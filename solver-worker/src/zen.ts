import { buildUserPrompt, extractPublicClassName, mandatoryFragments, stripJavaComments, SYSTEM_PROMPT } from "./prompts";
import type { SolveRequest, SolveSuccess } from "./schema";

type ApiKind = "chat" | "responses";

export const VERIFIED_FREE_MODELS: Record<string, ApiKind> = {
  "ling-3.0-flash-fin-free": "chat",
  "nemotron-3.5-lightning-free": "chat",
  "nemotron-3-ultra-free": "chat",
  "mimo-v2.5-free": "chat",
  "big-pickle": "chat",
  "muse-spark-1.3-contributor-free": "responses",
  "muse-spark-1.2-contributor-free": "responses"
};

const DEFAULT_MODELS = [
  "muse-spark-1.3-contributor-free",
  "ling-3.0-flash-fin-free",
  "nemotron-3.5-lightning-free",
  "muse-spark-1.2-contributor-free",
  "nemotron-3-ultra-free",
  "mimo-v2.5-free",
  "big-pickle"
];
const ZEN_BASE_URL = "https://opencode.ai/zen/v1";
const REASONING_EFFORT = "high";
const ATTEMPT_TIMEOUT_MS = 18_000;
const TOTAL_TIMEOUT_MS = 52_000;

export type ZenEnv = {
  OPENCODE_API_KEY: string;
  ZEN_MODELS?: string;
};

type ModelResult = {
  text: string;
  usage?: { input?: number; output?: number };
};

class ZenRequestError extends Error {
  constructor(readonly status: number | null, message: string) {
    super(message);
    this.name = "ZenRequestError";
  }
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function modelChain(configured?: string): string[] {
  const requested = configured
    ? configured.split(",").map((model) => model.trim()).filter(Boolean)
    : DEFAULT_MODELS;
  const unique = [...new Set(requested)];
  const supported = unique.filter((model) => model in VERIFIED_FREE_MODELS);
  return supported.length ? supported : DEFAULT_MODELS;
}

export function extractJavaCode(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:java)?\s*\n([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) return fenced;

  const startMatch = trimmed.match(/\b(?:package\s+[\w.]+\s*;|import\s+[\w.*]+\s*;|public\s+class\s+\w+|class\s+\w+)/);
  const start = startMatch?.index ?? 0;
  const end = trimmed.lastIndexOf("}");
  return (end >= start ? trimmed.slice(start, end + 1) : trimmed).replace(/^java\s*\n/i, "").trim();
}

export function validateSolution(code: string, input: SolveRequest): string[] {
  const errors: string[] = [];
  const cleanCode = stripJavaComments(code);
  const requiredClass = extractPublicClassName(input.starterCode);
  const actualClass = extractPublicClassName(code);

  if (!code.trim() || !/\bclass\s+[A-Za-z_$][\w$]*/.test(cleanCode)) errors.push("missing Java class");
  if (requiredClass && actualClass !== requiredClass) errors.push(`public class must be ${requiredClass}`);
  if (!/\bstatic\s+void\s+main\s*\(/.test(cleanCode)) errors.push("missing main method");

  for (const fragment of mandatoryFragments(input)) {
    if (!cleanCode.includes(fragment)) errors.push(`missing mandatory fragment: ${fragment.slice(0, 120)}`);
  }
  return errors;
}

function responsesText(body: Record<string, unknown>): string {
  if (typeof body.output_text === "string") return body.output_text;
  if (!Array.isArray(body.output)) return "";
  const texts: string[] = [];
  for (const item of body.output) {
    if (!item || typeof item !== "object" || !Array.isArray((item as { content?: unknown }).content)) continue;
    for (const content of (item as { content: unknown[] }).content) {
      if (!content || typeof content !== "object") continue;
      const text = (content as { text?: unknown }).text;
      if (typeof text === "string") texts.push(text);
    }
  }
  return texts.join("\n");
}

async function callModel(model: string, kind: ApiKind, prompt: string, apiKey: string): Promise<ModelResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);

  try {
    const endpoint = kind === "chat" ? `${ZEN_BASE_URL}/chat/completions` : `${ZEN_BASE_URL}/responses`;
    const requestBody = kind === "chat"
      ? {
          model,
          temperature: 0.1,
          max_tokens: 5000,
          reasoning_effort: REASONING_EFFORT,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt }
          ]
        }
      : {
          model,
          instructions: SYSTEM_PROMPT,
          input: prompt,
          max_output_tokens: 5000,
          reasoning: { effort: REASONING_EFFORT }
        };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    const body = (await response.json().catch(() => null)) as Record<string, any> | null;
    if (!response.ok) {
      const message = typeof body?.error?.message === "string" ? body.error.message : `Zen returned HTTP ${response.status}`;
      throw new ZenRequestError(response.status, message);
    }
    if (!body) throw new Error("Zen returned invalid JSON");

    const text = kind === "chat" ? body.choices?.[0]?.message?.content : responsesText(body);
    if (typeof text !== "string" || !text.trim()) throw new Error("Zen returned no text");

    return {
      text,
      usage: {
        input: asNumber(body.usage?.prompt_tokens ?? body.usage?.input_tokens),
        output: asNumber(body.usage?.completion_tokens ?? body.usage?.output_tokens)
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function solveWithZen(input: SolveRequest, env: ZenEnv): Promise<SolveSuccess> {
  if (!env.OPENCODE_API_KEY?.trim()) throw new Error("OPENCODE_API_KEY is not configured");

  const prompt = buildUserPrompt(input);
  const chain = modelChain(env.ZEN_MODELS);
  const tried: string[] = [];
  const failures: string[] = [];
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;

  for (const model of chain) {
    if (Date.now() >= deadline) break;
    tried.push(model);
    try {
      const result = await callModel(model, VERIFIED_FREE_MODELS[model], prompt, env.OPENCODE_API_KEY);
      const code = extractJavaCode(result.text);
      const errors = validateSolution(code, input);
      if (errors.length) {
        failures.push(`${model}: validation_failed`);
        continue;
      }
      return { ok: true, code, model, tried, usage: result.usage };
    } catch (error) {
      if (error instanceof ZenRequestError) {
        failures.push(`${model}: upstream_http_${error.status ?? "unknown"}`);
      } else if (error instanceof Error && error.name === "AbortError") {
        failures.push(`${model}: timeout`);
      } else {
        failures.push(`${model}: adapter_error`);
      }
    }
  }

  throw new Error(`All models failed (${failures.join(" | ") || "time limit reached"})`);
}
