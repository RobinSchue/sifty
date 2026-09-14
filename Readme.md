# Sifty

Sifty rates instruction, skill and prompt files for AI coding tools. It answers one
question: is this file clear, well structured, complete, cost-efficient and safe?

> **Status: early.** The mechanical checks run, the scoring engine is in place, the
> terminal report is readable, the AI layer is not connected yet. Scores are usable
> for comparison, not yet as a gate.

## Why

Instruction files are shipped to a model on every request, but nobody reviews them
the way code gets reviewed. A vague rule quietly wastes tokens, a contradictory one
quietly breaks suggestions, and a hardcoded key quietly leaves the building.

Existing linters treat prompts as generic text. Sifty knows the actual file formats
of the tools — where `applyTo` belongs, which file is loaded on every single request,
what a good `description` has to contain.

## Install

```bash
npm install -g @rosc/sifty
# or without installing
npx @rosc/sifty check .github/copilot-instructions.md --tool copilot
```

Requires Node 18 or newer.

## Usage

```bash
sifty check <file> --tool copilot
sifty check <file> --tool copilot --preset cost
sifty check <file> --tool copilot --config ./my-criteria.json
```

The file kind is detected from the path:

| Path                                     | Kind        | Treated as                                    |
| ---------------------------------------- | ----------- | --------------------------------------------- |
| `.github/copilot-instructions.md`        | `repo-wide` | Loaded on every request — strict token limits |
| `.github/instructions/*.instructions.md` | `scoped`    | Applies only where `applyTo` matches          |

## What it rates

Five axes, each 0–100:

| Axis                | Question                                                    |
| ------------------- | ----------------------------------------------------------- |
| Clarity & Precision | Concrete, consistent, no room for interpretation?           |
| Structure & Format  | Does it match the format the tool expects?                  |
| Completeness        | Enough context and examples to actually take effect?        |
| Cost Efficiency     | How many tokens per request, and is each one needed?        |
| Security            | Secrets, internal hosts, personal data, injection patterns? |

The overall score is the weighted mean of the axes. Which axes weigh more is
controlled by a preset (`balanced`, `cost`, `security`).

## How scoring works

- **Proportional, not absolute.** Every check scores 0–100, then gets averaged into
  its axis by its own weight.
- **Not applicable means not counted.** A check that cannot apply — `applyTo` rules
  on a repo-wide file, marker checks on a non-English file — drops out of the
  numerator _and_ the denominator. It is never silently scored as a pass.
- **Blockers cap the total.** A hardcoded secret or an internal hostname caps the
  overall score, no matter how good the other four axes are. The uncapped value stays
  in the report so the cap remains explainable.
- **Fixes are ranked by effect**, not by how alarming they sound: how many overall
  points does fixing this recover? Blockers still come first.
- **Every report records the criteria version and the preset.** A score without both
  is not comparable to anything.

Findings are redacted before they are printed. A detected key shows up as
`sk-l********`, so the report itself does not leak what it just flagged.

## Write instruction files in English

Sifty checks for this and says so. The codebase, the identifiers and the model's own
instruction training are English; switching language mid-context costs tokens and
precision. When a file is not English, the marker-based checks report as _not
applicable_ rather than passing on a technicality.

## Criteria live in config, not in code

The engine contains no rule about any specific tool. It reads `config/<tool>.json`
and does the math. Everything tool-specific — thresholds, word lists, security
patterns, weights — is data:

```json
{
  "id": "cost.file-length",
  "axis": "cost",
  "weight": 4,
  "measure": { "type": "tokenCount" },
  "scoring": { "type": "bands", "bands": [{ "upTo": 800, "score": 100 }] }
}
```

That is deliberate. AI tools and their pricing change fast; adjusting a threshold
should be a pull request against a JSON file, not a release. Bump `criteriaVersion`
when you change anything that moves scores.

The config is validated on load — unknown axes, missing word sets, dangling
`requires` references and unterminated band lists fail loudly at startup.

## Project layout

```
config/
  copilot.json          criteria: axes, checks, thresholds, word lists
src/
  index.ts              CLI entry point
  criteria.types.ts     schema of a criteria config
  report.types.ts       schema of a result
  config/load.ts        loading, validation, file-kind detection
  engine/text.ts        parses the file once for all measures
  engine/measures.ts    the mechanical measurements
  engine/runner.ts      file in, report out
  engine/scoring.ts     tool-agnostic math
```

## Development

```bash
npm install
npm run dev -- check examples/good.instructions.md --tool copilot
npm run test
npm run build
```

Adding a check usually means editing `config/copilot.json` only. A new _kind_ of
measurement means adding the type to `Measure` in `criteria.types.ts` — TypeScript
then refuses to compile until the implementation exists in `measures.ts`.

## Roadmap

- [x] Criteria as versioned config
- [x] Scoring engine with not-applicable handling and blocker caps
- [x] Mechanical checks (offline, free)
- [x] Readable terminal output
- [ ] Bundled AI call for the judgement-based checks
- [ ] Rewritten version as a diff
- [ ] Claude Code criteria
- [ ] Composite review across several files: contradictions, overlaps, colliding triggers
- [ ] Web UI

The composite review is the point of the whole thing. Real repositories have an
AGENTS.md plus scoped instruction files plus skills, and the expensive mistakes
happen between them — the same rule stated three times, or one file saying strict
TypeScript while another says just use `any`. No single-file linter can see that.

## License

Not decided yet.
