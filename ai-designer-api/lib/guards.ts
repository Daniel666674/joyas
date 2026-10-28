import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "./config";
import { ApiError } from "./errors";

const sha = (text: string) => createHash("sha256").update(text).digest();

/** Compares the demo code without leaking, through timing, how much of it matched. */
export function assertDemoCode(request: Request, config: Config): void {
  if (config.demoCode === null) return; // only possible with the mock provider
  const given = request.headers.get("x-demo-code") ?? "";
  if (!timingSafeEqual(sha(given), sha(config.demoCode))) {
    throw new ApiError("unauthorized", "wrong or missing demo code");
  }
}

function allowedOrigin(request: Request, config: Config): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  return config.allowedOrigins.includes(origin) ? origin : null;
}

/**
 * Browsers always send `Origin` on cross-site calls. If one arrives from a site
 * we don't list, refuse it outright. (Requests with no Origin, like curl, pass
 * this check; the demo code is what stops them.)
 */
export function assertOriginAllowed(request: Request, config: Config): void {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigin(request, config)) {
    throw new ApiError("forbidden_origin", `origin not allowed: ${origin}`);
  }
}

export function corsHeaders(request: Request, config: Config): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  const origin = allowedOrigin(request, config);
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "content-type, x-demo-code";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}
