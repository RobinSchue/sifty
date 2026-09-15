# AGENTS.md

Repo-specific rules for any AI agent working in Sifty. This file only states
what lint/CI do NOT already enforce — see `docs/architecture/dependency-rules.md`
for the rules ESLint enforces mechanically, and don't fight the linter: an
import-restriction error is telling you where the logic actually belongs, not
asking you to suppress it.

## Language

- Chat with the user (Robin): **German**.
- Code, identifiers, code comments, commit messages, and everything under
  `docs/`: **English** — including this file and ADRs. The one exception is
  documents the user explicitly asked for in German (e.g. a review report).

## Commits and branches

- Conventional Commits: `<type>(<scope>): <imperative summary>`, lowercase,
  no trailing period. Types: `feat`, `fix`, `refactor`, `docs`, `chore`,
  `test`, `build`, `ci`.
- Branch names: `<type>/<short-kebab-case-description>`.
- No `Co-Authored-By` trailer in commit messages.
- Small, independently reviewable changes — don't combine unrelated changes
  in one commit.
- Don't create branches, tags, releases, or publish the package unless
  explicitly asked.

## Architecture — read before a non-trivial change

- **Criteria are data, the engine knows no tool-specific rule** (ADR-0002,
  `docs/adr/0002-criteria-are-data-axes-are-code.md`). A new check, a
  recalibrated threshold, a new tool (`config/<tool>.json`) is a JSON
  change. A new _axis_ is not — see the ADR for why.
- **The AI provider is a port** (ADR-0003). A second provider is one new
  file under `src/providers/**` plus a flag in `src/cli.ts` — nothing in
  `src/engine/**` or `src/fixprompt/**` should need to change.
- **A blocker caps the score, it doesn't zero it out** (ADR-0004) — read
  this before touching `security.blockerCapsOverallAt` or a check's
  `severity`.
- Dependency direction (criteria → engine → {providers, reporting,
  fixprompt} → cli) is enforced by ESLint, not by convention — see
  `docs/architecture/dependency-rules.md` and `docs/architecture/context-map.md`.
- Terms: `docs/architecture/glossary.md`. Don't introduce a synonym for an
  existing term (e.g. "Prüfpunkt" for "check") — extend the glossary instead
  if a genuinely new concept needs a name.

## The golden safety net

`src/engine/golden.test.ts` pins the reported score for three fixtures
against the REAL `config/copilot.json`. Before changing
`src/engine/measures.ts`, `scoring.ts`, `text.ts`, or any `config/*.json`:

1. Run `npm test`. If a golden test goes red and you did NOT intend to move
   a score, that's a bug — find it before proceeding.
2. If the score change is deliberate (a recalibration, a new check), review
   the failing diff by hand, then regenerate the pinned values with
   `npx tsx src/testing/golden/generate.ts` and commit the new
   `src/testing/golden/expected/*.json` alongside the change that caused it.
3. Bump `criteriaVersion` in the affected `config/*.json` whenever a change
   there is meant to move any score — a report's `criteriaVersion` is a
   promise that identical input still produces an identical score under the
   same version.

## Quality bar

- `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build`
  must all pass before you consider a change done — this is exactly what CI
  runs.
- Functions in `src/engine/**` should stay small and single-purpose; if a
  function is hard to name in one phrase, it is probably doing two things.
- Add a test with every new behavior and every bug fix (a reproducing test
  first, for bugs). Reuse `src/testing/fixtures.ts`'s `makeConfig`/`makeCheck`
  builders rather than hand-rolling a `CriteriaConfig` in a test.

## Further reading

| File                                    | Content                                             |
| --------------------------------------- | --------------------------------------------------- |
| `ARCHITECTURE.md`                       | Why the code is shaped this way — read this first   |
| `docs/architecture/glossary.md`         | One term per concept                                |
| `docs/architecture/context-map.md`      | Module responsibilities, mermaid diagram            |
| `docs/architecture/dependency-rules.md` | What ESLint enforces, and how it was verified       |
| `docs/adr/*.md`                         | Why past architectural decisions were made          |
| `docs/architecture/reviews/*.md`        | Point-in-time architecture reviews                  |
| `Readme.md`                             | User-facing docs: install, usage, how scoring works |
