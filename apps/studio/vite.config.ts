import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { ProjectRepository } from "../../packages/project/src/repository.ts";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const projectsRoot = resolve(process.env.FIGMENT_PROJECTS_DIR ?? join(repositoryRoot, "projects"));
const repository = new ProjectRepository(projectsRoot);

export default defineConfig({
  plugins: [react(), filesystemApi()],
  server: { host: "127.0.0.1", port: 4173 },
});

function filesystemApi(): Plugin {
  return {
    name: "figment-filesystem-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        try {
          const url = new URL(request.url ?? "/", "http://localhost");
          if (request.method === "GET" && url.pathname === "/api/studio") return json(response, await studioData());
          if (request.method === "POST" && url.pathname === "/api/review") {
            const body = await readBody(request) as { metadataPath?: string; review?: Record<string, unknown> };
            if (!body.metadataPath || !body.review) return json(response, { error: "Invalid review payload" }, 400);
            const record = await repository.updateReview(resolve(repositoryRoot, body.metadataPath), body.review);
            return json(response, record);
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
          next();
        } catch (error) {
          json(response, { error: error instanceof Error ? error.message : String(error) }, 500);
        }
      });
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
    prototypes: await directoryNames(join(project.path, "prototypes")),
  })));
  const generations = (await repository.generations()).flatMap((handle) => handle.metadata.outputFiles.map((outputFile, outputIndex) => ({
    projectId: handle.project.metadata.id,
    projectSlug: handle.project.metadata.slug,
    projectTitle: handle.project.metadata.title,
    kind: handle.kind,
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

function fileDescriptor(path: string) {
  return { name: path.split(sep).at(-1), path: relative(repositoryRoot, path), url: fileUrl(path) };
}
function fileUrl(path: string): string { return `/project-file?path=${encodeURIComponent(relative(repositoryRoot, path))}`; }
async function directoryNames(path: string): Promise<string[]> {
  try { return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name); }
  catch { return []; }
}
function mimeType(path: string): string {
  return ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif", ".heic": "image/heic" } as Record<string, string>)[extname(path).toLowerCase()] ?? "application/octet-stream";
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
