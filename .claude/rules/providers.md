---
description: Rules for src/providers/** — AI provider adapters
paths:
  - "src/providers/**"
---

# src/providers/\*\*

- This is the ONLY directory allowed to import `@anthropic-ai/sdk` (or any
  future provider SDK) — enforced by ESLint (`docs/architecture/dependency-rules.md`,
  rule R1). See ADR-0003 (`docs/adr/0003-ai-provider-port.md`) for why.
- Implement the `AiProvider` port from `src/engine/ai-provider.ts`
  (`complete({system, user, schema, maxTokens}) → {output, usage?}`) —
  don't widen the port to leak SDK-specific request/response shapes into
  `src/engine/**` or `src/fixprompt/**`.
- Model selection is a construction-time concern, not part of the port —
  a new model tier is a new `model` option value passed by the caller
  (`src/cli.ts`), not a new method or a branch inside `complete()`.
- Give a test seam for the underlying client (see `src/providers/anthropic.ts`'s
  `client` option) so the adapter's own request/response mapping is unit
  tested without a real network call — see `anthropic.test.ts`.
