import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext, handleHealth, handleOrderCreate, handleOrderFile, handleOrders, handleOrderStatus } from "../lib/handlers";
import { ORDER_ID, orderPath, type OrderRecord, type OrderStore } from "../lib/orders";
import { fakeJpegDataUri, fakePngDataUri, jsonRequest } from "./helpers";

const SITE = "https://daniel666674.github.io";
const API = "https://api.test";
const DEMO = { "x-demo-code": "secreto", Origin: SITE };
const ADMIN = { "x-admin-code": "jefe", Origin: SITE };
const TASK = "01a1a52b-898b-7569-8667-fea24eccdb03";

/** A fake GLB: 8 MB of known bytes (3 pieces), so a wrong slice or a missing piece is caught. */
const MODEL = Buffer.alloc(8_000_000);
for (let i = 0; i < MODEL.length; i++) MODEL[i] = (i * 17 + 3) & 0xff;
MODEL.write("glTF", 0, "ascii");

function memoryStore() {
  const files = new Map<string, Uint8Array>();
  const store: OrderStore = {
    async putJson(path, value) {
      files.set(path, new TextEncoder().encode(JSON.stringify(value)));
    },
    async putBytes(path, bytes) {
      files.set(path, bytes);
    },
    async getJson<T>(path: string) {
      const data = files.get(path);
      return data ? (JSON.parse(new TextDecoder().decode(data)) as T) : null;
    },
    async listIds() {
      return [...files.keys()].map((k) => /^orders\/(HE-\d{6}-[A-Z0-9]{4})\/order\.json$/.exec(k)?.[1]).filter((v): v is string => Boolean(v));
    },
    async readRange(path, offset, length) {
      const data = files.get(path);
      return data ? { bytes: data.subarray(offset, offset + length), total: data.length } : null;
    },
  };
  return { store, files };
}

function fakeWorld(status = "SUCCEEDED") {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://api.meshy.ai/openapi/v1/image-to-3d/")) {
      return new Response(
        JSON.stringify(status === "SUCCEEDED" ? { status, progress: 100, model_urls: { glb: "https://assets.meshy.ai/x/model.glb?Expires=1&Signature=s" } } : { status, progress: 40 }),
        { status: 200 },
      );
    }
    if (url.startsWith("https://assets.meshy.ai/")) {
      const m = /bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("range") ?? "");
      if (!m) return new Response(MODEL, { status: 200 });
      const start = Number(m[1]);
      if (start >= MODEL.length) return new Response("", { status: 416 });
      const end = Math.min(Number(m[2]), MODEL.length - 1);
      return new Response(MODEL.subarray(start, end + 1), { status: 206, headers: { "Content-Range": `bytes ${start}-${end}/${MODEL.length}` } });
    }
    return new Response("unexpected " + url, { status: 599 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function setup(extraEnv: Record<string, string> = {}, status = "SUCCEEDED") {
  const world = fakeWorld(status);
  const mem = memoryStore();
  const ctx = createContext({ PROVIDER: "meshy", MESHY_API_KEY: "k", DEMO_CODE: "secreto", ADMIN_CODE: "jefe", ...extraEnv }, world.fetchImpl, mem.store);
  return { ctx, world, ...mem };
}

const orderBody = (extra: Record<string, unknown> = {}) => ({
  jobId: TASK,
  piece: "collar",
  material: "plata",
  style: "gato naranja de ojos verdes",
  name: "  María   Pérez ",
  notes: "para el cumpleaños de mi mamá",
  photo: fakeJpegDataUri(),
  consent: true,
  ...extra,
});

async function create(ctx: ReturnType<typeof setup>["ctx"], body: unknown, headers: Record<string, string> = DEMO) {
  return handleOrderCreate(jsonRequest(`${API}/api/order`, { method: "POST", headers, body }), ctx);
}

test("an order keeps the whole 3D file, the photo and the customer's words, and answers with a short id", async () => {
  const { ctx, files } = setup();
  const res = await create(ctx, orderBody());
  assert.equal(res.status, 201);
  const { orderId } = (await res.json()) as { orderId: string };
  assert.match(orderId, ORDER_ID);

  const model = files.get(orderPath(orderId, "model.glb"));
  assert.ok(model && Buffer.from(model).equals(MODEL), "the stored 3D file must be byte for byte the model (8 MB, 3 pieces)");
  assert.equal(files.get(orderPath(orderId, "photo.jpg"))?.length, Buffer.from(fakeJpegDataUri().split(",")[1] ?? "", "base64").length);

  const record = JSON.parse(new TextDecoder().decode(files.get(orderPath(orderId, "order.json")))) as OrderRecord;
  assert.equal(record.status, "nuevo");
  assert.equal(record.jobId, TASK);
  assert.equal(record.piece, "collar");
  assert.equal(record.material, "plata");
  assert.equal(record.style, "gato naranja de ojos verdes");
  assert.equal(record.name, "María Pérez", "spaces collapsed");
  assert.equal(record.files.model.bytes, MODEL.length);
  assert.equal(record.files.photo?.type, "image/jpeg");
});

test("a png photo is kept as png, and the photo is optional", async () => {
  const { ctx, files } = setup();
  const png = await create(ctx, orderBody({ photo: fakePngDataUri() }));
  const pngId = ((await png.json()) as { orderId: string }).orderId;
  assert.ok(files.has(orderPath(pngId, "photo.png")));
  const none = await create(ctx, orderBody({ photo: undefined }));
  const noneId = ((await none.json()) as { orderId: string }).orderId;
  assert.equal(files.has(orderPath(noneId, "photo.jpg")), false);
  const record = JSON.parse(new TextDecoder().decode(files.get(orderPath(noneId, "order.json")))) as OrderRecord;
  assert.equal(record.files.photo, null);
});

test("creating an order needs consent, the demo code, a real finished job and a sane body", async () => {
  const { ctx, files, world } = setup();
  assert.equal((await create(ctx, orderBody({ consent: false }))).status, 400);
  assert.equal((await create(ctx, orderBody({ consent: undefined }))).status, 400);
  assert.equal((await create(ctx, orderBody(), { ...DEMO, "x-demo-code": "nope" })).status, 401);
  assert.equal((await create(ctx, orderBody(), { Origin: SITE })).status, 401);
  assert.equal((await create(ctx, orderBody(), { ...DEMO, Origin: "https://evil.example" })).status, 403);
  assert.equal((await create(ctx, orderBody({ jobId: "ii_" + TASK }))).status, 400, "step-1 ids would start a new 3D task");
  assert.equal((await create(ctx, orderBody({ jobId: "../x" }))).status, 400);
  assert.equal((await create(ctx, orderBody({ piece: "corona" }))).status, 400);
  assert.equal((await create(ctx, orderBody({ photo: "data:text/html;base64,AAAA" }))).status, 422);
  assert.equal(files.size, 0, "nothing stored by a refused order");
  assert.equal(world.calls.filter((c) => c.startsWith("https://assets.meshy.ai")).length, 0, "no download for refused orders");

  const running = setup({}, "IN_PROGRESS");
  assert.equal((await create(running.ctx, orderBody())).status, 404, "an unfinished design cannot be ordered");
  assert.equal(running.files.size, 0);
});

test("name and notes are cleaned and capped; the logs never carry them", async () => {
  const { ctx, files } = setup();
  const logs: string[] = [];
  const original = console.log;
  console.log = (line?: unknown) => { logs.push(String(line)); };
  let id: string;
  try {
    const res = await create(ctx, orderBody({ name: "N\u0000ombre\n" + "x".repeat(200), notes: "n".repeat(900), style: "s".repeat(500) }));
    id = ((await res.json()) as { orderId: string }).orderId;
  } finally {
    console.log = original;
  }
  const record = JSON.parse(new TextDecoder().decode(files.get(orderPath(id, "order.json")))) as OrderRecord;
  assert.equal(record.name.length, 60);
  assert.equal(record.name.startsWith("N ombre x"), true);
  assert.equal(record.notes.length, 400);
  assert.equal(record.style.length, 200);
  const joined = logs.join("\n");
  assert.match(joined, /order_created/);
  assert.equal(joined.includes("María"), false);
  assert.equal(joined.includes("Nombre"), false);
  assert.equal(joined.includes("nnnnnnnn"), false);
});

test("the admin panel lists orders newest first, only with the admin code (the demo code is not enough)", async () => {
  const { ctx } = setup();
  const first = ((await (await create(ctx, orderBody({ name: "primero" }))).json()) as { orderId: string }).orderId;
  await new Promise((r) => setTimeout(r, 15));
  const second = ((await (await create(ctx, orderBody({ name: "segundo" }))).json()) as { orderId: string }).orderId;

  const list = (headers: Record<string, string>) => handleOrders(jsonRequest(`${API}/api/orders`, { headers }), ctx);
  assert.equal((await list({ Origin: SITE })).status, 401);
  assert.equal((await list(DEMO)).status, 401, "the client's demo code must not open the orders");
  assert.equal((await list({ ...ADMIN, "x-admin-code": "otro" })).status, 401);
  assert.equal((await list({ ...ADMIN, Origin: "https://evil.example" })).status, 403);
  const ok = await list(ADMIN);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("access-control-allow-origin"), SITE);
  const data = (await ok.json()) as { orders: OrderRecord[] };
  assert.deepEqual(data.orders.map((o) => o.id), [second, first]);
});

test("the admin downloads an order's 3D file and photo in pieces that reassemble exactly", async () => {
  const { ctx } = setup();
  const id = ((await (await create(ctx, orderBody())).json()) as { orderId: string }).orderId;
  const piece = (kind: string, offset: number, headers: Record<string, string> = ADMIN) =>
    handleOrderFile(jsonRequest(`${API}/api/order-file?id=${id}&kind=${kind}&offset=${offset}`, { headers }), ctx);

  assert.equal((await piece("model", 0, DEMO)).status, 401);
  assert.equal((await piece("model", 0, { Origin: SITE })).status, 401);
  assert.equal((await piece("video", 0)).status, 400);
  assert.equal((await piece("model", 99_999_999)).status, 400);
  assert.equal((await handleOrderFile(jsonRequest(`${API}/api/order-file?id=HE-000000-AAAA&kind=model`, { headers: ADMIN }), ctx)).status, 404);

  const parts: Buffer[] = [];
  let got = 0;
  let total = 0;
  while (total === 0 || got < total) {
    const res = await piece("model", got);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("access-control-expose-headers") ?? "", /x-model-total/i);
    total = Number(res.headers.get("x-model-total"));
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 0 && buf.length <= 3_500_000);
    parts.push(buf);
    got += buf.length;
  }
  assert.equal(total, MODEL.length);
  assert.ok(Buffer.concat(parts).equals(MODEL));
  assert.equal((await piece("photo", 0)).status, 200);
});

test("the admin can change an order's status, and only to a known one", async () => {
  const { ctx } = setup();
  const id = ((await (await create(ctx, orderBody())).json()) as { orderId: string }).orderId;
  const set = (body: unknown, headers: Record<string, string> = ADMIN) =>
    handleOrderStatus(jsonRequest(`${API}/api/order-status`, { method: "POST", headers, body }), ctx);
  assert.equal((await set({ id, status: "cotizado" }, DEMO)).status, 401);
  assert.equal((await set({ id, status: "regalado" })).status, 400);
  assert.equal((await set({ id: "nope", status: "cotizado" })).status, 400);
  assert.equal((await set({ id: "HE-000000-AAAA", status: "cotizado" })).status, 404);
  const ok = await set({ id, status: "cotizado" });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { order: OrderRecord }).order.status, "cotizado");
  const list = await handleOrders(jsonRequest(`${API}/api/orders`, { headers: ADMIN }), ctx);
  assert.equal(((await list.json()) as { orders: OrderRecord[] }).orders[0]?.status, "cotizado");
});

test("without storage or without an admin code orders are off: 503 everywhere, health says so, nothing is fetched", async () => {
  const world = fakeWorld();
  const noStore = createContext({ PROVIDER: "meshy", MESHY_API_KEY: "k", DEMO_CODE: "secreto", ADMIN_CODE: "jefe" }, world.fetchImpl, null);
  const noAdmin = createContext({ PROVIDER: "meshy", MESHY_API_KEY: "k", DEMO_CODE: "secreto" }, world.fetchImpl, memoryStore().store);
  for (const ctx of [noStore, noAdmin]) {
    assert.equal((await create(ctx, orderBody())).status, 503);
    assert.equal((await handleOrders(jsonRequest(`${API}/api/orders`, { headers: ADMIN }), ctx)).status, 503);
    const health = await handleHealth(jsonRequest(`${API}/api/health`, { headers: { Origin: SITE } }), ctx);
    assert.equal(((await health.json()) as { orders: boolean }).orders, false);
  }
  assert.equal(world.calls.length, 0);

  const on = setup();
  const health = await handleHealth(jsonRequest(`${API}/api/health`, { headers: { Origin: SITE } }), on.ctx);
  assert.equal(((await health.json()) as { orders: boolean }).orders, true);
});
