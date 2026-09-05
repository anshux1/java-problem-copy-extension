# eLab Solver Worker

Cloudflare Worker backend for the extension's **Solve It** action. It validates the scraped problem, calls a verified OpenCode Zen free-model fallback chain, preserves the starter code's public class name, checks mandatory code fragments, and returns Java source only.

## Local setup

```bash
npm install
cp .dev.vars.example .dev.vars
```

Put your Zen API key in `.dev.vars`, then start the Worker:

```bash
npm run dev
```

For local extension testing, change `SOLVER_ENDPOINT` in `../problem-copier-extension/service-worker.js` to `http://127.0.0.1:8787/solve`, reload the unpacked extension, and reload the eLab page.

## Verify and deploy

```bash
npm run typecheck
npm test
npx wrangler deploy --dry-run
npx wrangler secret put OPENCODE_API_KEY
npm run deploy
```

After deployment, register the `workers.dev` subdomain if Cloudflare prompts for it. The checked-in extension endpoint is `https://elab-solver.elab-solver-worker.workers.dev/solve`; if you choose a different Worker URL, update `service-worker.js`, replace the wildcard `workers.dev` host permission with the exact Worker host, and reload the extension.

Configuration lives in `wrangler.toml`:

- `ZEN_MODELS` is a comma-separated fallback chain restricted by the code's verified-free allowlist. The deployed default order starts with Muse Spark 1.3 Free, followed by Ling 3.0 Flash Fin, Nemotron 3.5 Lightning, Muse Spark 1.2, Nemotron 3 Ultra, MiMo V2.5, and Big Pickle.
- Every model attempt requests the highest verified reasoning setting for that model (`reasoning_effort: "high"` for the current chat free models and `reasoning: { effort: "xhigh", summary: "auto" }` for Muse Spark Responses).
- Zen requests follow the OpenCode harness shape: both APIs use `stream: true`; chat requests include `stream_options.include_usage`, Responses requests use typed `input` message items, `store: false`, and `include: ["reasoning.encrypted_content"]`. The worker parses SSE and accepts a JSON response fallback.
- The output ceiling is 32,000 tokens (the smallest current free-model catalog cap), replacing the old 5,000-token cap so high-effort reasoning has enough room to produce code. A model attempt can use up to 45 seconds, with a 58-second chain ceiling to stay inside the extension's 60-second request timeout.
- `ALLOWED_ORIGIN` defaults to `*` for initial extension setup. Replace it with the installed extension origin where practical.
- `OPENCODE_API_KEY` must be a Wrangler secret; never put it in `wrangler.toml` or extension files.

The free-model prompts may be retained or used for provider improvement. Do not send private or personal code.
