/**
 * Sifty — terminal formatting for a composite review.
 *
 * The composite counterpart of terminal.ts: a `CompositeResult` in, the
 * string the CLI prints out. No score, no bars — findings, or the absence
 * of them.
 */
import chalk from "chalk";

import type { CompositeSeverity } from "../composite/rules.js";
import type { CompositeEvidence, CompositeResult } from "../composite/types.js";

export function formatCompositeTerminal(result: CompositeResult): string {
  const { review } = result;
  const lines: string[] = [];

  lines.push(chalk.bold(`\nComposite review: ${review.files.length} files`));
  for (const file of review.files) {
    lines.push(chalk.dim(`  ${file.path}  (${file.fileKind})`));
  }
  lines.push(
    chalk.dim(`Rules: ${review.ruleIds.join(", ") || "none applicable"}  v${review.rulesVersion}`),
  );

  if (result.error) {
    lines.push("");
    lines.push(chalk.yellow(`Review incomplete: ${result.error}`));
  }

  lines.push("");
  if (review.findings.length === 0) {
    if (!result.error) {
      lines.push(chalk.green(`No contradictions found across ${review.files.length} files.`));
    }
    return lines.join("\n");
  }

  lines.push(chalk.bold(`${review.findings.length} finding(s):`));
  review.findings.forEach((finding, index) => {
    lines.push("");
    lines.push(
      `  ${String(index + 1).padStart(2)}. ${severityTag(finding.severity)} ${finding.summary}`,
    );
    for (const evidence of finding.evidence) {
      lines.push(chalk.dim(`      ${formatEvidence(evidence)}`));
    }
    lines.push(`      ${finding.rationale}`);
    lines.push(chalk.cyan(`      Fix: ${finding.fix}`));
  });

  return lines.join("\n");
}

function severityTag(severity: CompositeSeverity): string {
  return severity === "warn" ? chalk.yellow("[warn]") : chalk.dim("[info]");
}

function formatEvidence(evidence: CompositeEvidence): string {
  const location =
    evidence.line !== undefined ? `${evidence.file}:${evidence.line}` : evidence.file;
  return evidence.excerpt ? `${location} — "${evidence.excerpt}"` : location;
}
