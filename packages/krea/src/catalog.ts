import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { writeJson, type ModelCache } from "@figment/core";
import { KreaAdapter } from "./client.js";

export class ModelCatalog {
  readonly cachePath: string;

  constructor(cachePath = resolve(".cache/krea/image-models.json")) {
    this.cachePath = cachePath;
  }

  async get(options: { refresh?: boolean } = {}): Promise<ModelCache> {
    if (!options.refresh) {
      try {
        return JSON.parse(await readFile(this.cachePath, "utf8")) as ModelCache;
      } catch {
        // First use refreshes from Krea.
      }
    }
    const client = new KreaAdapter();
    const models = await client.listImageModels();
    const refreshedAt = new Date().toISOString();
    for (const model of models) if (model.price) model.price.refreshedAt = refreshedAt;
    const cache: ModelCache = { schemaVersion: 1, refreshedAt, source: "krea-live-mcp", models };
    await mkdir(dirname(this.cachePath), { recursive: true });
    await writeJson(this.cachePath, cache);
    return cache;
  }
}
