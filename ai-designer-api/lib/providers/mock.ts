import { ApiError } from "../errors";
import type { Material } from "../prompts";
import type { CreateJobInput, JobStatus, ModelProvider } from "./types";

/**
 * Free stand-in for a real provider. It "generates" for a few seconds and then
 * returns one of the pre-made sample models, so the whole page (upload,
 * progress, viewer, errors) can be built and shown without spending credits.
 *
 * It keeps no memory between calls: everything it needs is encoded in the job
 * id (`mock_<start-time>_<material><flag>`), which is also how it behaves on
 * serverless hosting where no two calls share state.
 *
 * Testing aids: put one of these words in the "style" box to force an outcome
 *   !rechazar -> the photo is "rejected" (content screening)
 *   !falla    -> the job fails
 *   !lento    -> the job never finishes (to see the timeout message)
 */
export interface MockOptions {
  modelBaseUrl: string;
  durationMs: number;
  now?: () => number;
}

const MATERIAL_CHAR: Record<Material, string> = { oro: "o", plata: "p", "oro-rosa": "r" };

const JOB_ID = /^mock_([0-9a-z]+)_([oprn])([0rfs])$/;

function flagFor(styleText: string): string {
  const text = styleText.toLowerCase();
  if (text.includes("!rechazar")) return "r";
  if (text.includes("!falla")) return "f";
  if (text.includes("!lento")) return "s";
  return "0";
}

export function createMockProvider(options: MockOptions): ModelProvider {
  const now = options.now ?? Date.now;

  return {
    name: "mock",

    async createJob(input: CreateJobInput) {
      const materialChar = input.material ? MATERIAL_CHAR[input.material] : "n";
      const jobId = `mock_${now().toString(36)}_${materialChar}${flagFor(input.styleText)}`;
      return { jobId };
    },

    async getJob(jobId: string): Promise<JobStatus> {
      const match = JOB_ID.exec(jobId);
      if (!match) throw new ApiError("not_found", `unknown mock job id: ${jobId}`);

      const startedAt = Number.parseInt(match[1] ?? "", 36);
      const flag = match[3] ?? "0";

      const elapsed = now() - startedAt;
      const progress = Math.max(0, Math.min(100, Math.round((elapsed / options.durationMs) * 100)));
      const state = elapsed < 1500 ? "queued" : "running";

      if (flag === "s") {
        return { state, progress: Math.min(progress, 85) };
      }
      if (flag === "r" && progress >= 40) {
        return { state: "failed", progress: 40, error: { code: "content_rejected" } };
      }
      if (flag === "f" && progress >= 60) {
        return { state: "failed", progress: 60, error: { code: "provider_error" } };
      }
      if (progress >= 100) {
        // Always the same pre-made example piece: a real generation would be
        // built from the photo, the mock just stands in for it.
        return { state: "succeeded", progress: 100, modelUrl: `${options.modelBaseUrl}/anillo.glb` };
      }
      return { state, progress };
    },
  };
}
