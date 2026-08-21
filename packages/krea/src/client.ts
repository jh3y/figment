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

export class KreaAdapter {
  private readonly client: InstanceType<typeof Krea>;

  constructor(apiKey = process.env.KREA_API_KEY) {
    if (!apiKey) throw new Error("KREA_API_KEY is not set. Copy .env.example to .env and add a Krea API token.");
    this.client = new Krea({ apiKey, baseUrl: process.env.KREA_API_BASE_URL });
  }

  async listImageModels(): Promise<ModelSummary[]> {
    const response = await this.client.models.list({ category: "image" });
    const rawModels = unwrapArray(response);
    return rawModels.map(normalizeModel).filter((model) => model.id.length > 0);
  }

  async getModelSchema(model: string): Promise<unknown> {
    return this.client.models.getSchema(stripCategory(model));
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
    const raw = await this.client.generateRaw(ensureCategory(model), input);
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
    .flatMap((candidate) => Array.isArray(candidate) ? candidate : typeof candidate === "string" ? [candidate] : [])
    .map(String);
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

function unwrapArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = (value ?? {}) as Record<string, unknown>;
  for (const key of ["models", "data", "items"]) if (Array.isArray(record[key])) return record[key] as unknown[];
  return [];
}

function ensureCategory(model: string): string {
  return model.startsWith("image/") ? model : `image/${model}`;
}

function stripCategory(model: string): string {
  return model.replace(/^image\//, "");
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
