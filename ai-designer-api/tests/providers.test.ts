import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../lib/errors";
import { buildCreateBody, classifyTaskError, createMeshyProvider } from "../lib/providers/meshy";
import { createMockProvider } from "../lib/providers/mock";
import { fakeJpegDataUri } from "./helpers";

const meshyOptions = {
  apiKey: "test-key",
  model: "meshy-6-lite",
  enablePbr: true,
  moderation: true,
  baseUrl: "https://api.meshy.test",
};

interface Recorded {
  url: string;
  init: RequestInit;
}

/** A fake `fetch` that records what was sent and answers with a canned reply. */
function fakeFetch(reply: { status?: number; body: unknown }, recorded: Recorded[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    recorded.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return err instanceof ApiError ? err.code : "non-api-error";
  }
  return "no-error";
}

const input = {
  imageDataUri: fakeJpegDataUri(),
  material: "oro" as const,
  styleText: "",
  texturePrompt: "polished yellow gold jewelry",
};

test("meshy: createJob sends the documented request and returns the task id", async () => {
  const recorded: Recorded[] = [];
  const provider = createMeshyProvider(meshyOptions, fakeFetch({ status: 202, body: { result: "task_123" } }, recorded));

  const { jobId } = await provider.createJob(input);

  assert.equal(jobId, "task_123");
  assert.equal(recorded[0]?.url, "https://api.meshy.test/openapi/v1/image-to-3d");
  assert.equal(recorded[0]?.init.method, "POST");
  const headers = recorded[0]?.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer test-key");
  const sent = JSON.parse(String(recorded[0]?.init.body));
  assert.equal(sent.ai_model, "meshy-6-lite");
  assert.equal(sent.should_texture, true);
  assert.equal(sent.enable_pbr, true);
  assert.deepEqual(sent.target_formats, ["glb"]);
  assert.equal(sent.texture_prompt, "polished yellow gold jewelry");
  assert.equal(sent.image_url, input.imageDataUri);
  // meshy-6-lite answers HTTP 400 if `moderation` is sent, so it must be absent
  assert.equal("moderation" in sent, false);
});

test("meshy: photo-only requests carry no texture_prompt", async () => {
  const recorded: Recorded[] = [];
  const provider = createMeshyProvider(meshyOptions, fakeFetch({ body: { result: "task_123" } }, recorded));
  await provider.createJob({ ...input, material: null, texturePrompt: null });
  assert.equal("texture_prompt" in JSON.parse(String(recorded[0]?.init.body)), false);
});

test("meshy: HTTP failures map to friendly error codes", async () => {
  const make = (status: number, body: unknown = {}) => createMeshyProvider(meshyOptions, fakeFetch({ status, body }));
  assert.equal(await errorCode(make(402).createJob(input)), "out_of_credits");
  assert.equal(await errorCode(make(429).createJob(input)), "busy");
  assert.equal(await errorCode(make(401).createJob(input)), "provider_error");
  assert.equal(await errorCode(make(400, { message: "Image failed moderation" }).createJob(input)), "content_rejected");
  assert.equal(await errorCode(make(400, { message: "Invalid data URI" }).createJob(input)), "invalid_input");
  assert.equal(await errorCode(make(403).createJob(input)), "provider_error"); // our plan / IP allow-list, not the customer
  assert.equal(await errorCode(make(500).createJob(input)), "provider_error");
  assert.equal(await errorCode(make(200, {}).createJob(input)), "provider_error"); // no task id
});

test("meshy: getJob maps each status word", async () => {
  const status = async (body: unknown, http = 200) =>
    createMeshyProvider(meshyOptions, fakeFetch({ status: http, body })).getJob("task_123");

  assert.deepEqual(await status({ status: "PENDING", progress: 0 }), { state: "queued", progress: 0, creditsUsed: undefined });
  assert.equal((await status({ status: "IN_PROGRESS", progress: 42 })).progress, 42);

  const done = await status({
    status: "SUCCEEDED",
    progress: 100,
    model_urls: { glb: "https://assets.meshy.test/model.glb" },
    thumbnail_url: "https://assets.meshy.test/t.png",
    consumed_credits: 15,
  });
  assert.equal(done.state, "succeeded");
  assert.equal(done.modelUrl, "https://assets.meshy.test/model.glb");
  assert.equal(done.creditsUsed, 15);

  const noFile = await status({ status: "SUCCEEDED", progress: 100, model_urls: {} });
  assert.equal(noFile.state, "failed");

  // task_error shapes exactly as in Meshy's docs (docs.meshy.ai/api/errors)
  const failed = (task_error: unknown) => status({ status: "FAILED", progress: 10, task_error });
  assert.deepEqual((await failed({ type: "invalid_input", code: "moderation_blocked", message: "x" })).error, { code: "content_rejected" });
  assert.deepEqual((await failed({ type: "invalid_input", code: "image_too_complex", message: "" })).error, { code: "invalid_input" });
  assert.deepEqual((await failed({ type: "server_error", message: "An internal error occurred. Please retry." })).error, { code: "provider_error" });
  assert.deepEqual((await failed({ type: "timeout", code: "queue_timeout", message: "" })).error, { code: "timeout" });
  assert.deepEqual((await status({ status: "CANCELED", progress: 0 })).error, { code: "provider_error" });

  const unknown = await status({ status: "SOMETHING_NEW", progress: 5 });
  assert.equal(unknown.state, "running"); // never crash on a new status word

  assert.equal(await errorCode(status({}, 404)), "not_found");
});

test("meshy: job ids are URL-encoded", async () => {
  const recorded: Recorded[] = [];
  const provider = createMeshyProvider(meshyOptions, fakeFetch({ body: { status: "PENDING" } }, recorded));
  await provider.getJob("a/b?c");
  assert.equal(recorded[0]?.url, "https://api.meshy.test/openapi/v1/image-to-3d/a%2Fb%3Fc");
});

test("classifyTaskError uses the documented type and code", () => {
  assert.equal(classifyTaskError({ code: "moderation_blocked" }), "content_rejected");
  // A temporary outage of Meshy's content checker is NOT the customer's fault.
  assert.equal(classifyTaskError({ type: "server_error", code: "moderation_unavailable" }), "provider_error");
  assert.equal(classifyTaskError({ code: "image_too_complex" }), "invalid_input");
  assert.equal(classifyTaskError({ type: "invalid_input" }), "invalid_input");
  assert.equal(classifyTaskError({ type: "timeout" }), "timeout");
  assert.equal(classifyTaskError({ code: "queue_timeout" }), "timeout");
  assert.equal(classifyTaskError({ type: "server_error", message: "server exploded" }), "provider_error");
  // a code Meshy adds later falls back on its type, then on "provider_error"
  assert.equal(classifyTaskError({ type: "invalid_input", code: "some_new_code" }), "invalid_input");
  assert.equal(classifyTaskError({ code: "some_new_code" }), "provider_error");
  assert.equal(classifyTaskError(undefined), "provider_error");
  assert.equal(classifyTaskError(null), "provider_error");
});

test("meshy: moderation is only requested with meshy-6 (lite rejects it, 7.1 ignores it)", () => {
  const body = (model: string, moderation = true) => buildCreateBody({ ...meshyOptions, model, moderation }, input);
  assert.equal(body("meshy-6").moderation, true);
  assert.equal("moderation" in body("meshy-6-lite"), false);
  assert.equal("moderation" in body("meshy-7.1"), false);
  assert.equal("moderation" in body("meshy-6", false), false);
});

test("mock: progresses with time and finishes with the example piece", async () => {
  let clock = 1_000_000;
  const provider = createMockProvider({ modelBaseUrl: "https://x.test/m", durationMs: 10_000, now: () => clock });
  const { jobId } = await provider.createJob({ ...input, material: "plata" });

  assert.equal((await provider.getJob(jobId)).state, "queued");
  clock += 5_000;
  const mid = await provider.getJob(jobId);
  assert.equal(mid.state, "running");
  assert.equal(mid.progress, 50);
  clock += 5_000;
  const end = await provider.getJob(jobId);
  assert.equal(end.state, "succeeded");
  assert.equal(end.modelUrl, "https://x.test/m/anillo.glb");
});

test("mock: photo-only works too; unknown ids are not found", async () => {
  let clock = 5_000_000;
  const provider = createMockProvider({ modelBaseUrl: "https://x.test/m", durationMs: 1_000, now: () => clock });
  const { jobId } = await provider.createJob({ ...input, material: null });
  clock += 2_000;
  assert.equal((await provider.getJob(jobId)).modelUrl, "https://x.test/m/anillo.glb");
  assert.equal(await errorCode(provider.getJob("mock_zzzz")), "not_found");
});

test("mock: magic words force a rejection, a failure, or a job that never ends", async () => {
  let clock = 9_000_000;
  const provider = createMockProvider({ modelBaseUrl: "https://x.test/m", durationMs: 10_000, now: () => clock });
  const reject = (await provider.createJob({ ...input, styleText: "x !rechazar" })).jobId;
  const fail = (await provider.createJob({ ...input, styleText: "!falla" })).jobId;
  const slow = (await provider.createJob({ ...input, styleText: "!LENTO" })).jobId;
  clock += 60_000;
  assert.deepEqual((await provider.getJob(reject)).error, { code: "content_rejected" });
  assert.deepEqual((await provider.getJob(fail)).error, { code: "provider_error" });
  const stuck = await provider.getJob(slow);
  assert.equal(stuck.state, "running");
  assert.equal(stuck.progress, 85);
});
