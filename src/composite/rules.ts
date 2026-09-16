/**
 * Sifty — composite rules: the data behind a composite review.
 *
 * A rule is a question asked about SEVERAL files at once. It has no axis,
 * weight or scoring — a composite review reports findings, never a score
 * (ADR-0005) — so this is a separate, much smaller schema than
 * `CriteriaConfig`, kept in its own file (config/composite.json).
 */
import { z } from "zod";

export type CompositeSeverity = "info" | "warn";

export interface CompositeRule {
  id: string;
  label: string;
  severity: CompositeSeverity;
  /** Below this many files the rule is not applicable and does not run. */
  minFiles: number;
  /** Upper bound on findings per run — asked of the model and enforced afterwards. */
  maxFindings: number;
  /** Refuse (rather than truncate) inputs whose combined length exceeds this. */
  maxInputChars: number;
  question: string;
  fix: string;
}

export interface CompositeRules {
  /** Version of the config FORMAT — bump when the loader breaks. */
  schemaVersion: 1;
  /** Provenance only: which rule set produced a review. Carries no reproducibility promise. */
  rulesVersion: string;
  updated: string;
  rules: CompositeRule[];
}

const compositeRuleSchema: z.ZodType<CompositeRule> = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  severity: z.enum(["info", "warn"]),
  minFiles: z.number().int().min(2),
  maxFindings: z.number().int().min(1),
  maxInputChars: z.number().int().min(1),
  question: z.string().min(1),
  fix: z.string().min(1),
});

export const compositeRulesSchema: z.ZodType<CompositeRules> = z
  .object({
    schemaVersion: z.literal(1),
    rulesVersion: z.string().min(1),
    updated: z.string().min(1),
    rules: z.array(compositeRuleSchema).min(1),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    config.rules.forEach((rule, index) => {
      if (seen.has(rule.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["rules", index, "id"],
          message: `duplicate rule id "${rule.id}"`,
        });
      }
      seen.add(rule.id);
    });
  });
