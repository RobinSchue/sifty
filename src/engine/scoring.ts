/**
 * Sifty — scoring.
 *
 * STUB: `resolveCheck` is final (it applies per-file-kind overrides),
 * `buildReport` only assembles the report shell from raw measurements.
 * Score aggregation (bands/penalty/binary → axis scores → grade) lands with
 * the scoring engine step.
 */

import type { Check, CriteriaConfig } from "../criteria.types.js";
import type { AiFinding, Measurement, Report } from "../report.types.js";

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

export function buildReport(args: BuildReportArgs): Report {
  return {
    tool: args.config.tool,
    criteriaVersion: args.config.criteriaVersion,
    file: args.file,
    fileKind: args.fileKind,
    preset: args.preset ?? args.config.defaultPreset,
    measurements: args.measurements,
    aiFindings: args.aiFindings ?? [],
  };
}
