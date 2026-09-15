# Dependency rules

Every rule below is enforced by `eslint.config.js` — run `npm run lint` to
check it, or read the named block directly for the exact patterns and
messages. ESLint flat config resolves `no-restricted-imports` per file from
the LAST matching block only (blocks don't merge), so each directory below
has exactly one self-contained block; see the file's own top comment.

Test files (`*.test.ts`) are exempt from every rule here — they legitimately
cross these boundaries to build fixtures (e.g. `src/engine/golden.test.ts`
loads the real criteria file and the real engine together on purpose).

| #   | Rule                                                                                                                                                                | Enforced by (`eslint.config.js` block)                                                                                                          | Verified                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| R1  | `@anthropic-ai/sdk` is importable only under `src/providers/**`                                                                                                     | the `SDK_BAN` pattern, repeated in every directory block, plus the final `src/providers/**` override that turns the rule off                    | Temporarily added the import to `src/cli.ts`; lint caught it; reverted                                    |
| R2  | `src/engine/**` imports no `node:fs`/`node:path`/`node:url`, no `chalk`/`commander`/`dotenv`, and never reads `process.env`/`process.cwd()`/sets `process.exitCode` | the `"R2: the engine is pure…"` block (`no-restricted-imports` + `no-restricted-properties`)                                                    | Temporarily added `node:fs` to `src/engine/scoring.ts`; lint caught it; reverted                          |
| R3  | _(folded into R2)_ — no direct `process` access in the engine                                                                                                       | same block, `no-restricted-properties`                                                                                                          | see R2                                                                                                    |
| R4  | `dotenv`/`commander` import only in `src/cli.ts`; `chalk` only in `src/cli.ts` and `src/reporting/**`                                                               | the `CLI_ONLY_BAN` pattern, present in every non-cli/non-reporting block                                                                        | Covered by R2/R5's own verification (both include `CLI_ONLY_BAN`)                                         |
| R5  | `src/criteria/**` imports nothing from `engine/`, `providers/`, `reporting/`, or `fixprompt/`                                                                       | the `"R5: criteria describes and loads…"` block                                                                                                 | Temporarily added an `engine/measures.js` import to `src/criteria/load.ts`; lint caught it; reverted      |
| R6  | `src/reporting/**` imports from `engine/` as TYPES only (never engine code), and nothing from `criteria/`/`providers/`                                              | the `"R6: reporting turns a Report into text…"` block — the type-only half uses `@typescript-eslint/no-restricted-imports`'s `allowTypeImports` | Temporarily added a value import (`buildReport`) to `src/reporting/terminal.ts`; lint caught it; reverted |
| —   | `src/fixprompt/**` — same shape as R2 (no I/O, no chalk/commander/dotenv), since it sits at the same edge as reporting                                              | the `"fixprompt/ sits at the same edge…"` block                                                                                                 | Same mechanism as R2                                                                                      |
| —   | `src/cli.ts` — the composition root, everything allowed except the SDK directly                                                                                     | the `"The composition root…"` block                                                                                                             | Same mechanism as R1                                                                                      |

## Rules a schema enforces instead of ESLint

| Rule                                                                                                            | Enforced by                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A criteria config's shape, ranges, and cross-references (weights, bands, `requires`, `redactWith`, `overrides`) | `src/criteria/schema.ts`'s `criteriaConfigSchema`, run by `loadCriteria()`/`validateCriteria()` at startup                                                                                                      |
| `check.measure.type` is something the engine actually implements                                                | `load.ts`'s `ValidateCriteriaOptions.measureTypes`, supplied by `src/cli.ts` as `Object.keys(measures)` — deliberately NOT a second hardcoded list in the schema (see `schema.ts`'s comment on `measureSchema`) |
| A criteria-relevant change to `config/*.json` doesn't silently move a score                                     | `src/engine/golden.test.ts` + `src/testing/golden/expected/*.json`, generated by `src/testing/golden/generate.ts` — not an ESLint rule, a test                                                                  |

## What CI covers

`.github/workflows/ci.yml` runs, on every pull request and every push to
`main`: `npm run typecheck`, `npm run lint` (including every rule above),
`npm run format:check`, `npm test` (including the golden safety net),
`npm run build`.
