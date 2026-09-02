#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { compactId, safeSlug, writeJson, type BatchManifest, type CostRecord, type GenerationRecord, type ReferenceRecord } from "@figment/core";
import { KreaAdapter, ModelCatalog, type KreaJob } from "@figment/krea";
import { ProjectRepository, type GenerationHandle, type ProjectHandle } from "@figment/project";

try {
  if (process.loadEnvFile) process.loadEnvFile(".env");
  else {
    for (const line of (await readFile(".env", "utf8")).split("\n")) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2]!.replace(/^['"]|['"]$/g, "");
    }
  }
} catch { /* Environment variables may already be exported. */ }

const repository = new ProjectRepository();
const [command = "help", ...argv] = process.argv.slice(2);
const args = parseArgs(argv);

try {
  switch (command) {
    case "new": await createProject(); break;
    case "projects": await listProjects(); break;
    case "models": await listModels(); break;
    case "probe": await generate("probe"); break;
    case "generate": await generate("batch"); break;
    case "review": await reviewGeneration(); break;
    case "reconcile": await reconcile(); break;
    case "touch": await touchProject(); break;
    default: help();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  output({ error: message }, message, true);
  process.exitCode = 1;
}

async function createProject(): Promise<void> {
  const title = stringArg("title") ?? args.positionals.join(" ");
  if (!title) throw new Error("Usage: pnpm lab new --title \"Project title\" [--description ...]");
  const project = await repository.create({
    title,
    description: stringArg("description"),
    slug: stringArg("slug"),
    tags: values("tag"),
  });
  output(projectSummary(project), `Created ${project.metadata.title} at ${relative(process.cwd(), project.path)}`);
}

async function listProjects(): Promise<void> {
  const projects = (await repository.list()).map(projectSummary);
  output(projects, projects.length ? projects.map((project) => `${project.year}/${project.slug}  ${project.title}`).join("\n") : "No projects yet.");
}

async function listModels(): Promise<void> {
  const model = stringArg("schema");
  if (model) {
    const schema = await new KreaAdapter().getModelSchema(model);
    output({ model, refreshedAt: new Date().toISOString(), schema }, JSON.stringify(schema, null, 2));
    return;
  }
  const cache = await new ModelCatalog().get({ refresh: booleanArg("refresh") });
  output(cache, [
    `Krea image models — refreshed ${cache.refreshedAt}`,
    ...cache.models.map((item) => `${item.id}${item.price ? `  ~$${item.price.amount.toFixed(3)}` : "  cost unavailable"}${item.description ? `  ${item.description}` : ""}`),
  ].join("\n"));
}

async function generate(kind: "probe" | "batch"): Promise<void> {
  const projectId = args.positionals[0];
  const model = required("model");
  const prompt = required("prompt");
  if (!projectId) throw new Error(`Usage: pnpm lab ${kind === "probe" ? "probe" : "generate"} <project> --model <id> --prompt <text>`);
  const project = await repository.find(projectId);
  const count = Math.max(1, Number(stringArg("count") ?? (kind === "probe" ? 1 : 4)));
  if (!Number.isInteger(count) || count > 50) throw new Error("--count must be an integer between 1 and 50.");
  if (kind === "probe" && count > 4) throw new Error("A probe is limited to four outputs. Use `pnpm lab generate` for a larger controlled batch.");
  const parameters = jsonArg("params");
  const references = await prepareReferences(project);
  const referenceField = stringArg("reference-field");
  if (references.length && !referenceField) {
    throw new Error("References vary by model. Inspect `pnpm lab models --schema <model>`, then pass --reference-field <schema-field>.");
  }
  if (referenceField) {
    const template = stringArg("reference-template");
    const values = references.map((reference) => template
      ? replaceUrlTemplate(JSON.parse(template) as unknown, reference.assetUrl!)
      : reference.assetUrl);
    const asArray = booleanArg("reference-array") || values.length > 1 || await expectsArray(model, referenceField);
    setPath(parameters, referenceField, asArray ? values : values[0]);
  }
  const estimate = await estimateCost(model, count);
  const estimateText = estimate ? `$${estimate.amount.toFixed(3)} estimated total` : "cost unavailable from the live catalogue";
  if (kind === "batch" && (count > 4 || (estimate?.amount ?? 0) > 1) && !booleanArg("yes")) {
    throw new Error(`Planned batch: ${count} × ${model}; ${estimateText}. Re-run with --yes after reviewing the cost.`);
  }

  const createdAt = new Date().toISOString();
  const purpose = stringArg("purpose") ?? (kind === "probe" ? "Targeted creative probe" : "Controlled generation batch");
  const batchPath = await nextBatchPath(project, kind, purpose, createdAt);
  const generationIds = Array.from({ length: count }, (_, index) => String(index + 1).padStart(3, "0"));
  const manifest: BatchManifest = {
    schemaVersion: 1,
    id: compactId(kind),
    projectId: project.metadata.id,
    kind,
    category: safeSlug(stringArg("category") ?? (kind === "probe" ? "probes" : "generations")),
    purpose,
    hypothesis: stringArg("hypothesis"),
    variable: stringArg("variable"),
    createdAt,
    model,
    prompt,
    references,
    parameters,
    estimatedCost: estimate,
    generationIds,
  };
  await mkdir(batchPath, { recursive: true });
  await writeJson(join(batchPath, "manifest.json"), manifest);
  process.stderr.write(`Running ${count} × ${model}; ${estimateText}.\n`);
  const client = new KreaAdapter();
  const completed: GenerationRecord[] = [];
  for (const id of generationIds) {
    const metadataPath = join(batchPath, `${id}.json`);
    const record = initialGeneration(id, manifest, references);
    await writeJson(metadataPath, record);
    try {
      const submitted = await client.submit(model, { prompt, ...parameters });
      record.jobId = submitted.jobId;
      record.status = submitted.status;
      record.providerResult = submitted.raw;
      await writeJson(metadataPath, record);
      const terminal = await client.wait(submitted.jobId, async (job) => {
        record.status = job.status === "completed" ? "processing" : job.status;
        record.providerResult = job.raw;
        record.error = job.error;
        await writeJson(metadataPath, record);
      });
      await finishGeneration(client, batchPath, record, terminal);
      await writeJson(metadataPath, record);
      completed.push(record);
      process.stderr.write(`${id}: ${record.status}${record.actualCost ? ` ($${record.actualCost.amount.toFixed(3)})` : ""}\n`);
    } catch (error) {
      record.status = record.jobId ? "interrupted" : "failed";
      record.error = { message: error instanceof Error ? error.message : String(error) };
      await writeJson(metadataPath, record);
      process.stderr.write(`${id}: ${record.status} — ${record.error.message}\n`);
    }
  }
  const actualAmount = completed.reduce((sum, item) => sum + (item.actualCost?.amount ?? 0), 0);
  if (completed.length === count && completed.every((item) => item.actualCost)) manifest.actualCost = { currency: "USD", amount: actualAmount, kind: "actual", source: "Krea job responses" };
  await writeJson(join(batchPath, "manifest.json"), manifest);
  await repository.touch(project);
  output({ batchPath: relative(process.cwd(), batchPath), manifest, generations: completed }, `Saved ${completed.length}/${count} completed outputs to ${relative(process.cwd(), batchPath)}`);
}

async function reconcile(): Promise<void> {
  const projectId = args.positionals[0];
  if (!projectId) throw new Error("Usage: pnpm lab reconcile <project>");
  const project = await repository.find(projectId);
  const pending = (await repository.generations(project)).filter(({ metadata }) => metadata.jobId && !["completed", "failed", "cancelled"].includes(metadata.status));
  const client = new KreaAdapter();
  for (const handle of pending) await reconcileOne(client, handle);
  const refreshed = await repository.generations(project);
  for (const batchPath of new Set(refreshed.map((handle) => handle.batchPath))) {
    const records = refreshed.filter((handle) => handle.batchPath === batchPath);
    const manifest = records[0]?.manifest;
    if (manifest && records.length === manifest.generationIds.length && records.every((handle) => handle.metadata.status === "completed" && handle.metadata.actualCost)) {
      manifest.actualCost = {
        currency: "USD",
        amount: records.reduce((sum, handle) => sum + handle.metadata.actualCost!.amount, 0),
        kind: "actual",
        source: "Krea job responses",
      };
      await writeJson(join(batchPath, "manifest.json"), manifest);
    }
  }
  if (pending.length) await repository.touch(project);
  output({ reconciled: pending.length }, `Reconciled ${pending.length} generation record(s).`);
}

async function reviewGeneration(): Promise<void> {
  const file = required("file");
  const patch: Record<string, unknown> = {};
  if (stringArg("favourite")) patch.favourite = booleanArg("favourite");
  if (stringArg("signal")) patch.signal = stringArg("signal");
  if (stringArg("rating")) patch.rating = Number(stringArg("rating"));
  if (values("tag").length) patch.tags = values("tag");
  if (stringArg("note") !== undefined) patch.note = stringArg("note");
  const record = await repository.updateReview(resolve(file), patch);
  output(record, `Updated review for ${file}`);
}

async function touchProject(): Promise<void> {
  const projectId = args.positionals[0];
  if (!projectId) throw new Error("Usage: pnpm lab touch <project>");
  const project = await repository.find(projectId);
  await repository.touch(project);
  output(projectSummary(project), `Updated ${project.metadata.slug} modified time.`);
}

async function reconcileOne(client: KreaAdapter, handle: GenerationHandle): Promise<void> {
  const job = await client.getJob(handle.metadata.jobId!);
  if (job.status === "completed") await finishGeneration(client, handle.batchPath, handle.metadata, job);
  else {
    handle.metadata.status = job.status;
    handle.metadata.error = job.error;
    handle.metadata.providerResult = job.raw;
  }
  await writeJson(handle.metadataPath, handle.metadata);
}

async function finishGeneration(client: KreaAdapter, batchPath: string, record: GenerationRecord, job: KreaJob): Promise<void> {
  if (job.status !== "completed") {
    record.status = job.status;
    record.error = job.error;
    record.providerResult = job.raw;
    return;
  }
  if (!job.urls.length) throw new Error("Krea marked the job completed but returned no output URLs.");
  const files: string[] = [];
  for (const [index, url] of job.urls.entries()) {
    const result = await client.download(url);
    const dimensions = pngDimensions(result.bytes, result.contentType);
    if (index === 0 && dimensions) {
      record.width = dimensions.width;
      record.height = dimensions.height;
    }
    const extension = extensionFor(result.contentType);
    const filename = `${record.id}${index ? `-${String(index + 1).padStart(2, "0")}` : ""}.${extension}`;
    const destination = join(batchPath, filename);
    const temporary = `${destination}.${process.pid}.tmp`;
    await writeFile(temporary, result.bytes);
    await rename(temporary, destination);
    files.push(filename);
  }
  record.outputFiles = files;
  record.status = "completed";
  record.completedAt = job.completedAt ?? new Date().toISOString();
  record.durationMs = Date.parse(record.completedAt) - Date.parse(record.createdAt);
  record.actualCost = job.cost;
  record.providerResult = job.raw;
}

async function prepareReferences(project: ProjectHandle): Promise<ReferenceRecord[]> {
  const inputs: Array<{ path: string; source?: NonNullable<ReferenceRecord["source"]> }> = values("reference").map((path) => ({ path: resolve(path) }));
  for (const value of values("reference-shot")) {
    const shotNumber = Number(value);
    if (!Number.isInteger(shotNumber) || shotNumber < 1) throw new Error(`--reference-shot must be a positive integer: ${value}`);
    const handle = await repository.generationByShot(project, shotNumber);
    const outputFile = handle.metadata.outputFiles[0]!;
    inputs.push({
      path: resolve(handle.batchPath, outputFile),
      source: {
        projectId: project.metadata.id,
        generationId: handle.metadata.id,
        batchId: handle.metadata.batchId,
        metadataPath: relative(project.path, handle.metadataPath),
        outputFile,
        shotNumber,
      },
    });
  }
  if (!inputs.length) return [];
  const projectRoot = resolve(project.path);
  for (const { path } of inputs) if (path !== projectRoot && !path.startsWith(`${projectRoot}${sep}`)) throw new Error(`Reference must be inside ${relative(process.cwd(), projectRoot)}: ${path}`);
  const mapPath = join(project.path, "references", ".krea-assets.json");
  let mappings: Record<string, ReferenceRecord> = {};
  try { mappings = JSON.parse(await readFile(mapPath, "utf8")); } catch { /* No uploads yet. */ }
  const client = new KreaAdapter();
  const records: ReferenceRecord[] = [];
  const uniqueInputs = new Map(inputs.map((input) => [input.path, input]));
  for (const { path, source } of uniqueInputs.values()) {
    const localPath = relative(project.path, path);
    let record = mappings[localPath];
    if (!record?.assetUrl || booleanArg("refresh-reference")) {
      const asset = await client.upload(path, `Figment reference: ${project.metadata.slug}/${basename(path)}`);
      record = { localPath, assetId: asset.id, assetUrl: asset.url, uploadedAt: asset.uploadedAt ?? new Date().toISOString() };
    }
    if (source) record = { ...record, source };
    mappings[localPath] = record;
    await writeJson(mapPath, mappings);
    records.push(record);
  }
  return records;
}

async function estimateCost(model: string, count: number): Promise<CostRecord | undefined> {
  const explicit = Number(stringArg("cost-per-image"));
  if (Number.isFinite(explicit) && explicit >= 0) {
    return { currency: "USD", amount: explicit * count, kind: "estimate", source: "Explicit refreshed per-image estimate", refreshedAt: new Date().toISOString() };
  }
  try {
    const cache = await new ModelCatalog().get();
    const normalized = model.replace(/^image\//, "");
    const match = cache.models.find((item) => item.id.replace(/^image\//, "") === normalized);
    if (!match?.price) return undefined;
    return { ...match.price, amount: match.price.amount * count, refreshedAt: cache.refreshedAt };
  } catch {
    return undefined;
  }
}

async function nextBatchPath(project: ProjectHandle, kind: "probe" | "batch", purpose: string, createdAt: string): Promise<string> {
  const folder = kind === "probe" ? "probes" : "generations";
  const prefix = `${createdAt.slice(0, 10)}-${safeSlug(purpose).slice(0, 40)}`;
  for (let index = 1; index < 100; index++) {
    const path = join(project.path, folder, `${prefix}-${String(index).padStart(2, "0")}`);
    try { await readFile(join(path, "manifest.json")); } catch { return path; }
  }
  throw new Error("Could not allocate a batch directory.");
}

function initialGeneration(id: string, manifest: BatchManifest, references: ReferenceRecord[]): GenerationRecord {
  return {
    schemaVersion: 1,
    id,
    provider: "krea",
    status: "queued",
    createdAt: new Date().toISOString(),
    model: manifest.model,
    prompt: manifest.prompt,
    negativePrompt: typeof manifest.parameters.negative_prompt === "string" ? manifest.parameters.negative_prompt : undefined,
    seed: typeof manifest.parameters.seed === "number" ? manifest.parameters.seed : undefined,
    width: typeof manifest.parameters.width === "number" ? manifest.parameters.width : undefined,
    height: typeof manifest.parameters.height === "number" ? manifest.parameters.height : undefined,
    aspectRatio: typeof manifest.parameters.aspect_ratio === "string" ? manifest.parameters.aspect_ratio : undefined,
    resolution: typeof manifest.parameters.resolution === "string" ? manifest.parameters.resolution : undefined,
    parameters: manifest.parameters,
    references,
    outputFiles: [],
    batchId: manifest.id,
    parentGenerationId: stringArg("parent"),
    estimatedCost: manifest.estimatedCost ? { ...manifest.estimatedCost, amount: manifest.estimatedCost.amount / manifest.generationIds.length } : undefined,
    review: { favourite: false, signal: "unreviewed", tags: [] },
  };
}

function projectSummary(project: ProjectHandle) {
  return { year: project.year, path: relative(process.cwd(), project.path), ...project.metadata };
}

function output(json: unknown, text: string, error = false): void {
  const value = booleanArg("json") ? JSON.stringify(json, null, 2) : text;
  (error ? process.stderr : process.stdout).write(`${value}\n`);
}

function parseArgs(tokens: string[]): { positionals: string[]; flags: Map<string, string[]> } {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (!token.startsWith("--")) { positionals.push(token); continue; }
    const [name, inline] = token.slice(2).split("=", 2);
    const next = inline ?? (tokens[index + 1] && !tokens[index + 1]!.startsWith("--") ? tokens[++index] : "true");
    flags.set(name!, [...(flags.get(name!) ?? []), next!]);
  }
  return { positionals, flags };
}

function values(name: string): string[] { return args.flags.get(name) ?? []; }
function stringArg(name: string): string | undefined { return values(name).at(-1); }
function booleanArg(name: string): boolean { return ["true", "1", "yes"].includes(stringArg(name) ?? ""); }
function required(name: string): string { const value = stringArg(name); if (!value) throw new Error(`Missing --${name}.`); return value; }
function jsonArg(name: string): Record<string, unknown> {
  const raw = stringArg(name);
  if (!raw) return {};
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`--${name} must be a JSON object.`);
  return value as Record<string, unknown>;
}
function extensionFor(contentType?: string): string {
  return ({
    "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/ogg": "ogv",
  } as Record<string, string>)[contentType ?? ""] ?? "png";
}

function pngDimensions(bytes: Uint8Array, contentType?: string): { width: number; height: number } | undefined {
  if (contentType !== "image/png" || bytes.length < 24) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) return undefined;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

// A single reference sent to an array-typed schema field is rejected by Krea as
// "Validation failed" before generation, with nothing to indicate the shape was
// wrong. The live schema already knows the field type, so consult it rather than
// making the human rediscover --reference-array by trial and error. Explicit
// --reference-array still wins, and an unreadable schema falls back to the old
// single-value behaviour rather than failing the run.
async function expectsArray(model: string, field: string): Promise<boolean> {
  try {
    const schema = await new KreaAdapter().getModelSchema(model);
    const input = (schema as { inputSchema?: unknown } | undefined)?.inputSchema;
    let node: unknown = input;
    for (const part of field.split(".").filter(Boolean)) {
      const properties = (node as { properties?: Record<string, unknown> } | undefined)?.properties;
      if (!properties || typeof properties !== "object") return false;
      node = properties[part];
      if (!node) return false;
    }
    return (node as { type?: unknown }).type === "array";
  } catch { return false; }
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length) throw new Error("--reference-field cannot be empty.");
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value;
}

function replaceUrlTemplate(value: unknown, url: string): unknown {
  if (value === "$url") return url;
  if (Array.isArray(value)) return value.map((item) => replaceUrlTemplate(item, url));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceUrlTemplate(item, url)]));
  return value;
}

function help(): void {
  process.stdout.write(`Figment creative lab\n\nCommands:\n  pnpm lab new --title <title> [--description ...] [--json]\n  pnpm lab projects [--json]\n  pnpm lab models [--refresh] [--json]\n  pnpm lab models --schema <model> [--json]\n  pnpm lab probe <project> --model <id> --prompt <text> [--category concepts] [--reference <path> | --reference-shot <number>] --reference-field <field>\n  pnpm lab generate <project> --model <id> --prompt <text> [--category concepts] [--reference-shot <number>] [--count 4] [--yes]\n  pnpm lab review --file <generation.json> [--favourite true] [--signal shortlist|reject|unreviewed]\n  pnpm lab reconcile <project>\n  pnpm lab touch <project>\n  pnpm studio\n`);
}
