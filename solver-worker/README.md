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

After deployment, paste the generated `/solve` URL into `SOLVER_ENDPOINT`, replace the wildcard `workers.dev` host permission with the exact Worker host, and reload the extension.

Configuration lives in `wrangler.toml`:

- `ZEN_MODELS` is a comma-separated fallback chain restricted by the code's verified-free allowlist.
- `ALLOWED_ORIGIN` defaults to `*` for initial extension setup. Replace it with the installed extension origin where practical.
- `OPENCODE_API_KEY` must be a Wrangler secret; never put it in `wrangler.toml` or extension files.

The free-model prompts may be retained or used for provider improvement. Do not send private or personal code.
