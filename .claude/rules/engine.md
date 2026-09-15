---
description: Rules for src/engine/** — the pure scoring engine
paths:
  - "src/engine/**"
---

# src/engine/\*\*

- No file-system I/O, no `process.env`/`process.cwd()`/`process.exitCode`,
  no `chalk`/`commander`/`dotenv`, no AI SDK import — all enforced by
  ESLint (`docs/architecture/dependency-rules.md`, rule R2). If you hit one
  of these lint errors here, the code belongs in `src/cli.ts` instead, not
  in a suppression comment.
- `analyze()` (`runner.ts`) is the one entry point. It takes an already-loaded
  `CriteriaConfig` and file content — never load a config or read a file from
  inside `src/engine/**`.
- Score-relevant invariants (0–100 clamping, `requires`-gating, the blocker
  cap, evidence redaction) live in `scoring.ts` only. If you are duplicating
  a `Math.min(100, Math.max(0, …))` or similar anywhere else in `engine/`,
  that's a sign the value should flow through `scoring.ts` instead.
- Reach the model only through the `AiProvider` port (`ai-provider.ts`) —
  never `@anthropic-ai/sdk` directly (see `providers.md`).
- Run `npm test` after any change here — `src/engine/golden.test.ts` pins
  real scores against `config/copilot.json` and will go red if a score
  moved. See `AGENTS.md`'s "golden safety net" section for what to do next.
