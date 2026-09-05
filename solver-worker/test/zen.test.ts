import { afterEach, describe, expect, it, vi } from "vitest";
import { extractJavaCode, modelChain, solveWithZen, validateSolution } from "../src/zen";
import { sampleRequest, validSolution } from "./fixtures";

describe("Zen response handling", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("extracts a fenced Java program", () => {
    expect(extractJavaCode(`Here you go:\n\`\`\`java\n${validSolution}\n\`\`\``)).toBe(validSolution);
  });

  it("extracts a raw Java program from surrounding prose", () => {
    expect(extractJavaCode(`Solution:\n${validSolution}\nDone.`)).toBe(validSolution);
  });

  it("accepts a valid solution", () => {
    expect(validateSolution(validSolution, sampleRequest)).toEqual([]);
  });

  it("rejects a changed public class and missing mandatory code", () => {
    const invalid = "public class Main { public static void main(String[] args) {} }";
    expect(validateSolution(invalid, sampleRequest)).toEqual(
      expect.arrayContaining([
        "public class must be ClassRA2682241010202",
        expect.stringContaining("missing mandatory fragment")
      ])
    );
  });

  it("ignores unsupported configured models", () => {
    expect(modelChain("paid-model,big-pickle,big-pickle,mimo-v2.5-free")).toEqual([
      "big-pickle",
      "mimo-v2.5-free"
    ]);
  });

  it("uses the latest free-model order by default", () => {
    expect(modelChain()).toEqual([
      "muse-spark-1.3-contributor-free",
      "ling-3.0-flash-fin-free",
      "nemotron-3.5-lightning-free",
      "muse-spark-1.2-contributor-free",
      "nemotron-3-ultra-free",
      "mimo-v2.5-free",
      "big-pickle"
    ]);
  });

  it("normalizes a successful chat-completions response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: `\`\`\`java\n${validSolution}\n\`\`\`` } }],
        usage: { prompt_tokens: 120, completion_tokens: 80 }
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await solveWithZen(sampleRequest, {
      OPENCODE_API_KEY: "test-key",
      ZEN_MODELS: "big-pickle"
    });

    expect(result).toMatchObject({ ok: true, code: validSolution, model: "big-pickle", tried: ["big-pickle"] });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://opencode.ai/zen/v1/chat/completions",
      expect.objectContaining({ method: "POST" })
    );
    const chatBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(chatBody.reasoning_effort).toBe("high");
  });

  it("normalizes a successful Responses API result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        output: [{ content: [{ type: "output_text", text: `\`\`\`java\n${validSolution}\n\`\`\`` }] }]
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await solveWithZen(sampleRequest, {
      OPENCODE_API_KEY: "test-key",
      ZEN_MODELS: "muse-spark-1.3-contributor-free"
    });
    expect(result.model).toBe("muse-spark-1.3-contributor-free");
    expect(result.code).toBe(validSolution);
    const responsesBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(responsesBody.reasoning).toEqual({ effort: "high" });
  });
});
