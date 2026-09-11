import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import type { ProjectStatus } from "../../packages/core/src/index.ts";
import { ProjectRepository, type GenerationHandle } from "../../packages/project/src/repository.ts";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const projectsRoot = resolve(process.env.FIGMENT_PROJECTS_DIR ?? join(repositoryRoot, "projects"));
const repository = new ProjectRepository(projectsRoot);

// Galleries render source art into ~225px cells. Decoding a 5504x3072 PNG to fill one costs ~65MB of
// bitmap per card, so Studio serves a downscaled copy to the grid and keeps the original for the lightbox.
const THUMBNAIL_WIDTH = 480;
const THUMBNAIL_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".tif", ".tiff"]);
const thumbnailRoot = join(repositoryRoot, ".cache", "thumbnails");
const pendingThumbnails = new Map<string, Promise<Buffer | undefined>>();
type Resizer = (input: string) => { rotate: () => { resize: (options: { width: number; withoutEnlargement: boolean }) => { webp: (options: { quality: number }) => { toBuffer: () => Promise<Buffer> } } } };
let resizer: Resizer | null | undefined;

// sharp is optional so Studio still installs on a platform without a prebuilt binary; without it the
// grid falls back to full-size originals, which is slower to scroll but never broken.
async function loadResizer(): Promise<Resizer | null> {
  if (resizer !== undefined) return resizer;
  try { resizer = (await import("sharp")).default as unknown as Resizer; }
  catch {
    resizer = null;
    console.warn("[figment] sharp is not installed — Studio will serve full-size images to the gallery. Run `pnpm install` to restore fast scrolling.");
  }
  return resizer;
}

function isThumbnailable(path: string): boolean { return THUMBNAIL_EXTENSIONS.has(extname(path).toLowerCase()); }

// Keyed by the source fingerprint, so an edited file lands on a different cache entry instead of a stale one.
async function thumbnail(path: string, width: number, fingerprint: string): Promise<Buffer | undefined> {
  const resize = await loadResizer();
  if (!resize || !isThumbnailable(path)) return undefined;
  const key = createHash("sha1").update(`${path}:${fingerprint}:${width}`).digest("hex");
  const destination = join(thumbnailRoot, `${key}.webp`);
  try { return await readFile(destination); } catch { /* Not generated yet. */ }
  const inFlight = pendingThumbnails.get(destination);
  if (inFlight) return inFlight;
  const work = (async () => {
    try {
      await mkdir(thumbnailRoot, { recursive: true });
      const buffer = await resize(path).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
      // Rename in from a temp file so a killed process cannot leave a truncated thumbnail behind.
      const temporary = `${destination}.${process.pid}.tmp`;
      await writeFile(temporary, buffer);
      await rename(temporary, destination);
      return buffer;
    } catch { return undefined; }
    finally { pendingThumbnails.delete(destination); }
  })();
  pendingThumbnails.set(destination, work);
  return work;
}

export default defineConfig({
  plugins: [react(), filesystemApi()],
  base: "./",
  server: { host: "127.0.0.1", port: 4173 },
});

function filesystemApi(): Plugin {
  return {
    name: "figment-filesystem-api",
    configureServer(server) {
      let suppressWatchUntil = 0;
      let changedAt: string | undefined;
      let activityTimer: ReturnType<typeof setTimeout> | undefined;
      let recheckTimer: ReturnType<typeof setTimeout> | undefined;
      // Studio is told what changed and decides when to pull it in; a full reload would throw away the view mid-generation.
      const publishActivity = async () => {
        const activity = await activityState(changedAt);
        server.ws.send({ type: "custom", event: "figment:activity", data: activity });
        clearTimeout(recheckTimer);
        // An abandoned run stops writing, so keep re-checking until its records age out of the active window.
        if (activity.generating) recheckTimer = setTimeout(() => void publishActivity(), 15_000);
      };
      server.watcher.add(projectsRoot);
      server.watcher.on("all", (_event, changedPath) => {
        const path = resolve(changedPath);
        if (!inside(projectsRoot, path) || path.endsWith(".tmp") || path.endsWith("shot-index.json") || Date.now() < suppressWatchUntil) return;
        changedAt = new Date().toISOString();
        clearTimeout(activityTimer);
        activityTimer = setTimeout(() => void publishActivity(), 450);
      });
      server.ws.on("connection", () => void publishActivity());
      server.middlewares.use(async (request, response, next) => {
        try {
          const url = new URL(request.url ?? "/", "http://localhost");
          if (request.method === "GET" && url.pathname === "/api/studio") return json(response, await studioData());
          if (request.method === "POST" && url.pathname === "/api/review") {
            const body = await readBody(request) as { metadataPath?: string; review?: Record<string, unknown> };
            if (!body.metadataPath || !body.review) return json(response, { error: "Invalid review payload" }, 400);
            suppressWatchUntil = Date.now() + 1_000;
            const record = await repository.updateReview(resolve(repositoryRoot, body.metadataPath), body.review);
            return json(response, record);
          }
          if (request.method === "POST" && url.pathname === "/api/project-status") {
            const body = await readBody(request) as { projectId?: string; status?: ProjectStatus };
            if (!body.projectId || !body.status || !["active", "paused", "complete", "archived"].includes(body.status)) return json(response, { error: "Invalid project status payload" }, 400);
            suppressWatchUntil = Date.now() + 1_000;
            return json(response, await repository.updateStatus(body.projectId, body.status));
          }
          if (request.method === "POST" && url.pathname === "/api/delete-output") {
            const body = await readBody(request) as { metadataPath?: string; outputFile?: string };
            if (!body.metadataPath || !body.outputFile) return json(response, { error: "Invalid output deletion payload" }, 400);
            suppressWatchUntil = Date.now() + 1_000;
            await repository.deleteOutput(resolve(repositoryRoot, body.metadataPath), body.outputFile);
            return json(response, { ok: true });
          }
          if (request.method === "POST" && url.pathname === "/api/delete-prototype") {
            const body = await readBody(request) as { projectId?: string; slug?: string };
            if (!body.projectId || !body.slug) return json(response, { error: "Invalid prototype deletion payload" }, 400);
            suppressWatchUntil = Date.now() + 1_000;
            await repository.deletePrototype(body.projectId, body.slug);
            return json(response, { ok: true });
          }
          if (request.method === "GET" && url.pathname === "/project-file") {
            const relativePath = url.searchParams.get("path") ?? "";
            const path = resolve(repositoryRoot, relativePath);
            if (!path.startsWith(`${projectsRoot}${sep}`)) return json(response, { error: "Invalid file path" }, 403);
            const info = await stat(path);
            if (!info.isFile()) return json(response, { error: "Not found" }, 404);
            const fingerprint = `${info.mtimeMs}-${info.size}`;
            const width = Number(url.searchParams.get("w"));
            if (Number.isFinite(width) && width > 0) {
              const buffer = await thumbnail(path, Math.min(Math.round(width), 2048), fingerprint);
              if (buffer) {
                response.setHeader("Content-Type", "image/webp");
                // The gallery asks for a URL carrying the source fingerprint, so this copy can never go stale.
                response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
                response.end(buffer);
                return;
              }
            }
            // Originals stay revalidated rather than cached outright, but a 304 beats re-sending 19MB on every look.
            const etag = `"${fingerprint}"`;
            response.setHeader("Content-Type", mimeType(path));
            response.setHeader("Cache-Control", "no-cache");
            response.setHeader("ETag", etag);
            if (request.headers["if-none-match"] === etag) { response.statusCode = 304; response.end(); return; }
            response.end(await readFile(path));
            return;
          }
          if (request.method === "GET" && url.pathname.startsWith("/prototype-preview/")) {
            return servePrototype(url.pathname, response);
          }
          next();
        } catch (error) {
          json(response, { error: error instanceof Error ? error.message : String(error) }, 500);
        }
      });
    },
    async generateBundle() {
      const emitAsset = (fileName: string, source: Buffer) => {
        this.emitFile({ type: "asset", fileName, source });
        return `./${fileName.split("/").map(encodeURIComponent).join("/")}`;
      };
      const data = await staticStudioData({
        file: async (sourcePath, fileName) => emitAsset(fileName, await readFile(sourcePath)),
        thumbnail: async (sourcePath, fileName) => {
          const info = await fileInfo(sourcePath);
          if (!info) return undefined;
          const buffer = await thumbnail(sourcePath, THUMBNAIL_WIDTH, `${info.mtimeMs}-${info.size}`);
          return buffer ? emitAsset(`${fileName}.w${THUMBNAIL_WIDTH}.webp`, buffer) : undefined;
        },
      });
      this.emitFile({ type: "asset", fileName: "studio-data.json", source: JSON.stringify(data) });
    },
  };
}

async function studioData() {
  const projects = await repository.list();
  const projectData = await Promise.all(projects.map(async (project) => ({
    year: project.year,
    metadata: project.metadata,
    brief: await repository.readMarkdown(project, "brief.md"),
    decisions: await repository.readMarkdown(project, "decisions.md"),
    references: await Promise.all((await repository.references(project)).map(fileDescriptor)),
    prototypes: await prototypeDescriptors(project.path, project.year, project.metadata.slug),
  })));
  const handles = await repository.generations();
  const numbers = await repository.shotNumbers();
  // Provenance may be committed without its generated assets, so the record can outlive the file it describes.
  const generations = (await Promise.all(handles.flatMap((handle) => handle.metadata.outputFiles.map(async (outputFile, outputIndex) => {
    const outputPath = join(handle.batchPath, outputFile);
    const info = await fileInfo(outputPath);
    // A mesh job answers with the model and a rendered preview. The preview is the
    // mesh's poster rather than a shot of its own, so it is attached here and dropped
    // from the gallery below instead of appearing as a second card for one generation.
    const posterFile = isModelFile(outputFile)
      ? handle.metadata.outputFiles.find((candidate) => !isModelFile(candidate) && !isVideoFile(candidate))
      : undefined;
    const posterPath = posterFile ? join(handle.batchPath, posterFile) : undefined;
    const posterInfo = posterPath ? await fileInfo(posterPath) : undefined;
    return {
      projectId: handle.project.metadata.id,
      projectSlug: handle.project.metadata.slug,
      projectTitle: handle.project.metadata.title,
      kind: handle.kind,
      category: handle.manifest.category ?? legacyCategory(handle.manifest.purpose),
      shotNumber: numbers.get(handle.metadataPath)!,
      batchName: handle.batchPath.split(sep).at(-1),
      manifest: handle.manifest,
      metadata: handle.metadata,
      metadataPath: relative(repositoryRoot, handle.metadataPath),
      outputIndex,
      outputFile,
      imageUrl: fileUrl(outputPath),
      thumbnailUrl: posterPath && posterInfo
        ? thumbnailUrl(posterPath, posterInfo.mtimeMs, posterInfo.size)
        : info && !isVideoFile(outputFile) && !isModelFile(outputFile) ? thumbnailUrl(outputPath, info.mtimeMs, info.size) : undefined,
      posterUrl: posterPath && posterInfo ? fileUrl(posterPath) : undefined,
      posterFile,
      mediaType: mediaTypeFor(outputFile),
      available: Boolean(info),
    };
  })))).filter((item, _index, all) => {
    // Drop an image that is already serving as some mesh's poster in the same batch.
    if (item.mediaType !== "image") return true;
    return !all.some((other) => other.mediaType === "model" && other.metadataPath === item.metadataPath && other.posterFile === item.outputFile);
  });
  return { scannedAt: new Date().toISOString(), projects: projectData, generations, activity: await activityFrom(handles) };
}

const ACTIVE_JOB_STATUSES = new Set(["backlogged", "queued", "scheduled", "processing", "sampling", "intermediate-complete"]);
const ACTIVITY_STALE_MS = 180_000;

interface StudioActivityBatch { projectId: string; projectTitle: string; batchName: string; kind: "probe" | "batch"; model: string; completed: number; total: number }
interface StudioActivity { generating: boolean; batches: StudioActivityBatch[]; outputs: number; changedAt?: string; checkedAt: string }

async function activityState(changedAt?: string): Promise<StudioActivity> {
  return activityFrom(await repository.generations(), changedAt);
}

async function activityFrom(handles: GenerationHandle[], changedAt?: string): Promise<StudioActivity> {
  const groups = new Map<string, GenerationHandle[]>();
  let outputs = 0;
  for (const handle of handles) {
    outputs += handle.metadata.outputFiles.length;
    groups.set(handle.batchPath, [...(groups.get(handle.batchPath) ?? []), handle]);
  }
  const batches: StudioActivityBatch[] = [];
  for (const [batchPath, records] of groups) {
    const running = records.filter((record) => ACTIVE_JOB_STATUSES.has(record.metadata.status));
    if (!running.length || !(await writtenRecently(running.map((record) => record.metadataPath)))) continue;
    const first = records[0]!;
    batches.push({
      projectId: first.project.metadata.id,
      projectTitle: first.project.metadata.title,
      batchName: batchPath.split(sep).at(-1)!,
      kind: first.kind,
      model: first.manifest.model,
      completed: records.filter((record) => record.metadata.status === "completed").length,
      total: first.manifest.generationIds.length,
    });
  }
  return { generating: batches.length > 0, batches, outputs, changedAt, checkedAt: new Date().toISOString() };
}

// A record only counts as in flight while something is still writing it, so a crashed run cannot hold Studio forever.
async function writtenRecently(paths: string[]): Promise<boolean> {
  const cutoff = Date.now() - ACTIVITY_STALE_MS;
  for (const path of paths) {
    try { if ((await stat(path)).mtimeMs > cutoff) return true; }
    catch { /* The record was removed between the scan and this check. */ }
  }
  return false;
}
function isVideoFile(path: string): boolean { return [".mp4", ".webm", ".ogv", ".mov"].includes(extname(path).toLowerCase()); }
// A mesh cannot be thumbnailed by sharp and must not be handed to an <img>, so it
// gets its own media type rather than falling through to the image branch.
function isModelFile(path: string): boolean { return [".glb", ".gltf"].includes(extname(path).toLowerCase()); }
function mediaTypeFor(path: string): "image" | "video" | "model" {
  if (isVideoFile(path)) return "video";
  if (isModelFile(path)) return "model";
  return "image";
}

function legacyCategory(purpose: string): string {
  const value = purpose.toLowerCase();
  if (value.includes("merch")) return "merch";
  if (value.includes("character map") || value.includes("consistency")) return "character-maps";
  if (value.includes("headshot") || value.includes("face") || value.includes("crop")) return "headshots";
  if (value.includes("aesthetic") || value.includes("manifestation")) return "aesthetics";
  if (value.includes("character dna") || value.includes("silhouette")) return "character-dna";
  return "concepts";
}

interface StaticEmitter {
  file: (sourcePath: string, fileName: string) => Promise<string>;
  thumbnail: (sourcePath: string, fileName: string) => Promise<string | undefined>;
}

async function staticStudioData(emitter: StaticEmitter) {
  const emit = emitter.file;
  const data = await studioData();
  const projects = await Promise.all(data.projects.map(async (project) => ({
    ...project,
    references: await Promise.all(project.references.map(async (reference) => {
      const source = resolve(repositoryRoot, reference.path);
      const fileName = staticAssetName(source);
      return { ...reference, url: await emit(source, fileName), thumbnailUrl: await emitter.thumbnail(source, fileName) };
    })),
    prototypes: await Promise.all(project.prototypes.map(async (prototype) => {
      if (!prototype.entry || !prototype.launchUrl?.startsWith("/prototype-preview/")) return prototype;
      const root = resolve(repositoryRoot, prototype.path);
      for (const path of await filesUnder(root)) {
        const destination = ["project-prototypes", String(project.year), project.metadata.slug, prototype.slug, relative(root, path)].join("/").replaceAll(sep, "/");
        await emit(path, destination);
      }
      return { ...prototype, launchUrl: `./project-prototypes/${[String(project.year), project.metadata.slug, prototype.slug, prototype.entry].flatMap((part) => part.split(sep)).map(encodeURIComponent).join("/")}` };
    })),
  })));
  const generations = await Promise.all(data.generations.map(async (generation) => {
    if (!generation.available) return generation;
    const path = join(dirname(resolve(repositoryRoot, generation.metadataPath)), generation.outputFile);
    const fileName = staticAssetName(path);
    return { ...generation, imageUrl: await emit(path, fileName), thumbnailUrl: await emitter.thumbnail(path, fileName) };
  }));
  return { ...data, readOnly: true, activity: undefined, projects, generations };
}

async function fileDescriptor(path: string) {
  const info = await fileInfo(path);
  return {
    name: path.split(sep).at(-1),
    path: relative(repositoryRoot, path),
    url: fileUrl(path),
    thumbnailUrl: info ? thumbnailUrl(path, info.mtimeMs, info.size) : undefined,
  };
}
function fileUrl(path: string): string { return `/project-file?path=${encodeURIComponent(relative(repositoryRoot, path))}`; }
// `v` is never read by the server; it only moves the URL when the file changes so the immutable copy expires.
function thumbnailUrl(path: string, mtimeMs: number, size: number): string | undefined {
  return isThumbnailable(path) ? `${fileUrl(path)}&w=${THUMBNAIL_WIDTH}&v=${Math.round(mtimeMs)}-${size}` : undefined;
}
async function fileInfo(path: string) { try { const info = await stat(path); return info.isFile() ? info : undefined; } catch { return undefined; } }
function mimeType(path: string): string {
  return ({
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif", ".heic": "image/heic", ".svg": "image/svg+xml",
    ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".ogv": "video/ogg",
    ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
  } as Record<string, string>)[extname(path).toLowerCase()] ?? "application/octet-stream";
}

interface PrototypeManifest { title?: string; description?: string; entry?: string; url?: string; embed?: boolean }

async function prototypeDescriptors(projectPath: string, year: number, slug: string) {
  const root = join(projectPath, "prototypes");
  let names: string[];
  try { names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(); }
  catch { return []; }
  return Promise.all(names.map(async (name) => {
    const directory = join(root, name);
    const manifest = await readPrototypeManifest(join(directory, "prototype.json"));
    const entry = safePrototypeEntry(manifest?.entry ?? "index.html");
    const hasEntry = entry ? await isFile(join(directory, entry)) : false;
    const declaredUrl = safePrototypeUrl(manifest?.url);
    const launchUrl = declaredUrl ?? (hasEntry ? `/prototype-preview/${encodeURIComponent(String(year))}/${encodeURIComponent(slug)}/${encodeURIComponent(name)}/${entry!.split(sep).map(encodeURIComponent).join("/")}` : undefined);
    return {
      slug: name,
      title: manifest?.title?.trim() || name.replaceAll("-", " "),
      description: manifest?.description?.trim() || undefined,
      path: relative(repositoryRoot, directory),
      launchUrl,
      entry: hasEntry ? entry : undefined,
      embeddable: Boolean(launchUrl) && manifest?.embed !== false,
      kind: manifest ? "declared" as const : hasEntry ? "static" as const : "folder" as const,
    };
  }));
}

async function servePrototype(pathname: string, response: ServerResponse): Promise<void> {
  const parts = pathname.slice("/prototype-preview/".length).split("/").filter(Boolean).map(decodeURIComponent);
  const [year, projectSlug, prototypeSlug, ...assetParts] = parts;
  if (!year || !projectSlug || !prototypeSlug) return json(response, { error: "Invalid prototype path" }, 400);
  const root = resolve(projectsRoot, year, projectSlug, "prototypes", prototypeSlug);
  let path = resolve(root, ...assetParts);
  if (!inside(root, path)) return json(response, { error: "Invalid prototype path" }, 403);
  try {
    const info = await stat(path);
    if (info.isDirectory()) path = join(path, "index.html");
    if (!(await stat(path)).isFile()) return json(response, { error: "Not found" }, 404);
    response.setHeader("Content-Type", mimeType(path));
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.end(await readFile(path));
  } catch { return json(response, { error: "Not found" }, 404); }
}

async function readPrototypeManifest(path: string): Promise<PrototypeManifest | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as PrototypeManifest;
    return value && typeof value === "object" ? value : undefined;
  } catch { return undefined; }
}
async function isFile(path: string): Promise<boolean> { try { return (await stat(path)).isFile(); } catch { return false; } }
async function filesUnder(root: string): Promise<string[]> {
  const results: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) results.push(...await filesUnder(path));
    else if (entry.isFile()) results.push(path);
  }
  return results;
}
// Named against the projects root rather than the repository, because FIGMENT_PROJECTS_DIR may point
// outside the checkout; naming against the repository there yields ".." segments that Rollup refuses to
// emit, which failed the whole build. The "projects/" prefix keeps output paths unchanged for the default
// layout. Anything that somehow sits outside the projects root falls back to a flat, collision-free name.
function staticAssetName(absolutePath: string): string {
  const name = inside(projectsRoot, absolutePath)
    ? relative(projectsRoot, absolutePath).split(sep).join("/")
    : `${createHash("sha1").update(absolutePath).digest("hex")}${extname(absolutePath)}`;
  return `project-assets/projects/${name}`;
}
function inside(root: string, path: string): boolean { const value = relative(root, path); return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value)); }
function safePrototypeEntry(value: string): string | undefined { const normalized = value.trim(); if (!normalized) return undefined; const path = resolve("/prototype", normalized); return inside("/prototype", path) ? relative("/prototype", path) : undefined; }
function safePrototypeUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined; }
  catch { return undefined; }
}
function json(response: ServerResponse, value: unknown, status = 200): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}
async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
