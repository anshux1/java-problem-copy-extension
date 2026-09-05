import { Hono } from "hono";
import { cors } from "hono/cors";
import { solveRequestSchema, type SolveSuccess } from "./schema";
import { solveWithZen, VERIFIED_FREE_MODELS, type ZenEnv } from "./zen";

type Bindings = ZenEnv & {
  ALLOWED_ORIGIN?: string;
};

type CachedSolution = { expiresAt: number; value: SolveSuccess };
const cache = new Map<string, CachedSolution>();
const rateLimits = new Map<string, { resetAt: number; count: number }>();
const MAX_BODY_BYTES = 50 * 1024;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const CACHE_TTL_MS = 60 * 60 * 1000;

export const app = new Hono<{ Bindings: Bindings }>();

app.use("*", async (context, next) => {
  const allowedOrigin = context.env.ALLOWED_ORIGIN || "*";
  return cors({
    origin: allowedOrigin,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400
  })(context, next);
});

app.get("/health", (context) => context.json({ ok: true }));

app.get("/models", async (context) => {
  const configured = (context.env.ZEN_MODELS || "").split(",").map((value) => value.trim()).filter(Boolean);
  const models = (configured.length ? configured : Object.keys(VERIFIED_FREE_MODELS))
    .filter((model) => model in VERIFIED_FREE_MODELS)
    .map((id) => ({ id, api: VERIFIED_FREE_MODELS[id] }));
  return context.json({ ok: true, models });
});

function checkRateLimit(key: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }
  if (current.count >= RATE_LIMIT) {
    return { allowed: false, retryAfter: Math.ceil((current.resetAt - now) / 1000) };
  }
  current.count += 1;
  return { allowed: true, retryAfter: 0 };
}

async function hashPayload(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

app.post("/solve", async (context) => {
  const contentLength = Number(context.req.header("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return context.json({ ok: false, error: "Payload exceeds 50 KB." }, 413);
  }

  const rawBody = await context.req.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return context.json({ ok: false, error: "Payload exceeds 50 KB." }, 413);
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch (_) {
    return context.json({ ok: false, error: "Request body must be valid JSON." }, 400);
  }

  const parsed = solveRequestSchema.safeParse(json);
  if (!parsed.success) {
    return context.json({
      ok: false,
      error: "Invalid solve request.",
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
    }, 400);
  }

  const clientKey = context.req.header("cf-connecting-ip") || "unknown";
  const limit = checkRateLimit(clientKey);
  if (!limit.allowed) {
    context.header("Retry-After", String(limit.retryAfter));
    return context.json({ ok: false, error: "Rate limit exceeded. Try again later." }, 429);
  }

  const cacheKey = await hashPayload(parsed.data);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return context.json({ ...cached.value, cached: true });
  }

  try {
    const result = await solveWithZen(parsed.data, context.env);
    cache.set(cacheKey, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return context.json(result);
  } catch (error) {
    console.error("solve_failed", { type: error instanceof Error ? error.name : "UnknownError" });
    return context.json({ ok: false, error: "All configured solver models failed." }, 502);
  }
});

export default app;
