import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { sampleRequest } from "./fixtures";

const env = {
  OPENCODE_API_KEY: "test-key",
  ALLOWED_ORIGIN: "*",
  ZEN_MODELS: "big-pickle"
};

describe("Worker API", () => {
  it("reports health", async () => {
    const response = await app.request("/health", {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("reports configured verified models", async () => {
    const response = await app.request("/models", {}, env);
    expect(await response.json()).toEqual({ ok: true, models: [{ id: "big-pickle", api: "chat" }] });
  });

  it("rejects malformed requests before calling Zen", async () => {
    const response = await app.request(
      "/solve",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ problem: "x" }) },
      env
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: "Invalid solve request." });
  });

  it("rejects oversized bodies", async () => {
    const oversized = { ...sampleRequest, problem: "x".repeat(55 * 1024) };
    const response = await app.request(
      "/solve",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(oversized) },
      env
    );
    expect(response.status).toBe(413);
  });
});
