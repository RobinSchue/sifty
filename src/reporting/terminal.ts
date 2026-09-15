/**
 * Sifty — terminal report formatting.
 *
 * One function, one job: turn a `Report` into the string the CLI prints.
 * Kept separate from `src/cli.ts` so the CLI stays composition-only. See
 * `json.ts` for the other supported `--format`.
 */

import chalk from "chalk";

import type { Evidence, Report } from "../report.types.js";

const BAR_WIDTH = 20;

export function formatTerminal(report: Report): string {
  const lines: string[] = [];

  lines.push(chalk.bold(`\nFile: ${report.file}`));
  lines.push(
    chalk.dim(
      `Tool: ${report.tool}  Kind: ${report.fileKind}  Preset: ${report.preset}  Criteria: v${report.criteriaVersion}`,
    ),
  );

  if (report.blockers.length > 0) {
    lines.push("");
    for (const blocker of report.blockers) {
      lines.push(chalk.bgRed.white.bold(" BLOCKER ") + chalk.red(` ${blocker.label}`));
      for (const evidence of blocker.evidence ?? []) {
        lines.push(chalk.dim(`   ${formatEvidence(evidence)}`));
      }
    }
  }

  lines.push("");
  const scoreColor = colorFor(report.grade.color);
  const capNote =
    report.cappedFrom !== undefined ? chalk.dim(` (capped from ${report.cappedFrom})`) : "";
  lines.push(
    chalk.bold("Overall score: ") +
      scoreColor(`${report.overallScore}/100`) +
      chalk.dim(` — ${report.grade.label}`) +
      capNote,
  );

  lines.push("");
  for (const axis of report.axisScores) {
    const coverage =
      axis.checkCount < axis.totalChecks
        ? chalk.dim(` (${axis.checkCount}/${axis.totalChecks} checks)`)
        : "";
    const scoreCell =
      axis.checkCount === 0
        ? chalk.dim("n/a")
        : colorFor(axis.color)(String(axis.score).padStart(3));
    lines.push(
      `  ${axis.label.padEnd(20)} ${axis.checkCount === 0 ? emptyBar() : bar(axis.score, axis.color)} ${scoreCell}${coverage}`,
    );
  }

  if (report.fixes.length > 0) {
    lines.push("");
    lines.push(chalk.bold("Fix list (by impact):"));
    report.fixes.forEach((fix, index) => {
      lines.push(`  ${String(index + 1).padStart(2)}. ${severityTag(fix.severity)} ${fix.text}`);
    });
  } else {
    lines.push("");
    lines.push(chalk.green("No fixes needed — every applicable check passed."));
  }

  return lines.join("\n");
}

function bar(score: number, color: "green" | "amber" | "red"): string {
  const filled = Math.round((clamp(score) / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  return colorFor(color)("█".repeat(filled)) + chalk.dim("░".repeat(empty));
}

function emptyBar(): string {
  return chalk.dim("·".repeat(BAR_WIDTH));
}

function clamp(score: number): number {
  return Math.min(100, Math.max(0, score));
}

function colorFor(color: "green" | "amber" | "red"): (text: string) => string {
  if (color === "green") return chalk.green;
  if (color === "amber") return chalk.yellow;
  return chalk.red;
}

function severityTag(severity: "info" | "warn" | "blocker"): string {
  if (severity === "blocker") return chalk.bgRed.white(" blocker ");
  if (severity === "warn") return chalk.yellow("[warn]");
  return chalk.dim("[info]");
}

function formatEvidence(evidence: Evidence): string {
  const parts: string[] = [];
  if (evidence.line !== undefined) parts.push(`line ${evidence.line}`);
  if (evidence.excerpt) parts.push(`"${evidence.excerpt}"`);
  if (evidence.hint) parts.push(evidence.hint);
  return parts.join(" — ");
}
