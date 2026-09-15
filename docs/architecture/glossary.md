# Glossary

One term per concept, used consistently in code, config, CLI output, tests
and docs. Prose in other documents may be German; these terms stay English
(see `AGENTS.md`).

| Term                     | Meaning                                                                                                                                                               | Defined in                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **tool**                 | Target AI coding tool a criteria set targets (`copilot`, `claude`, …)                                                                                                 | `config/<tool>.json`, `CriteriaConfig.tool`       |
| **criteria**             | The versioned rule set for one tool — axes, presets, file kinds, checks, grades, security policy                                                                      | `src/criteria/types.ts`, `src/criteria/schema.ts` |
| **check**                | One scoring rule: id, axis, weight, mode, scoring, fix text                                                                                                           | `Check` (`src/criteria/types.ts`)                 |
| **axis**                 | One of the five fixed scoring dimensions (`clarity`, `structure`, `completeness`, `cost`, `security`) — see ADR-0002                                                  | `AxisId` (`src/criteria/types.ts`)                |
| **preset**               | A named set of per-axis weights (`balanced`, `cost`, `security`, …)                                                                                                   | `Preset`                                          |
| **file kind**            | A tool-defined file category, matched by glob (`repo-wide`, `scoped`, …)                                                                                              | `FileKind`, `detectFileKind()`                    |
| **measure**              | A mechanical measurement function — free, offline, deterministic                                                                                                      | `MeasureFn` (`src/engine/measures.ts`)            |
| **measurement**          | One measure's raw result (value + evidence), before scoring                                                                                                           | `Measurement` (`src/report.types.ts`)             |
| **AI finding**           | One AI check's raw result (score + rationale from the model), before scoring                                                                                          | `AiFinding`                                       |
| **check score**          | A check's 0–100 score after `requires`-gating, or _not applicable_                                                                                                    | `CheckScore`                                      |
| **not applicable (n/a)** | A check that cannot apply to this file — drops out of both the numerator and the denominator, never scored as a pass                                                  | —                                                 |
| **axis score**           | The weighted mean of one axis's applicable check scores, plus its color (from `grades`)                                                                               | `AxisScore`                                       |
| **overall score**        | The preset-weighted mean of axis scores, capped if a blocker is present                                                                                               | `Report.overallScore`, `Report.cappedFrom`        |
| **blocker**              | A `severity: "blocker"` check that did not score 100 — caps the overall score at `security.blockerCapsOverallAt` (see ADR-0004)                                       | `Blocker`                                         |
| **grade band**           | One threshold (`min`, `label`, `color`) in the `grades` ladder — used for the overall grade AND, via the same lookup, each axis's color                               | `GradeBand` (`src/criteria/types.ts`)             |
| **grade**                | The label/color a report's overall score resolves to                                                                                                                  | `Grade` (`src/report.types.ts`)                   |
| **fix**                  | One entry in the report's impact-sorted fix list                                                                                                                      | `FixItem`                                         |
| **evidence**             | A located observation (line/excerpt/hint) backing a measurement or finding — always redacted before it reaches a report (`security.redactWith`)                       | `Evidence`                                        |
| **report**               | The full result of analyzing one file                                                                                                                                 | `Report`                                          |
| **analyze()**            | The engine's one entry point — `(content, criteria, provider?) → report`, pure, no file system, no network                                                            | `src/engine/runner.ts`                            |
| **AI provider**          | The port `src/engine/ai-provider.ts` defines; `src/providers/anthropic.ts` is the only implementation and the only file that imports the Anthropic SDK — see ADR-0003 | `AiProvider`                                      |
| **fix prompt**           | A generated, ready-to-paste optimization prompt built from a report's fix list — its own concern, no score                                                            | `src/fixprompt/generate.ts`                       |
| **composite review**     | Planned: analyzing several files together for contradictions, duplicated rules, overlapping triggers — no score (not yet built)                                       | Readme roadmap                                    |

## Deprecated / avoid

| Don't use                             | Use instead                                     | Why                                                                                            |
| ------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `config/` (as a source directory)     | `criteria/`                                     | Renamed in Wave 3 — `src/config/` no longer exists                                             |
| `AiClient`                            | `AiProvider`                                    | Renamed in Wave 2 when the SDK-shaped port became a real one                                   |
| `analyzeContent()` / `analyzeFile()`  | `analyze()`                                     | Renamed in Wave 3 — the engine no longer touches the file system itself                        |
| `formatReport()`                      | `formatTerminal()` (paired with `formatJson()`) | Renamed in Wave 3 alongside `--format json`                                                    |
| criteria's `Grade`                    | `GradeBand`                                     | Renamed in Wave 4 — was colliding in name with `report.types.ts`'s `Grade` (a different shape) |
| Achse / Prüfpunkt / Verbund-Bewertung | axis / check / composite review                 | German synonyms from early planning docs — the code and this glossary are English              |
