export type ProjectStatus = "active" | "paused" | "complete" | "archived";
export type ReviewSignal = "unreviewed" | "shortlist" | "reject";
export type JobStatus =
  | "backlogged"
  | "queued"
  | "scheduled"
  | "processing"
  | "sampling"
  | "intermediate-complete"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface ProjectMetadata {
  id: string;
  slug: string;
  title: string;
  description: string;
  createdAt: string;
  modifiedAt: string;
  status: ProjectStatus;
  tags: string[];
  currentDirection?: string;
}

export interface CostRecord {
  currency: "USD";
  amount: number;
  kind: "estimate" | "actual";
  source?: string;
  refreshedAt?: string;
}

export interface ReferenceRecord {
  localPath: string;
  assetId?: string;
  assetUrl?: string;
  uploadedAt?: string;
}

export interface ReviewMetadata {
  favourite: boolean;
  signal: ReviewSignal;
  rating?: number;
  tags: string[];
  note?: string;
  updatedAt?: string;
  agentAnalysis?: Record<string, unknown>;
}

export interface GenerationRecord {
  schemaVersion: 1;
  id: string;
  provider: "krea";
  jobId?: string;
  status: JobStatus;
  createdAt: string;
  completedAt?: string;
  durationMs?: number;
  model: string;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  aspectRatio?: string;
  resolution?: string;
  parameters: Record<string, unknown>;
  references: ReferenceRecord[];
  outputFiles: string[];
  batchId: string;
  parentGenerationId?: string;
  estimatedCost?: CostRecord;
  actualCost?: CostRecord;
  review: ReviewMetadata;
  error?: { code?: string; message: string };
  providerResult?: unknown;
}

export interface BatchManifest {
  schemaVersion: 1;
  id: string;
  projectId: string;
  kind: "probe" | "batch";
  purpose: string;
  hypothesis?: string;
  variable?: string;
  createdAt: string;
  model: string;
  prompt: string;
  references: ReferenceRecord[];
  parameters: Record<string, unknown>;
  estimatedCost?: CostRecord;
  actualCost?: CostRecord;
  generationIds: string[];
  notes?: string;
  conclusion?: string;
}

export interface ModelSummary {
  id: string;
  name?: string;
  category?: string;
  description?: string;
  price?: CostRecord;
  capabilities?: string[];
  schema?: unknown;
  deprecated?: boolean;
  raw: unknown;
}

export interface ModelCache {
  schemaVersion: 1;
  refreshedAt: string;
  source: "krea-live-mcp";
  models: ModelSummary[];
}
