# Java Problem Copy Extension

A Chrome/Edge extension that copies an eLab-style coding problem into structured Markdown, including the description, input/output format, logical test cases, mandatory test cases, complexity test cases, and a Java solving prompt.

## Install the extension

1. Download [`problem-copier-extension.zip`](./problem-copier-extension.zip), or clone/download this repository.
2. If you downloaded the ZIP, extract it to a folder first.
3. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted `problem-copier-extension` folder — the folder containing `manifest.json`.
7. Open or reload the coding problem page.

Click the blue **Copy problem** button at the bottom-right of the page, or open the extension from the browser toolbar and click **Copy problem and test cases**.

> Browser pages such as `chrome://extensions` cannot be accessed by extensions. If using a local HTML file, enable **Allow access to file URLs** for this extension in its details page.

## Repository layout

- `problem-copier-extension/` — installable unpacked extension
- `problem-copier-extension.zip` — packaged extension for downloading/sharing
- `layout.html` — sample page used during development

See [`problem-copier-extension/README.md`](./problem-copier-extension/README.md) for implementation details and URL-scope customization.
