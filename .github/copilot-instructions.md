# Sifty repository instructions

Sifty is a Node.js and TypeScript CLI that evaluates AI instruction, skill, and prompt files. Keep the MVP focused on validating one GitHub Copilot-targeted file and producing one terminal report.

## Workflow

- Work in small, independently reviewable changes. Do not combine unrelated plan steps in one change.
- Use conventional branch names: `<type>/<short-kebab-case-description>`.
  - Allowed types are `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `build`, and `ci`.
  - Examples: `feat/report-output`, `fix/frontmatter-validation`, `chore/tooling-setup`.
- Use Conventional Commits: `<type>(<optional-scope>): <imperative summary>`.
  - Keep the summary lowercase, concise, and without a trailing period.
  - Examples: `feat(cli): add output format option`, `fix(checks): reject missing applyTo`.
- Do not create branches, commits, tags, releases, or publish packages unless explicitly requested.
- Do not include a Co-authored-by trailer in commit messages.

## TypeScript and CLI conventions

- Use strict TypeScript. Avoid `any`, unsafe casts, and implicit runtime assumptions.
- Keep `src/index.ts` as CLI composition only. Place parsing, checks, scoring, reporting, and AI integration in focused modules under `src/` as they are introduced.
- Use ESM-compatible imports with explicit `.js` extensions for local runtime imports.
- Validate external and AI-generated data at boundaries with Zod. Report useful, actionable errors to stderr and set a non-zero exit code for invalid input or failed checks.
- Preserve deterministic output for mechanical checks. Do not make an AI API call when it is not needed.
- Keep the initial CLI scope to GitHub Copilot input files. Do not add Claude or multi-file evaluation before the MVP plan calls for it.

## Dependencies and validation

- Prefer the existing stack: `commander`, `gray-matter`, `chalk`, `zod`, `dotenv`, and `@anthropic-ai/sdk`.
- Add a dependency only when the current stack cannot reasonably solve the problem. Commit `package.json` and `package-lock.json` together when dependencies change.
- Add focused tests with each new behavior once a test runner is configured. Until then, validate affected paths with `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm run build`.
- Use Prettier for formatting. Do not add or enable ESLint rules that duplicate Prettier formatting rules.
- Keep generated output (`dist/`) and environment files untracked.

## Security and documentation

- Never log, commit, or include secrets, API keys, personally identifiable information, or `.env` contents in fixtures or examples.
- Treat instruction-file input as untrusted. Read only the requested file and do not execute its content.
- Update `README.md` when a user-facing command, flag, configuration requirement, or installation step changes.
