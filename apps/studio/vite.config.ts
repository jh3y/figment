import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { writeJson, type ProjectStatus } from "../../packages/core/src/index.ts";
import { ProjectRepository, type GenerationHandle } from "../../packages/project/src/repository.ts";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const projectsRoot = resolve(process.env.FIGMENT_PROJECTS_DIR ?? join(repositoryRoot, "projects"));
const repository = new ProjectRepository(projectsRoot);

export default defineConfig({
  plugins: [react(), filesystemApi()],
  base: "./",
  server: { host: "127.0.0.1", port: 4173 },
});

function filesystemApi(): Plugin {
  return {
    name: "figment-filesystem-api",
    configureServer(server) {
      let suppressReloadUntil = 0;
      let reloadTimer: ReturnType<typeof setTimeout> | undefined;
      server.watcher.add(projectsRoot);
      server.watcher.on("all", (_event, changedPath) => {
        const path = resolve(changedPath);
        if (!inside(projectsRoot, path) || path.endsWith(".tmp") || path.endsWith("shot-index.json") || Date.now() < suppressReloadUntil) return;
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => server.ws.send({ type: "full-reload", path: "*" }), 450);
      });
      server.middlewares.use(async (request, response, next) => {
        try {
          const url = new URL(request.url ?? "/", "http://localhost");
          if (request.method === "GET" && url.pathname === "/api/studio") return json(response, await studioData());
          if (request.method === "POST" && url.pathname === "/api/review") {
            const body = await readBody(request) as { metadataPath?: string; review?: Record<string, unknown> };
            if (!body.metadataPath || !body.review) return json(response, { error: "Invalid review payload" }, 400);
            suppressReloadUntil = Date.now() + 1_000;
            const record = await repository.updateReview(resolve(repositoryRoot, body.metadataPath), body.review);
            return json(response, record);
          }
          if (request.method === "POST" && url.pathname === "/api/project-status") {
            const body = await readBody(request) as { projectId?: string; status?: ProjectStatus };
            if (!body.projectId || !body.status || !["active", "paused", "complete", "archived"].includes(body.status)) return json(response, { error: "Invalid project status payload" }, 400);
            suppressReloadUntil = Date.now() + 1_000;
            return json(response, await repository.updateStatus(body.projectId, body.status));
          }
          if (request.method === "GET" && url.pathname === "/project-file") {
            const relativePath = url.searchParams.get("path") ?? "";
            const path = resolve(repositoryRoot, relativePath);
            if (!path.startsWith(`${projectsRoot}${sep}`)) return json(response, { error: "Invalid file path" }, 403);
            const info = await stat(path);
            if (!info.isFile()) return json(response, { error: "Not found" }, 404);
            response.setHeader("Content-Type", mimeType(path));
            response.setHeader("Cache-Control", "no-cache");
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
      const data = await staticStudioData(async (sourcePath, fileName) => {
        this.emitFile({ type: "asset", fileName, source: await readFile(sourcePath) });
        return `./${fileName.split("/").map(encodeURIComponent).join("/")}`;
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
    references: (await repository.references(project)).map(fileDescriptor),
    prototypes: await prototypeDescriptors(project.path, project.year, project.metadata.slug),
  })));
  const handles = await repository.generations();
  const numbers = await ensureShotNumbers(handles);
  const generations = handles.flatMap((handle) => handle.metadata.outputFiles.map((outputFile, outputIndex) => ({
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
    imageUrl: fileUrl(join(handle.batchPath, outputFile)),
  })));
  return { scannedAt: new Date().toISOString(), projects: projectData, generations };
}

interface ShotIndex { schemaVersion: 1; nextNumber: number; shots: Record<string, number> }

async function ensureShotNumbers(handles: GenerationHandle[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const byProject = new Map<string, GenerationHandle[]>();
  for (const handle of handles.filter((candidate) => candidate.metadata.outputFiles.length > 0)) byProject.set(handle.project.path, [...(byProject.get(handle.project.path) ?? []), handle]);
  for (const [projectPath, projectHandles] of byProject) {
    const indexPath = join(projectPath, "shot-index.json");
    let index: ShotIndex | undefined;
    try { index = JSON.parse(await readFile(indexPath, "utf8")) as ShotIndex; } catch { /* Created below. */ }
    const valid = index?.schemaVersion === 1 && index.shots && typeof index.shots === "object";
    const next: ShotIndex = valid ? index! : { schemaVersion: 1, nextNumber: 1, shots: {} };
    let changed = !valid;
    const missing = projectHandles.filter((handle) => next.shots[relative(projectPath, handle.metadataPath)] === undefined);
    if (!valid) {
      for (const handle of missing) next.shots[relative(projectPath, handle.metadataPath)] = next.nextNumber++;
    } else {
      for (const handle of missing.sort((a, b) => a.metadata.createdAt.localeCompare(b.metadata.createdAt))) {
        next.shots[relative(projectPath, handle.metadataPath)] = next.nextNumber++;
        changed = true;
      }
    }
    if (changed) await writeJson(indexPath, next);
    for (const handle of projectHandles) result.set(handle.metadataPath, next.shots[relative(projectPath, handle.metadataPath)]!);
  }
  return result;
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

async function staticStudioData(emit: (sourcePath: string, fileName: string) => Promise<string>) {
  const data = await studioData();
  const projects = await Promise.all(data.projects.map(async (project) => ({
    ...project,
    references: await Promise.all(project.references.map(async (reference) => ({ ...reference, url: await emit(resolve(repositoryRoot, reference.path), staticAssetName(reference.path)) }))),
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
    const path = join(dirname(resolve(repositoryRoot, generation.metadataPath)), generation.outputFile);
    return { ...generation, imageUrl: await emit(path, staticAssetName(relative(repositoryRoot, path))) };
  }));
  return { ...data, readOnly: true, projects, generations };
}

function fileDescriptor(path: string) {
  return { name: path.split(sep).at(-1), path: relative(repositoryRoot, path), url: fileUrl(path) };
}
function fileUrl(path: string): string { return `/project-file?path=${encodeURIComponent(relative(repositoryRoot, path))}`; }
function mimeType(path: string): string {
  return ({
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif", ".heic": "image/heic", ".svg": "image/svg+xml",
    ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".mp4": "video/mp4", ".webm": "video/webm",
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
function staticAssetName(path: string): string { return `project-assets/${path.split(sep).join("/")}`; }
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
