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
  /** Used to download the finished model (see handleModel). Injected so tests never touch the network. */
  fetchImpl: typeof fetch;
}

export function createContext(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Context {
  const config = loadConfig(env);
  return { config, provider: config.problems.length ? null : createProvider(config, fetchImpl), fetchImpl };
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
  run: () => Promise<{ status: number; body: unknown } | { raw: Response }>,
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
    if ("raw" in result) {
      // Binary answer (the model relay): keep our CORS headers, take type/size headers from the handler.
      const rawHeaders = new Headers({ ...corsHeaders(request, ctx.config), "Cache-Control": "no-store" });
      result.raw.headers.forEach((value, key) => rawHeaders.set(key, value));
      return new Response(result.raw.body, { status: result.raw.status, headers: rawHeaders });
    }
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

/**
 * Meshy serves finished models from assets.meshy.ai (CloudFront), which sends no
 * CORS headers, so a browser on another site (our GitHub Pages) is not allowed to
 * read the file. This relay downloads it server-side and hands it to the page.
 *
 * It answers in pieces of MODEL_CHUNK_BYTES (`?offset=N`) because a Vercel
 * function cannot return more than about 4.5 MB in one response, and a textured
 * model is several MB. Each answer carries `X-Model-Total` so the page knows when
 * it has everything. The demo code is required, like every other endpoint.
 */
export const MODEL_CHUNK_BYTES = 3_500_000;
const MODEL_MAX_BYTES = 80_000_000;

function assertModelHost(modelUrl: string, config: Config): URL {
  let url: URL;
  try {
    url = new URL(modelUrl);
  } catch {
    throw new ApiError("provider_error", "model url is not a URL");
  }
  const host = url.hostname.toLowerCase();
  const mockHost = new URL(config.mock.modelBaseUrl).hostname.toLowerCase();
  const allowed =
    url.protocol === "https:" && (host === "meshy.ai" || host.endsWith(".meshy.ai") || host === mockHost);
  // The link comes from the provider's own API, but never fetch from a host we did not expect.
  if (!allowed) throw new ApiError("provider_error", `model host not allowed: ${host}`);
  return url;
}

export function handleModel(request: Request, ctx: Context = defaultContext()): Promise<Response> {
  return guarded(request, ctx, { method: "GET", requireReady: true, requireCode: true }, async () => {
    const provider = requireProvider(ctx);
    const params = new URL(request.url).searchParams;
    const id = params.get("id") ?? "";
    if (!JOB_ID.test(id)) throw new ApiError("bad_request", "bad job id");
    const offsetText = params.get("offset") ?? "0";
    if (!/^\d{1,9}$/.test(offsetText)) throw new ApiError("bad_request", "bad offset");
    const offset = Number(offsetText);

    const job = await provider.getJob(id);
    if (job.state !== "succeeded" || !job.modelUrl) throw new ApiError("not_found", "model is not ready");
    const modelUrl = assertModelHost(job.modelUrl, ctx.config);

    const upstream = await ctx.fetchImpl(modelUrl, {
      headers: { Range: `bytes=${offset}-${offset + MODEL_CHUNK_BYTES - 1}` },
      redirect: "error",
    });
    if (upstream.status === 416) throw new ApiError("bad_request", "offset is past the end of the model");
    if (upstream.status !== 200 && upstream.status !== 206) {
      throw new ApiError("provider_error", `model download answered http ${upstream.status}`);
    }

    const bytes = new Uint8Array(await upstream.arrayBuffer());
    let total: number;
    let chunk: Uint8Array;
    if (upstream.status === 206) {
      const range = /bytes\s+(\d+)-(\d+)\/(\d+)/i.exec(upstream.headers.get("content-range") ?? "");
      if (!range || Number(range[1]) !== offset) throw new ApiError("provider_error", "model download had no usable Content-Range");
      total = Number(range[3]);
      chunk = bytes;
    } else {
      // The host ignored Range and sent everything: cut our piece out of it.
      total = bytes.length;
      chunk = bytes.subarray(offset, offset + MODEL_CHUNK_BYTES);
    }
    if (total > MODEL_MAX_BYTES) throw new ApiError("provider_error", `model is too large: ${total} bytes`);
    if (chunk.length === 0) throw new ApiError("bad_request", "offset is past the end of the model");

    if (offset === 0) log("model_relay", { provider: provider.name, jobId: id, totalBytes: total });
    return {
      raw: new Response(chunk, {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Model-Total": String(total),
          "Access-Control-Expose-Headers": "x-model-total",
        },
      }),
    };
  });
}
