import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { writeJson, type BatchManifest, type GenerationRecord } from "@figment/core";
import { ProjectRepository } from "@figment/project";

const temporaryRoots: string[] = [];
afterEach(async () => Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "figment-test-"));
  temporaryRoots.push(root);
  return new ProjectRepository(join(root, "projects"));
}

describe("ProjectRepository", () => {
  it("uses the creation year and creates the human-readable anatomy", async () => {
    const repository = await setup();
    const project = await repository.create({ title: "Goob", now: new Date("2027-01-02T10:00:00Z") });
    expect(project.year).toBe(2027);
    expect(project.path).toContain("/2027/goob");
    expect(await readdir(project.path)).toEqual(expect.arrayContaining(["brief.md", "decisions.md", "project.json", "references", "probes", "generations", "prototypes", "notes"]));
    expect((await repository.list())[0]?.metadata.createdAt).toBe("2027-01-02T10:00:00.000Z");
  });

  it("discovers generation metadata and persists qualitative review atomically", async () => {
    const repository = await setup();
    const project = await repository.create({ title: "Creature study", now: new Date("2026-08-21T10:00:00Z") });
    const batchPath = join(project.path, "probes", "2026-08-21-face-01");
    await mkdir(batchPath, { recursive: true });
    const manifest: BatchManifest = {
      schemaVersion: 1, id: "probe_1", projectId: project.metadata.id, kind: "probe", purpose: "Face study",
      createdAt: "2026-08-21T10:00:00.000Z", model: "image/example", prompt: "A face", references: [], parameters: {}, generationIds: ["001"],
    };
    const generation: GenerationRecord = {
      schemaVersion: 1, id: "001", provider: "krea", status: "completed", createdAt: manifest.createdAt,
      model: manifest.model, prompt: manifest.prompt, parameters: {}, references: [], outputFiles: ["001.png"], batchId: manifest.id,
      review: { favourite: false, signal: "unreviewed", tags: [] },
    };
    await writeJson(join(batchPath, "manifest.json"), manifest);
    await writeJson(join(batchPath, "001.json"), generation);

    const [handle] = await repository.generations(project);
    expect(handle?.metadata.prompt).toBe("A face");
    const reviewed = await repository.updateReview(handle!.metadataPath, { favourite: true, signal: "shortlist", tags: ["eyes"] });
    expect(reviewed.review).toMatchObject({ favourite: true, signal: "shortlist", tags: ["eyes"] });
    expect((await readdir(batchPath)).some((name) => name.endsWith(".tmp"))).toBe(false);
  });
});
