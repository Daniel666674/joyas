import { get, list, put } from "@vercel/blob";

/**
 * Saved orders: what a customer sends when they ask to quote a piece. The repository is public
 * (it is what GitHub Pages serves), so customer data, photos and 3D files can never live in it:
 * they go to a PRIVATE Vercel Blob store that only this backend (and so the admin panel, with
 * the admin code) can read.
 *
 * Layout inside the store:
 *   orders/<id>/order.json   the record (written LAST, so a record always has its files)
 *   orders/<id>/model.glb    the finished 3D model (Meshy deletes its copy after ~3 days)
 *   orders/<id>/photo.jpg    the customer's photo (only with their consent)
 */
export const ORDER_STATUSES = ["nuevo", "cotizado", "en-produccion", "entregado", "cancelado"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** HE-<yymmdd>-<4 letters/digits>, short enough to read out over WhatsApp. */
export const ORDER_ID = /^HE-\d{6}-[A-Z0-9]{4}$/;

export interface OrderRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: OrderStatus;
  /** The provider's id of the finished 3D model (used by the recovery link while the provider still has it). */
  jobId: string;
  piece: string | null;
  material: string | null;
  /** The words the customer wrote in "Cuéntanos más". */
  style: string;
  name: string;
  notes: string;
  files: {
    model: { path: string; bytes: number };
    photo: { path: string; bytes: number; type: string } | null;
  };
}

export type OrderFileKind = "model" | "photo";

export interface OrderStore {
  putJson(path: string, value: unknown): Promise<void>;
  putBytes(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  getJson<T>(path: string): Promise<T | null>;
  /** Ids of every order that has a record, in any order. */
  listIds(): Promise<string[]>;
  /** `length` bytes from `offset` (fewer at the end) plus the file's total size, or null when it does not exist. */
  readRange(path: string, offset: number, length: number): Promise<{ bytes: Uint8Array; total: number } | null>;
}

export function newOrderId(now: Date = new Date(), random: () => number = Math.random): string {
  const yy = String(now.getUTCFullYear()).slice(2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  // no 0/O or 1/I so it cannot be misread when someone types or reads it out
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let tail = "";
  for (let i = 0; i < 4; i++) tail += alphabet[Math.floor(random() * alphabet.length)];
  return `HE-${yy}${mm}${dd}-${tail}`;
}

export function orderPath(id: string, file: "order.json" | "model.glb" | "photo.jpg" | "photo.png"): string {
  return `orders/${id}/${file}`;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The real store: Vercel Blob, private access. The SDK reads BLOB_READ_WRITE_TOKEN itself. */
export function createBlobStore(): OrderStore {
  return {
    async putJson(path, value) {
      await put(path, JSON.stringify(value), {
        access: "private",
        allowOverwrite: true,
        addRandomSuffix: false,
        contentType: "application/json",
      });
    },

    async putBytes(path, bytes, contentType) {
      await put(path, Buffer.from(bytes), { access: "private", allowOverwrite: true, addRandomSuffix: false, contentType });
    },

    async getJson<T>(path: string): Promise<T | null> {
      const res = await get(path, { access: "private", useCache: false });
      if (!res || res.statusCode !== 200) return null;
      return JSON.parse(await new Response(res.stream).text()) as T;
    },

    async listIds() {
      const ids: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const result = await list({ prefix: "orders/", limit: 1000, cursor });
        for (const blob of result.blobs) {
          const match = /^orders\/(HE-\d{6}-[A-Z0-9]{4})\/order\.json$/.exec(blob.pathname);
          if (match?.[1]) ids.push(match[1]);
        }
        if (!result.hasMore) break;
        cursor = result.cursor;
      }
      return ids;
    },

    async readRange(path, offset, length) {
      const res = await get(path, { access: "private", useCache: false });
      if (!res || res.statusCode !== 200) return null;
      const total = res.blob.size;
      const end = Math.min(total, offset + length);
      const reader = res.stream.getReader();
      const parts: Uint8Array[] = [];
      let position = 0;
      while (position < end) {
        const { done, value } = await reader.read();
        if (done) break;
        const start = position;
        position += value.length;
        if (position > offset) parts.push(value.subarray(Math.max(0, offset - start), Math.min(value.length, end - start)));
      }
      await reader.cancel().catch(() => undefined);
      return { bytes: concat(parts), total };
    },
  };
}
