"use strict";

const SOLVER_ENDPOINT = "https://elab-solver.elab-solver-worker.workers.dev/solve";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_PAYLOAD_BYTES = 50 * 1024;
const MAX_RESPONSE_BYTES = 120 * 1024;
const MAX_CODE_LENGTH = 100_000;

const ERROR_MESSAGES = {
  BAD_PAYLOAD: "The problem data is incomplete or too large.",
  NOT_CONFIGURED: "The solver server URL has not been configured in service-worker.js yet.",
  TIMEOUT: "The solver took too long to respond. Try again.",
  RATE_LIMITED: "The solver is temporarily rate-limited. Wait a moment and try again.",
  MODEL_FAILED: "All configured solver models failed. Try again later.",
  BAD_RESPONSE: "The solver returned an invalid response.",
  NETWORK_ERROR: "Could not reach the solver server. Check your connection and Worker URL."
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validatePayload(payload) {
  if (!isPlainObject(payload)) return false;
  const requiredStrings = ["language", "starterCode", "problem", "inputFormat", "outputFormat"];
  if (requiredStrings.some((key) => typeof payload[key] !== "string")) return false;
  if (!payload.starterCode.trim() || !payload.problem.trim()) return false;
  if (!["logical", "mandatory", "complexity"].every((key) => Array.isArray(payload[key]))) return false;
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength <= MAX_PAYLOAD_BYTES;
}

function errorResult(code, detail) {
  return { ok: false, code, error: detail || ERROR_MESSAGES[code] || "The solver request failed." };
}

async function solve(payload) {
  if (!validatePayload(payload)) return errorResult("BAD_PAYLOAD");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(SOLVER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const responseText = await response.text();
    if (new TextEncoder().encode(responseText).byteLength > MAX_RESPONSE_BYTES) {
      return errorResult("BAD_RESPONSE", "The solver response was unexpectedly large.");
    }

    let body;
    try {
      body = JSON.parse(responseText);
    } catch (_) {
      return errorResult("BAD_RESPONSE");
    }

    if (response.status === 429) return errorResult("RATE_LIMITED", body?.error);
    if (!response.ok) {
      const code = response.status >= 500 ? "MODEL_FAILED" : "BAD_RESPONSE";
      return errorResult(code, body?.error);
    }
    if (!body?.ok || typeof body.code !== "string" || !body.code.trim()) {
      return errorResult("BAD_RESPONSE");
    }
    if (body.code.length > MAX_CODE_LENGTH) {
      return errorResult("BAD_RESPONSE", "The generated solution is too large to inject safely.");
    }

    return {
      ok: true,
      code: body.code,
      model: typeof body.model === "string" ? body.model : "unknown model"
    };
  } catch (error) {
    if (error?.name === "AbortError") return errorResult("TIMEOUT");
    return errorResult("NETWORK_ERROR");
  } finally {
    clearTimeout(timeout);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SOLVE_PROBLEM") return false;
  solve(message.payload)
    .then(sendResponse)
    .catch(() => sendResponse(errorResult("NETWORK_ERROR")));
  return true;
});
