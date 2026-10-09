import { loadConfig, type Config } from "./config";
import { ApiError, friendlyMessage } from "./errors";
import { assertDemoCode, assertOriginAllowed, corsHeaders } from "./guards";
import { buildTexturePrompt } from "./prompts";
import { createProvider, type ModelProvider } from "./providers";
import type { JobStatus } from "./providers/types";
import { parseGenerateBody } from "./validate";

export interface Context {
  config: Config;
  /** null when the configuration has problems (the API then refuses to run). */
  provider: ModelProvider | null;
}

export function createContext(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Context {
  const config = loadConfig(env);
  return { config, provider: config.problems.length ? null : createProvider(config, fetchImpl) };
}

let cached: Context | undefined;
function defaultContext(): Context {
  cached ??= createContext();
  return cached;
}

// Task ids are pasted into a URL on the provider's side, so only a strict
// alphabet is allowed (no slashes, dots or query characters).
const JOB_ID = /^[A-Za-z0-9_-]{6,80}$/;

function log(event: string, data: Record<string, unknown> = {}): void {
  // Never log photos, keys or the demo code: only ids, states and error codes.
  console.log(JSON.stringify({ evt: event, ...data }));
}

interface Rule {
  method: "GET" | "POST";
  /** false only for /health, which must answer even when setup is incomplete. */
  requireReady: boolean;
  /** false only for /health, so the page can learn whether a code is needed. */
  requireCode: boolean;
}

async function guarded(
  request: Request,
  ctx: Context,
  rule: Rule,
  run: () => Promise<{ status: number; body: unknown }>,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...corsHeaders(request, ctx.config),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

  try {
    // Browser pre-flight check: answered with headers only, never reaches the provider.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== rule.method) throw new ApiError("method_not_allowed");
    assertOriginAllowed(request, ctx.config);

    if (rule.requireReady) {
      if (ctx.config.problems.length > 0 || !ctx.provider) {
        log("not_configured", { problems: ctx.config.problems });
        throw new ApiError("not_configured");
      }
      if (!ctx.config.enabled) throw new ApiError("disabled");
    }
    if (rule.requireCode) assertDemoCode(request, ctx.config);

    const result = await run();
    return json(result.status, result.body);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status >= 500) log("api_error", { code: err.code, detail: err.message });
      return json(err.status, { error: { code: err.code, message: friendlyMessage(err.code) } });
    }
    log("unexpected_error", { detail: err instanceof Error ? err.message : String(err) });
    const fallback = new ApiError("provider_error");
    return json(fallback.status, { error: { code: fallback.code, message: friendlyMessage(fallback.code) } });
  }
}

function requireProvider(ctx: Context): ModelProvider {
  if (!ctx.provider) throw new ApiError("not_configured");
  return ctx.provider;
}

export function handleHealth(request: Request, ctx: Context = defaultContext()): Promise<Response> {
  return guarded(request, ctx, { method: "GET", requireReady: false, requireCode: false }, async () => ({
    status: 200,
    body: {
      ok: ctx.config.problems.length === 0,
      enabled: ctx.config.enabled,
      provider: ctx.config.provider,
      requiresCode: ctx.config.demoCode !== null,
    },
  }));
}

export function handleGenerate(request: Request, ctx: Context = defaultContext()): Promise<Response> {
  return guarded(request, ctx, { method: "POST", requireReady: true, requireCode: true }, async () => {
    const provider = requireProvider(ctx);

    // base64 inflates data by ~4/3; a little headroom for the JSON wrapper.
    const maxBodyChars = Math.ceil((ctx.config.maxImageBytes * 4) / 3) + 4096;
    const text = await request.text();
    if (text.length > maxBodyChars) throw new ApiError("image_too_large", `body is ${text.length} chars`);

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApiError("bad_request", "body is not valid JSON");
    }

    const input = parseGenerateBody(json, ctx.config.maxImageBytes);
    const texturePrompt = buildTexturePrompt(input.material, input.styleText) || null;
    const { jobId } = await provider.createJob({ ...input, texturePrompt });

    log("job_created", { provider: provider.name, jobId, material: input.material, withStyle: input.styleText !== "" });
    return { status: 202, body: { jobId } };
  });
}

function publicStatus(job: JobStatus) {
  return {
    state: job.state,
    progress: job.progress,
    ...(job.modelUrl ? { modelUrl: job.modelUrl } : {}),
    ...(job.thumbnailUrl ? { thumbnailUrl: job.thumbnailUrl } : {}),
    ...(job.error ? { error: { code: job.error.code, message: friendlyMessage(job.error.code) } } : {}),
  };
}

export function handleStatus(request: Request, ctx: Context = defaultContext()): Promise<Response> {
  return guarded(request, ctx, { method: "GET", requireReady: true, requireCode: true }, async () => {
    const provider = requireProvider(ctx);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!JOB_ID.test(id)) throw new ApiError("bad_request", "bad job id");

    const job = await provider.getJob(id);
    if (job.state === "succeeded" || job.state === "failed") {
      log("job_finished", {
        provider: provider.name,
        jobId: id,
        state: job.state,
        error: job.error?.code,
        creditsUsed: job.creditsUsed,
      });
    }
    return { status: 200, body: publicStatus(job) };
  });
}
