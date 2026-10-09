import type { ErrorCode } from "../errors";
import type { Material } from "../prompts";

/**
 * The "contract" every 3D provider follows. The rest of the app only knows
 * these types, so swapping Meshy for another provider (e.g. Tripo) means
 * writing one new file that implements `ModelProvider`; nothing else changes.
 */
export interface CreateJobInput {
  /** `data:image/jpeg;base64,...` (already validated and browser-resized). */
  imageDataUri: string;
  material: Material | null;
  styleText: string;
  /** Ready-made texture prompt, or null in photo-only mode. */
  texturePrompt: string | null;
}

export type JobState = "queued" | "running" | "succeeded" | "failed";

export interface JobStatus {
  state: JobState;
  /** 0-100. */
  progress: number;
  /** Present when state === "succeeded". */
  modelUrl?: string;
  thumbnailUrl?: string;
  /** Present when state === "failed". */
  error?: { code: ErrorCode };
  /** Provider-reported cost; logged for budgeting, never shown to customers. */
  creditsUsed?: number;
}

export interface ModelProvider {
  readonly name: string;
  createJob(input: CreateJobInput): Promise<{ jobId: string }>;
  getJob(jobId: string): Promise<JobStatus>;
}
