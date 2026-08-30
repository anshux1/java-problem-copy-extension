(() => {
  "use strict";

  if (window.__problemStatementCopierLoaded) return;
  window.__problemStatementCopierLoaded = true;

  const BUTTON_ID = "problem-copier-button";
  const TOAST_ID = "problem-copier-toast";
  const FINAL_PROMPT =
    "Solve this problem in Java. Your solution must follow the exact input and output formats and satisfy every logical, mandatory, and complexity test case listed above. Include every mandatory keyword or construct exactly as required. Return the complete Java solution.";

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
      problemCell: problemRow && problemRow.querySelector(":scope > td"),
      testCell: testRow && testRow.querySelector(":scope > td")
    };
  }

  function isProblemPage() {
    const { problemCell, testCell } = getPageParts();
    return Boolean(problemCell && testCell);
  }

  function splitProblemStatement(rawText) {
    const text = cleanText(rawText);
    const result = {
      problem: "",
      functional: "",
      constraints: "",
      input: "",
      output: ""
    };

    const headingPattern =
      /\b(Problem\s+Description|Functional\s+Description|Constraints?|Input\s+Format|Output\s+Format)\s*:?\s*/gi;
    const matches = [...text.matchAll(headingPattern)];

    if (!matches.length) {
      result.problem = text;
      return result;
    }

    if (matches[0].index > 0) {
      result.problem = cleanText(text.slice(0, matches[0].index));
    }

    const keyForHeading = (heading) => {
      const value = normalized(heading);
      if (value.startsWith("problem")) return "problem";
      if (value.startsWith("functional")) return "functional";
      if (value.startsWith("constraint")) return "constraints";
      if (value.startsWith("input")) return "input";
      return "output";
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

    // React may render the panel after the click. Poll briefly instead of
    // assuming that a fixed delay is enough on slower connections.
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
      if (child.classList && child.classList.contains("ant-card-body")) return child;
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
        const pre = valueElement && valueElement.querySelector("pre");
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
          const value = cleanText(field.value) || "Not provided";
          lines.push(`- **${field.label}:** ${value}`);
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

  async function buildStructuredProblem() {
    const { problemCell, testCell } = getPageParts();
    if (!problemCell || !testCell) {
      throw new Error("No supported problem statement was found on this page.");
    }

    await ensureTestGroupsAvailable(testCell);
    const statement = splitProblemStatement(elementText(problemCell));
    const sections = [
      "# Programming Problem",
      `## Problem Description\n\n${statement.problem || "Not provided on the page."}`
    ];

    if (statement.functional) {
      sections.push(`## Functional Description\n\n${statement.functional}`);
    }
    if (statement.constraints) {
      sections.push(`## Constraints\n\n${statement.constraints}`);
    }

    sections.push(`## Input Format\n\n${statement.input || "Not provided on the page."}`);
    sections.push(`## Output Format\n\n${statement.output || "Not provided on the page."}`);

    const missingGroups = [];
    for (const group of TEST_GROUPS) {
      const groupElement = findTestGroup(testCell, group.matcher);
      const cards = extractTestCards(groupElement);
      if (!groupElement || !cards.length) missingGroups.push(group.title);
      sections.push(renderTestGroup(group, cards));
    }

    if (missingGroups.length) {
      sections.push(
        `> **Extraction warning:** The following requested section(s) were not found or had no visible test cards: ${missingGroups.join(", ")}.`
      );
    }

    sections.push(`## Solver Instructions\n\n${FINAL_PROMPT}`);
    return sections.join("\n\n").trim() + "\n";
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
    textarea.style.cssText =
      "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none;";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("The browser blocked clipboard access.");
  }

  let toastTimer;
  function showToast(message, isError = false) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      toast.setAttribute("role", "status");
      document.documentElement.appendChild(toast);
    }

    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.toggle("problem-copier-toast-error", isError);
    toast.classList.add("problem-copier-toast-visible");
    toastTimer = setTimeout(() => {
      toast.classList.remove("problem-copier-toast-visible");
    }, 2600);
  }

  async function copyProblem(showPageToast = true) {
    const text = await buildStructuredProblem();
    await writeClipboard(text);
    if (showPageToast) showToast("Problem and test cases copied as Markdown.");
    return text;
  }

  function createCopyButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const button = document.createElement("button");
    button.id = BUTTON_ID;
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

  function syncPageEnhancements() {
    const supported = isProblemPage();
    document.documentElement.classList.toggle("problem-copier-selection-enabled", supported);

    if (supported) {
      createCopyButton();
    } else {
      document.getElementById(BUTTON_ID)?.remove();
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

    // The popup performs the final clipboard write in its own extension
    // context. Clipboard user activation is not reliably forwarded to a
    // content script through runtime messaging.
    buildStructuredProblem()
      .then((text) => sendResponse({ ok: true, text, length: text.length }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  });
})();
