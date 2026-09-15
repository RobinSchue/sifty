# 0002. Criteria are data, axes are code

## Status

Accepted

## Context

Sifty scores a file on five axes — clarity, structure, completeness, cost,
security — using a per-tool set of checks (thresholds, word lists, security
patterns, weights). New tools (Claude Code, other AI assistants) and
recalibration of existing thresholds are both expected, frequent changes; a
code release should not be required for either.

Two different things could be made "data": the checks themselves (which
words count as filler, what token limit is too long, which regexes catch a
secret), and the five axes a check belongs to. The axes are a much smaller,
much more stable set — they are how Sifty explains a score to a human
("your clarity is fine, your security is not"), they appear in the CLI
output, the JSON contract, and every criteria config's `presets` and
`grades`. Making the axis set itself configurable per tool would mean the
engine, the report shape, and every consumer of a report would need to
handle an open-ended, per-config list of axes instead of five known ones.

## Decision

Checks are data. `config/<tool>.json` defines every check — its axis,
weight, mode (`mechanical` | `ai`), measure, scoring rule, and fix text —
and the engine (`src/engine/**`) contains no rule specific to any tool. A
new tool, or a recalibrated threshold, is a JSON change (`Object.keys` of
`src/engine/measures.ts`'s registry is the only thing that constrains which
`measure.type` values a check may use — see `src/criteria/schema.ts`'s
`ValidateCriteriaOptions.measureTypes`).

The five axes are code. `AxisId` in `src/criteria/types.ts` is a fixed
five-member union (`clarity | structure | completeness | cost | security`),
not a `string`. A criteria config may use FEWER of the five (a tool without
a meaningful "cost" concept could omit checks on that axis, and the axis
would just show `n/a`), but it cannot invent a sixth. Adding one is a
deliberate, reviewed, cross-cutting change — it touches `AxisId`,
`src/report.types.ts`, every criteria config's `presets`/`grades`, and the
terminal/JSON output — not something a JSON edit alone should be able to
trigger silently.

## Consequences

Adding a tool or recalibrating scores stays a config-only change, reviewable
as a JSON diff — this is what makes `config/claude.json` (Claude Code
skills, `CLAUDE.md`) cheap once it is written. The axis set stays a small,
well-known vocabulary shared by the engine, the terminal report, the JSON
output, and (eventually) a composite review across several files — nothing
has to branch on "whichever axes this particular config happens to define."

The cost is that a genuinely new axis is not a config change — it is a
cross-cutting one, touching code in `src/criteria/types.ts` and
`src/report.types.ts` as well as every existing criteria config's
`presets`/`grades`. That is accepted deliberately: five axes is a product
decision (what Sifty measures), not a per-tool preference, and the
alternative — a fully open axis set — would push every future consumer of a
`Report` (the terminal formatter, the JSON contract, a future composite
review, a future web UI) to handle an unbounded, config-defined vocabulary
instead of five names it can rely on.
