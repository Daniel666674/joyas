import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext, handleGenerate, handleHealth, handleStatus } from "../lib/handlers";
import { fakeJpegDataUri, jsonRequest } from "./helpers";

const SITE = "https://daniel666674.github.io";
const API = "https://api.test";

function mockContext(extra: Record<string, string> = {}) {
  return createContext({ PROVIDER: "mock", DEMO_CODE: "secreto", MOCK_DURATION_MS: "10", ...extra });
}

const withCode = { "x-demo-code": "secreto", Origin: SITE };

async function body(res: Response): Promise<any> {
  return res.json();
}

test("health works without a code and says whether one is needed", async () => {
  const res = await handleHealth(jsonRequest(`${API}/api/health`, { headers: { Origin: SITE } }), mockContext());
  assert.equal(res.status, 200);
  assert.deepEqual(await body(res), { ok: true, enabled: true, provider: "mock", requiresCode: true });
  assert.equal(res.headers.get("access-control-allow-origin"), SITE);
});

test("generate -> status works end to end with the mock provider", async () => {
  const ctx = mockContext();
  const created = await handleGenerate(
    jsonRequest(`${API}/api/generate`, { method: "POST", headers: withCode, body: { image: fakeJpegDataUri(), material: "oro" } }),
    ctx,
  );
  assert.equal(created.status, 202);
  const { jobId } = await body(created);
  assert.match(jobId, /^mock_/);

  await new Promise((r) => setTimeout(r, 60));
  const status = await handleStatus(jsonRequest(`${API}/api/status?id=${jobId}`, { headers: withCode }), ctx);
  assert.equal(status.status, 200);
  const data = await body(status);
  assert.equal(data.state, "succeeded");
  assert.match(data.modelUrl, /anillo\.glb$/);
});

test("a wrong or missing demo code is refused before anything happens", async () => {
  const ctx = mockContext();
  const attempts: Array<Record<string, string>> = [{ Origin: SITE }, { Origin: SITE, "x-demo-code": "otro" }];
  for (const headers of attempts) {
    const res = await handleGenerate(
      jsonRequest(`${API}/api/generate`, { method: "POST", headers, body: { image: fakeJpegDataUri() } }),
      ctx,
    );
    assert.equal(res.status, 401);
    assert.equal((await body(res)).error.code, "unauthorized");
  }
});

test("a browser from a site that is not on the list is refused", async () => {
  const res = await handleGenerate(
    jsonRequest(`${API}/api/generate`, {
      method: "POST",
      headers: { ...withCode, Origin: "https://evil.example" },
      body: { image: fakeJpegDataUri() },
    }),
    mockContext(),
  );
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("pre-flight (OPTIONS) answers with CORS headers and no body", async () => {
  const res = await handleGenerate(
    jsonRequest(`${API}/api/generate`, { method: "OPTIONS", headers: { Origin: SITE } }),
    mockContext(),
  );
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), SITE);
  assert.match(res.headers.get("access-control-allow-headers") ?? "", /x-demo-code/);
});

test("the off switch pauses generation but not health", async () => {
  const ctx = mockContext({ ENABLED: "false" });
  const res = await handleGenerate(
    jsonRequest(`${API}/api/generate`, { method: "POST", headers: withCode, body: { image: fakeJpegDataUri() } }),
    ctx,
  );
  assert.equal(res.status, 503);
  assert.equal((await body(res)).error.code, "disabled");
  const health = await handleHealth(jsonRequest(`${API}/api/health`), ctx);
  assert.equal((await body(health)).enabled, false);
});

test("FAIL CLOSED: the real provider without a demo code or key refuses to run", async () => {
  const ctx = createContext({ PROVIDER: "meshy" });
  assert.equal(ctx.provider, null);
  assert.equal(ctx.config.problems.length, 2);
  const res = await handleGenerate(
    jsonRequest(`${API}/api/generate`, { method: "POST", body: { image: fakeJpegDataUri() } }),
    ctx,
  );
  assert.equal(res.status, 503);
  assert.equal((await body(res)).error.code, "not_configured");
  assert.equal((await body(await handleHealth(jsonRequest(`${API}/api/health`), ctx))).ok, false);
});

test("bad inputs get friendly errors, and error bodies never leak internals", async () => {
  const ctx = mockContext();
  const cases: Array<[unknown, number, string]> = [
    [{ image: "data:image/gif;base64,AAAA" }, 422, "invalid_input"],
    [{ image: fakeJpegDataUri(), material: "platino" }, 400, "bad_request"],
    [{ image: fakeJpegDataUri(4_000_000) }, 413, "image_too_large"],
  ];
  for (const [payload, status, code] of cases) {
    const res = await handleGenerate(
      jsonRequest(`${API}/api/generate`, { method: "POST", headers: withCode, body: payload }),
      ctx,
    );
    assert.equal(res.status, status);
    const data = await body(res);
    assert.equal(data.error.code, code);
    assert.equal(typeof data.error.message, "string");
    assert.deepEqual(Object.keys(data.error).sort(), ["code", "message"]);
  }
  const garbage = await handleGenerate(
    new Request(`${API}/api/generate`, { method: "POST", headers: withCode, body: "{not json" }),
    ctx,
  );
  assert.equal(garbage.status, 400);
});

test("status rejects job ids that could escape into a URL", async () => {
  for (const id of ["../etc/passwd", "a b", "x", "a?b=c", ""]) {
    const res = await handleStatus(jsonRequest(`${API}/api/status?id=${encodeURIComponent(id)}`, { headers: withCode }), mockContext());
    assert.equal(res.status, 400, `id ${JSON.stringify(id)}`);
  }
});

test("wrong HTTP method is refused", async () => {
  const res = await handleGenerate(jsonRequest(`${API}/api/generate`, { headers: withCode }), mockContext());
  assert.equal(res.status, 405);
});

test("failed jobs come back as a friendly message, not a raw provider error", async () => {
  const ctx = mockContext();
  const created = await handleGenerate(
    jsonRequest(`${API}/api/generate`, { method: "POST", headers: withCode, body: { image: fakeJpegDataUri(), style: "!rechazar" } }),
    ctx,
  );
  const { jobId } = await body(created);
  await new Promise((r) => setTimeout(r, 60));
  const data = await body(await handleStatus(jsonRequest(`${API}/api/status?id=${jobId}`, { headers: withCode }), ctx));
  assert.equal(data.state, "failed");
  assert.equal(data.error.code, "content_rejected");
  assert.match(data.error.message, /otra foto/);
});
