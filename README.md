# eLab Java Problem Copy & Solve Extension

A Chrome/Edge extension that copies an eLab-style coding problem into structured Markdown and adds a fifth **Solve It** action beside Save, Reset, Run, and Evaluate below the code editor. The solve flow preserves eLab's starter class name, injects generated Java into Ace for review, and never runs or evaluates automatically.

## Install the extension

1. Download [`problem-copier-extension.zip`](./problem-copier-extension.zip), or clone/download this repository.
2. If you downloaded the ZIP, extract it to a folder first.
3. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted `problem-copier-extension` folder — the folder containing `manifest.json`.
7. Open or reload the coding problem page.

Click the blue **Copy problem** button at the bottom-right of the page, or open the extension from the browser toolbar and click **Copy problem and test cases**.

To enable **Solve It**, deploy the companion Cloudflare Worker in `solver-worker/` and set its `/solve` URL in `problem-copier-extension/service-worker.js`. Detailed backend setup is in [`solver-worker/README.md`](./solver-worker/README.md).

> Browser pages such as `chrome://extensions` cannot be accessed by extensions. If using a local HTML file, enable **Allow access to file URLs** for this extension in its details page.

## Repository layout

- `problem-copier-extension/` — installable unpacked extension
- `problem-copier-extension.zip` — packaged extension for downloading/sharing
- `solver-worker/` — Cloudflare Worker that securely calls OpenCode Zen
- `layout.html` — sample page used during development

See [`problem-copier-extension/README.md`](./problem-copier-extension/README.md) for implementation details and URL-scope customization.
