# Problem Statement Copier

A Manifest V3 browser extension for the eLab-style online code submitter shown in `../layout.html`.

It copies the problem description, functional description, constraints, input/output format, logical test cases, mandatory test cases, and complexity test cases as readable Markdown. It also appends Java solving instructions and enables text selection on supported problem pages.

## Install in Chrome / Edge

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this `problem-copier-extension` folder.
5. Open or reload the problem page.

Use either:

- the blue **Copy problem** button at the bottom-right of the problem page, or
- the extension icon in the browser toolbar and **Copy problem and test cases**.

The extension opens collapsed test-case sections when necessary so their contents are included. The clipboard output is Markdown and ends with a solver prompt for Java.

## Notes

- The content script currently uses `<all_urls>` because the submitter URL was not provided. For least privilege, replace it in `manifest.json` with the submitter's actual URL pattern, for example `https://submitter.example.com/*`, then reload the extension.
- Browser-internal pages such as `chrome://extensions` cannot be modified by extensions.
- No network requests or external libraries are used.
