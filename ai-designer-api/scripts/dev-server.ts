/**
 * Runs the three API files on your own computer (http://localhost:8787) using
 * exactly the same code Vercel runs, so you can test without deploying.
 *   npm run dev
 * Reads settings from ".env" if present (copy .env.example first).
 */
import { createServer, type IncomingMessage } from "node:http";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: defaults apply (mock provider).
}

// (Imports run first, but the API reads its settings lazily on the first
// request, so the .env values above are already in place by then.)
import generate from "../api/generate";
import health from "../api/health";
import status from "../api/status";

const routes: Record<string, { fetch: (request: Request) => Promise<Response> | Response }> = {
  "/api/generate": generate,
  "/api/status": status,
  "/api/health": health,
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const port = Number(process.env.PORT ?? 8787);

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const route = routes[url.pathname];
    if (!route) {
      res.writeHead(404, { "Content-Type": "application/json" }).end('{"error":"not found"}');
      return;
    }
    const method = req.method ?? "GET";
    const hasBody = method !== "GET" && method !== "HEAD";
    const request = new Request(url, {
      method,
      headers: req.headers as Record<string, string>,
      ...(hasBody ? { body: new Uint8Array(await readBody(req)) } : {}),
    });
    const response = await route.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "Content-Type": "application/json" }).end('{"error":"dev server error"}');
  }
}).listen(port, () => {
  console.log(`AI designer API listening on http://localhost:${port}/api/health`);
});
