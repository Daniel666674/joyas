import { loadConfig, type Config } from "./config";
import { ApiError, friendlyMessage } from "./errors";
import { assertAdminCode, assertDemoCode, assertOriginAllowed, corsHeaders } from "./guards";
import { createBlobStore, newOrderId, ORDER_ID, ORDER_STATUSES, orderPath, type OrderFileKind, type OrderRecord, type OrderStatus, type OrderStore } from "./orders";
import { buildRestylePrompt, buildTexturePrompt } from "./prompts";
import { createProvider, type ModelProvider } from "./providers";
import type { JobStatus } from "./providers/types";
import { parseGenerateBody, parseOrderBody } from "./validate";

export interface Context {
  config: Config;
  /** null when the configuration has problems (the API then refuses to run). */
  provider: ModelProvider | null;
  /** Used to download the finished model (see handleModel). Injected so tests never touch the network. */
  fetchImpl: typeof fetch;
  /** Where saved orders live (private Blob store); null when none is configured. */
  store: OrderStore | null;
}

/** Orders work only with BOTH a place to keep them and an admin code to read them: otherwise nothing could ever be read back. */
export function ordersEnabled(ctx: Context): boolean {
  return ctx.store !== null && ctx.config.orders.adminCode !== null;
}

export function createContext(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
  store?: OrderStore | null,
): Context {
  const config = loadConfig(env);
  const orderStore = store === undefined ? (config.orders.hasStorageToken ? createBlobStore() : null) : store;
  return { config, provider: config.problems.length ? null : createProvider(config, fetchImpl), fetchImpl, store: orderStore };
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
  /** "admin": the admin panel's own code instead of the demo code. */
  auth?: "admin";
  /** The endpoint needs saved orders to be set up (storage + admin code). */
  orders?: boolean;
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
    if (rule.orders && !ordersEnabled(ctx)) throw new ApiError("orders_unavailable");
    if (rule.auth === "admin") assertAdminCode(request, ctx.config.orders.adminCode);
    else if (rule.requireCode) assertDemoCode(request, ctx.config);

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
      orders: ordersEnabled(ctx),
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
    const restylePrompt = input.piece ? buildRestylePrompt(input.piece, input.material, input.styleText) : null;
    const { jobId } = await provider.createJob({ ...input, texturePrompt, restylePrompt });

    log("job_created", {
      provider: provider.name,
      jobId,
      piece: input.piece,
      material: input.material,
      withStyle: input.styleText !== "",
    });
    return { status: 202, body: { jobId } };
  });
}

function publicStatus(job: JobStatus) {
  return {
    state: job.state,
    progress: job.progress,
    ...(job.modelUrl ? { modelUrl: job.modelUrl } : {}),
    ...(job.thumbnailUrl ? { thumbnailUrl: job.thumbnailUrl } : {}),
    ...(job.nextJobId ? { nextJobId: job.nextJobId } : {}),
    ...(job.error ? { error: { code: job.error.code, message: friendlyMessage(job.error.code) } } : {}),
  };
}

export function handleStatus(request: Request, ctx: Context = defaultContext()): Promise<Response> {
  return guarded(request, ctx, { method: "GET", requireReady: true, requireCode: true }, async () => {
    const provider = requireProvider(ctx);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!JOB_ID.test(id)) throw new ApiError("bad_request", "bad job id");

    const job = await provider.getJob(id);
    if (job.nextJobId) log("stage_advanced", { provider: provider.name, jobId: id, nextJobId: job.nextJobId, creditsUsed: job.creditsUsed });
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

/** One piece (at most MODEL_CHUNK_BYTES) of the finished model, read from the provider's file host. */
async function downloadModelPiece(ctx: Context, modelUrl: URL, offset: number): Promise<{ chunk: Uint8Array; total: number }> {
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
  return { chunk, total };
}

export function handleModel(request: Request, ctx: Context = defaultContext()): Promise<Response> {
  return guarded(request, ctx, { method: "GET", requireReady: true, requireCode: true }, async () => {
    const provider = requireProvider(ctx);
    const params = new URL(request.url).searchParams;
    const id = params.get("id") ?? "";
    // A step-1 id would make getJob() start a new 3D task (and spend credits): only finished 3D ids are served.
    if (!JOB_ID.test(id) || id.startsWith("ii_")) throw new ApiError("bad_request", "bad job id");
    const offsetText = params.get("offset") ?? "0";
    if (!/^\d{1,9}$/.test(offsetText)) throw new ApiError("bad_request", "bad offset");
    const offset = Number(offsetText);

    const job = await provider.getJob(id);
    if (job.state !== "succeeded" || !job.modelUrl) throw new ApiError("not_found", "model is not ready");
    const modelUrl = assertModelHost(job.modelUrl, ctx.config);

    const { chunk, total } = await downloadModelPiece(ctx, modelUrl, offset);

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

// ------------------------------------------------------------------ orders --
// A customer who likes a design can ask to quote it. The order keeps the 3D file (Meshy deletes its
// copy after ~3 days), the photo (only with consent) and the customer's words in a private store, and
// the admin panel reads them back with the admin code. See lib/orders.ts.

function requireStore(ctx: Context): OrderStore {
  if (!ctx.store) throw new ApiError("orders_unavailable");
  return ctx.store;
}

/** The whole finished model, assembled from the provider's file host piece by piece. */
async function fetchWholeModel(ctx: Context, provider: ModelProvider, jobId: string): Promise<Uint8Array> {
  const job = await provider.getJob(jobId);
  if (job.state !== "succeeded" || !job.modelUrl) throw new ApiError("not_found", "model is not ready");
  const url = assertModelHost(job.modelUrl, ctx.config);
  const pieces: Uint8Array[] = [];
  let got = 0;
  let total = Number.POSITIVE_INFINITY;
  while (got < total) {
    const piece = await downloadModelPiece(ctx, url, got); // throws when a piece comes back empty, so this always ends
    total = piece.total;
    pieces.push(piece.chunk);
    got += piece.chunk.length;
  }
  const whole = new Uint8Array(got);
  let at = 0;
  for (const piece of pieces) {
    whole.set(piece, at);
    at += piece.length;
  }
  return whole;
}

export function handleOrderCreate(request: Request, ctx: Context = defaultContext()): Promise<Response> {
  return guarded(request, ctx, { method: "POST", requireReady: true, requireCode: true, orders: true }, async () => {
    const provider = requireProvider(ctx);
    const store = requireStore(ctx);

    const maxBodyChars = Math.ceil((ctx.config.maxImageBytes * 4) / 3) + 16_384;
    const text = await request.text();
    if (text.length > maxBodyChars) throw new ApiError("image_too_large", `body is ${text.length} chars`);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApiError("bad_request", "body is not valid JSON");
    }
    const order = parseOrderBody(json, ctx.config.maxImageBytes);

    const model = await fetchWholeModel(ctx, provider, order.jobId);
    const id = newOrderId();
    const now = new Date().toISOString();
    const modelPath = orderPath(id, "model.glb");
    await store.putBytes(modelPath, model, "model/gltf-binary");

    let photo: OrderRecord["files"]["photo"] = null;
    if (order.photo) {
      const path = orderPath(id, order.photo.kind === "png" ? "photo.png" : "photo.jpg");
      await store.putBytes(path, order.photo.bytes, order.photo.kind === "png" ? "image/png" : "image/jpeg");
      photo = { path, bytes: order.photo.bytes.length, type: order.photo.kind === "png" ? "image/png" : "image/jpeg" };
    }

    const record: OrderRecord = {
      id,
      createdAt: now,
      updatedAt: now,
      status: "nuevo",
      jobId: order.jobId,
      piece: order.piece,
      material: order.material,
      style: order.style,
      name: order.name,
      notes: order.notes,
      files: { model: { path: modelPath, bytes: model.length }, photo },
    };
    await store.putJson(orderPath(id, "order.json"), record); // last: a record always has its files

    // No names or notes in the logs: only ids and sizes.
    log("order_created", { orderId: id, jobId: order.jobId, piece: order.piece, material: order.material, modelBytes: model.length, hasPhoto: photo !== null });
    return { status: 201, body: { orderId: id } };
  });
}

const ADMIN_RULE: Rule = { method: "GET", requireReady: false, requireCode: false, auth: "admin", orders: true };

export function handleOrders(request: Request, ctx: Context = defaultContext()): Promise<Response> {
  return guarded(request, ctx, ADMIN_RULE, async () => {
    const store = requireStore(ctx);
    const ids = await store.listIds();
    const records = await Promise.all(ids.map((id) => store.getJson<OrderRecord>(orderPath(id, "order.json"))));
    const orders = records
      .filter((record): record is OrderRecord => record !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 200);
    return { status: 200, body: { orders } };
  });
}

export function handleOrderFile(request: Request, ctx: Context = defaultContext()): Promise<Response> {
  return guarded(request, ctx, ADMIN_RULE, async () => {
    const store = requireStore(ctx);
    const params = new URL(request.url).searchParams;
    const id = params.get("id") ?? "";
    const kind = params.get("kind") ?? "";
    const offsetText = params.get("offset") ?? "0";
    if (!ORDER_ID.test(id) || (kind !== "model" && kind !== "photo") || !/^\d{1,9}$/.test(offsetText)) {
      throw new ApiError("bad_request", "bad order file request");
    }
    const record = await store.getJson<OrderRecord>(orderPath(id, "order.json"));
    const file = record ? (kind === "model" ? record.files.model : record.files.photo) : null;
    if (!record || !file) throw new ApiError("not_found", "no such order file");
    const piece = await store.readRange(file.path, Number(offsetText), MODEL_CHUNK_BYTES);
    if (!piece) throw new ApiError("not_found", "no such order file");
    if (piece.bytes.length === 0) throw new ApiError("bad_request", "offset is past the end of the file");
    return {
      raw: new Response(piece.bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Model-Total": String(piece.total),
          "Access-Control-Expose-Headers": "x-model-total",
        },
      }),
    };
  });
}

export function handleOrderStatus(request: Request, ctx: Context = defaultContext()): Promise<Response> {
  return guarded(request, ctx, { ...ADMIN_RULE, method: "POST" }, async () => {
    const store = requireStore(ctx);
    let json: unknown;
    try {
      json = JSON.parse(await request.text());
    } catch {
      throw new ApiError("bad_request", "body is not valid JSON");
    }
    const body = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id : "";
    const status = typeof body.status === "string" ? body.status : "";
    if (!ORDER_ID.test(id) || !(ORDER_STATUSES as readonly string[]).includes(status)) {
      throw new ApiError("bad_request", "bad order status request");
    }
    const record = await store.getJson<OrderRecord>(orderPath(id, "order.json"));
    if (!record) throw new ApiError("not_found", "no such order");
    const updated: OrderRecord = { ...record, status: status as OrderStatus, updatedAt: new Date().toISOString() };
    await store.putJson(orderPath(id, "order.json"), updated);
    log("order_status", { orderId: id, status });
    return { status: 200, body: { order: updated } };
  });
}
