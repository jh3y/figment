import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Krea } from "@krea-ai/sdk";
import type { CostRecord, JobStatus, ModelSummary } from "@figment/core";

export interface KreaAsset {
  id: string;
  url: string;
  uploadedAt?: string;
  raw: unknown;
}

export interface KreaJob {
  jobId: string;
  status: JobStatus;
  createdAt?: string;
  completedAt?: string;
  urls: string[];
  cost?: CostRecord;
  error?: { code?: string; message: string };
  raw: unknown;
}

type ModelListFilters = NonNullable<Parameters<InstanceType<typeof Krea>["models"]["list"]>[0]>;

export class KreaAdapter {
  private readonly client: InstanceType<typeof Krea>;
  private readonly endpoints = new Map<string, string>();

  constructor(apiKey = process.env.KREA_API_KEY) {
    if (!apiKey) throw new Error("KREA_API_KEY is not set. Copy .env.example to .env and add a Krea API token.");
    this.client = new Krea({ apiKey, baseUrl: process.env.KREA_API_BASE_URL });
  }

  // Krea serves image, video, audio, 3d and enhance models. Passing no category
  // returns every one of them; a category narrows the list without Figment having
  // to know which categories exist.
  async listModels(category?: string): Promise<ModelSummary[]> {
    // The SDK types this union as image | video | enhance while the live API also
    // serves audio and 3d, so the caller's category is passed straight through
    // rather than re-declaring a taxonomy Krea can extend at any time.
    const filters = (category ? { category } : {}) as ModelListFilters;
    const response = await this.client.models.list(filters);
    const rawModels = unwrapArray(response);
    return rawModels.map(normalizeModel).filter((model) => model.id.length > 0);
  }

  async getModelSchema(model: string): Promise<unknown> {
    return this.client.models.getSchema(bareModelId(model));
  }

  // A model id is "vendor/model" but generation posts to "category/vendor/model".
  // The category comes from the live schema rather than an assumption, so a video
  // or audio model submits exactly like an image one.
  async resolveEndpoint(model: string): Promise<string> {
    if (model.split("/").length >= 3) return model;
    const cached = this.endpoints.get(model);
    if (cached) return cached;
    const schema = (await this.getModelSchema(model) ?? {}) as { endpointPath?: unknown; category?: unknown };
    const endpoint = stringValue(schema.endpointPath)
      ?? (stringValue(schema.category) ? `${stringValue(schema.category)}/${model}` : undefined);
    if (!endpoint) throw new Error(`Krea did not report an endpoint for "${model}". Inspect \`pnpm lab models --schema ${model}\`.`);
    this.endpoints.set(model, endpoint);
    return endpoint;
  }

  async upload(path: string, description?: string): Promise<KreaAsset> {
    const bytes = await readFile(path);
    const file = new File([bytes], basename(path), { type: mimeFor(path) });
    const raw = await this.client.assets.upload(file, description ? { description } : undefined);
    const record = raw as Record<string, unknown>;
    const url = stringValue(record.image_url) ?? stringValue(record.url);
    if (!url) throw new Error("Krea uploaded the asset but returned no usable URL.");
    return {
      id: String(record.id ?? ""),
      url,
      uploadedAt: stringValue(record.uploaded_at),
      raw,
    };
  }

  async submit(model: string, input: Record<string, unknown>): Promise<KreaJob> {
    const raw = await this.client.generateRaw(await this.resolveEndpoint(model), input);
    return normalizeJob(raw);
  }

  async getJob(jobId: string): Promise<KreaJob> {
    return normalizeJob(await this.client.jobs.get(jobId));
  }

  async wait(jobId: string, onUpdate?: (job: KreaJob) => Promise<void> | void): Promise<KreaJob> {
    let delay = 2_000;
    for (;;) {
      const job = await this.getJob(jobId);
      await onUpdate?.(job);
      if (["completed", "failed", "cancelled"].includes(job.status)) return job;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(Math.round(delay * 1.25), 5_000);
    }
  }

  async download(url: string): Promise<{ bytes: Uint8Array; contentType?: string }> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not download Krea output (${response.status}).`);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type")?.split(";")[0],
    };
  }
}

function normalizeModel(value: unknown): ModelSummary {
  const raw = (value ?? {}) as Record<string, unknown>;
  const id = String(raw.id ?? raw.model_id ?? raw.model ?? "");
  const pricing = objectValue(raw.pricing) ?? objectValue(raw.price);
  const amount = numberValue(raw.cost) ?? numberValue(raw.price_usd) ?? numberValue(pricing?.usd) ?? numberValue(pricing?.amount);
  const metadata = objectValue(raw.metadata);
  const capabilitiesValue = raw.capabilities ?? metadata?.capabilities;
  const capabilities = Array.isArray(capabilitiesValue) ? capabilitiesValue.map(String) : undefined;
  return {
    id,
    name: stringValue(raw.name) ?? stringValue(raw.title),
    category: stringValue(raw.category) ?? "image",
    description: stringValue(raw.description),
    price: amount === undefined ? undefined : {
      currency: "USD",
      amount,
      kind: "estimate",
      source: "Krea live model catalogue",
    },
    capabilities,
    deprecated: Boolean(raw.deprecated ?? raw.deprecation),
    raw,
  };
}

function normalizeJob(value: unknown): KreaJob {
  const envelope = (value ?? {}) as Record<string, unknown>;
  const raw = (objectValue(envelope.data) ?? envelope) as Record<string, unknown>;
  const result = objectValue(raw.result) ?? objectValue(envelope.data);
  const error = objectValue(raw.error) ?? objectValue(result?.error);
  const urls = [raw.urls, result?.urls, result?.url]
    .flatMap((candidate) => Array.isArray(candidate) ? candidate : candidate === undefined ? [] : [candidate])
    .map(outputUrl)
    .filter((url): url is string => url !== undefined);
  const amount = numberValue(raw.cost_usd) ?? numberValue(result?.cost_usd) ?? microdollars(raw.cost_microdollars);
  return {
    jobId: String(raw.job_id ?? raw.id ?? envelope.requestId ?? ""),
    status: String(raw.status ?? "queued") as JobStatus,
    createdAt: stringValue(raw.created_at),
    completedAt: stringValue(raw.completed_at),
    urls,
    cost: amount === undefined ? undefined : {
      currency: "USD",
      amount,
      kind: "actual",
      source: "Krea job response",
    },
    error: error ? { code: stringValue(error.code), message: String(error.message ?? "Krea job failed") } : undefined,
    raw: value,
  };
}

// Image and video jobs report bare URL strings, but 3D jobs return typed entries
// such as { type: "model", url } alongside { type: "preview", url }. Both shapes
// are unwrapped so every output a model produces is downloaded.
function outputUrl(candidate: unknown): string | undefined {
  if (typeof candidate === "string") return candidate;
  const url = stringValue(objectValue(candidate)?.url);
  return url;
}

function unwrapArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = (value ?? {}) as Record<string, unknown>;
  for (const key of ["models", "data", "items"]) if (Array.isArray(record[key])) return record[key] as unknown[];
  return [];
}

// Schema lookups take the bare "vendor/model" id, so drop a leading category
// segment when an endpoint path is passed in instead.
export function bareModelId(model: string): string {
  const parts = model.split("/");
  return parts.length >= 3 ? parts.slice(1).join("/") : model;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function microdollars(value: unknown): number | undefined {
  const amount = numberValue(value);
  return amount === undefined ? undefined : amount / 1_000_000;
}

function mimeFor(path: string): string {
  const extension = path.toLowerCase().split(".").pop();
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic" } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}
