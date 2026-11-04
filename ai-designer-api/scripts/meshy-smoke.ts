/**
 * First real run of the Meshy integration, step by step and safe by default.
 *
 *   npm run smoke
 *       FREE. Checks that the API key works and shows your credit balance.
 *   npm run smoke -- --image ./foto.jpg
 *       FREE dry run. Shows exactly what would be sent and what it should cost.
 *   npm run smoke -- --image ./foto.jpg --spend [--material oro] [--style "acabado pulido"] [--out ./salida]
 *       REAL generation: SPENDS CREDITS. Prints the time taken and the credits
 *       Meshy charged (compare with the expectation), cross-checks your balance
 *       before and after, and downloads the .glb straight away (Meshy keeps the
 *       files for only about 3 days).
 *
 * Settings come from the environment or an ".env" file, with the same names as
 * the backend: MESHY_API_KEY (required), MESHY_MODEL, MESHY_ENABLE_PBR,
 * MESHY_MODERATION, MESHY_BASE_URL. The key is never printed. Keep it in your
 * own terminal or in a secret store; never paste it into a chat or commit it.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../lib/config";
import { ApiError, friendlyMessage } from "../lib/errors";
import { buildTexturePrompt, MATERIALS, type Material } from "../lib/prompts";
import { buildCreateBody, createMeshyProvider } from "../lib/providers/meshy";
import type { JobStatus } from "../lib/providers/types";
import { cleanStyleText, parseGenerateBody } from "../lib/validate";

const POLL_MS = 5_000; // Meshy's docs: poll every ~5 s (or at Retry-After)
const GIVE_UP_MS = 10 * 60_000; // typical task: 1-3.5 min; the docs say very busy periods can take far longer

export interface SmokeArgs {
  help: boolean;
  image: string | null;
  spend: boolean;
  material: Material | null;
  style: string;
  out: string;
}

export function parseArgs(argv: string[]): SmokeArgs {
  const args: SmokeArgs = { help: false, image: null, spend: false, material: null, style: "", out: "meshy-smoke-out" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = (): string => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    switch (flag) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--image":
        args.image = value();
        break;
      case "--spend":
        args.spend = true;
        break;
      case "--material": {
        const material = value();
        if (!(MATERIALS as readonly string[]).includes(material)) {
          throw new Error(`--material must be one of: ${MATERIALS.join(", ")}`);
        }
        args.material = material as Material;
        break;
      }
      case "--style":
        args.style = cleanStyleText(value());
        break;
      case "--out":
        args.out = value();
        break;
      default:
        throw new Error(`Unknown option: ${flag}. Try --help.`);
    }
  }
  if (args.spend && !args.image) throw new Error("--spend needs --image <file>");
  return args;
}

/**
 * Credits Meshy charges for "Image to 3D, mesh with 2K textures", from the
 * official pricing page (docs.meshy.ai/api/pricing, checked 2026-11-04).
 * null = a model this script has no price for.
 */
export function expectedCredits(model: string): number | null {
  const table: Record<string, number> = {
    "meshy-6-lite": 15,
    "meshy-6": 30,
    "meshy-7": 30,
    "meshy-7.1": 30,
    latest: 30,
  };
  return table[model] ?? null;
}

export interface Balance {
  balance: number;
  monthly: number;
  permanent: number;
  resetsAt: number | null;
}

async function getBalance(fetchImpl: typeof fetch, baseUrl: string, apiKey: string): Promise<Balance> {
  const res = await fetchImpl(`${baseUrl}/openapi/v1/balance`, { headers: { Authorization: `Bearer ${apiKey}` } });
  const body = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  if (res.status === 401) {
    throw new Error(
      "Meshy rejected the key (HTTP 401). Check MESHY_API_KEY, and that your plan includes the API (Pro or higher).",
    );
  }
  if (!res.ok) throw new Error(`Balance check failed: HTTP ${res.status} ${String(body.message ?? "")}`.trim());
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  return {
    balance: num(body.balance),
    monthly: num(body.monthly_credits),
    permanent: num(body.permanent_credits),
    resetsAt: typeof body.monthly_resets_at === "number" ? body.monthly_resets_at : null,
  };
}

function sniffMime(bytes: Buffer): "image/jpeg" | "image/png" {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  throw new Error("The image must be a JPG or PNG file (the same rule the website applies).");
}

export interface SmokeDeps {
  fetchImpl: typeof fetch;
  readFileImpl: (path: string) => Promise<Buffer>;
  writeFileImpl: (path: string, data: Uint8Array) => Promise<void>;
  mkdirImpl: (path: string) => Promise<void>;
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const defaultDeps: SmokeDeps = {
  fetchImpl: fetch,
  readFileImpl: (path) => readFile(path),
  writeFileImpl: (path, data) => writeFile(path, data),
  mkdirImpl: async (path) => {
    await mkdir(path, { recursive: true });
  },
  log: (line) => console.log(line),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

const HELP = `Meshy first-run check (free unless you pass --spend)

  npm run smoke                              check the key + show your credit balance (free)
  npm run smoke -- --image photo.jpg         dry run: what would be sent, expected cost (free)
  npm run smoke -- --image photo.jpg --spend [--material oro|plata|oro-rosa] [--style "text"] [--out folder]
                                             REAL generation, spends credits

Needs MESHY_API_KEY in the environment or in a .env file.`;

export type SmokeResult =
  | { kind: "help" }
  | { kind: "balance"; balance: Balance }
  | { kind: "dry-run"; balance: Balance; expected: number | null; fields: string[] }
  | { kind: "failed"; jobId: string; code: string; seconds: number }
  | { kind: "succeeded"; jobId: string; seconds: number; creditsUsed: number | undefined; spent: number; file: string; validGlb: boolean };

export async function runSmoke(
  argv: string[],
  env: Record<string, string | undefined>,
  deps: SmokeDeps = defaultDeps,
): Promise<SmokeResult> {
  const args = parseArgs(argv);
  if (args.help) {
    deps.log(HELP);
    return { kind: "help" };
  }

  // The backend's config needs a demo code in meshy mode; irrelevant here.
  const config = loadConfig({ ...env, PROVIDER: "meshy", DEMO_CODE: env.DEMO_CODE ?? "smoke-test" });
  const meshy = config.meshy;
  if (!meshy.apiKey) {
    throw new Error("MESHY_API_KEY is not set. Put it in the environment or in a .env file (never in a chat).");
  }

  // 1. FREE: does the key work, and what can it spend?
  const before = await getBalance(deps.fetchImpl, meshy.baseUrl, meshy.apiKey);
  const resets = before.resetsAt ? `, monthly credits refresh ${new Date(before.resetsAt).toISOString().slice(0, 10)}` : "";
  deps.log(
    `Key works. Credits you can spend: ${before.balance} (monthly ${before.monthly}, permanent ${before.permanent}${resets}).`,
  );
  if (!args.image) return { kind: "balance", balance: before };

  // 2. Validate the photo with the SAME checks the backend applies.
  const bytes = await deps.readFileImpl(args.image);
  const request = parseGenerateBody(
    {
      image: `data:${sniffMime(bytes)};base64,${bytes.toString("base64")}`,
      material: args.material ?? undefined,
      style: args.style || undefined,
    },
    config.maxImageBytes,
  );
  const texturePrompt = buildTexturePrompt(request.material, request.styleText) || null;
  const input = { ...request, texturePrompt };
  const body = buildCreateBody(meshy, input);
  const fields = Object.keys(body);
  const expected = expectedCredits(meshy.model);

  deps.log(`Model: ${meshy.model} | PBR maps: ${meshy.enablePbr} | texture prompt: ${texturePrompt ?? "(none)"}`);
  deps.log(`Fields that would be sent: ${fields.join(", ")} (photo: ${Math.round(bytes.length / 1024)} KB)`);
  deps.log(`Expected cost: ${expected ?? "unknown"} credits (official pricing, mesh with 2K textures).`);
  if (!args.spend) {
    deps.log("DRY RUN: nothing was sent and nothing was spent. Add --spend to generate for real.");
    return { kind: "dry-run", balance: before, expected, fields };
  }
  if (expected !== null && before.balance < expected) {
    throw new Error(`Not enough credits: this needs about ${expected} and you have ${before.balance}.`);
  }

  // 3. REAL generation.
  deps.log("Spending credits now...");
  const provider = createMeshyProvider(meshy, deps.fetchImpl);
  const startedAt = deps.now();
  const { jobId } = await provider.createJob(input);
  deps.log(`Task created: ${jobId}`);

  let job: JobStatus;
  let lastProgress = -1;
  let transientErrors = 0;
  for (;;) {
    try {
      job = await provider.getJob(jobId);
      transientErrors = 0;
    } catch (err) {
      // a busy/5xx answer while polling is worth a few retries, anything else is not
      const transient = err instanceof ApiError && (err.code === "busy" || err.code === "provider_error");
      if (!transient || ++transientErrors > 3) throw err;
      await deps.sleep(POLL_MS * 2);
      continue;
    }
    if (job.progress !== lastProgress) {
      deps.log(`  ${job.state} ${job.progress}%`);
      lastProgress = job.progress;
    }
    if (job.state === "succeeded" || job.state === "failed") break;
    if (deps.now() - startedAt > GIVE_UP_MS) {
      throw new Error(
        `Not finished after ${GIVE_UP_MS / 60_000} minutes. Task ${jobId} may still complete: check it in the Meshy dashboard.`,
      );
    }
    await deps.sleep(POLL_MS);
  }

  const seconds = Math.round((deps.now() - startedAt) / 1000);
  if (job.state === "failed") {
    const code = job.error?.code ?? "provider_error";
    deps.log(`FAILED after ${seconds}s: ${code}. ${friendlyMessage(code)} (Meshy refunds failed tasks.)`);
    return { kind: "failed", jobId, code, seconds };
  }

  const after = await getBalance(deps.fetchImpl, meshy.baseUrl, meshy.apiKey);
  const spent = before.balance - after.balance;
  deps.log(
    `SUCCEEDED in ${seconds}s. Meshy says it charged ${job.creditsUsed ?? "(not reported)"} credits ` +
      `(expected ${expected ?? "?"}); your balance went ${before.balance} -> ${after.balance} (spent ${spent}).`,
  );

  // Download right away: the links stop working after about 3 days.
  const res = await deps.fetchImpl(job.modelUrl ?? "");
  if (!res.ok) throw new Error(`Could not download the model (HTTP ${res.status}). The link was: ${job.modelUrl}`);
  const glb = new Uint8Array(await res.arrayBuffer());
  const validGlb = glb.length > 12 && String.fromCharCode(glb[0] ?? 0, glb[1] ?? 0, glb[2] ?? 0, glb[3] ?? 0) === "glTF";
  await deps.mkdirImpl(args.out);
  const file = join(args.out, `${jobId}.glb`);
  await deps.writeFileImpl(file, glb);
  deps.log(`Saved ${file} (${Math.round(glb.length / 1024)} KB, valid GLB header: ${validGlb}).`);
  if (job.thumbnailUrl) deps.log(`Preview image (expires in about 3 days): ${job.thumbnailUrl}`);
  return { kind: "succeeded", jobId, seconds, creditsUsed: job.creditsUsed, spent, file, validGlb };
}

if (require.main === module) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file: the environment alone is used
  }
  runSmoke(process.argv.slice(2), process.env).catch((err: unknown) => {
    const text = err instanceof ApiError ? `${err.code} (${err.message})` : err instanceof Error ? err.message : String(err);
    console.error(`\nERROR: ${text}`);
    process.exitCode = 1;
  });
}
