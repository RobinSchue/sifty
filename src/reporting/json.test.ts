import { describe, expect, it } from "vitest";

import type { AnalyzeResult } from "../engine/runner.js";
import type { Report } from "../report.types.js";
import { formatJson } from "./json.js";

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
    ],
    overallScore: 90,
    grade: { label: "strong", color: "green" },
    blockers: [],
    fixes: [],
    ...overrides,
  };
}

describe("formatJson", () => {
  it("serializes the full AnalyzeResult contract as pretty-printed JSON", () => {
    const result: AnalyzeResult = {
      report: baseReport(),
      failures: [],
    };

    expect(formatJson(result)).toMatchSnapshot();
  });

  it("round-trips to an object with exactly the contract's top-level keys", () => {
    const result: AnalyzeResult = {
      report: baseReport({
        overallScore: 42,
        blockers: [{ checkId: "security.secrets", label: "Secrets" }],
      }),
      failures: [{ checkId: "clarity.x", message: "boom" }],
      aiError: "no key",
      usage: { inputTokens: 100, outputTokens: 20 },
    };

    const parsed = JSON.parse(formatJson(result)) as Record<string, unknown>;

    expect(Object.keys(parsed).sort()).toEqual(["aiError", "failures", "report", "usage"]);
    expect(parsed["report"]).toMatchObject({ overallScore: 42 });
    expect(parsed["failures"]).toEqual([{ checkId: "clarity.x", message: "boom" }]);
    expect(parsed["aiError"]).toBe("no key");
    expect(parsed["usage"]).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  it("omits aiError and usage from the JSON when they are undefined", () => {
    const result: AnalyzeResult = { report: baseReport(), failures: [] };

    const parsed = JSON.parse(formatJson(result)) as Record<string, unknown>;

    expect(Object.keys(parsed).sort()).toEqual(["failures", "report"]);
  });
});
