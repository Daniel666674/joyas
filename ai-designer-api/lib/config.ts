export type ProviderName = "mock" | "meshy";

export interface Config {
  provider: ProviderName;
  /** false = instant off switch (ENABLED=false). */
  enabled: boolean;
  /** null only allowed with the mock provider. */
  demoCode: string | null;
  allowedOrigins: string[];
  /** Max decoded size of the (already browser-resized) photo. */
  maxImageBytes: number;
  meshy: { apiKey: string; model: string; enablePbr: boolean; baseUrl: string };
  mock: { modelBaseUrl: string; durationMs: number };
  /**
   * Human-readable setup mistakes (variable NAMES only, never values). When this
   * is non-empty the API refuses to run instead of running half-configured.
   */
  problems: string[];
}

type Env = Record<string, string | undefined>;

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return !["false", "0", "off", "no"].includes(value.trim().toLowerCase());
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = [];

  const rawProvider = (env.PROVIDER ?? "mock").trim().toLowerCase();
  let provider: ProviderName = "mock";
  if (rawProvider === "mock" || rawProvider === "meshy") {
    provider = rawProvider;
  } else {
    problems.push("PROVIDER must be 'mock' or 'meshy'");
  }

  const demoCode = env.DEMO_CODE?.trim() || null;
  const apiKey = env.MESHY_API_KEY?.trim() ?? "";

  // Fail closed: a real provider with no gate or no key must never serve traffic.
  if (provider === "meshy") {
    if (!apiKey) problems.push("MESHY_API_KEY is missing");
    if (!demoCode) problems.push("DEMO_CODE is required when PROVIDER=meshy");
  }

  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "https://daniel666674.github.io")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  return {
    provider,
    enabled: flag(env.ENABLED, true),
    demoCode,
    allowedOrigins,
    maxImageBytes: 3_000_000,
    meshy: {
      apiKey,
      model: env.MESHY_MODEL?.trim() || "meshy-6-lite",
      enablePbr: flag(env.MESHY_ENABLE_PBR, true),
      baseUrl: (env.MESHY_BASE_URL?.trim() || "https://api.meshy.ai").replace(/\/+$/, ""),
    },
    mock: {
      modelBaseUrl: (
        env.MOCK_MODEL_BASE_URL?.trim() || "https://daniel666674.github.io/joyas/models/samples"
      ).replace(/\/+$/, ""),
      durationMs: positiveInt(env.MOCK_DURATION_MS, 12_000),
    },
    problems,
  };
}
