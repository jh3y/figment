import type { BatchManifest, GenerationRecord, ProjectMetadata } from "@figment/core";

export interface StudioProject {
  year: number;
  metadata: ProjectMetadata;
  brief: string;
  decisions: string;
  references: Array<{ name: string; path: string; url: string }>;
  prototypes: StudioPrototype[];
}

export interface StudioPrototype {
  slug: string;
  title: string;
  description?: string;
  path: string;
  launchUrl?: string;
  entry?: string;
  embeddable: boolean;
  kind: "static" | "declared" | "folder";
}

export interface StudioGeneration {
  projectId: string;
  projectSlug: string;
  projectTitle: string;
  kind: "probe" | "batch";
  category: string;
  shotNumber: number;
  batchName: string;
  manifest: BatchManifest;
  metadata: GenerationRecord;
  metadataPath: string;
  outputIndex: number;
  outputFile: string;
  imageUrl: string;
  mediaType: "image" | "video";
}

export interface StudioData {
  scannedAt: string;
  readOnly?: boolean;
  projects: StudioProject[];
  generations: StudioGeneration[];
}
