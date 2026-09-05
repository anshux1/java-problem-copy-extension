# eLab Auto-Solver Plan — From "Copy Problem" to "Solve + Inject"

> Goal: Add a fifth, native-looking **Solve It** action beside the four existing actions below the eLab code editor (**Save**, **Reset**, **Run**, and **Evaluate**). Clicking it scrapes the problem, sends it to our server, calls an OpenCode Zen model, and injects the Java solution into the Ace editor. The extension never clicks Run or Evaluate.
> Repo current state: `problem-copier-extension/content.js` already scrapes Problem / Input / Output / Logical / Mandatory / Complexity + builds Markdown. We reuse it.
> Server choice: **Cloudflare Workers + Hono (TypeScript)** — free, no cold-start, keeps Zen key secret.
> Provider contract last verified: 2026-09-05 (UTC)
> Build status: DOM injection, structured extraction, Ace bridge, extension service worker, Worker API, Zen adapters, validation, tests, and the distributable ZIP are implemented. The Worker is created as `elab-solver`; remaining setup is workers.dev subdomain registration and the owner's Zen API key.

---

## 1. How it will work (target UX)

1. User opens an eLab problem page (Ant Design layout, `tr > th = Problem | Test Cases | Code Editor`).
2. The extension finds the Code Editor card (`#editor`) and its footer action list (`#editor > .ant-card-actions`). The captured page contains exactly four actions: **Save**, **Reset**, **Run**, and **Evaluate**.
3. It injects **Solve It** as a fifth `<li>` action between **Reset** and **Run**, using the same Ant classes (`ant-btn ant-btn-link editorBtn`) and DOM shape as the existing actions. All five `<li>` elements are changed from `width: 25%` to `width: 20%`.
4. Click → button state: `Reading… → Solving…` with a spinner and `disabled`/`aria-busy="true"`. The other four actions are not modified or triggered.
5. The content script reuses `getPageParts()`, `splitProblemStatement()`, and `extractTestCards()`, then adds the starter code and language. It asks the extension service worker to `POST` JSON to `https://your-worker.workers.dev/solve`.
6. The Worker builds a strict Java prompt, calls the Zen fallback chain, extracts the Java code, validates it, and returns `{code, model}`.
7. A small main-world bridge writes the solution through Ace's API and verifies it; the content script shows `Solution injected by <model> — Review & Run` and briefly highlights the editor.
8. User reviews the generated code and clicks eLab **Run** or **Evaluate** themselves. On failure, **Solve It** returns to its idle state and the toast explains whether reading, network, model, validation, or editor injection failed.

No auto-run and no auto-evaluate. The existing **Copy problem** button and popup remain available during the MVP; removing or relocating them is a separate cleanup after the solve flow is proven.

---

## 2. Why you need your own server (do not call Zen from `content.js`)

1. **Key leak:** Zen uses `Authorization: Bearer <OPENCODE_API_KEY>`. Anything in `content.js` is readable via DevTools.
2. **CORS:** Zen does not return `Access-Control-Allow-Origin: *` for browser origins. Direct `fetch` from eLab origin will be blocked. Worker can set CORS itself.
3. **Two API shapes:** Most free models use `/chat/completions`, Muse Spark free uses `/responses`. Worker normalizes this; extension only sees `{code}`.
4. **Fallback + validation:** Free models can return 429s, time out, or ignore eLab's required class name. The Worker retries the next model, strips explanations, verifies the starter template's public class name, and checks mandatory requirements before returning.

---

## 3. OpenCode Zen — live free-model list (fetched 2026-09-05)

Source of truth: `GET https://opencode.ai/zen/v1/models` + `https://opencode.ai/docs/zen/` pricing table.

### 3.1 Confirmed FREE in docs pricing table (Free in / Free out)

| # | Display name | Model ID to send | Endpoint | SDK type | Use for |
|---|---|---|---|---|---|
| 1 | Big Pickle (stealth, best for code eval) | `big-pickle` | `https://opencode.ai/zen/v1/chat/completions` | `@ai-sdk/openai-compatible` | Primary |
| 2 | MiMo-V2.5 Free | `mimo-v2.5-free` | `.../zen/v1/chat/completions` | `openai-compatible` | Fallback 1 |
| 3 | Nemotron 3 Ultra Free | `nemotron-3-ultra-free` | `.../zen/v1/chat/completions` | `openai-compatible` | Fallback 2 |
| 4 | Nemotron 3.5 Lightning Free | `nemotron-3.5-lightning-free` | `.../zen/v1/chat/completions` | `openai-compatible` | Fallback 3, fast |
| 5 | Ling 3.0 Flash Fin Free | `ling-3.0-flash-fin-free` | `.../zen/v1/chat/completions` | `openai-compatible` | Fallback 4 |
| 6 | Muse Spark 1.3 Contributor Free | `muse-spark-1.3-contributor-free` | `https://opencode.ai/zen/v1/responses` | `@ai-sdk/openai` (Responses API) | Alternate, different parser |

### 3.2 Present in live `/models` but NOT in docs pricing table (treat as experimental)

Fetched raw `data[].id` on 2026-09-05 included:

```
deepseek-v4-flash-free
muse-spark-1.2-contributor-free
```

These end in `-free`, likely also `.../zen/v1/chat/completions`, but docs don't guarantee Free pricing. Try them manually once; if billed / 404, drop them. Do NOT put them first in chain.

The live endpoint contained eight free-like IDs: `big-pickle`, `deepseek-v4-flash-free`, `muse-spark-1.3-contributor-free`, `muse-spark-1.2-contributor-free`, `mimo-v2.5-free`, `ling-3.0-flash-fin-free`, `nemotron-3-ultra-free`, and `nemotron-3.5-lightning-free`. Only IDs also documented as free belong in the production allowlist.

> Free = promo, "limited time to collect feedback". Expect rotation. Keep a reviewed allowlist in server code and verify it against both `/models` and the official pricing table before releases; a `-free` suffix alone is not enough.

### 3.3 Auth + billing note

1. Sign up at `https://opencode.ai/auth`, add billing details, copy API key (starts with `opencode_...`).
2. Even for $0 models you need a key + workspace. Set monthly limit $0–$5 + disable auto-reload if you want strict $0.
3. Privacy (from Zen docs): free-model prompts **may be used for training / logged** (Big Pickle, MiMo, Ling, Nemotron NVIDIA trial, Muse Spark Contributor). Do not send personal data. All hosted US, zero-retention *except* those free exceptions.

### 3.4 Request shapes

**Chat models (big-pickle + mimo + nemotron + ling):**

```bash
curl https://opencode.ai/zen/v1/chat/completions \
  -H "Authorization: Bearer $OPENCODE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "big-pickle",
    "temperature": 0.2,
    "max_tokens": 2500,
    "messages": [
      {"role": "system", "content": "You are a Java 11 solver. Return ONLY code in one ```java block."},
      {"role": "user", "content": "Solve..."}
    ]
  }'
# -> resp.choices[0].message.content
```

**Responses models (muse-spark-*-contributor-free):**

```bash
curl https://opencode.ai/zen/v1/responses \
  -H "Authorization: Bearer $OPENCODE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "muse-spark-1.3-contributor-free",
    "input": "Solve this Java problem... Return ONLY code",
    "max_output_tokens": 2500
  }'
# -> resp.output_text or resp.output[].content[].text, parse ```java inside
```

Worker must implement both parsers.

---

## 4. Server design — Cloudflare Workers + Hono

### 4.1 Why this stack

- Free 100k req/day, zero cold start (Render free sleeps 30s — bad for extension UX).
- `wrangler secret put OPENCODE_API_KEY` keeps key off client.
- One file, native `fetch` to Zen, easy CORS.
- `wrangler dev` + `cloudflared tunnel` gives https URL for `manifest.json` testing.

Deps: `hono`, `zod` (payload validation). No DB for MVP. Optional `KV` later for rate limit.

### 4.2 File layout

```
solver-worker/
  src/index.ts       # Hono app: GET /health, GET /models, POST /solve
  src/prompts.ts     # system + user prompt builder
  src/zen.ts         # callZenChat(), callZenResponses(), fallback chain, code extractor
  wrangler.toml      # name, compatibility_date
  .dev.vars          # OPENCODE_API_KEY=... (local only, gitignored)
```

### 4.3 API contract

**`POST /solve` request (from extension):**

```json
{
  "language": "openJDK v11.0.20",
  "starterCode": "public class ClassRA2682241010202 { ... }",
  "problem": "...",
  "functional": "...",
  "constraints": "...",
  "inputFormat": "...",
  "outputFormat": "...",
  "logical": [{"title": "Test Case 1", "fields": [{"label": "Input", "value": "..."}]}],
  "mandatory": [{"title": "...", "fields": [{"label": "Code", "value": "must contain synchronized"}]}],
  "complexity": [{"title": "...", "fields": []}]
}
```

Build this object from the new `collectProblemData()` result and add `starterCode`/`language`. Do not parse the clipboard Markdown. Keep serialized input at or below 50 KB and truncate individual non-mandatory test values to 2,000 characters with an explicit truncation marker.

**`POST /solve` response:**

```json
{
  "ok": true,
  "code": "import java.util.*;\npublic class ClassRA2682241010202 {...}",
  "model": "big-pickle",
  "tried": ["big-pickle"],
  "usage": {"input": 1234, "output": 567}
}
```

Error: `{ "ok": false, "error": "all models failed", "details": "..." }` with HTTP 502/429/400.

**`GET /health` → `{ok:true}` ; `GET /models` → proxies filtered free list for popup dropdown.**

### 4.4 Prompt builder (`prompts.ts`)

System:

```
You are an expert Java 11 solver for eLab-style auto-grader.
Return ONLY one complete runnable Java program in a single ```java block.
No explanation outside the block.
Preserve the starter template's public class name and required method signatures exactly.
Use the exact input/output format and satisfy every mandatory requirement.
```

User (assembled server-side):

````text
# Programming Problem
## Problem Description: ...
## Constraints: ...
## Input Format: ...
## Output Format: ...
## Logical Test Cases: ...
## Mandatory Requirements (MUST include verbatim): synchronized, ...
## Complexity: ...
## Starter template to complete (keep class/method names if present):
```java
<starterCode>
```
Solver Instructions: satisfy every test, include every mandatory keyword exactly.
````

`temperature: 0.1-0.2`, `max_tokens: 2500-3500`.

### 4.5 Zen caller (`zen.ts`) logic

```
FREE_CHAIN = ["big-pickle","mimo-v2.5-free","nemotron-3-ultra-free","nemotron-3.5-lightning-free","ling-3.0-flash-fin-free"]
+ optional ["muse-spark-1.3-contributor-free"] via Responses API

for model in chain:
  try fetch with 40s timeout (AbortSignal)
  if 429/5xx/timeout -> continue
  extract code via /```(?:java)?\n([\s\S]*?)```/ else raw
  strip language tag, trim
  validate: complete Java source, same public class as starter, mandatory requirements present
  if pass -> return
if all fail -> 502
```

Treat validation as a rejection signal, not proof that the answer is correct. Ignore required words found only in comments when practical. Log `model`, latency, token usage, and an error code (never problem text or generated code). Cache identical problem hashes for up to 1 hour to save quota, but include starter-code/class-name and language in the hash so one student's required class name cannot leak into another response.

### 4.6 Security / ops

- CORS: `Access-Control-Allow-Origin: *` (or lock to `chrome-extension://<id>` in prod) + `OPTIONS` handler.
- Validation with `zod`, max body 50KB, timeout 45s.
- Rate limit MVP: in-memory Map IP → 20/hour; later Cloudflare Rate Limiting / KV.
- Secrets: `wrangler secret put OPENCODE_API_KEY`; never log key; set workspace monthly limit $5, disable auto-reload if strict $0.
- Deploy: `npx wrangler deploy` → `https://elab-solver.<you>.workers.dev/solve`.

---

## 5. Extension changes (detailed)

### 5.1 Inject a fifth editor-footer action

The source fixture proves the correct anchor is the editor card footer, not the header:

```html
<div id="editor" class="ant-card ...">
  ...
  <ul class="ant-card-actions">
    <li style="width: 25%">... Save ...</li>
    <li style="width: 25%">... Reset ...</li>
    <li style="width: 25%">... Run ...</li>
    <li style="width: 25%">... Evaluate ...</li>
  </ul>
</div>
```

Add `findEditorActions()` and `ensureSolveAction()` to `content.js`:

```js
const SOLVE_ACTION_ID = "elab-solve-action";
const SOLVE_BUTTON_ID = "elab-solve-button";

function findEditorActions() {
  const direct = document.querySelector("#editor > .ant-card-actions");
  if (direct) return direct;

  const editorCard = [...document.querySelectorAll(".ant-card")].find(
    (card) => normalized(elementText(card.querySelector(":scope > .ant-card-head .ant-card-head-title"))) === "code editor"
  );
  return editorCard?.querySelector(":scope > .ant-card-actions") || null;
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

    const runItem = [...actions.children].find(
      (child) => normalized(elementText(child)) === "run"
    );
    actions.insertBefore(item, runItem || null);
    item.querySelector("button").addEventListener("click", solveCurrentProblem);
  }

  for (const action of actions.children) action.style.width = "20%";
}
```

Implementation requirements:

- Preserve the same `<li><span><button>` structure and Ant button classes as the four native actions.
- Label the button exactly **Solve It**. Place it between **Reset** and **Run** so the execution actions remain together.
- Style only extension-owned selectors. Inherit native typography, height, hover, and divider behavior; add only solve color, spinner, disabled, and focus-visible rules.
- Never locate the footer with a bare `.ant-card-actions` selector because other cards may have actions.
- Keep injection idempotent. The page is React-driven, so the existing debounced `MutationObserver` must call `ensureSolveAction()` on every sync and recreate it if the editor card is replaced.
- After every insertion, normalize all five direct child widths to `20%`. Do not alter nested list items or the behavior/disabled state of the four existing buttons.
- If the Code Editor footer is not present yet, do nothing and let the observer retry. Do not create a floating Solve fallback.
- Keep the current floating **Copy problem** control during MVP so existing functionality does not regress.

### 5.2 Separate structured extraction from Markdown rendering

`buildStructuredProblem()` currently returns only Markdown. Refactor without changing copied output:

1. `collectProblemData()` expands collapsed tests once and returns `{problem, functional, constraints, inputFormat, outputFormat, logical, mandatory, complexity}`.
2. `renderProblemMarkdown(data)` produces the current clipboard text and extraction warnings.
3. `buildStructuredProblem()` becomes a compatibility wrapper around those two functions.
4. `collectSolvePayload()` adds `{language, starterCode}` to the structured object and enforces size limits before sending it.

Do not scrape the already-rendered Markdown back into JSON. Cap the body at 50 KB and each logical/complexity test value at 2,000 characters. Never silently truncate the problem description, starter code, or mandatory requirements; reject an oversized payload with a visible, actionable error instead.

### 5.3 Read and write Ace through a page-world bridge

Important: Chrome content scripts run in an isolated JavaScript world. The DOM is shared, but the content script cannot reliably call the page's `window.ace`. Add `page-bridge.js` as a second content script with `"world": "MAIN"`; keep `content.js` in the default isolated world where `chrome.runtime` is available.

The two scripts communicate with namespaced `CustomEvent`s and a unique request ID:

- `elab-solver:editor-request` with `{requestId, operation: "read" | "write", code?}`.
- `elab-solver:editor-response` with `{requestId, ok, code?, error?}`.
- The bridge handles only those two allow-listed operations, calls `window.ace.edit("ace-editor")`, and reports success only after reading the session value back.
- For `write`, preserve the editor's newline mode, call `session.setValue(code)`, move the cursor to the start, clear selection, focus, and verify exact normalized content.
- If Ace is unavailable, return a typed `EDITOR_NOT_READY` error. Do not mutate `.ace_text-input` directly in the MVP; that hidden textarea is an input surface, not a reliable representation of the full document.
- Use a 3-second bridge timeout and remove event listeners after each response to avoid leaks.

`manifest.json` therefore gains the main-world script and the worker permission:

```json
{
  "background": { "service_worker": "service-worker.js" },
  "host_permissions": ["https://YOUR-WORKER.workers.dev/*"],
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["page-bridge.js"],
      "run_at": "document_start",
      "world": "MAIN"
    },
    {
      "matches": ["<all_urls>"],
      "css": ["content.css"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

Replace `<all_urls>` in both entries with the real eLab origin as soon as it is known. The two match lists must remain identical.

### 5.4 Send network requests through the service worker

Use `service-worker.js` for the cross-origin request rather than fetching from page-bound code. `content.js` sends `SOLVE_PROBLEM`; the service worker validates the message shape, calls the Worker with a 60-second `AbortController`, parses JSON safely, and returns a small normalized result.

```js
// content.js, inside solveCurrentProblem()
setSolveState(button, "reading");
const payload = await collectSolvePayload();
setSolveState(button, "solving");
const result = await chrome.runtime.sendMessage({ type: "SOLVE_PROBLEM", payload });
if (!result?.ok) throw new Error(result?.error || "Solver request failed.");
setSolveState(button, "injecting");
await writeEditorThroughBridge(result.code);
showToast(`Solution injected by ${result.model}. Review it, then Run.`);
```

The service worker must never accept a caller-supplied URL, headers, or API key. It uses one compile-time `WORKER_URL`, checks `response.ok`, limits returned code size, and maps errors to stable codes (`BAD_PAYLOAD`, `TIMEOUT`, `RATE_LIMITED`, `MODEL_FAILED`, `BAD_RESPONSE`, `NETWORK_ERROR`). The Zen key remains only in the Cloudflare Worker secret.

### 5.5 Solve-button state and failure behavior

Use a single guarded `solveCurrentProblem()` flow with `try/catch/finally`:

| State | Label | Disabled | Result |
|---|---|---:|---|
| Idle | Solve It | No | Ready for a new request |
| Reading | Reading… | Yes | Scrape problem and read starter code |
| Solving | Solving… | Yes | Wait for the Worker/model |
| Injecting | Injecting… | Yes | Write and verify Ace contents |
| Success | Solved! | Yes, for 1.2s | Toast includes model; then return to Idle |
| Failure | Try Again | No | Error toast; clicking retries from a fresh scrape |

Only one solve may be in flight per tab. Keep an operation token so a late response from an older request cannot overwrite a newer editor. Never clear the current editor before a valid solution is returned. If injection fails, copy the returned code to the clipboard only after an explicit user click in the error UI.

### 5.6 Popup scope

Popup changes are not required for the first working slice. Keep **Copy problem and test cases** unchanged. After the in-page flow is stable, optionally add model selection, last-model/last-error status, and a Solve command that delegates to the active tab instead of duplicating scraper logic.

---

## 6. Testing checklist

### 6.1 Local fixture and DOM behavior

- Load the unpacked extension on `layout.html` with file URL access enabled.
- Confirm the Code Editor footer order is **Save · Reset · Solve It · Run · Evaluate** and every direct `<li>` has `width: 20%`.
- Confirm the injected button uses `ant-btn ant-btn-link editorBtn`, matches the native action height/spacing, is keyboard focusable, and has a visible focus ring.
- Run `syncPageEnhancements()` repeatedly and trigger unrelated DOM mutations; exactly one Solve action must exist.
- Remove and recreate `#editor` to simulate a React route/render update; the observer must inject exactly one Solve action into the new footer.
- Confirm pages without Problem + Test Cases do not get a Solve action.
- Confirm the existing Copy button and popup still produce byte-for-byte equivalent Markdown after the extraction refactor.

### 6.2 Editor bridge

- Read the current full Ace session through the bridge, including multiline starter code.
- Write code containing quotes, Unicode, CRLF/LF newlines, and more lines than the viewport; exact normalized content must read back.
- Verify missing `#ace-editor`, missing `window.ace`, and bridge timeout return visible errors without changing the existing code.
- Verify successful injection does not click or dispatch events to Save, Reset, Run, or Evaluate.

### 6.3 Solver and error paths

- `curl` the local `/solve` endpoint with a representative fixture; assert JSON response shape and extracted Java source.
- Test every configured model once before enabling it in the fallback chain; treat undocumented `-free` models as opt-in only.
- Click **Solve It** and verify `Reading… → Solving… → Injecting… → Solved! → Solve It`.
- Double-click or press Enter repeatedly while solving; only one request is accepted.
- Exercise malformed payload, offline, 429, 5xx, timeout, invalid JSON, missing code, oversized code, and mandatory-validation failure. The original editor content must remain intact in every pre-injection failure.
- Navigate to a different problem while a request is pending; a stale response must not overwrite the new editor.
- Deploy the Worker, update `WORKER_URL`, reload the extension, test on live eLab, and verify usage/latency in the Zen dashboard.

### 6.4 MVP acceptance criteria

The MVP is complete only when all of the following are true:

1. Exactly one **Solve It** button appears as the fifth native-looking action below the Code Editor.
2. The button survives eLab React rerenders without duplicates and without changing the four existing actions' behavior.
3. One click collects the structured problem plus the actual Ace starter code, obtains a valid Java solution, injects it, and verifies the resulting session value.
4. The OpenCode key never appears in extension files, browser storage, DOM, events, logs, or network requests from the eLab page.
5. Failures are recoverable, leave the current code untouched when possible, and allow retry without reloading.
6. The extension never automatically invokes Save, Reset, Run, or Evaluate.

---

## 7. Costs, limits, risks

- **Cost:** $0 if only free IDs used + monthly limit set. Card fee note: Zen passes 4.4%+$0.30 per top-up — avoid top-up by staying free-only.
- **Rate limits:** Free tier throttled; expect 429 at bursts → fallback chain + client retry with backoff essential.
- **Quality:** Free code models weaker than GPT-5/Claude; Big Pickle / MiMo best bets. Validate mandatory keywords client-side; allow manual edit before Run.
- **Deprecation:** Free IDs rotate. Health-check `/models` weekly; alert if chain empty.
- **Privacy:** Free prompts may train models (see §3.3). Fine for coursework problems, not for private code.
- **Academic integrity:** Auto-solving may violate eLab/course rules. Use for practice / learning, keep manual review step, do not auto-submit. Add disclaimer in popup.

---

## 8. Build order (next actions)

- [x] Phase 0 — DOM slice: add the fifth **Solve It** footer action, 20% widths, native styling, state renderer, and rerender-safe injection.
- [x] Phase 1 — Data slice: introduce `collectProblemData()` and `renderProblemMarkdown()` while preserving current clipboard output; add payload limits and fixtures.
- [x] Phase 2 — Editor slice: add `page-bridge.js`, read/write request helpers, timeouts, verification, and manifest main-world registration.
- [x] Phase 3 — Server slice: scaffold `solver-worker/` (`index.ts`, `prompts.ts`, `zen.ts`), validate the API contract, test code extraction/mandatory checks, and verify configured model IDs.
- [ ] Phase 4 — End-to-end deployment: Worker upload is complete and `service-worker.js` points at the deployed endpoint. Remaining: register the workers.dev subdomain, set `OPENCODE_API_KEY`, and verify one live solve.
- [ ] Phase 5 — Production hardening: deploy Worker, set secrets and spending/rate limits, restrict extension match patterns and CORS, test live eLab rerenders/navigation, and add basic latency/error telemetry without problem text.
- [ ] Phase 6 — Optional UX: model picker, history, popup Solve entry, and removal/relocation of the floating Copy button only after the MVP acceptance criteria pass.
