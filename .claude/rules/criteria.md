---
description: Rules for src/criteria/** and config/*.json — criteria data and its schema
paths:
  - "src/criteria/**"
  - "config/*.json"
---

# src/criteria/\*\* and config/\*.json

- `src/criteria/**` must not import `src/engine/**`, `src/providers/**`,
  `src/reporting/**`, or `src/fixprompt/**` — enforced by ESLint
  (`docs/architecture/dependency-rules.md`, rule R5). This module describes
  and loads criteria data; it must stay usable without the engine existing
  at all.
- `criteriaConfigSchema` (`src/criteria/schema.ts`) is the one place
  structural and cross-field validation lives — don't add a hand-written
  `if`-check for something a Zod refinement could express; extend the
  schema's `superRefine` instead.
- Which measure types are actually implemented (`check.measure.type`) is
  deliberately NOT hardcoded in the schema — it comes from
  `ValidateCriteriaOptions.measureTypes`, supplied by `src/cli.ts` via
  `Object.keys(measures)`. Don't add a second, hand-maintained list of
  measure type names anywhere in `src/criteria/**`.
- Editing a `config/*.json` file that moves a score: bump `criteriaVersion`
  in that file, and see `AGENTS.md`'s "golden safety net" section before
  committing — `npm test` will tell you if the move was intended.
- The axis set (`clarity`, `structure`, `completeness`, `cost`, `security`)
  is fixed — see ADR-0002 (`docs/adr/0002-criteria-are-data-axes-are-code.md`)
  for why a sixth axis is a code change, not a config change.
