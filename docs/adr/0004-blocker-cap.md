# 0004. A blocker caps the overall score, security stays a regular axis

## Status

Accepted

## Context

Security is one of Sifty's five axes, scored and weighted the same way as
clarity, structure, completeness, and cost — a `preset` decides how much it
counts toward the overall score, same as any other axis. But some security
findings are not "one axis among five": a hardcoded API key or an internal
hostname in an instruction file is sent to a model on every request. A file
that is otherwise excellent — clear, well-structured, complete, cheap — but
leaks a secret must not average that leak away against four good axes and
still come out looking fine.

Two designs were possible: give security a much higher fixed weight (still
just an average, still capable of being outweighed by four perfect axes at
a low enough security weight or a high enough preset skew), or treat
certain findings as categorically different from a score.

## Decision

A check may be marked `severity: "blocker"` in its criteria config (today:
`security.secrets`, `security.internal-hosts`). If a blocker check does not
score a clean 100, the overall score is capped at
`security.blockerCapsOverallAt` (currently 40 in `config/copilot.json`),
regardless of preset or how the other four axes scored. The uncapped value
is kept on the report as `cappedFrom` so the cap stays explainable — a user
sees both "your overall score is 40" and "uncapped, it would have been 90".

This is deliberately a cap, not a zero-out: a file with a blocker still
gets its real per-axis scores and its real fix list, sorted by impact
(`weight * (100 - score)`) — a blocker check's own weight still drives it
to the top of that list, but the OTHER findings are not hidden just because
one thing is broken. `security.reportBlockersSeparately` additionally
surfaces blockers as their own section above the score, so the reason for
a capped score is never just an axis label with a low number.

## Consequences

A hardcoded secret cannot be scored away by four good axes, in any preset —
the blocker cap is a property of the check's severity, not of preset
weighting, so a `--preset cost` run cannot accidentally under-weight
security enough to hide it. `evidence.excerpt`/`evidence.hint` for a
blocker (and every other finding) is redacted before it reaches the report
(`src/engine/text.ts`'s `redactEvidence`, driven by `security.redactWith`)
so flagging the secret does not itself leak it into a terminal, a CI log,
or the JSON output.

The cost: `overallScore` is not a pure function of the five axis scores and
the preset weights once a blocker is present — a reader of the JSON
contract who only looks at `overallScore` without also checking
`cappedFrom` and `blockers` could be misled into thinking a preset change
would move the score, when in fact only fixing the blocker will. This is
accepted because the alternative (a purely additive score) is the actual
problem this decision solves.
