import { buildUserPrompt, extractPublicClassName, mandatoryFragments, stripJavaComments, SYSTEM_PROMPT } from "./prompts";
import type { SolveRequest, SolveSuccess } from "./schema";

type ApiKind = "chat" | "responses";
type ReasoningEffort = "high" | "xhigh";

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
// Muse Spark is the only current free model in this chain with a verified
// xhigh effort level. The other free models either expose high or only a
// reasoning toggle, so high is the safest highest-effort request for them.
const MUSE_MODELS = new Set([
  "muse-spark-1.3-contributor-free",
  "muse-spark-1.2-contributor-free"
]);
const MAX_OUTPUT_TOKENS = 32_000;
// High-reasoning free models can need more than 24 seconds on a long problem.
// An attempt may use up to 45 seconds, while solveWithZen caps the whole chain
// below the extension's 60-second request timeout.
const ATTEMPT_TIMEOUT_MS = 45_000;
const TOTAL_TIMEOUT_MS = 58_000;

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

class ZenResponseError extends Error {
  constructor(readonly category: string, message: string) {
    super(message);
    this.name = "ZenResponseError";
  }
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function reasoningEffortForModel(model: string): ReasoningEffort {
  return MUSE_MODELS.has(model) ? "xhigh" : "high";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsMandatoryFragment(code: string, fragment: string): boolean {
  if (code.includes(fragment)) return true;

  // eLab sometimes removes spaces from Java snippets and truncates a for-loop
  // increment (for example, `for(int i=0;i<n;i)`). Compare compact forms and
  // accept the normal ++/-- increment before the closing parenthesis.
  const compactCode = code.replace(/\s+/g, "");
  const compactFragment = fragment.replace(/\s+/g, "");
  if (compactCode.includes(compactFragment)) return true;
  if (compactFragment.startsWith("for(") && compactFragment.endsWith(")")) {
    const loopPrefix = compactFragment.slice(0, -1);
    return new RegExp(`${escapeRegExp(loopPrefix)}(?:\\+\\+|--|\\+=1|=\\w+\\+1)?\\)`).test(compactCode);
  }
  return false;
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
    if (!containsMandatoryFragment(cleanCode, fragment)) errors.push(`missing mandatory fragment: ${fragment.slice(0, 120)}`);
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

function usageFromBody(body: Record<string, any> | null): ModelResult["usage"] {
  if (!body || !isRecord(body.usage)) return undefined;
  return {
    input: asNumber(body.usage.prompt_tokens ?? body.usage.input_tokens),
    output: asNumber(body.usage.completion_tokens ?? body.usage.output_tokens)
  };
}

function appendText(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (isRecord(value) && typeof value.text === "string") {
    output.push(value.text);
    return;
  }
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (isRecord(item) && typeof item.text === "string") output.push(item.text);
  }
}

function parseSseEvents(raw: string): Record<string, any>[] {
  const events: Record<string, any>[] = [];
  let dataLines: string[] = [];

  const flush = () => {
    if (!dataLines.length) return;
    const data = dataLines.join("\n").trim();
    dataLines = [];
    if (!data || data === "[DONE]") return;
    try {
      const parsed: unknown = JSON.parse(data);
      if (isRecord(parsed)) events.push(parsed);
    } catch {
      // Ignore comments/heartbeats and malformed provider events. A missing
      // text result is handled by callModel as a failed attempt.
    }
  };

  for (const line of raw.split(/\r?\n/)) {
    if (line === "") {
      flush();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  flush();
  return events;
}

function parseChatStream(raw: string): ModelResult {
  const text: string[] = [];
  let usage: ModelResult["usage"];
  const eventShapes: string[] = [];

  for (const event of parseSseEvents(raw)) {
    eventShapes.push(typeof event.type === "string" ? event.type : Object.keys(event).slice(0, 6).join(","));
    const choice = Array.isArray(event.choices) && isRecord(event.choices[0]) ? event.choices[0] : undefined;
    if (choice) {
      const delta = isRecord(choice.delta) ? choice.delta : undefined;
      const deltaContent = delta?.content;
      appendText(deltaContent, text);
      // A few OpenAI-compatible gateways emit a complete message in the last
      // event instead of a delta. Do not expose reasoning_content as answer text.
      if (deltaContent === undefined || deltaContent === null) {
        appendText(isRecord(choice.message) ? choice.message.content : undefined, text);
      }
      appendText(choice.text, text);
    }
    const eventUsage = usageFromBody(event);
    if (eventUsage) usage = eventUsage;
  }

  const result = { text: text.join(""), usage };
  if (!result.text.trim() && eventShapes.length) {
    throw new ZenResponseError("stream_no_text", `Chat stream events: ${eventShapes.slice(0, 8).join("|")}`);
  }
  return result;
}

function parseResponsesStream(raw: string): ModelResult {
  const text: string[] = [];
  let usage: ModelResult["usage"];
  const eventShapes: string[] = [];

  for (const event of parseSseEvents(raw)) {
    eventShapes.push(typeof event.type === "string" ? event.type : Object.keys(event).slice(0, 6).join(","));
    if (event.type === "error") {
      const message = isRecord(event.error) && typeof event.error.message === "string"
        ? event.error.message
        : "Zen returned a Responses stream error";
      throw new Error(message);
    }

    if (event.type === "response.output_text.delta") appendText(event.delta, text);
    if (event.type === "response.output_text.done" && !text.length) appendText(event.text, text);

    if (event.type === "response.completed" || event.type === "response.incomplete") {
      const response = isRecord(event.response) ? event.response : undefined;
      const responseUsage = usageFromBody(response ?? null);
      if (responseUsage) usage = responseUsage;
      if (!text.length && response) appendText(responsesText(response), text);
    }

    if (event.type === "response.output_item.done" && !text.length && isRecord(event.item)) {
      const item = event.item;
      if (Array.isArray(item.content)) {
        for (const content of item.content) {
          if (isRecord(content)) appendText(content.text, text);
        }
      }
    }
  }

  const result = { text: text.join(""), usage };
  if (!result.text.trim() && eventShapes.length) {
    throw new ZenResponseError("stream_no_text", `Responses stream events: ${eventShapes.slice(0, 8).join("|")}`);
  }
  return result;
}

async function parseModelResponse(response: Response, kind: ApiKind): Promise<ModelResult> {
  // Preserve AbortError/network failures from the body reader. Swallowing a
  // read abort turns a real timeout into a misleading "empty stream" result.
  const raw = await response.text();
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  const looksLikeSse = contentType.includes("text/event-stream") || raw.trimStart().startsWith("data:");

  if (!response.ok) {
    let body: Record<string, any> | null = null;
    try {
      const parsed: unknown = JSON.parse(raw);
      body = isRecord(parsed) ? parsed : null;
    } catch {
      // Keep the status-only error when the provider did not return JSON.
    }
    const message = typeof body?.error?.message === "string" ? body.error.message : `Zen returned HTTP ${response.status}`;
    throw new ZenRequestError(response.status, message);
  }

  if (looksLikeSse) {
    const result = kind === "chat" ? parseChatStream(raw) : parseResponsesStream(raw);
    if (!result.text.trim()) {
      const prefix = raw.trimStart().slice(0, 32).replace(/[^a-zA-Z0-9:_.,[\]{}-]/g, "_");
      throw new ZenResponseError("stream_no_text", `Zen stream contained no answer text_${raw.length}bytes_${prefix}`);
    }
    return result;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Zen returned invalid JSON");
  }
  if (!isRecord(parsed)) throw new Error("Zen returned invalid JSON");

  const text = kind === "chat" ? parsed.choices?.[0]?.message?.content : responsesText(parsed);
  if (typeof text !== "string" || !text.trim()) throw new ZenResponseError("response_no_text", "Zen response contained no answer text");
  return { text, usage: usageFromBody(parsed) };
}

async function callModel(
  model: string,
  kind: ApiKind,
  prompt: string,
  apiKey: string,
  timeoutMs = ATTEMPT_TIMEOUT_MS
): Promise<ModelResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const effort = reasoningEffortForModel(model);

  try {
    const endpoint = kind === "chat" ? `${ZEN_BASE_URL}/chat/completions` : `${ZEN_BASE_URL}/responses`;
    const requestBody = kind === "chat"
      ? {
          model,
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: MAX_OUTPUT_TOKENS,
          reasoning_effort: effort,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt }
          ]
        }
      : {
          model,
          input: [
            { role: "developer", content: SYSTEM_PROMPT },
            { role: "user", content: [{ type: "input_text", text: prompt }] }
          ],
          stream: true,
          store: false,
          max_output_tokens: MAX_OUTPUT_TOKENS,
          reasoning: { effort, summary: "auto" },
          include: ["reasoning.encrypted_content"]
        };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "eLab-Solver/1.0"
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    return await parseModelResponse(response, kind);
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
  const apiKey = env.OPENCODE_API_KEY.trim();

  for (const model of chain) {
    if (Date.now() >= deadline) break;
    tried.push(model);
    try {
      const remainingMs = Math.max(1, deadline - Date.now());
      const result = await callModel(
        model,
        VERIFIED_FREE_MODELS[model],
        prompt,
        apiKey,
        Math.min(ATTEMPT_TIMEOUT_MS, remainingMs)
      );
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
      } else if (error instanceof ZenResponseError) {
        const detail = error.message.replace(/[^a-zA-Z0-9_|,.-]/g, "_").slice(0, 180);
        failures.push(`${model}: ${error.category}${detail ? `_${detail}` : ""}`);
      } else if (error instanceof Error && error.name === "AbortError") {
        failures.push(`${model}: timeout`);
      } else {
        failures.push(`${model}: adapter_error`);
      }
    }
  }

  throw new Error(`All models failed (${failures.join(" | ") || "time limit reached"})`);
}
