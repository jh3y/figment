import { access, mkdir, readFile, readdir } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import {
  atomicWrite,
  compactId,
  safeSlug,
  writeJson,
  type BatchManifest,
  type GenerationRecord,
  type ProjectMetadata,
  type ProjectStatus,
  type ReviewMetadata,
} from "../../core/src/index.ts";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".heic"]);
const PROJECT_FOLDERS = ["references", "probes", "generations", "prototypes", "notes"];

export interface ProjectHandle {
  year: number;
  path: string;
  metadata: ProjectMetadata;
}

export interface GenerationHandle {
  project: ProjectHandle;
  kind: "probe" | "batch";
  batchPath: string;
  manifest: BatchManifest;
  metadataPath: string;
  metadata: GenerationRecord;
}

export class ProjectRepository {
  readonly root: string;

  constructor(root = resolve(process.env.FIGMENT_PROJECTS_DIR ?? "projects")) {
    this.root = root;
  }

  async create(input: { title: string; description?: string; slug?: string; tags?: string[]; now?: Date }): Promise<ProjectHandle> {
    const now = input.now ?? new Date();
    const slug = safeSlug(input.slug ?? input.title);
    const year = now.getFullYear();
    const path = join(this.root, String(year), slug);
    try {
      await access(path);
      throw new Error(`Project already exists: ${relative(process.cwd(), path)}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Project already exists")) throw error;
    }

    await Promise.all(PROJECT_FOLDERS.map((folder) => mkdir(join(path, folder), { recursive: true })));
    const timestamp = now.toISOString();
    const metadata: ProjectMetadata = {
      id: compactId("project"),
      slug,
      title: input.title,
      description: input.description ?? "",
      createdAt: timestamp,
      modifiedAt: timestamp,
      status: "active",
      tags: input.tags ?? [],
    };
    await writeJson(join(path, "project.json"), metadata);
    await atomicWrite(join(path, "brief.md"), initialBrief(input.title));
    await atomicWrite(join(path, "decisions.md"), "# Decisions\n\nMeaningful creative choices are recorded here without rewriting history.\n");
    return { year, path, metadata };
  }

  async list(): Promise<ProjectHandle[]> {
    await mkdir(this.root, { recursive: true });
    const years = (await readdir(this.root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
      .sort((a, b) => b.name.localeCompare(a.name));
    const projects: ProjectHandle[] = [];
    for (const year of years) {
      for (const entry of await readdir(join(this.root, year.name), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const path = join(this.root, year.name, entry.name);
        try {
          const metadata = JSON.parse(await readFile(join(path, "project.json"), "utf8")) as ProjectMetadata;
          projects.push({ year: Number(year.name), path, metadata });
        } catch {
          // A directory is not a project until project.json is valid.
        }
      }
    }
    return projects.sort((a, b) => b.metadata.modifiedAt.localeCompare(a.metadata.modifiedAt));
  }

  async find(identifier: string): Promise<ProjectHandle> {
    const match = (await this.list()).find(
      (project) => project.metadata.id === identifier || project.metadata.slug === identifier,
    );
    if (!match) throw new Error(`Unknown project: ${identifier}`);
    return match;
  }

  async readMarkdown(project: ProjectHandle, name: "brief.md" | "decisions.md"): Promise<string> {
    return readFile(join(project.path, name), "utf8");
  }

  async references(project: ProjectHandle): Promise<string[]> {
    return walk(join(project.path, "references"), (path) => IMAGE_EXTENSIONS.has(extname(path).toLowerCase()));
  }

  async generations(project?: ProjectHandle): Promise<GenerationHandle[]> {
    const projects = project ? [project] : await this.list();
    const records: GenerationHandle[] = [];
    for (const current of projects) {
      for (const [folder, kind] of [["probes", "probe"], ["generations", "batch"]] as const) {
        const root = join(current.path, folder);
        for (const manifestPath of await walk(root, (path) => basename(path) === "manifest.json")) {
          const batchPath = dirname(manifestPath);
          try {
            const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as BatchManifest;
            for (const id of manifest.generationIds) {
              const metadataPath = join(batchPath, `${id}.json`);
              const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as GenerationRecord;
              records.push({ project: current, kind, batchPath, manifest, metadataPath, metadata });
            }
          } catch {
            // Preserve partially written/hand-authored directories; omit invalid records from Studio.
          }
        }
      }
    }
    return records.sort((a, b) => b.metadata.createdAt.localeCompare(a.metadata.createdAt));
  }

  async updateReview(metadataPath: string, patch: Record<string, unknown>): Promise<GenerationRecord> {
    const resolved = resolve(metadataPath);
    const allowedRoot = `${resolve(this.root)}${sep}`;
    if (!resolved.startsWith(allowedRoot) || basename(resolved) === "manifest.json") {
      throw new Error("Review target is outside the projects directory.");
    }
    const record = JSON.parse(await readFile(resolved, "utf8")) as GenerationRecord;
    const existing = record.review ?? { favourite: false, signal: "unreviewed", tags: [] };
    const next: ReviewMetadata = { ...existing };
    if (typeof patch.favourite === "boolean") next.favourite = patch.favourite;
    if (["unreviewed", "shortlist", "reject"].includes(String(patch.signal))) next.signal = String(patch.signal) as ReviewMetadata["signal"];
    if (patch.rating === null) delete next.rating;
    else if (typeof patch.rating === "number" && Number.isInteger(patch.rating) && patch.rating >= 1 && patch.rating <= 5) next.rating = patch.rating;
    if (Array.isArray(patch.tags) && patch.tags.every((tag) => typeof tag === "string")) next.tags = [...new Set(patch.tags)];
    if (typeof patch.note === "string") next.note = patch.note;
    if (patch.agentAnalysis && typeof patch.agentAnalysis === "object" && !Array.isArray(patch.agentAnalysis)) next.agentAnalysis = patch.agentAnalysis as Record<string, unknown>;
    next.updatedAt = new Date().toISOString();
    record.review = next;
    await writeJson(resolved, record);
    await this.touchProjectForPath(resolved);
    return record;
  }

  async updateStatus(identifier: string, status: ProjectStatus): Promise<ProjectMetadata> {
    if (!["active", "paused", "complete", "archived"].includes(status)) throw new Error(`Invalid project status: ${status}`);
    const project = await this.find(identifier);
    project.metadata.status = status;
    project.metadata.modifiedAt = new Date().toISOString();
    await writeJson(join(project.path, "project.json"), project.metadata);
    return project.metadata;
  }

  async touch(project: ProjectHandle): Promise<void> {
    project.metadata.modifiedAt = new Date().toISOString();
    await writeJson(join(project.path, "project.json"), project.metadata);
  }

  private async touchProjectForPath(path: string): Promise<void> {
    const project = (await this.list()).find((candidate) => path.startsWith(`${candidate.path}${sep}`));
    if (!project) return;
    await this.touch(project);
  }
}

async function walk(root: string, include: (path: string) => boolean): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return walk(path, include);
      return include(path) ? [path] : [];
    }));
    return nested.flat();
  } catch {
    return [];
  }
}

function initialBrief(title: string): string {
  return `# ${title}\n\n> This brief is intentionally incomplete. Record only what the human has provided; label hypotheses and open ideas clearly.\n\n## Objective\n\n## Concept\n\n## Audience / context\n\n## Creative principles\n\n## Desired feeling\n\n## Visual direction\n\n## Constraints\n\n## Anti-goals\n\n## References\n\n## Open questions\n\n## Current hypotheses\n\n## Success criteria\n`;
}
