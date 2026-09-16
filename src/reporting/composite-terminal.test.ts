import chalk from "chalk";
import { beforeAll, describe, expect, it } from "vitest";

import { formatCompositeJson } from "./composite-json.js";
import { formatCompositeTerminal } from "./composite-terminal.js";
import type { CompositeResult } from "../composite/types.js";

beforeAll(() => {
  chalk.level = 0;
});

function baseResult(overrides: Partial<CompositeResult> = {}): CompositeResult {
  return {
    review: {
      files: [
        { path: ".github/copilot-instructions.md", fileKind: "repo-wide" },
        { path: "src/ts.instructions.md", fileKind: "scoped" },
      ],
      rulesVersion: "0.1.0",
      ruleIds: ["composite.contradictions"],
      findings: [],
    },
    ...overrides,
  };
}

const FINDING = {
  ruleId: "composite.contradictions",
  severity: "warn" as const,
  summary: "Tabs vs. spaces",
  rationale: "The repo-wide file requires tabs; the scoped file forbids them.",
  fix: "Pick one, or state precedence.",
  evidence: [
    { file: ".github/copilot-instructions.md", line: 6, excerpt: "Use tabs for indentation" },
    { file: "src/ts.instructions.md", excerpt: "Indent with two spaces, never tabs" },
  ],
};

describe("formatCompositeTerminal", () => {
  it("renders findings with file, line and excerpt per evidence entry", () => {
    const output = formatCompositeTerminal(
      baseResult({
        review: {
          ...baseResult().review,
          findings: [FINDING, { ...FINDING, severity: "info", summary: "Minor" }],
        },
      }),
    );

    expect(output).toContain("Composite review: 2 files");
    expect(output).toContain("2 finding(s):");
    expect(output).toContain("[warn] Tabs vs. spaces");
    expect(output).toContain("[info] Minor");
    expect(output).toContain('.github/copilot-instructions.md:6 — "Use tabs for indentation"');
    expect(output).toContain('src/ts.instructions.md — "Indent with two spaces, never tabs"');
    expect(output).toContain("Fix: Pick one, or state precedence.");
    expect(output).toMatchSnapshot();
  });

  it("says so when nothing was found", () => {
    const output = formatCompositeTerminal(baseResult());

    expect(output).toContain("No contradictions found across 2 files.");
    expect(output).toMatchSnapshot();
  });

  it("shows the error instead of a clean verdict when the review could not run", () => {
    const output = formatCompositeTerminal(
      baseResult({ error: "Composite review requires an AI provider." }),
    );

    expect(output).toContain("Review incomplete: Composite review requires an AI provider.");
    expect(output).not.toContain("No contradictions found");
    expect(output).toMatchSnapshot();
  });
});

describe("formatCompositeJson", () => {
  it("serializes review, error and usage — and nothing else", () => {
    const result = baseResult({
      review: { ...baseResult().review, findings: [FINDING] },
      usage: { inputTokens: 10, outputTokens: 2 },
    });

    const parsed = JSON.parse(formatCompositeJson({ ...result, extra: true } as CompositeResult));

    expect(Object.keys(parsed)).toEqual(["review", "usage"]);
    expect(parsed.review.findings[0].evidence[0].file).toBe(".github/copilot-instructions.md");
    expect(formatCompositeJson(result)).toMatchSnapshot();
  });
});
