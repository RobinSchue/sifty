# Sifty

Sifty rates instruction, skill and prompt files for AI coding tools. It answers one
question: is this file clear, well structured, complete, cost-efficient and safe?

> **Status: early.** The mechanical checks run, the scoring engine is in place, the
> terminal report is readable, and the AI layer is connected and optional. Scores are
> usable for comparison, not yet as a gate.

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

Requires Node 20 or newer.

## Usage

```bash
sifty check <file> --tool copilot
sifty check <file> --tool copilot --preset cost
sifty check <file> --tool copilot --config ./my-criteria.json
sifty check <file> --tool copilot --no-ai
sifty check <file> --tool copilot --generate-fix-prompt
sifty check <file> --tool copilot --generate-fix-prompt --fix-prompt full
sifty check <file> --tool copilot --show-tokens
sifty check <file> --tool copilot --format json
```

The file kind is detected from the path:

| Path                                     | Kind        | Treated as                                    |
| ---------------------------------------- | ----------- | --------------------------------------------- |
| `.github/copilot-instructions.md`        | `repo-wide` | Loaded on every request — strict token limits |
| `.github/instructions/*.instructions.md` | `scoped`    | Applies only where `applyTo` matches          |

## AI checks

Some checks need judgement, not pattern matching — concrete instructions,
contradictions, project context, a scope statement, whether an output constraint is
sensible. `config/copilot.json` currently defines 5 of these (`mode: "ai"`). Sifty
bundles all of them into a single Anthropic API call per file; the mechanical checks
stay offline and deterministic either way.

Set `ANTHROPIC_API_KEY` as an environment variable, or drop it in a `.env` file in
the working directory (`.env*` is gitignored):

```
ANTHROPIC_API_KEY=your-key-here
```

The call uses `claude-haiku-4-5`, chosen for cost. The response is validated; an
invalid or incomplete one is retried once.

Without a key, AI checks are skipped and a note goes to stderr. `--no-ai` skips them
silently. If the API call itself fails, the report still prints, with a stderr note
naming the reason. None of these affect the exit code — only blockers do. Axes with
skipped checks show how many actually ran, e.g. `(3/5 checks)`.

Pass `--show-tokens` to print input/output token usage for each AI call made
(bundled checks, and the fix prompt if `--generate-fix-prompt` was also given).

**Privacy:** when AI checks run, the full file content is sent to the Anthropic API.

The AI call itself goes through a small provider interface (`AiProvider`); Anthropic
is the only implementation today, and it is the only place in the codebase that
imports `@anthropic-ai/sdk` — everything else, including the scoring engine, only
knows the interface.

## Fix suggestions (AI-driven)

After scoring, Sifty can generate ready-to-use prompts to help you fix the issues it found:

```bash
sifty check <file> --tool copilot --generate-fix-prompt
```

This generates two formats:

- **`--fix-prompt short`**: Brief suggestion ("these issues found: [...]. Please fix.") — good for quick copy-paste
- **`--fix-prompt full`** (default): Complete prompt with your full file content and detailed context, ready to paste into Claude/ChatGPT

Uses `claude-sonnet-5` for better prompt quality (~$0.01–0.02 per file extra cost). If no key is set or the API fails, the fix prompt is skipped silently. `--no-ai` disables it too — the fix prompt is AI-generated like the bundled checks, so it follows the same flag instead of making its own request regardless.

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

## JSON output

`--format json` prints exactly `{ report, failures, aiError, usage }` to stdout —
the same information the terminal report shows, structured for a script, CI, or a
future web UI to consume instead of parsing formatted text. `aiError` and `usage`
are omitted when there is nothing to report. `--generate-fix-prompt` and
`--show-tokens` are ignored in JSON mode; `usage` is already part of the contract.

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
  copilot.json            criteria: axes, checks, thresholds, word lists
src/
  index.ts                npm bin entry — just imports cli.js
  cli.ts                  composition root: flags, env, file I/O, printing
  report.types.ts         schema of a result
  criteria/types.ts       schema of a criteria config
  criteria/load.ts        loading, validation, file-kind detection
  engine/text.ts          parses the file once for all measures
  engine/measures.ts      the mechanical measurements
  engine/runner.ts        analyze(): pure, config + content in, report out
  engine/scoring.ts       tool-agnostic math
  engine/ai-provider.ts   the AiProvider port — no SDK import here
  engine/ai-checks.ts     bundled AI call (via the port), response validation, one retry
  providers/anthropic.ts  the only file that imports @anthropic-ai/sdk
  fixprompt/generate.ts   AI-driven fix-prompt generation (via the port)
  reporting/terminal.ts   Report -> terminal output
  reporting/json.ts       Report -> JSON output (--format json)
```

`analyze()` (in `engine/runner.ts`) takes a pre-loaded criteria config and file
content — no file system, no network, no `process` — so it can be called from
a script, a test, or eventually a web UI with nothing but plain objects.
Loading a config from disk and reaching a real model are `cli.ts`'s job.

## Development

```bash
npm install
npm run dev -- check example.instructions.md --tool copilot
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
- [x] Bundled AI call for the judgement-based checks
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
