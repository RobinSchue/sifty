import { describe, expect, it, vi } from "vitest";

import { type CompositeFile, reviewComposite } from "./review.js";
import type { CompositeFinding } from "./types.js";
import type { AiProvider } from "../engine/ai-provider.js";
import { makeCompositeRule, makeCompositeRules } from "../testing/fixtures.js";

const FILES: CompositeFile[] = [
  { path: "a.md", content: "- Use tabs.\n", fileKind: "repo-wide" },
  { path: "b.md", content: "- Never tabs.\n", fileKind: "scoped" },
];

const SECRET_PATTERNS = [{ id: "openai-key", re: "sk-[A-Za-z0-9]{20,}", hint: "OpenAI key" }];

function makeProvider(completeImpl: AiProvider["complete"]) {
  const complete = vi.fn<AiProvider["complete"]>(completeImpl);
  return { provider: { complete } satisfies AiProvider, complete };
}

function modelFinding(excerpt = "Use tabs.") {
  return {
    summary: "Tabs",
    rationale: "Conflict.",
    evidence: [
      { fileId: "f1", line: 1, excerpt },
      { fileId: "f2", line: 1, excerpt: "Never tabs." },
    ],
  };
}

function finding(overrides: Partial<CompositeFinding> = {}): CompositeFinding {
  return {
    ruleId: "composite.example",
    severity: "warn",
    summary: "Tabs",
    rationale: "Conflict.",
    fix: "fix for composite.example",
    evidence: [
      { file: "a.md", line: 1, excerpt: "Use tabs." },
      { file: "b.md", line: 1, excerpt: "Never tabs." },
    ],
    ...overrides,
  };
}

describe("reviewComposite", () => {
  it("runs every applicable rule through the provider and returns its findings", async () => {
    const { provider, complete } = makeProvider(async () => ({
      output: { findings: [modelFinding()] },
      usage: { inputTokens: 50, outputTokens: 5 },
    }));

    const result = await reviewComposite(FILES, { rules: makeCompositeRules(), provider });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(result).toMatchSnapshot();
  });

  it("reports an error and makes no call when no provider is given", async () => {
    const result = await reviewComposite(FILES, { rules: makeCompositeRules() });

    expect(result.error).toBe("Composite review requires an AI provider.");
    expect(result.review.findings).toEqual([]);
    expect(result.review.ruleIds).toEqual(["composite.example"]);
  });

  it("uses injected findings instead of calling the provider", async () => {
    const { provider, complete } = makeProvider(async () => ({ output: { findings: [] } }));

    const result = await reviewComposite(FILES, {
      rules: makeCompositeRules(),
      provider,
      findings: [finding()],
    });

    expect(complete).not.toHaveBeenCalled();
    expect(result.review.findings).toEqual([finding()]);
  });

  it("leaves out a rule whose minFiles is not met and makes no call for it", async () => {
    const { provider, complete } = makeProvider(async () => ({ output: { findings: [] } }));
    const rules = makeCompositeRules({ rules: [makeCompositeRule({ minFiles: 3 })] });

    const result = await reviewComposite(FILES, { rules, provider });

    expect(complete).not.toHaveBeenCalled();
    expect(result.review.ruleIds).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it("redacts secrets the model quoted, in every finding, before they reach the review", async () => {
    const { provider } = makeProvider(async () => ({
      output: { findings: [modelFinding("token sk-abcdefghijklmnopqrstuvwxyz here")] },
    }));

    const result = await reviewComposite(FILES, {
      rules: makeCompositeRules(),
      provider,
      redactPatterns: SECRET_PATTERNS,
    });

    const excerpt = result.review.findings[0]!.evidence[0]!.excerpt!;
    expect(excerpt).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(excerpt).toMatch(/sk-a/);
    expect(result.review.findings[0]!.evidence[0]!.file).toBe("a.md");
  });

  it("also redacts injected findings", async () => {
    const result = await reviewComposite(FILES, {
      rules: makeCompositeRules(),
      findings: [
        finding({
          evidence: [
            { file: "a.md", excerpt: "sk-abcdefghijklmnopqrstuvwxyz" },
            { file: "b.md", excerpt: "clean" },
          ],
        }),
      ],
      redactPatterns: SECRET_PATTERNS,
    });

    expect(result.review.findings[0]!.evidence[0]!.excerpt).not.toContain(
      "sk-abcdefghijklmnopqrstuvwxyz",
    );
  });

  it("leaves excerpts untouched when there are no redaction patterns", async () => {
    const result = await reviewComposite(FILES, {
      rules: makeCompositeRules(),
      findings: [finding()],
      redactPatterns: [],
    });

    expect(result.review.findings[0]!.evidence[0]!.excerpt).toBe("Use tabs.");
  });

  it("refuses an over-budget input without calling the provider", async () => {
    const { provider, complete } = makeProvider(async () => ({ output: { findings: [] } }));
    const rules = makeCompositeRules({
      rules: [makeCompositeRule({ id: "composite.x", maxInputChars: 10 })],
    });

    const result = await reviewComposite(FILES, { rules, provider });

    expect(complete).not.toHaveBeenCalled();
    expect(result.review.ruleIds).toEqual(["composite.x"]);
    expect(result.error).toMatch(/^Rule "composite.x" skipped: input is ≈\d+ tokens/);
    expect(result.error).toContain("pass fewer files");
  });

  it("sums usage and joins errors across rules", async () => {
    let calls = 0;
    const { provider } = makeProvider(async () => {
      calls += 1;
      if (calls === 2) throw new Error("boom");
      return { output: { findings: [] }, usage: { inputTokens: 7, outputTokens: 1 } };
    });
    const rules = makeCompositeRules({
      rules: [makeCompositeRule({ id: "composite.a" }), makeCompositeRule({ id: "composite.b" })],
    });

    const result = await reviewComposite(FILES, { rules, provider });

    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 1 });
    expect(result.error).toBe('Rule "composite.b" failed: boom');
    expect(result.review.ruleIds).toEqual(["composite.a", "composite.b"]);
  });
});
