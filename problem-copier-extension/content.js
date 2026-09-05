(() => {
  "use strict";

  if (window.__problemStatementCopierLoaded) return;
  window.__problemStatementCopierLoaded = true;

  const COPY_BUTTON_ID = "problem-copier-button";
  const SOLVE_ACTION_ID = "elab-solve-action";
  const SOLVE_BUTTON_ID = "elab-solve-button";
  const TOAST_ID = "problem-copier-toast";
  const EDITOR_REQUEST_EVENT = "elab-solver:editor-request";
  const EDITOR_RESPONSE_EVENT = "elab-solver:editor-response";
  const MAX_PAYLOAD_BYTES = 50 * 1024;
  const MAX_TEST_VALUE_LENGTH = 2000;
  const FINAL_PROMPT =
    "Solve this problem in Java. Your solution must follow the exact input and output formats and satisfy every logical, mandatory, and complexity test case listed above. Include every mandatory keyword or construct exactly as required. Return the complete Java solution.";

  const SOLVE_STATES = {
    idle: { label: "Solve It", disabled: false, busy: false },
    reading: { label: "Reading…", disabled: true, busy: true },
    solving: { label: "Solving…", disabled: true, busy: true },
    injecting: { label: "Injecting…", disabled: true, busy: true },
    success: { label: "Solved!", disabled: true, busy: false },
    failure: { label: "Try Again", disabled: false, busy: false }
  };

  let solveState = "idle";
  let activeSolveToken = null;
  let toastTimer;

  const cleanText = (value) =>
    String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  function elementText(element) {
    if (!element) return "";
    return cleanText(element.innerText || element.textContent || "");
  }

  function normalized(value) {
    return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function makeRequestId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function findDescriptionRow(label) {
    const wanted = normalized(label);
    for (const row of document.querySelectorAll("tr")) {
      const heading = row.querySelector(":scope > th");
      if (heading && normalized(elementText(heading)) === wanted) return row;
    }
    return null;
  }

  function getPageParts() {
    const problemRow = findDescriptionRow("Problem");
    const testRow = findDescriptionRow("Test Cases");
    return {
      problemCell: problemRow?.querySelector(":scope > td") || null,
      testCell: testRow?.querySelector(":scope > td") || null
    };
  }

  function isProblemPage() {
    const { problemCell, testCell } = getPageParts();
    return Boolean(problemCell && testCell);
  }

  function getPageIdentity() {
    const { problemCell } = getPageParts();
    return `${location.href}\n${elementText(problemCell)}`;
  }

  function splitProblemStatement(rawText) {
    const text = cleanText(rawText);
    const result = {
      problem: "",
      functional: "",
      constraints: "",
      inputFormat: "",
      outputFormat: ""
    };

    const headingPattern =
      /\b(Problem\s+Description|Functional\s+Description|Constraints?|Input\s+Format|Output\s+Format)\s*:?\s*/gi;
    const matches = [...text.matchAll(headingPattern)];

    if (!matches.length) {
      result.problem = text;
      return result;
    }

    if (matches[0].index > 0) result.problem = cleanText(text.slice(0, matches[0].index));

    const keyForHeading = (heading) => {
      const value = normalized(heading);
      if (value.startsWith("problem")) return "problem";
      if (value.startsWith("functional")) return "functional";
      if (value.startsWith("constraint")) return "constraints";
      if (value.startsWith("input")) return "inputFormat";
      return "outputFormat";
    };

    matches.forEach((match, index) => {
      const start = match.index + match[0].length;
      const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
      const key = keyForHeading(match[1]);
      const value = cleanText(text.slice(start, end));
      result[key] = cleanText([result[key], value].filter(Boolean).join("\n\n"));
    });

    return result;
  }

  const TEST_GROUPS = [
    { key: "logical", title: "Logical Test Cases", matcher: /logical test cases?/i },
    { key: "mandatory", title: "Mandatory Test Cases", matcher: /mandatory test cases?/i },
    { key: "complexity", title: "Complexity Test Cases", matcher: /complexity test cases?/i }
  ];

  function findTestGroup(testCell, matcher) {
    if (!testCell) return null;
    for (const item of testCell.querySelectorAll(".ant-collapse-item")) {
      const heading = item.querySelector(".ant-collapse-header-text");
      if (heading && matcher.test(elementText(heading))) return item;
    }
    return null;
  }

  async function ensureTestGroupsAvailable(testCell) {
    let expandedSomething = false;
    for (const group of TEST_GROUPS) {
      const item = findTestGroup(testCell, group.matcher);
      if (!item || item.querySelector(".ant-card")) continue;
      const header = item.querySelector(".ant-collapse-header");
      if (header && header.getAttribute("aria-expanded") === "false") {
        header.click();
        expandedSomething = true;
      }
    }

    if (!expandedSomething) return;
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const allAvailable = TEST_GROUPS.every((group) => {
        const item = findTestGroup(testCell, group.matcher);
        return !item || Boolean(item.querySelector(".ant-card"));
      });
      if (allAvailable) return;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
  }

  function preformattedText(element) {
    return String(element?.innerText || element?.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r\n?/g, "\n")
      .trim();
  }

  function getDirectCardBody(card) {
    for (const child of card.children) {
      if (child.classList?.contains("ant-card-body")) return child;
    }
    return card.querySelector(".ant-card-body");
  }

  function extractTestCards(groupElement) {
    if (!groupElement) return [];
    const cards = [];
    for (const card of groupElement.querySelectorAll(".ant-card")) {
      if (card.closest(".ant-collapse-item") !== groupElement) continue;
      const body = getDirectCardBody(card);
      if (!body) continue;

      const title = elementText(card.querySelector(".ant-card-head-title")) || `Test Case ${cards.length + 1}`;
      const fields = [];
      for (const labelElement of body.querySelectorAll(".overlineFit")) {
        const label = elementText(labelElement);
        const valueElement = labelElement.nextElementSibling;
        const pre = valueElement?.querySelector("pre");
        const value = pre ? preformattedText(pre) : elementText(valueElement);
        if (label || value) fields.push({ label: label || "Value", value });
      }

      if (!fields.length) {
        const value = elementText(body);
        if (value) fields.push({ label: "Details", value });
      }
      cards.push({ title, fields });
    }
    return cards;
  }

  async function collectProblemData() {
    const { problemCell, testCell } = getPageParts();
    if (!problemCell || !testCell) throw new Error("No supported problem statement was found on this page.");

    await ensureTestGroupsAvailable(testCell);
    const data = {
      ...splitProblemStatement(elementText(problemCell)),
      logical: [],
      mandatory: [],
      complexity: [],
      missingGroups: []
    };

    for (const group of TEST_GROUPS) {
      const groupElement = findTestGroup(testCell, group.matcher);
      const cards = extractTestCards(groupElement);
      data[group.key] = cards;
      if (!groupElement || !cards.length) data.missingGroups.push(group.title);
    }
    return data;
  }

  function fence(value, language = "text") {
    const safeValue = String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r\n?/g, "\n")
      .trim() || "Not provided";
    const marker = safeValue.includes("```") ? "````" : "```";
    return `${marker}${language}\n${safeValue}\n${marker}`;
  }

  function renderTestGroup(group, cards) {
    const lines = [`## ${group.title}`];
    if (!cards.length) {
      lines.push("Not provided on the page.");
      return lines.join("\n\n");
    }

    if (group.key === "complexity") {
      for (const card of cards) {
        lines.push(`### ${card.title}`);
        for (const field of card.fields) {
          lines.push(`- **${field.label}:** ${cleanText(field.value) || "Not provided"}`);
        }
      }
      return lines.join("\n\n");
    }

    for (const card of cards) {
      lines.push(`### ${card.title}`);
      for (const field of card.fields) {
        const language = group.key === "mandatory" ? "java" : "text";
        lines.push(`**${field.label}**\n\n${fence(field.value, language)}`);
      }
    }
    return lines.join("\n\n");
  }

  function renderProblemMarkdown(data) {
    const sections = [
      "# Programming Problem",
      `## Problem Description\n\n${data.problem || "Not provided on the page."}`
    ];
    if (data.functional) sections.push(`## Functional Description\n\n${data.functional}`);
    if (data.constraints) sections.push(`## Constraints\n\n${data.constraints}`);
    sections.push(`## Input Format\n\n${data.inputFormat || "Not provided on the page."}`);
    sections.push(`## Output Format\n\n${data.outputFormat || "Not provided on the page."}`);
    for (const group of TEST_GROUPS) sections.push(renderTestGroup(group, data[group.key] || []));

    if (data.missingGroups?.length) {
      sections.push(
        `> **Extraction warning:** The following requested section(s) were not found or had no visible test cards: ${data.missingGroups.join(", ")}.`
      );
    }
    sections.push(`## Solver Instructions\n\n${FINAL_PROMPT}`);
    return sections.join("\n\n").trim() + "\n";
  }

  async function buildStructuredProblem() {
    return renderProblemMarkdown(await collectProblemData());
  }

  function requestEditor(operation, code) {
    return new Promise((resolve, reject) => {
      const requestId = makeRequestId();
      const timeout = setTimeout(() => {
        document.removeEventListener(EDITOR_RESPONSE_EVENT, onResponse);
        reject(new Error("The code editor did not respond. Reload the page and try again."));
      }, 3000);

      function onResponse(event) {
        let detail;
        try {
          detail = JSON.parse(String(event.detail || ""));
        } catch (_) {
          return;
        }
        if (detail.requestId !== requestId) return;
        clearTimeout(timeout);
        document.removeEventListener(EDITOR_RESPONSE_EVENT, onResponse);
        if (!detail.ok) {
          reject(new Error(detail.error || "The code editor operation failed."));
          return;
        }
        resolve(detail.code || "");
      }

      document.addEventListener(EDITOR_RESPONSE_EVENT, onResponse);
      document.dispatchEvent(
        new CustomEvent(EDITOR_REQUEST_EVENT, {
          detail: JSON.stringify({ requestId, operation, ...(operation === "write" ? { code } : {}) })
        })
      );
    });
  }

  function getLanguage() {
    const editor = document.getElementById("editor");
    return elementText(editor?.querySelector(":scope > .ant-card-head .monoFont")) || "Java";
  }

  function truncateTestCards(cards) {
    return cards.map((card) => ({
      title: card.title,
      fields: card.fields.map((field) => {
        const value = String(field.value || "");
        if (value.length <= MAX_TEST_VALUE_LENGTH) return { ...field, value };
        return { ...field, value: `${value.slice(0, MAX_TEST_VALUE_LENGTH)}\n[truncated by extension]` };
      })
    }));
  }

  async function collectSolvePayload() {
    const [data, starterCode] = await Promise.all([collectProblemData(), requestEditor("read")]);
    if (!starterCode.trim()) throw new Error("The code editor is empty or not ready yet.");

    const payload = {
      language: getLanguage(),
      starterCode,
      problem: data.problem,
      functional: data.functional,
      constraints: data.constraints,
      inputFormat: data.inputFormat,
      outputFormat: data.outputFormat,
      logical: truncateTestCards(data.logical),
      mandatory: data.mandatory,
      complexity: truncateTestCards(data.complexity)
    };

    const size = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    if (size > MAX_PAYLOAD_BYTES) {
      throw new Error("This problem is too large to send safely. Copy it instead and solve it manually.");
    }
    return payload;
  }

  async function writeClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (_) {
      // Older sites and some HTTP pages block the modern Clipboard API.
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none;";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("The browser blocked clipboard access.");
  }

  function showToast(message, isError = false) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.documentElement.appendChild(toast);
    }

    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.toggle("problem-copier-toast-error", isError);
    toast.classList.add("problem-copier-toast-visible");
    toastTimer = setTimeout(() => toast.classList.remove("problem-copier-toast-visible"), 3600);
  }

  async function copyProblem(showPageToast = true) {
    const text = await buildStructuredProblem();
    await writeClipboard(text);
    if (showPageToast) showToast("Problem and test cases copied as Markdown.");
    return text;
  }

  function createCopyButton() {
    if (document.getElementById(COPY_BUTTON_ID)) return;
    const button = document.createElement("button");
    button.id = COPY_BUTTON_ID;
    button.type = "button";
    button.title = "Copy the full problem and all test cases as structured Markdown";
    button.setAttribute("aria-label", "Copy problem and test cases");
    button.innerHTML =
      '<svg class="problem-copier-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"/></svg><span>Copy problem</span>';

    button.addEventListener("click", async () => {
      if (button.disabled) return;
      button.disabled = true;
      const label = button.querySelector("span");
      const previousLabel = label.textContent;
      label.textContent = "Copying…";
      try {
        await copyProblem(true);
        label.textContent = "Copied!";
      } catch (error) {
        console.error("Problem Statement Copier:", error);
        showToast(error.message || "Could not copy this problem.", true);
        label.textContent = "Copy failed";
      } finally {
        setTimeout(() => {
          label.textContent = previousLabel;
          button.disabled = false;
        }, 1200);
      }
    });
    document.documentElement.appendChild(button);
  }

  function findEditorActions() {
    const direct = document.querySelector("#editor > .ant-card-actions");
    if (direct) return direct;
    const editorCard = [...document.querySelectorAll(".ant-card")].find(
      (card) =>
        normalized(elementText(card.querySelector(":scope > .ant-card-head .ant-card-head-title"))) ===
        "code editor"
    );
    return editorCard?.querySelector(":scope > .ant-card-actions") || null;
  }

  function applySolveState() {
    const button = document.getElementById(SOLVE_BUTTON_ID);
    if (!button) return;
    const state = SOLVE_STATES[solveState] || SOLVE_STATES.idle;
    const label = button.querySelector(".elab-solve-label");
    if (label) label.textContent = state.label;
    button.disabled = state.disabled;
    button.setAttribute("aria-busy", String(state.busy));
    button.classList.toggle("elab-solve-loading", state.busy);
    button.classList.toggle("elab-solve-failed", solveState === "failure");
  }

  function setSolveState(nextState) {
    solveState = nextState;
    applySolveState();
  }

  function ensureSolveAction() {
    const actions = findEditorActions();
    if (!actions) return;

    let item = actions.querySelector(`#${SOLVE_ACTION_ID}`);
    if (!item) {
      item = document.createElement("li");
      item.id = SOLVE_ACTION_ID;
      item.innerHTML = `<span><button id="${SOLVE_BUTTON_ID}" type="button"
        class="ant-btn ant-btn-link editorBtn" aria-label="Solve this problem">
        <span class="elab-solve-icon" aria-hidden="true">&#10024;</span>
        <span class="elab-solve-label">Solve It</span>
      </button></span>`;

      const runItem = [...actions.children].find((child) => normalized(elementText(child)) === "run");
      actions.insertBefore(item, runItem || null);
      item.querySelector("button").addEventListener("click", solveCurrentProblem);
    }

    for (const action of actions.children) action.style.width = "20%";
    applySolveState();
  }

  function brieflyHighlightEditor() {
    const editor = document.getElementById("ace-editor");
    if (!editor) return;
    editor.classList.add("elab-solver-editor-success");
    setTimeout(() => editor.classList.remove("elab-solver-editor-success"), 2200);
  }

  async function solveCurrentProblem() {
    if (activeSolveToken) return;

    const token = makeRequestId();
    const initialIdentity = getPageIdentity();
    activeSolveToken = token;
    setSolveState("reading");

    try {
      const payload = await collectSolvePayload();
      if (activeSolveToken !== token) return;

      setSolveState("solving");
      const result = await chrome.runtime.sendMessage({ type: "SOLVE_PROBLEM", payload });
      if (activeSolveToken !== token) return;
      if (!result?.ok) throw new Error(result?.error || "The solver request failed.");
      if (!result.code?.trim()) throw new Error("The solver returned an empty solution.");
      if (getPageIdentity() !== initialIdentity) {
        throw new Error("The problem changed while the solution was being generated. Try again on this page.");
      }

      setSolveState("injecting");
      await requestEditor("write", result.code);
      if (activeSolveToken !== token) return;

      brieflyHighlightEditor();
      setSolveState("success");
      showToast(`Solution injected by ${result.model || "the solver"}. Review it, then Run.`);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (activeSolveToken === token) setSolveState("idle");
    } catch (error) {
      if (activeSolveToken !== token) return;
      console.error("eLab Solver:", error);
      setSolveState("failure");
      showToast(error.message || "Could not solve this problem.", true);
    } finally {
      if (activeSolveToken === token) activeSolveToken = null;
    }
  }

  function syncPageEnhancements() {
    const supported = isProblemPage();
    document.documentElement.classList.toggle("problem-copier-selection-enabled", supported);
    if (supported) {
      createCopyButton();
      ensureSolveAction();
    } else {
      document.getElementById(COPY_BUTTON_ID)?.remove();
      document.getElementById(SOLVE_ACTION_ID)?.remove();
    }
  }

  let mutationTimer;
  const observer = new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(syncPageEnhancements, 250);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  syncPageEnhancements();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "COPY_STRUCTURED_PROBLEM") return false;
    buildStructuredProblem()
      .then((text) => sendResponse({ ok: true, text, length: text.length }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  });
})();
