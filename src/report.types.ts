/**
 * Sifty — report schema.
 *
 * Defined here (not in criteria/types.ts) because the report describes a RUN,
 * not the config.
 */

import type { AxisId } from "./criteria/types.js";

/** A single located observation backing a measurement or finding. */
export interface Evidence {
  /** 1-based line number in the raw file. */
  line?: number | undefined;
  /** Short quoted snippet (secrets redacted). */
  excerpt?: string | undefined;
  /** Plain-language explanation shown in the fix list. */
  hint?: string | undefined;
}

/** Outcome of one mechanical check. */
export interface Measurement {
  checkId: string;
  /** Absent when the check is not applicable to this file. */
  value?: number | boolean;
  applicable: boolean | undefined;
  evidence?: Evidence[] | undefined;
}

/** One answer from the bundled AI call. */
export interface AiFinding {
  checkId: string;
  /** 0–100, provided by the model. */
  score: number;
  rationale: string;
  evidence?: Evidence[] | undefined;
}

/** Score of one check after requires-gating, 0-100, or excluded entirely. */
export interface CheckScore {
  checkId: string;
  axis: AxisId;
  label: string;
  severity: "info" | "warn" | "blocker";
  source: "mechanical" | "ai";
  /** False when gated out by `requires`, not applicable to this file, or no AI data yet. */
  applicable: boolean;
  /** Absent when not applicable. */
  score?: number | undefined;
  evidence?: Evidence[] | undefined;
}

/** Weighted average of one axis' applicable check scores. */
export interface AxisScore {
  axis: AxisId;
  label: string;
  /** 0-100. 0 when no check on this axis had data (e.g. AI layer not connected yet). */
  score: number;
  /** Number of checks that actually contributed a score. */
  checkCount: number;
  /** Checks assigned to this axis for this file, whether or not they contributed. */
  totalChecks: number;
  /** From the SAME grade bands as the overall grade (config.grades) — not a hardcoded threshold. */
  color: "green" | "amber" | "red";
}

/** A blocker-severity check that did not fully pass — caps the overall score. */
export interface Blocker {
  checkId: string;
  label: string;
  evidence?: Evidence[] | undefined;
}

/** One entry in the report's prioritized fix list. */
export interface FixItem {
  checkId: string;
  axis: AxisId;
  severity: "info" | "warn" | "blocker";
  /** weight * (100 - score) — higher sorts first. */
  impact: number;
  text: string;
  evidence?: Evidence[] | undefined;
}

export interface Grade {
  label: string;
  color: "green" | "amber" | "red";
}

export interface Report {
  tool: string;
  criteriaVersion: string;
  file: string;
  fileKind: string;
  preset: string;
  measurements: Measurement[];
  aiFindings: AiFinding[];
  checkScores: CheckScore[];
  axisScores: AxisScore[];
  /** 0-100, after the blocker cap (if any) is applied. */
  overallScore: number;
  /** Present only when a blocker capped the score — the uncapped value. */
  cappedFrom?: number | undefined;
  grade: Grade;
  blockers: Blocker[];
  fixes: FixItem[];
}
