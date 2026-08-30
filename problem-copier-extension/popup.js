(() => {
  "use strict";

  const copyButton = document.getElementById("copy-button");
  const status = document.getElementById("status");

  function setStatus(message, kind = "") {
    status.textContent = message;
    status.className = kind;
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]?.id) throw new Error("No active browser tab was found.");
    return tabs[0];
  }

  async function sendCopyMessage(tabId) {
    return chrome.tabs.sendMessage(tabId, { type: "COPY_STRUCTURED_PROBLEM" });
  }

  async function writeClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (_) {
      // Keep a fallback for browsers that do not expose Clipboard API to popups.
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("The browser blocked clipboard access.");
  }

  async function copyFromActiveTab() {
    const tab = await getActiveTab();
    let response;

    try {
      response = await sendCopyMessage(tab.id);
    } catch (_) {
      // This handles a tab that was already open before the extension was installed,
      // or a page where the content script was not injected yet.
      try {
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
        response = await sendCopyMessage(tab.id);
      } catch (injectionError) {
        throw new Error("This page does not allow browser extensions to run.");
      }
    }

    if (!response?.ok) {
      throw new Error(response?.error || "No supported problem statement was found.");
    }
    if (!response.text) throw new Error("The problem statement was empty.");
    await writeClipboard(response.text);
    return response;
  }

  copyButton.addEventListener("click", async () => {
    copyButton.disabled = true;
    copyButton.textContent = "Copying…";
    setStatus("Reading the problem and test cases…");

    try {
      const result = await copyFromActiveTab();
      setStatus(`Copied ${result.length.toLocaleString()} characters to the clipboard.`, "success");
      copyButton.textContent = "Copied!";
    } catch (error) {
      setStatus(error.message || "Could not copy this problem.", "error");
      copyButton.textContent = "Try again";
    } finally {
      setTimeout(() => {
        copyButton.disabled = false;
        if (copyButton.textContent === "Copied!") copyButton.textContent = "Copy problem and test cases";
      }, 1400);
    }
  });
})();
