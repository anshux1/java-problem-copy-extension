(() => {
  "use strict";

  if (window.__elabSolverEditorBridgeLoaded) return;
  window.__elabSolverEditorBridgeLoaded = true;

  const REQUEST_EVENT = "elab-solver:editor-request";
  const RESPONSE_EVENT = "elab-solver:editor-response";
  const ALLOWED_OPERATIONS = new Set(["read", "write"]);

  const normalizeNewlines = (value) => String(value || "").replace(/\r\n?/g, "\n");

  function respond(response) {
    document.dispatchEvent(
      new CustomEvent(RESPONSE_EVENT, {
        detail: JSON.stringify(response)
      })
    );
  }

  document.addEventListener(REQUEST_EVENT, (event) => {
    let request;
    try {
      request = JSON.parse(String(event.detail || ""));
    } catch (_) {
      return;
    }

    const requestId = typeof request?.requestId === "string" ? request.requestId : "";
    if (!requestId || !ALLOWED_OPERATIONS.has(request.operation)) return;

    try {
      if (!window.ace?.edit || !document.getElementById("ace-editor")) {
        throw new Error("The Ace editor is not ready yet. Wait a moment and try again.");
      }

      const editor = window.ace.edit("ace-editor");
      const session = editor?.session;
      if (!session?.getValue || !session?.setValue) {
        throw new Error("The page's Ace editor session is unavailable.");
      }

      if (request.operation === "read") {
        respond({ requestId, ok: true, code: session.getValue() });
        return;
      }

      if (typeof request.code !== "string" || !request.code.trim()) {
        throw new Error("The generated solution was empty.");
      }

      session.setValue(request.code);
      editor.navigateFileStart?.();
      editor.clearSelection?.();
      editor.focus?.();

      const writtenCode = session.getValue();
      if (normalizeNewlines(writtenCode) !== normalizeNewlines(request.code)) {
        throw new Error("Ace did not accept the complete generated solution.");
      }
      respond({ requestId, ok: true, code: writtenCode });
    } catch (error) {
      respond({
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
})();
