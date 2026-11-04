import assert from "node:assert/strict";
import { test } from "node:test";
import { expectedCredits, parseArgs, runSmoke, type SmokeDeps } from "../scripts/meshy-smoke";
import { fakeJpegDataUri } from "./helpers";

const ENV = { MESHY_API_KEY: "test-key-123", MESHY_BASE_URL: "https://api.meshy.test" };

interface Call {
  method: string;
  url: string;
}

/** A fake Meshy + fake file system + fake clock: nothing here touches the network. */
function harness(options: { balances?: number[]; taskSteps?: Array<Record<string, unknown>>; balanceStatus?: number } = {}) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const written: Array<{ path: string; bytes: number }> = [];
  const balances = options.balances ?? [100];
  const steps = options.taskSteps ?? [];
  let balanceCalls = 0;
  let taskCalls = 0;
  let clock = 0;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ method, url: u });
    if (u.endsWith("/openapi/v1/balance")) {
      if (options.balanceStatus) return json(options.balanceStatus, { message: "nope" });
      const b = balances[Math.min(balanceCalls++, balances.length - 1)] ?? 0;
      return json(200, { balance: b, monthly_credits: b, permanent_credits: 0, monthly_resets_at: 1_893_456_000_000 });
    }
    if (method === "POST" && u.endsWith("/openapi/v1/image-to-3d")) return json(202, { result: "task_abc" });
    if (u.includes("/openapi/v1/image-to-3d/task_abc")) {
      return json(200, steps[Math.min(taskCalls++, steps.length - 1)] ?? { status: "PENDING", progress: 0 });
    }
    if (u.startsWith("https://assets.meshy.test/")) {
      return new Response(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]), { status: 200 });
    }
    return json(404, { message: `unexpected ${u}` });
  }) as typeof fetch;

  const deps: SmokeDeps = {
    fetchImpl,
    readFileImpl: async () => Buffer.from(fakeJpegDataUri().split(",")[1] ?? "", "base64"),
    writeFileImpl: async (path, data) => {
      written.push({ path, bytes: data.length });
    },
    mkdirImpl: async () => {},
    log: (line) => logs.push(line),
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, calls, logs, written, posts: () => calls.filter((c) => c.method === "POST") };
}

const SUCCESS = [
  { status: "PENDING", progress: 0 },
  { status: "IN_PROGRESS", progress: 45 },
  {
    status: "SUCCEEDED",
    progress: 100,
    model_urls: { glb: "https://assets.meshy.test/m.glb" },
    thumbnail_url: "https://assets.meshy.test/t.png",
    consumed_credits: 15,
  },
];

test("parseArgs: defaults, flags and mistakes", () => {
  assert.deepEqual(parseArgs([]), { help: false, image: null, spend: false, material: null, style: "", out: "meshy-smoke-out" });
  const a = parseArgs(["--image", "p.jpg", "--spend", "--material", "plata", "--style", "  mate\n pulido ", "--out", "salida"]);
  assert.equal(a.image, "p.jpg");
  assert.equal(a.spend, true);
  assert.equal(a.material, "plata");
  assert.equal(a.style, "mate pulido");
  assert.equal(a.out, "salida");
  assert.throws(() => parseArgs(["--nope"]), /Unknown option/);
  assert.throws(() => parseArgs(["--material", "platino"]), /--material must be one of/);
  assert.throws(() => parseArgs(["--image"]), /needs a value/);
  assert.throws(() => parseArgs(["--spend"]), /--spend needs --image/);
});

test("expectedCredits follows the official price list", () => {
  assert.equal(expectedCredits("meshy-6-lite"), 15);
  assert.equal(expectedCredits("meshy-7.1"), 30);
  assert.equal(expectedCredits("latest"), 30);
  assert.equal(expectedCredits("some-future-model"), null);
});

test("no photo: only the FREE balance check runs, and the key is never printed", async () => {
  const h = harness({ balances: [100] });
  const result = await runSmoke([], ENV, h.deps);
  assert.equal(result.kind, "balance");
  assert.deepEqual(h.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`), ["GET /openapi/v1/balance"]);
  assert.match(h.logs.join("\n"), /Credits you can spend: 100/);
  assert.equal(h.logs.join("\n").includes("test-key-123"), false);
});

test("dry run: shows the request and the cost but sends nothing and spends nothing", async () => {
  const h = harness({ balances: [100] });
  const result = await runSmoke(["--image", "foto.jpg", "--material", "oro"], ENV, h.deps);
  assert.equal(result.kind, "dry-run");
  assert.equal(h.posts().length, 0);
  if (result.kind === "dry-run") {
    assert.equal(result.expected, 15);
    for (const field of ["image_url", "ai_model", "should_texture", "enable_pbr", "target_formats", "texture_prompt"]) {
      assert.ok(result.fields.includes(field), `missing ${field}`);
    }
  }
  assert.match(h.logs.join("\n"), /DRY RUN: nothing was sent/);
});

test("--spend: one real task, cross-checks the charge, downloads the model at once", async () => {
  const h = harness({ balances: [100, 85], taskSteps: SUCCESS });
  const result = await runSmoke(["--image", "foto.jpg", "--spend", "--out", "salida"], ENV, h.deps);

  assert.equal(h.posts().length, 1); // exactly one task created
  assert.equal(result.kind, "succeeded");
  if (result.kind === "succeeded") {
    assert.equal(result.creditsUsed, 15);
    assert.equal(result.spent, 15); // balance 100 -> 85
    assert.equal(result.validGlb, true);
    assert.equal(result.seconds, 10); // two 5 s waits on the fake clock
    assert.match(result.file, /salida[\\/]task_abc\.glb$/);
  }
  assert.equal(h.written.length, 1);
  assert.equal(h.written[0]?.bytes, 16);
  assert.match(h.logs.join("\n"), /spent 15/);
});

test("--spend: a failed task is reported with its friendly code and nothing is downloaded", async () => {
  const h = harness({
    balances: [100],
    taskSteps: [{ status: "FAILED", progress: 10, task_error: { type: "invalid_input", code: "moderation_blocked", message: "x" } }],
  });
  const result = await runSmoke(["--image", "foto.jpg", "--spend"], ENV, h.deps);
  assert.equal(result.kind, "failed");
  if (result.kind === "failed") assert.equal(result.code, "content_rejected");
  assert.equal(h.written.length, 0);
});

test("--spend refuses up front when the balance cannot cover the expected cost", async () => {
  const h = harness({ balances: [5] });
  await assert.rejects(runSmoke(["--image", "foto.jpg", "--spend"], ENV, h.deps), /Not enough credits/);
  assert.equal(h.posts().length, 0);
});

test("guards: missing key, rejected key, and a file that is not a photo", async () => {
  const none = harness();
  await assert.rejects(runSmoke([], { MESHY_BASE_URL: ENV.MESHY_BASE_URL }, none.deps), /MESHY_API_KEY is not set/);
  assert.equal(none.calls.length, 0); // no request without a key

  const bad = harness({ balanceStatus: 401 });
  await assert.rejects(runSmoke([], ENV, bad.deps), /rejected the key/);

  const text = harness();
  text.deps.readFileImpl = async () => Buffer.from("not an image at all");
  await assert.rejects(runSmoke(["--image", "notas.txt"], ENV, text.deps), /JPG or PNG/);
  assert.equal(text.posts().length, 0);
});
