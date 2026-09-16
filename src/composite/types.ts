/**
 * Sifty — composite review result contract.
 *
 * The published shape of a composite review, parallel to `Report` /
 * `AnalyzeResult` for a single file. There is deliberately no score, axis,
 * grade or blocker here — a composite review reports findings, nothing more.
 */
import type { CompositeSeverity } from "./rules.js";
import type { TokenUsage } from "../engine/ai-provider.js";
import type { Evidence } from "../report.types.js";

/** Evidence that names its file — composite evidence spans files, Report evidence never does. */
export interface CompositeEvidence extends Evidence {
  /** The path as it was given to the review. */
  file: string;
}

export interface CompositeFinding {
  ruleId: string;
  severity: CompositeSeverity;
  /** One sentence: what conflicts with what. */
  summary: string;
  /** Why the cited instructions cannot both be followed. */
  rationale: string;
  /** The rule's fix text. */
  fix: string;
  /** At least two entries from at least two distinct files, redacted. */
  evidence: CompositeEvidence[];
}

export interface CompositeReview {
  files: { path: string; fileKind: string }[];
  rulesVersion: string;
  /** Rules that actually ran — a rule whose minFiles is not met is left out. */
  ruleIds: string[];
  findings: CompositeFinding[];
}

export interface CompositeResult {
  review: CompositeReview;
  /** Set when a rule was attempted but produced no usable findings. */
  error?: string | undefined;
  /** Token usage across every AI call made, when a provider ran and reported it. */
  usage?: TokenUsage | undefined;
}
