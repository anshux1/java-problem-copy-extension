# eLab Problem Copier & Solver

A Manifest V3 browser extension for the eLab-style online code submitter shown in `../layout.html`.

It copies the problem description, functional description, constraints, input/output format, logical test cases, mandatory test cases, and complexity test cases as readable Markdown. It also injects a native-looking **Solve It** action below the Ace editor once the companion Worker is configured.

## Install in Chrome / Edge

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this `problem-copier-extension` folder.
5. Open or reload the problem page.

Use either:

- the blue **Copy problem** button at the bottom-right of the problem page, or
- the extension icon in the browser toolbar and **Copy problem and test cases**.

The Code Editor footer also becomes **Save · Reset · Solve It · Run · Evaluate**. **Solve It** reads the current starter code, asks the configured Worker for a Java solution, and injects the result for review. It never clicks Run or Evaluate.

The extension opens collapsed test-case sections when necessary so their contents are included. The clipboard output is Markdown and ends with a solver prompt for Java.

## Notes

- The content script currently uses `<all_urls>` because the submitter URL was not provided. For least privilege, replace it in `manifest.json` with the submitter's actual URL pattern, for example `https://submitter.example.com/*`, then reload the extension.
- Browser-internal pages such as `chrome://extensions` cannot be modified by extensions.
- Solver requests go through `service-worker.js`; the OpenCode API key remains in the Cloudflare Worker and is never shipped in the extension.
- Before using **Solve It**, register the Worker URL and set `OPENCODE_API_KEY` as described in `../solver-worker/README.md`. The checked-in service worker already targets the deployed Worker endpoint.
- Free-model prompts may be retained or used for provider improvement. Do not send private or personal code.
