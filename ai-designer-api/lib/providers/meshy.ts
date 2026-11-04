import { ApiError, type ErrorCode } from "../errors";
import type { CreateJobInput, JobStatus, ModelProvider } from "./types";

/**
 * Meshy "Image to 3D" provider. This is the ONLY file that knows Meshy's
 * endpoint paths, field names and status words; if Meshy renames something,
 * this is the one place to fix.
 *
 * Checked line by line against Meshy's official docs on 2026-11-04
 * (docs.meshy.ai: image-to-3d, errors, pricing, task-lifecycle, balance):
 *   POST /openapi/v1/image-to-3d       -> 202 { result: "<task id>" }
 *   GET  /openapi/v1/image-to-3d/:id   -> { status, progress, model_urls.glb,
 *                                          thumbnail_url, task_error, consumed_credits }
 * It is exercised against a faked HTTP layer in tests/ but has NOT yet been run
 * against the real service. `scripts/meshy-smoke.ts` is the safe way to do the
 * first real run (free balance check first; spending needs an explicit flag).
 */
export interface MeshyOptions {
  apiKey: string;
  model: string;
  enablePbr: boolean;
  /** Ask Meshy to screen the photo first. See buildCreateBody: only `meshy-6` supports it. */
  moderation: boolean;
  baseUrl: string;
}

type FetchLike = typeof fetch;

export interface MeshyTaskError {
  type?: string;
  code?: string;
  message?: string;
}

interface MeshyTask {
  id?: string;
  status?: string;
  progress?: number;
  model_urls?: { glb?: string };
  thumbnail_url?: string;
  task_error?: MeshyTaskError | null;
  consumed_credits?: number;
}

/**
 * Turns Meshy's `task_error` (present when a task FAILED) into our error codes,
 * using the documented `type` and `code` rather than guessing from the text.
 * Meshy refunds the credits of every failed task.
 */
export function classifyTaskError(error: MeshyTaskError | null | undefined): ErrorCode {
  const code = error?.code ?? "";
  const type = error?.type ?? "";
  // The safety filters rejected this photo: the customer should try another one.
  if (code === "moderation_blocked") return "content_rejected";
  // Meshy's content checker was temporarily down. Nothing is wrong with the
  // photo, so this must read as "try again", never as "your photo is bad".
  if (code === "moderation_unavailable") return "provider_error";
  if (code === "image_too_complex" || code === "invalid_input" || type === "invalid_input") return "invalid_input";
  if (code === "timeout" || code === "queue_timeout" || type === "timeout") return "timeout";
  // Meshy may add codes later; its docs say to fall back on `type`. Anything
  // else is treated as a provider-side problem the customer can simply retry.
  return "provider_error";
}

/** HTTP 400 on create: Meshy explains the problem in `message` only (no code). */
function classifyBadRequest(message: string): ErrorCode {
  return /moderat|harmful|safety|nsfw|sensitive/i.test(message) ? "content_rejected" : "invalid_input";
}

/** Exposed so the smoke script can show exactly what would be sent. */
export function buildCreateBody(options: MeshyOptions, input: CreateJobInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    image_url: input.imageDataUri,
    ai_model: options.model,
    should_texture: true,
    // PBR maps (metallic/roughness) are what make gold look like gold; allowed
    // only together with should_texture. Adds 30-60 s per Meshy's task docs.
    enable_pbr: options.enablePbr,
    // Only the format the page uses: Meshy skips the others, which shortens the task.
    target_formats: ["glb"],
  };
  if (input.texturePrompt) body.texture_prompt = input.texturePrompt;
  // Meshy's pre-screening only takes effect with `meshy-6`: `meshy-7.1`/`latest`
  // ignore it and `meshy-6-lite` answers HTTP 400, so it must never be sent there.
  if (options.moderation && options.model === "meshy-6") body.moderation = true;
  return body;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await res.json();
    return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function errorForHttp(status: number, body: Record<string, unknown>): ApiError {
  const message = typeof body.message === "string" ? body.message : "";
  const detail = `meshy http ${status}: ${message}`;
  if (status === 402) return new ApiError("out_of_credits", detail);
  // 429: too many requests, or too many of our tasks queued/running (Pro: 10).
  if (status === 429) return new ApiError("busy", detail);
  if (status === 400 || status === 422) return new ApiError(classifyBadRequest(message), detail);
  // 401/403 mean OUR key, plan or IP allow-list is wrong: a setup problem, not
  // something the customer can fix. 5xx is Meshy's side. Both read generically.
  return new ApiError("provider_error", detail);
}

export function createMeshyProvider(options: MeshyOptions, fetchImpl: FetchLike = fetch): ModelProvider {
  const headers = {
    Authorization: `Bearer ${options.apiKey}`,
    "Content-Type": "application/json",
  };

  return {
    name: "meshy",

    async createJob(input: CreateJobInput) {
      const res = await fetchImpl(`${options.baseUrl}/openapi/v1/image-to-3d`, {
        method: "POST",
        headers,
        body: JSON.stringify(buildCreateBody(options, input)),
      });
      const data = await readJson(res);
      if (!res.ok) throw errorForHttp(res.status, data);

      const taskId = data.result;
      if (typeof taskId !== "string" || !taskId) {
        throw new ApiError("provider_error", "meshy create response had no task id");
      }
      return { jobId: taskId };
    },

    async getJob(jobId: string): Promise<JobStatus> {
      const res = await fetchImpl(
        `${options.baseUrl}/openapi/v1/image-to-3d/${encodeURIComponent(jobId)}`,
        { method: "GET", headers },
      );
      const data = await readJson(res);
      if (res.status === 404) throw new ApiError("not_found", "meshy task not found (expired?)");
      if (!res.ok) throw errorForHttp(res.status, data);

      const task = data as MeshyTask;
      const progress = Math.max(0, Math.min(100, Math.round(task.progress ?? 0)));
      const creditsUsed = typeof task.consumed_credits === "number" ? task.consumed_credits : undefined;

      switch (task.status) {
        case "PENDING":
          return { state: "queued", progress, creditsUsed };
        case "IN_PROGRESS":
          return { state: "running", progress, creditsUsed };
        case "SUCCEEDED": {
          const modelUrl = task.model_urls?.glb;
          if (!modelUrl) {
            return { state: "failed", progress, error: { code: "provider_error" }, creditsUsed };
          }
          return { state: "succeeded", progress: 100, modelUrl, thumbnailUrl: task.thumbnail_url, creditsUsed };
        }
        case "FAILED":
        case "CANCELED":
          return { state: "failed", progress, error: { code: classifyTaskError(task.task_error) }, creditsUsed };
        default:
          // An unknown status word is treated as "still working" rather than as a
          // failure, so a new status name on Meshy's side can't break the demo.
          return { state: "running", progress, creditsUsed };
      }
    },
  };
}
