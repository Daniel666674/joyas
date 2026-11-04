import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext, handleModel, MODEL_CHUNK_BYTES } from "../lib/handlers";
import { jsonRequest } from "./helpers";

const SITE = "https://daniel666674.github.io";
const API = "https://api.test";
const HEADERS = { "x-demo-code": "secreto", Origin: SITE };
const TASK = "01a1a52b-898b-7569-8667-fea24eccdb03";

/** A fake "GLB": 10 MB of known bytes, so a wrong slice or a missing piece is detected. */
const MODEL = Buffer.alloc(10_000_000);
for (let i = 0; i < MODEL.length; i++) MODEL[i] = (i * 31 + 7) & 0xff;
MODEL.write("glTF", 0, "ascii");

interface Fake {
  fetchImpl: typeof fetch;
  calls: string[];
}

/** Fake Meshy API + fake asset host (CloudFront-like: honours Range, sends no CORS headers). */
function fakeWorld(options: { status?: string; glbUrl?: string; honourRange?: boolean } = {}): Fake {
  const { status = "SUCCEEDED", glbUrl = "https://assets.meshy.ai/abc/tasks/x/output/model.glb?Expires=1&Signature=s", honourRange = true } = options;
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://api.meshy.ai/openapi/v1/image-to-3d/")) {
      return new Response(
        JSON.stringify(status === "SUCCEEDED" ? { status, progress: 100, model_urls: { glb: glbUrl }, consumed_credits: 15 } : { status, progress: 40 }),
        { status: 200 },
      );
    }
    if (url.startsWith("https://assets.meshy.ai/")) {
      const range = new Headers(init?.headers).get("range");
      const m = range ? /bytes=(\d+)-(\d+)/.exec(range) : null;
      if (!m || !honourRange) return new Response(MODEL, { status: 200 });
      const start = Number(m[1]);
      if (start >= MODEL.length) return new Response("", { status: 416 });
      const end = Math.min(Number(m[2]), MODEL.length - 1);
      return new Response(MODEL.subarray(start, end + 1), {
        status: 206,
        headers: { "Content-Range": `bytes ${start}-${end}/${MODEL.length}` },
      });
    }
    return new Response("unexpected " + url, { status: 599 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function meshyContext(fake: Fake) {
  return createContext({ PROVIDER: "meshy", MESHY_API_KEY: "key", DEMO_CODE: "secreto" }, fake.fetchImpl);
}

async function download(ctx: ReturnType<typeof meshyContext>): Promise<{ bytes: Buffer; pieces: number; total: number }> {
  const parts: Buffer[] = [];
  let got = 0;
  let total = 0;
  while (total === 0 || got < total) {
    const res = await handleModel(jsonRequest(`${API}/api/model?id=${TASK}&offset=${got}`, { headers: HEADERS }), ctx);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), SITE);
    assert.match(res.headers.get("access-control-expose-headers") ?? "", /x-model-total/i);
    total = Number(res.headers.get("x-model-total"));
    const piece = Buffer.from(await res.arrayBuffer());
    assert.ok(piece.length > 0 && piece.length <= MODEL_CHUNK_BYTES, `piece of ${piece.length} bytes`);
    parts.push(piece);
    got += piece.length;
  }
  return { bytes: Buffer.concat(parts), pieces: parts.length, total };
}

test("model relay: a 10 MB model comes back intact, in pieces that fit Vercel's response limit", async () => {
  const ctx = meshyContext(fakeWorld());
  const { bytes, pieces, total } = await download(ctx);
  assert.equal(total, MODEL.length);
  assert.equal(pieces, 3);
  assert.ok(bytes.equals(MODEL), "reassembled bytes differ from the original");
});

test("model relay: still correct when the file host ignores Range and sends everything", async () => {
  const ctx = meshyContext(fakeWorld({ honourRange: false }));
  const { bytes, total } = await download(ctx);
  assert.equal(total, MODEL.length);
  assert.ok(bytes.equals(MODEL));
});

test("model relay needs the demo code and an allowed origin, and fetches nothing otherwise", async () => {
  const fake = fakeWorld();
  const ctx = meshyContext(fake);
  const noCode = await handleModel(jsonRequest(`${API}/api/model?id=${TASK}`, { headers: { Origin: SITE } }), ctx);
  assert.equal(noCode.status, 401);
  const wrongCode = await handleModel(jsonRequest(`${API}/api/model?id=${TASK}`, { headers: { ...HEADERS, "x-demo-code": "nope" } }), ctx);
  assert.equal(wrongCode.status, 401);
  const foreign = await handleModel(jsonRequest(`${API}/api/model?id=${TASK}`, { headers: { ...HEADERS, Origin: "https://evil.example" } }), ctx);
  assert.equal(foreign.status, 403);
  assert.deepEqual(fake.calls, [], "nothing may be fetched before the guards pass");
});

test("model relay: unfinished job -> 404, bad id/offset -> 400, offset past the end -> 400", async () => {
  const running = meshyContext(fakeWorld({ status: "IN_PROGRESS" }));
  assert.equal((await handleModel(jsonRequest(`${API}/api/model?id=${TASK}`, { headers: HEADERS }), running)).status, 404);

  const ctx = meshyContext(fakeWorld());
  assert.equal((await handleModel(jsonRequest(`${API}/api/model?id=../etc`, { headers: HEADERS }), ctx)).status, 400);
  assert.equal((await handleModel(jsonRequest(`${API}/api/model?id=${TASK}&offset=-5`, { headers: HEADERS }), ctx)).status, 400);
  assert.equal((await handleModel(jsonRequest(`${API}/api/model?id=${TASK}&offset=abc`, { headers: HEADERS }), ctx)).status, 400);
  assert.equal((await handleModel(jsonRequest(`${API}/api/model?id=${TASK}&offset=99999999`, { headers: HEADERS }), ctx)).status, 400);
});

test("model relay never downloads from a host it does not expect", async () => {
  const fake = fakeWorld({ glbUrl: "https://evil.example/model.glb" });
  const res = await handleModel(jsonRequest(`${API}/api/model?id=${TASK}`, { headers: HEADERS }), meshyContext(fake));
  assert.equal(res.status, 502);
  assert.equal(fake.calls.some((c) => c.startsWith("https://evil.example")), false);

  const http = fakeWorld({ glbUrl: "http://assets.meshy.ai/model.glb" });
  assert.equal((await handleModel(jsonRequest(`${API}/api/model?id=${TASK}`, { headers: HEADERS }), meshyContext(http))).status, 502);
});

test("model relay answers JSON errors (not binary) when the file host fails", async () => {
  const fake = fakeWorld();
  const broken: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    String(input).startsWith("https://assets.meshy.ai/") ? new Response("denied", { status: 403 }) : fake.fetchImpl(input, init)) as typeof fetch;
  const ctx = createContext({ PROVIDER: "meshy", MESHY_API_KEY: "key", DEMO_CODE: "secreto" }, broken);
  const res = await handleModel(jsonRequest(`${API}/api/model?id=${TASK}`, { headers: HEADERS }), ctx);
  assert.equal(res.status, 502);
  const data = (await res.json()) as { error: { code: string } };
  assert.equal(data.error.code, "provider_error");
});
