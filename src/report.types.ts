/**
 * Sifty — report schema.
 *
 * STUB: the shape grows with the scoring engine. Defined here (not in
 * criteria.types.ts) because the report describes a RUN, not the config.
 */

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

export interface Report {
  tool: string;
  criteriaVersion: string;
  file: string;
  fileKind: string;
  preset: string;
  measurements: Measurement[];
  aiFindings: AiFinding[];
}
