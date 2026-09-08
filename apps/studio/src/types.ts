import type { BatchManifest, GenerationRecord, ProjectMetadata } from "@figment/core";

export interface StudioProject {
  year: number;
  metadata: ProjectMetadata;
  brief: string;
  decisions: string;
  references: Array<{ name: string; path: string; url: string; thumbnailUrl?: string }>;
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
  thumbnailUrl?: string;
  mediaType: "image" | "video" | "model";
  available: boolean;
}

export interface StudioActivityBatch {
  projectId: string;
  projectTitle: string;
  batchName: string;
  kind: "probe" | "batch";
  model: string;
  completed: number;
  total: number;
}

export interface StudioActivity {
  generating: boolean;
  batches: StudioActivityBatch[];
  outputs: number;
  changedAt?: string;
  checkedAt: string;
}

export interface StudioData {
  scannedAt: string;
  readOnly?: boolean;
  projects: StudioProject[];
  generations: StudioGeneration[];
  activity?: StudioActivity;
}

// model-viewer is a custom element, so JSX needs to be told it exists. Only the
// attributes Studio actually sets are declared.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        alt?: string;
        "camera-controls"?: boolean;
        "auto-rotate"?: boolean;
        "rotation-per-second"?: string;
        "interaction-prompt"?: string;
        "shadow-intensity"?: string;
        exposure?: string;
      };
    }
  }
}
