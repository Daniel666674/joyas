import { ApiError, type ErrorCode } from "../errors";
import type { CreateJobInput, JobStatus, ModelProvider } from "./types";

/**
 * Meshy "Image to 3D" provider. This is the ONLY file that knows Meshy's
 * endpoint paths, field names and status words; if Meshy renames something,
 * this is the one place to fix.
 *
 * Written against the public docs (docs.meshy.ai, checked 2026-10-09):
 *   POST /openapi/v1/image-to-3d       -> { result: "<task id>" }
 *   GET  /openapi/v1/image-to-3d/:id   -> { status, progress, model_urls, ... }
 * It has been exercised against a faked HTTP layer in tests/, NOT yet against
 * the real service (no API key existed when this was written). The first real
 * run should be compared against `consumed_credits` and the raw response.
 */
export interface MeshyOptions {
  apiKey: string;
  model: string;
  enablePbr: boolean;
  baseUrl: string;
}

type FetchLike = typeof fetch;

interface MeshyTask {
  id?: string;
  status?: string;
  progress?: number;
  model_urls?: { glb?: string };
  thumbnail_url?: string;
  task_error?: { message?: string; code?: string; type?: string } | null;
  consumed_credits?: number;
}

/** Best-effort sorting of Meshy's free-text failure reasons into our error codes. */
export function classifyFailure(message: string | undefined, code?: string): ErrorCode {
  const text = `${code ?? ""} ${message ?? ""}`.toLowerCase();
  if (/moderat|safety|nsfw|sensitive|inappropriate|policy/.test(text)) return "content_rejected";
  if (/too_complex|invalid_input|unsupported|no subject|could not (detect|find)|image/.test(text)) {
    return "invalid_input";
  }
  return "provider_error";
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
  const code = typeof body.code === "string" ? body.code : undefined;
  const detail = `meshy http ${status}: ${message}`;
  if (status === 402) return new ApiError("out_of_credits", detail);
  if (status === 429) return new ApiError("busy", detail);
  if (status === 400 || status === 422) return new ApiError(classifyFailure(message, code), detail);
  // 401/403 means OUR key is wrong or the plan lacks API access: a setup problem,
  // not something the customer can fix, so it is reported generically.
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
      const body: Record<string, unknown> = {
        image_url: input.imageDataUri,
        ai_model: options.model,
        should_texture: true,
        enable_pbr: options.enablePbr,
        // Only the format the page actually uses: the other formats are extra work.
        target_formats: ["glb"],
      };
      if (input.texturePrompt) body.texture_prompt = input.texturePrompt;

      const res = await fetchImpl(`${options.baseUrl}/openapi/v1/image-to-3d`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
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
        case "CANCELED": {
          const code = classifyFailure(task.task_error?.message, task.task_error?.code);
          return { state: "failed", progress, error: { code }, creditsUsed };
        }
        default:
          // An unknown status word is treated as "still working" rather than as a
          // failure, so a new status name on Meshy's side can't break the demo.
          return { state: "running", progress, creditsUsed };
      }
    },
  };
}
