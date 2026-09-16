/**
 * Sifty — composite review entry point.
 *
 * `reviewComposite()` is to several files what `analyze()` is to one: it
 * takes already-loaded rules and already-read content, never touches the
 * file system, and reaches the model only through the AiProvider port.
 */
import { type CompositeFile, runContradictionRule } from "./ai-contradictions.js";
import type { CompositeRule, CompositeRules } from "./rules.js";
import type { CompositeFinding, CompositeResult } from "./types.js";
import type { PatternDef } from "../criteria/types.js";
import type { AiProvider, TokenUsage } from "../engine/ai-provider.js";
import { addUsage } from "../engine/ai-request.js";
import { redactEvidence } from "../engine/text.js";

export type { CompositeFile } from "./ai-contradictions.js";

export interface ReviewCompositeDeps {
  rules: CompositeRules;
  provider?: AiProvider | undefined;
  /** Pattern sets for evidence redaction — the composition root takes them from the tool criteria. */
  redactPatterns?: PatternDef[] | undefined;
  /** Pre-computed findings (tests, a web UI); when set, no provider call is made. */
  findings?: CompositeFinding[] | undefined;
}

/** Same rough estimate the engine's tokenCount measure uses. */
const CHARS_PER_TOKEN = 4;

export async function reviewComposite(
  files: CompositeFile[],
  deps: ReviewCompositeDeps,
): Promise<CompositeResult> {
  const applicable = deps.rules.rules.filter((rule) => rule.minFiles <= files.length);
  const review = {
    files: files.map((file) => ({ path: file.path, fileKind: file.fileKind })),
    rulesVersion: deps.rules.rulesVersion,
    ruleIds: applicable.map((rule) => rule.id),
  };

  const collected = await collectFindings(applicable, files, deps);
  const findings = redactEvidenceIn(collected.findings, deps.redactPatterns ?? []);

  return {
    review: { ...review, findings },
    ...(collected.error !== undefined ? { error: collected.error } : {}),
    ...(collected.usage !== undefined ? { usage: collected.usage } : {}),
  };
}

async function collectFindings(
  rules: CompositeRule[],
  files: CompositeFile[],
  deps: ReviewCompositeDeps,
): Promise<{
  findings: CompositeFinding[];
  error?: string | undefined;
  usage?: TokenUsage | undefined;
}> {
  if (deps.findings) return { findings: deps.findings };
  if (rules.length === 0) return { findings: [] };
  if (!deps.provider) return { findings: [], error: "Composite review requires an AI provider." };

  const findings: CompositeFinding[] = [];
  const errors: string[] = [];
  let usage: TokenUsage | undefined;

  for (const rule of rules) {
    const overBudget = describeBudgetOverrun(rule, files);
    if (overBudget) {
      errors.push(overBudget);
      continue;
    }
    const result = await runContradictionRule({ rule, files, provider: deps.provider });
    findings.push(...result.findings);
    usage = addUsage(usage, result.usage);
    if (result.error) errors.push(result.error);
  }

  return {
    findings,
    ...(errors.length > 0 ? { error: errors.join(" ") } : {}),
    ...(usage !== undefined ? { usage } : {}),
  };
}

/** Refuse rather than truncate: a file cut mid-way can hide the conflicting line and yield a confident "no findings". */
function describeBudgetOverrun(rule: CompositeRule, files: CompositeFile[]): string | undefined {
  const chars = files.reduce((sum, file) => sum + file.content.length, 0);
  if (chars <= rule.maxInputChars) return undefined;
  const tokens = Math.ceil(chars / CHARS_PER_TOKEN);
  const budget = Math.ceil(rule.maxInputChars / CHARS_PER_TOKEN);
  return `Rule "${rule.id}" skipped: input is ≈${tokens} tokens, above its budget of ≈${budget} — pass fewer files.`;
}

function redactEvidenceIn(
  findings: CompositeFinding[],
  patterns: PatternDef[],
): CompositeFinding[] {
  if (patterns.length === 0) return findings;
  return findings.map((finding) => ({
    ...finding,
    evidence: redactEvidence(finding.evidence, patterns) ?? [],
  }));
}
