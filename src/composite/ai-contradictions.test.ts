import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  buildCompositeRequest,
  type CompositeFile,
  runContradictionRule,
} from "./ai-contradictions.js";
import { loadCompositeRules } from "./load.js";
import type { AiProvider } from "../engine/ai-provider.js";
import { makeCompositeRule } from "../testing/fixtures.js";

const FIXTURE_DIR = resolve(import.meta.dirname, "../testing/composite");

function fixture(name: string, fileKind: string): CompositeFile {
  return {
    path: `src/testing/composite/${name}`,
    content: readFileSync(resolve(FIXTURE_DIR, name), "utf8"),
    fileKind,
  };
}

const FILES: CompositeFile[] = [
  fixture("repo-wide.copilot-instructions.md", "repo-wide"),
  fixture("scoped.instructions.md", "scoped"),
];

function makeProvider(completeImpl: AiProvider["complete"]) {
  const complete = vi.fn<AiProvider["complete"]>(completeImpl);
  return { provider: { complete } satisfies AiProvider, complete };
}

function twoFileFinding(overrides: Record<string, unknown> = {}) {
  return {
    summary: "Tabs vs. spaces",
    rationale: "One file requires tabs, the other forbids them.",
    evidence: [
      { fileId: "f1", line: 6, excerpt: "Use tabs for indentation" },
      { fileId: "f2", line: 8, excerpt: "Indent with two spaces, never tabs" },
    ],
    ...overrides,
  };
}

describe("buildCompositeRequest", () => {
  it("labels every file with an id, path and kind, and states the rule and the limit", () => {
    const rule = makeCompositeRule({ id: "composite.x", question: "Do they conflict?" });
    const request = buildCompositeRequest({ rule, files: FILES });

    expect(request.system).toContain("several instruction files");
    expect(request.user).toContain("Rule: composite.x");
    expect(request.user).toContain("Do they conflict?");
    expect(request.user).toContain(`Return at most ${rule.maxFindings} findings`);
    expect(request.user).toContain("Files: 2");
    expect(request.user).toContain(
      "--- file id: f1, path: src/testing/composite/repo-wide.copilot-instructions.md, kind: repo-wide ---",
    );
    expect(request.user).toContain(
      "--- file id: f2, path: src/testing/composite/scoped.instructions.md, kind: scoped ---",
    );
    expect(request.user).toContain("Use tabs for indentation");
    expect(request.user).toContain("Indent with two spaces");
    expect(request.user).not.toContain("Retry note:");
  });

  it("appends a retry note when one is given", () => {
    const request = buildCompositeRequest({
      rule: makeCompositeRule(),
      files: FILES,
      retryReason: 'The response field "findings" was missing.',
    });

    expect(request.user).toContain("Retry note:");
    expect(request.user).toContain('The response field "findings" was missing.');
  });

  it("pins the full prompt for the real contradiction rule over the fixtures", () => {
    // The composite counterpart of the golden tests: a change to
    // config/composite.json's question or limits shows up here as a diff.
    const rules = loadCompositeRules();
    const rule = rules.rules.find((entry) => entry.id === "composite.contradictions");
    expect(rule).toBeDefined();

    const request = buildCompositeRequest({ rule: rule!, files: FILES });
    expect(`${request.system}\n\n${request.user}`).toMatchSnapshot();
  });
});

describe("runContradictionRule", () => {
  it("maps file ids back to paths and stamps rule policy onto each finding", async () => {
    const rule = makeCompositeRule({ id: "composite.x", severity: "info", fix: "Pick one." });
    const { provider, complete } = makeProvider(async () => ({
      output: { findings: [twoFileFinding()] },
      usage: { inputTokens: 100, outputTokens: 20 },
    }));

    const result = await runContradictionRule({ rule, files: FILES, provider });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.error).toBeUndefined();
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(result.findings).toEqual([
      {
        ruleId: "composite.x",
        severity: "info",
        summary: "Tabs vs. spaces",
        rationale: "One file requires tabs, the other forbids them.",
        fix: "Pick one.",
        evidence: [
          {
            file: "src/testing/composite/repo-wide.copilot-instructions.md",
            line: 6,
            excerpt: "Use tabs for indentation",
          },
          {
            file: "src/testing/composite/scoped.instructions.md",
            line: 8,
            excerpt: "Indent with two spaces, never tabs",
          },
        ],
      },
    ]);
  });

  it("treats an empty findings array as a successful, clean review", async () => {
    const { provider, complete } = makeProvider(async () => ({ output: { findings: [] } }));

    const result = await runContradictionRule({
      rule: makeCompositeRule(),
      files: FILES,
      provider,
    });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ findings: [], usage: undefined });
  });

  it("drops evidence with unknown file ids and findings left with fewer than two files", async () => {
    const { provider } = makeProvider(async () => ({
      output: {
        findings: [
          twoFileFinding({
            evidence: [
              { fileId: "f1", excerpt: "a" },
              { fileId: "f9", excerpt: "invented" },
            ],
          }),
          twoFileFinding({
            evidence: [
              { fileId: "f1", excerpt: "a" },
              { fileId: "f1", excerpt: "same file twice" },
            ],
          }),
          twoFileFinding({ summary: "kept" }),
        ],
      },
    }));

    const result = await runContradictionRule({
      rule: makeCompositeRule(),
      files: FILES,
      provider,
    });

    expect(result.findings.map((finding) => finding.summary)).toEqual(["kept"]);
  });

  it("caps the findings at the rule's maxFindings", async () => {
    const { provider } = makeProvider(async () => ({
      output: { findings: [twoFileFinding({ summary: "1" }), twoFileFinding({ summary: "2" })] },
    }));

    const result = await runContradictionRule({
      rule: makeCompositeRule({ maxFindings: 1 }),
      files: FILES,
      provider,
    });

    expect(result.findings.map((finding) => finding.summary)).toEqual(["1"]);
  });

  it("retries once on an invalid response, then gives up with an error and summed usage", async () => {
    const { provider, complete } = makeProvider(async () => ({
      output: { findings: [{ summary: "no evidence" }] },
      usage: { inputTokens: 10, outputTokens: 1 },
    }));

    const result = await runContradictionRule({
      rule: makeCompositeRule({ id: "composite.x" }),
      files: FILES,
      provider,
    });

    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]![0].user).toContain("Retry note:");
    expect(result.findings).toEqual([]);
    expect(result.error).toMatch(/^Rule "composite.x": AI response was invalid after one retry/);
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 2 });
  });

  it("recovers when the retry succeeds", async () => {
    let calls = 0;
    const { provider, complete } = makeProvider(async () => {
      calls += 1;
      return calls === 1
        ? { output: { nope: true } }
        : { output: { findings: [twoFileFinding()] } };
    });

    const result = await runContradictionRule({
      rule: makeCompositeRule(),
      files: FILES,
      provider,
    });

    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.error).toBeUndefined();
    expect(result.findings).toHaveLength(1);
  });

  it("does not retry an API error", async () => {
    const { provider, complete } = makeProvider(async () => {
      throw new Error("rate limited");
    });

    const result = await runContradictionRule({
      rule: makeCompositeRule({ id: "composite.x" }),
      files: FILES,
      provider,
    });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      findings: [],
      error: 'Rule "composite.x" failed: rate limited',
      usage: undefined,
    });
  });
});
