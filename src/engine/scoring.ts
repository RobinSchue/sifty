/**
 * Sifty — scoring.
 *
 * Turns raw measurements and AI findings into a Report: per-check scores
 * (bands/penalty/binary/ai), `requires`-gating, weighted axis scores, the
 * overall score (preset-weighted, blocker-capped), a grade, and a fix list
 * sorted by impact.
 */

import { redactEvidence } from "./text.js";
import type { Check, CriteriaConfig, PatternDef, Scoring } from "../criteria/types.js";
import type {
  AiFinding,
  AxisScore,
  Blocker,
  CheckScore,
  Evidence,
  FixItem,
  Grade,
  Measurement,
  Report,
} from "../report.types.js";

/** Applies the overrides for this file kind on top of the base check. */
export function resolveCheck(check: Check, fileKind: string): Check {
  const override = check.overrides?.[fileKind];
  return override ? { ...check, ...override } : check;
}

export interface BuildReportArgs {
  config: CriteriaConfig;
  file: string;
  fileKind: string;
  preset?: string | undefined;
  measurements: Measurement[];
  aiFindings?: AiFinding[] | undefined;
}

/** Internal working state for one check, before `requires`-gating. */
interface RawOutcome {
  check: Check;
  source: "mechanical" | "ai";
  applicable: boolean;
  score?: number | undefined;
  evidence?: Evidence[] | undefined;
}

export function buildReport(args: BuildReportArgs): Report {
  const preset = args.preset ?? args.config.defaultPreset;

  const relevantChecks = args.config.checks
    .map((check) => resolveCheck(check, args.fileKind))
    .filter((check) => check.appliesTo.length === 0 || check.appliesTo.includes(args.fileKind));

  const measurementById = new Map(args.measurements.map((m) => [m.checkId, m]));
  const aiFindingById = new Map((args.aiFindings ?? []).map((f) => [f.checkId, f]));

  const raw = new Map<string, RawOutcome>();
  for (const check of relevantChecks) {
    if (check.mode === "mechanical") {
      const measurement = measurementById.get(check.id);
      if (!measurement) continue; // e.g. measure threw — dropped by the runner already
      raw.set(check.id, outcomeFromMeasurement(check, measurement));
    } else {
      const finding = aiFindingById.get(check.id);
      if (!finding) continue; // AI layer not connected yet, or model skipped it
      raw.set(check.id, outcomeFromAiFinding(check, finding));
    }
  }

  const resolved = redactAllEvidence(args.config, applyRequiresGating(relevantChecks, raw));
  const axisScores = aggregateAxisScores(args.config, resolved);
  const blockers = findBlockers(resolved);

  let overallScore = computeOverallScore(args.config, preset, axisScores);
  let cappedFrom: number | undefined;
  if (blockers.length > 0 && overallScore > args.config.security.blockerCapsOverallAt) {
    cappedFrom = overallScore;
    overallScore = args.config.security.blockerCapsOverallAt;
  }

  return {
    tool: args.config.tool,
    criteriaVersion: args.config.criteriaVersion,
    file: args.file,
    fileKind: args.fileKind,
    preset,
    measurements: args.measurements,
    aiFindings: args.aiFindings ?? [],
    checkScores: [...resolved.entries()].map(toCheckScore),
    axisScores,
    overallScore,
    cappedFrom,
    grade: resolveGrade(args.config, overallScore),
    blockers,
    fixes: buildFixList(resolved),
  };
}

/* ------------------------------------------------------------------ *
 * Per-check scoring
 * ------------------------------------------------------------------ */

function outcomeFromMeasurement(check: Check, measurement: Measurement): RawOutcome {
  if (measurement.applicable === false || measurement.value === undefined) {
    return { check, source: "mechanical", applicable: false, evidence: measurement.evidence };
  }
  return {
    check,
    source: "mechanical",
    applicable: true,
    score: scoreFromMechanical(check.scoring, measurement.value),
    evidence: measurement.evidence,
  };
}

function outcomeFromAiFinding(check: Check, finding: AiFinding): RawOutcome {
  return {
    check,
    source: "ai",
    applicable: true,
    score: clampScore(finding.score),
    evidence: finding.evidence,
  };
}

/** Maps a raw measurement value to 0-100 via the check's scoring rule. */
function scoreFromMechanical(scoring: Scoring, value: number | boolean): number | undefined {
  switch (scoring.type) {
    case "binary":
      return value === true ? 100 : (scoring.failScore ?? 0);
    case "bands": {
      const numeric = typeof value === "number" ? value : value ? 1 : 0;
      const band = scoring.bands.find((b) => b.upTo === null || numeric <= b.upTo);
      return band?.score;
    }
    case "penalty": {
      const hits = typeof value === "number" ? value : value ? 1 : 0;
      return Math.max(scoring.floor ?? 0, 100 - scoring.perHit * hits);
    }
    case "ai":
      return undefined; // handled via outcomeFromAiFinding instead
  }
}

function clampScore(score: number): number {
  return Math.min(100, Math.max(0, score));
}

/* ------------------------------------------------------------------ *
 * `requires`-gating
 *
 * A check with `requires: [...]` only applies when every required check is
 * itself applicable AND scored a clean 100 (e.g. the file is written in
 * English before filler-word density is judged). Resolved iteratively since
 * chains can be several checks deep (frontmatter-valid → applyto-present →
 * applyto-valid → applyto-scoped).
 * ------------------------------------------------------------------ */

function applyRequiresGating(
  checks: Check[],
  raw: Map<string, RawOutcome>,
): Map<string, RawOutcome> {
  const resolved = new Map<string, RawOutcome>();
  const pending = new Map(checks.map((check) => [check.id, check]));

  let progressed = true;
  while (pending.size > 0 && progressed) {
    progressed = false;
    for (const [id, check] of pending) {
      const requires = check.requires ?? [];
      if (!requires.every((dep) => resolved.has(dep))) continue;

      const requiresSatisfied = requires.every((dep) => {
        const outcome = resolved.get(dep);
        return outcome?.applicable === true && outcome.score === 100;
      });

      const outcome = raw.get(id);
      resolved.set(
        id,
        requiresSatisfied && outcome
          ? outcome
          : { check, source: check.mode === "ai" ? "ai" : "mechanical", applicable: false },
      );
      pending.delete(id);
      progressed = true;
    }
  }

  // Unresolved requires (e.g. a required check has no data) → not applicable.
  for (const [id, check] of pending) {
    resolved.set(id, {
      check,
      source: check.mode === "ai" ? "ai" : "mechanical",
      applicable: false,
    });
  }

  return resolved;
}

/* ------------------------------------------------------------------ *
 * Evidence redaction
 *
 * Applied once, here, after gating and before anything reads `.evidence` —
 * checkScores, blockers and the fix list all derive from this same map, so
 * this is the one place that guarantees every one of them sees redacted
 * text regardless of whether it came from a measure or the model.
 * ------------------------------------------------------------------ */

function redactAllEvidence(
  config: CriteriaConfig,
  resolved: Map<string, RawOutcome>,
): Map<string, RawOutcome> {
  const patterns = collectRedactionPatterns(config);
  if (patterns.length === 0) return resolved;

  const out = new Map<string, RawOutcome>();
  for (const [id, outcome] of resolved) {
    out.set(id, { ...outcome, evidence: redactEvidence(outcome.evidence, patterns) });
  }
  return out;
}

function collectRedactionPatterns(config: CriteriaConfig): PatternDef[] {
  const setIds = config.security.redactWith ?? [];
  return setIds.flatMap((id) => config.sets.patterns[id] ?? []);
}

/* ------------------------------------------------------------------ *
 * Aggregation
 * ------------------------------------------------------------------ */

function aggregateAxisScores(
  config: CriteriaConfig,
  resolved: Map<string, RawOutcome>,
): AxisScore[] {
  return config.axes.map((axis) => {
    const onAxis = [...resolved.values()].filter((o) => o.check.axis === axis.id);
    const applicable = onAxis.filter((o) => o.applicable && o.score !== undefined);
    const totalWeight = applicable.reduce((sum, o) => sum + o.check.weight, 0);
    const score =
      totalWeight > 0
        ? applicable.reduce((sum, o) => sum + o.check.weight * (o.score ?? 0), 0) / totalWeight
        : 0;

    return {
      axis: axis.id,
      label: axis.label,
      score: Math.round(score),
      checkCount: applicable.length,
      totalChecks: onAxis.length,
    };
  });
}

function computeOverallScore(
  config: CriteriaConfig,
  preset: string,
  axisScores: AxisScore[],
): number {
  // No fallback to the default preset's weights: an unknown preset name must fail
  // loudly at the boundary (see runner.ts) — silently scoring with different
  // weights than the report claims to use is worse than a crash.
  const weights = config.presets[preset]?.weights;
  if (!weights) return 0;

  // An axis with zero contributing checks (e.g. AI layer not connected, or every
  // check on it was gated out) has no data — same not-applicable fairness rule as
  // individual checks: it falls out of numerator AND denominator instead of
  // dragging the overall score down as an implicit 0.
  const scored = axisScores.filter((a) => a.checkCount > 0);

  const totalWeight = scored.reduce((sum, a) => sum + (weights[a.axis] ?? 0), 0);
  if (totalWeight === 0) return 0;

  const weighted = scored.reduce((sum, a) => sum + (weights[a.axis] ?? 0) * a.score, 0);
  return Math.round(weighted / totalWeight);
}

function resolveGrade(config: CriteriaConfig, score: number): Grade {
  const match = [...config.grades].sort((a, b) => b.min - a.min).find((g) => score >= g.min);
  return match ? { label: match.label, color: match.color } : { label: "unrated", color: "red" };
}

function findBlockers(resolved: Map<string, RawOutcome>): Blocker[] {
  return [...resolved.entries()]
    .filter(([, o]) => o.check.severity === "blocker" && o.applicable && (o.score ?? 100) < 100)
    .map(([checkId, o]) => ({ checkId, label: o.check.label, evidence: o.evidence }));
}

function buildFixList(resolved: Map<string, RawOutcome>): FixItem[] {
  return [...resolved.entries()]
    .filter(([, o]) => o.applicable && o.score !== undefined && o.score < 100)
    .map(([checkId, o]) => ({
      checkId,
      axis: o.check.axis,
      severity: o.check.severity ?? "info",
      impact: o.check.weight * (100 - (o.score ?? 0)),
      text: o.check.fix,
      evidence: o.evidence,
    }))
    .sort((a, b) => b.impact - a.impact);
}

function toCheckScore([checkId, o]: [string, RawOutcome]): CheckScore {
  return {
    checkId,
    axis: o.check.axis,
    label: o.check.label,
    severity: o.check.severity ?? "info",
    source: o.source,
    applicable: o.applicable,
    score: o.score,
    evidence: o.evidence,
  };
}
