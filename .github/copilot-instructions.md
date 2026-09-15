# Sifty repository instructions

Sifty is a Node.js/TypeScript CLI that scores AI instruction, skill, and
prompt files. Read `AGENTS.md` first — it covers language, commits,
architecture, and the golden safety net; this file only adds what's
specific to working here as GitHub Copilot.

## TypeScript conventions

- Strict TypeScript, `exactOptionalPropertyTypes` on. Avoid `any`, unsafe
  casts, and implicit runtime assumptions.
- ESM imports with explicit `.js` extensions for local runtime imports.
- Validate external and AI-generated data at boundaries with Zod
  (`src/criteria/schema.ts`, `src/engine/ai-checks.ts`).
- `src/cli.ts` is the composition root — keep parsing, scoring, reporting,
  and AI integration in their existing focused modules under `src/`
  (see `docs/architecture/context-map.md`), not inlined into it.

## Dependencies

- Prefer the existing stack: `commander`, `gray-matter`, `chalk`, `zod`,
  `dotenv`, `picomatch`, `@anthropic-ai/sdk` (the last one only inside
  `src/providers/**` — see `docs/architecture/dependency-rules.md`).
- Add a dependency only when the current stack cannot reasonably solve the
  problem. Commit `package.json` and `package-lock.json` together.

## Security

- Never log, commit, or include secrets, API keys, PII, or `.env` contents
  in fixtures or examples.
- Treat instruction-file input as untrusted: read only the requested file,
  never execute its content.
- Update `Readme.md` when a user-facing command, flag, config requirement,
  or install step changes.
