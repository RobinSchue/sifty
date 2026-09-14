import chalk from "chalk";
import { beforeAll, describe, expect, it } from "vitest";

import type { Report } from "../report.types.js";
import { formatReport } from "./format.js";

beforeAll(() => {
  chalk.level = 0;
});

function baseReport(overrides: Partial<Report> = {}): Report {
  return {
    tool: "copilot",
    criteriaVersion: "1.0.0",
    file: "a.instructions.md",
    fileKind: "scoped",
    preset: "balanced",
    measurements: [],
    aiFindings: [],
    checkScores: [],
    axisScores: [
      { axis: "clarity", label: "Clarity & Precision", score: 90, checkCount: 3, totalChecks: 3 },
      { axis: "structure", label: "Structure & Format", score: 80, checkCount: 2, totalChecks: 2 },
      {
        axis: "completeness",
        label: "Completeness",
        score: 0,
        checkCount: 0,
        totalChecks: 5,
      },
      { axis: "cost", label: "Cost Efficiency", score: 70, checkCount: 1, totalChecks: 1 },
      { axis: "security", label: "Security", score: 100, checkCount: 1, totalChecks: 1 },
    ],
    overallScore: 85,
    grade: { label: "good", color: "green" },
    blockers: [],
    fixes: [],
    ...overrides,
  };
}

describe("formatReport", () => {
  it("includes the file, tool, kind, preset and criteria header", () => {
    const output = formatReport(baseReport());
    expect(output).toContain("File: a.instructions.md");
    expect(output).toContain("Tool: copilot");
    expect(output).toContain("Kind: scoped");
    expect(output).toContain("Preset: balanced");
    expect(output).toContain("Criteria: v1.0.0");
  });

  it("shows the overall score and grade", () => {
    const output = formatReport(baseReport());
    expect(output).toContain("Overall score: 85/100");
    expect(output).toContain("good");
  });

  it("omits the blocker section when there are no blockers", () => {
    const output = formatReport(baseReport());
    expect(output).not.toContain("BLOCKER");
  });

  it("shows a blocker section with its evidence when blockers are present", () => {
    const output = formatReport(
      baseReport({
        blockers: [
          {
            checkId: "security.secret",
            label: "Secrets in plain text",
            evidence: [{ line: 5, hint: "hardcoded key" }],
          },
        ],
      }),
    );
    expect(output).toContain("BLOCKER");
    expect(output).toContain("Secrets in plain text");
    expect(output).toContain("line 5");
    expect(output).toContain("hardcoded key");
  });

  it("shows a cap note only when cappedFrom is set", () => {
    const uncapped = formatReport(baseReport());
    expect(uncapped).not.toContain("capped from");

    const capped = formatReport(baseReport({ overallScore: 40, cappedFrom: 68 }));
    expect(capped).toContain("capped from 68");
  });

  it("shows n/a with coverage note for an axis with zero contributing checks", () => {
    const output = formatReport(baseReport());
    expect(output).toContain("n/a");
    expect(output).toContain("(0/5 checks)");
  });

  it("shows a coverage note for a partially-covered axis but not a fully-covered one", () => {
    const output = formatReport(
      baseReport({
        axisScores: [
          {
            axis: "clarity",
            label: "Clarity & Precision",
            score: 80,
            checkCount: 2,
            totalChecks: 5,
          },
        ],
      }),
    );
    expect(output).toContain("(2/5 checks)");
  });

  it("prints the fix list sorted as given, with severity tags", () => {
    const output = formatReport(
      baseReport({
        fixes: [
          {
            checkId: "security.secret",
            axis: "security",
            severity: "blocker",
            impact: 100,
            text: "Remove the secret.",
          },
          {
            checkId: "clarity.filler",
            axis: "clarity",
            severity: "warn",
            impact: 20,
            text: "Cut the filler words.",
          },
          {
            checkId: "completeness.examples",
            axis: "completeness",
            severity: "info",
            impact: 5,
            text: "Add an example.",
          },
        ],
      }),
    );

    expect(output).toContain("1.  blocker  Remove the secret.");
    expect(output).toContain("2. [warn] Cut the filler words.");
    expect(output).toContain("3. [info] Add an example.");
  });

  it("shows a success message when there are no fixes", () => {
    const output = formatReport(baseReport({ fixes: [] }));
    expect(output).toContain("No fixes needed");
  });
});
