# OpenCode Zen harness audit

Date: 2026-09-05 (UTC)

Reference: [`earendil-works/pi`](https://github.com/earendil-works/pi), commit `9841914c71a74d81abe07f751aefd271fd924e63`.

Scope was limited to the harness's OpenCode Zen provider registration (`packages/ai/src/providers/opencode.ts`), generated model metadata/routing (`packages/ai/scripts/generate-models.ts`), OpenAI-compatible request builder (`packages/ai/src/api/openai-completions.ts`), Responses request builder/parser (`packages/ai/src/api/openai-responses.ts` and `openai-responses-shared.ts`), retry behavior (`packages/ai/src/utils/provider-retry.ts`), and OpenCode attribution headers (`packages/coding-agent/src/core/provider-attribution.ts`). Other providers and unrelated harness features were not used to drive changes.

## Executive result

The Worker had the correct Zen host, bearer-key authentication, model IDs, and model-to-endpoint split. The request envelope was nevertheless less compatible with the harness in four material ways: it used non-streaming calls, used a string plus `instructions` for Responses, omitted Responses storage/reasoning metadata, and capped every model at 5,000 output tokens. It also sent `high` to Muse Spark even though the current catalog verifies `xhigh` for both Muse Spark free IDs.

Those differences are now fixed in `solver-worker/src/zen.ts`. The Worker sends the harness-compatible streamed request shape, parses both SSE and JSON responses, uses typed Responses input items, sets `store: false`, requests encrypted reasoning plus an automatic summary, trims the configured secret before sending it, and chooses `xhigh` for Muse Spark / `high` for the other current free models. Tests cover both streamed APIs and the legacy JSON fallback.

## Findings and disposition

| Area | `pi` harness behavior | Worker before audit | Disposition |
| --- | --- | --- | --- |
| Authentication | `OPENCODE_API_KEY` is resolved as a bearer API key | Same bearer header and Wrangler secret name | No change needed; key is still server-only |
| Host and routes | `https://opencode.ai/zen/v1`; OpenAI Responses or Chat Completions is selected by generated model metadata | Same host and routes, selected by the reviewed allowlist | No change needed |
| Model/API mapping | `@ai-sdk/openai` → `/responses`; null / OpenAI-compatible → `/chat/completions` | Muse → Responses; Ling/Nemotron/MiMo/Big Pickle → Chat | Correct; verified against the current catalog |
| Streaming | `stream: true`; Chat also sends `stream_options: {include_usage: true}` | No `stream` field; waited for one JSON document | Fixed; SSE parser now handles text deltas, terminal usage, and `[DONE]` |
| Responses input | Typed `input` message array; system/developer prompt is a message item | `instructions` plus a plain string `input` | Fixed to typed developer + user input items |
| Responses state/reasoning | `store: false`; `reasoning: {effort, summary: "auto"}` and `include: ["reasoning.encrypted_content"]` when reasoning is enabled | Omitted `store`, summary, and encrypted-reasoning include | Fixed |
| Reasoning level | Model metadata is mapped to the highest supported level; Muse Spark exposes `minimal…xhigh` | Hard-coded `high` for every model | Fixed: Muse Spark uses `xhigh`; other reviewed free models use `high` |
| Output budget | Harness uses each model's catalog `maxTokens` (32k–262k for the reviewed free models) | Hard-coded 5,000 for both APIs | Fixed to a bounded 32,000-token ceiling, the smallest current free-model cap, which leaves high-effort reasoning room without allowing an unbounded Worker response |
| User agent / session | Harness supplies its `pi` user agent. Session-aware runs add OpenCode session/client headers and a cache-affinity request ID | One-shot Worker had no session to preserve and previously supplied no explicit user agent | Worker now identifies itself as `eLab-Solver/1.0`; no fabricated persistent session is sent because each extension solve is stateless |
| Retries | Harness has an optional status-aware retry helper for 408/409/429/5xx, then agent-level retries when configured | Worker tries each reviewed model once, subject to a 45s attempt / 58s total budget | Kept bounded fallback behavior. Retrying the same free-tier request would multiply quota use and would not resolve account-level free-limit 429s; the Worker reports a clear 429 instead |
| Response features | Harness preserves reasoning/tool/replay metadata for multi-turn agent sessions | Solver only needs answer text and usage | Worker parses answer text and usage; tool/replay metadata is intentionally out of scope for this one-shot Java solver |

## Current reviewed free catalog

The current `models.dev` metadata maps these IDs as follows:

- `muse-spark-1.3-contributor-free`: Responses, reasoning efforts through `xhigh`.
- `muse-spark-1.2-contributor-free`: Responses, reasoning efforts through `xhigh`.
- `ling-3.0-flash-fin-free`: Chat, reasoning toggle metadata; the worker requests `high` as the highest compatible effort value.
- `nemotron-3.5-lightning-free`, `nemotron-3-ultra-free`, `mimo-v2.5-free`, `big-pickle`: Chat, reasoning enabled with provider-specific reasoning content; the worker requests `high`.

The allowlist intentionally remains limited to the seven IDs selected for this project. A `-free` suffix alone is not treated as proof that a model is current or tool-capable.

## Live failure interpretation

Before this patch, a tiny solve succeeded after the new Wrangler secret was uploaded, proving that the Worker could authenticate and reach Zen. The long eLab statement then produced a mixture of upstream HTTP 429 responses and 24-second timeouts across the free chain. That pattern is provider throttling/queue latency, not an invalid key or a wrong Zen URL. The adapter now gives a long attempt up to 45 seconds (without exceeding the 58-second chain ceiling), in addition to removing the request-shape and output-budget differences that could independently cause incomplete long responses. A provider-side free-tier limit can still legitimately return HTTP 429; the extension is expected to show its rate-limit message and allow a later retry.

No API key, problem text, generated code, or response body is stored in this report or in Worker logs.
