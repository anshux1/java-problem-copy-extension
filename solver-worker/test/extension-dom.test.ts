import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { validSolution } from "./fixtures";

const root = resolve(import.meta.dirname, "../..");
const layoutHtml = readFileSync(resolve(root, "layout.html"), "utf8");
const contentScript = readFileSync(resolve(root, "problem-copier-extension/content.js"), "utf8");
const bridgeScript = readFileSync(resolve(root, "problem-copier-extension/page-bridge.js"), "utf8");

function createPage(solveResponse: unknown = { ok: false, error: "test stop" }) {
  const dom = new JSDOM(layoutHtml, {
    url: "https://elab.example.test/problem/1",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  Object.assign(window, { TextEncoder, TextDecoder });

  let editorCode = "public class ClassRA2682241010202 {}";
  Object.defineProperty(window, "ace", {
    configurable: true,
    value: {
      edit: () => ({
        session: {
          getValue: () => editorCode,
          setValue: (code: string) => { editorCode = code; }
        },
        navigateFileStart: vi.fn(),
        clearSelection: vi.fn(),
        focus: vi.fn()
      })
    }
  });

  let messageListener: ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean) | undefined;
  const addListener = vi.fn((listener) => { messageListener = listener; });
  Object.defineProperty(window, "chrome", {
    configurable: true,
    value: {
      runtime: {
        onMessage: { addListener },
        sendMessage: vi.fn().mockResolvedValue(solveResponse)
      }
    }
  });

  window.eval(bridgeScript);
  window.eval(contentScript);
  return { dom, window, getEditorCode: () => editorCode, getMessageListener: () => messageListener };
}

describe("extension editor action", () => {
  it("injects one native-looking fifth action in the intended order", () => {
    const { dom, window } = createPage();
    const actions = window.document.querySelector("#editor > .ant-card-actions")!;
    const labels = [...actions.children].map((item) => item.textContent?.replace(/\s+/g, " ").trim());
    expect(labels).toEqual(["Save", "Reset", "✨ Solve It", "Run", "Evaluate"]);
    expect([...actions.children].every((item) => (item as HTMLElement).style.width === "20%")).toBe(true);
    expect(actions.querySelectorAll("#elab-solve-action")).toHaveLength(1);
    expect(actions.querySelector("#elab-solve-button")?.className).toContain("editorBtn");
    dom.window.close();
  });

  it("injects a returned solution through the Ace bridge", async () => {
    const { dom, window, getEditorCode } = createPage({ ok: true, code: validSolution, model: "big-pickle" });
    const button = window.document.getElementById("elab-solve-button") as HTMLButtonElement;
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getEditorCode()).toBe(validSolution);
    expect(button.textContent).toContain("Solved!");
    expect(window.document.getElementById("problem-copier-toast")?.textContent).toContain("big-pickle");
    dom.window.close();
  });

  it("re-injects exactly once after the action is removed by a rerender", async () => {
    const { dom, window } = createPage();
    const actions = window.document.querySelector("#editor > .ant-card-actions")!;
    actions.querySelector("#elab-solve-action")?.remove();
    for (const action of actions.children) (action as HTMLElement).style.width = "25%";

    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(actions.querySelectorAll("#elab-solve-action")).toHaveLength(1);
    expect([...actions.children].every((item) => (item as HTMLElement).style.width === "20%")).toBe(true);
    dom.window.close();
  });

  it("keeps the existing structured Markdown copy message working", async () => {
    const { dom, getMessageListener } = createPage();
    const listener = getMessageListener();
    expect(listener).toBeTypeOf("function");
    const response = await new Promise<any>((resolve) => {
      expect(listener?.({ type: "COPY_STRUCTURED_PROBLEM" }, {}, resolve)).toBe(true);
    });
    expect(response.ok).toBe(true);
    expect(response.text).toContain("# Programming Problem");
    expect(response.text).toContain("## Mandatory Test Cases");
    expect(response.text).toContain("Scanner input = new Scanner(System.in);");
    dom.window.close();
  });
});
