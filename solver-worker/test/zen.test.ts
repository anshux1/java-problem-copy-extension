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

  it("accepts formatted Java loops when eLab truncates the increment in a requirement", () => {
    const input = {
      ...sampleRequest,
      mandatory: [
        { title: "Loop", fields: [{ label: "KEYWORD", value: "for(int i=0;i<n;i)" }] },
        { title: "Sort", fields: [{ label: "KEYWORD", value: "sort" }] }
      ]
    };
    const code = `public class ClassRA2682241010202 {
      public static void main(String[] args) {
        int[] values = {3, 1}; int n = values.length;
        for (int i = 0; i < n; i++) { }
        Arrays.sort(values);
      }
    }`;
    expect(validateSolution(code, input)).toEqual([]);
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
    expect(chatBody.stream).toBe(true);
    expect(chatBody.stream_options).toEqual({ include_usage: true });
    expect(chatBody.max_tokens).toBe(32000);
    expect(chatBody.temperature).toBeUndefined();
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
    expect(responsesBody.reasoning).toEqual({ effort: "xhigh", summary: "auto" });
    expect(responsesBody.include).toEqual(["reasoning.encrypted_content"]);
    expect(responsesBody.stream).toBe(true);
    expect(responsesBody.store).toBe(false);
    expect(responsesBody.max_output_tokens).toBe(32000);
    expect(responsesBody.instructions).toBeUndefined();
    expect(responsesBody.input).toEqual([
      { role: "developer", content: expect.any(String) },
      { role: "user", content: [{ type: "input_text", text: expect.any(String) }] }
    ]);
  });

  it("parses streamed chat-completions deltas and usage", async () => {
    const splitAt = validSolution.indexOf("public class");
    const events = [
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "hidden" } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: validSolution.slice(0, splitAt) } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: validSolution.slice(splitAt) } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, message: { content: "" } }] })}`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 34 } })}`,
      "data: [DONE]"
    ].join("\n\n") + "\n\n";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(events, { status: 200, headers: { "Content-Type": "text/event-stream" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await solveWithZen(sampleRequest, {
      OPENCODE_API_KEY: "test-key",
      ZEN_MODELS: "big-pickle"
    });

    expect(result.code).toContain("public class ClassRA2682241010202");
    expect(result.usage).toEqual({ input: 12, output: 34 });
  });

  it("parses streamed Responses output deltas and terminal usage", async () => {
    const splitAt = validSolution.indexOf("public class");
    const events = [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: validSolution.slice(0, splitAt) })}`,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: validSolution.slice(splitAt) })}`,
      `data: ${JSON.stringify({
        type: "response.completed",
        response: { output: [], usage: { input_tokens: 22, output_tokens: 44 }
      }})}`,
      "data: [DONE]"
    ].join("\n\n") + "\n\n";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(events, { status: 200, headers: { "Content-Type": "text/event-stream" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await solveWithZen(sampleRequest, {
      OPENCODE_API_KEY: "test-key",
      ZEN_MODELS: "muse-spark-1.3-contributor-free"
    });

    expect(result.code).toContain("public class ClassRA2682241010202");
    expect(result.usage).toEqual({ input: 22, output: 44 });
  });
});
