import type { BatchManifest, GenerationRecord, ProjectMetadata } from "@figment/core";

export interface StudioProject {
  year: number;
  metadata: ProjectMetadata;
  brief: string;
  decisions: string;
  references: Array<{ name: string; path: string; url: string }>;
  prototypes: string[];
}

export interface StudioGeneration {
  projectId: string;
  projectSlug: string;
  projectTitle: string;
  kind: "probe" | "batch";
  batchName: string;
  manifest: BatchManifest;
  metadata: GenerationRecord;
  metadataPath: string;
  outputIndex: number;
  outputFile: string;
  imageUrl: string;
}

export interface StudioData {
  scannedAt: string;
  projects: StudioProject[];
  generations: StudioGeneration[];
}
