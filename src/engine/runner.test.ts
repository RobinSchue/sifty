import { describe, expect, it, vi } from "vitest";

import type { Check } from "../criteria/types.js";
import { makeCheck, makeConfig, makePreset } from "../testing/fixtures.js";
import type { AiProvider } from "./ai-provider.js";
import { analyze, pendingAiChecks, runMechanicalChecks, validatePreset } from "./runner.js";
import { prepareFile } from "./text.js";

function makeAiCheck(id: string, question = `Question for ${id}?`): Check {
  return {
    id,
    axis: "clarity",
    label: id,
    weight: 1,
    mode: "ai",
    appliesTo: [],
    scoring: { type: "ai" },
    fix: `Fix ${id}`,
    question,
  };
}

function makeProvider(completeImpl: AiProvider["complete"]) {
  const complete = vi.fn<AiProvider["complete"]>(completeImpl);
  return { provider: { complete } satisfies AiProvider, complete };
}

describe("runMechanicalChecks", () => {
  it("runs applicable mechanical checks and collects measurements", () => {
    const config = makeConfig({
      checks: [makeCheck({ id: "clarity.frontmatter", measure: { type: "frontmatterValid" } })],
    });
    const ctx = prepareFile("a.md", "---\napplyTo: '**'\n---\nbody\n");

    const { measurements, failures } = runMechanicalChecks(config, ctx, "scoped");

    expect(measurements).toHaveLength(1);
    expect(measurements[0]?.checkId).toBe("clarity.frontmatter");
    expect(failures).toHaveLength(0);
  });

  it("skips a check that does not apply to this file kind", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "clarity.frontmatter",
          measure: { type: "frontmatterValid" },
          appliesTo: ["repo-wide"],
        }),
      ],
    });
    const ctx = prepareFile("a.md", "---\napplyTo: '**'\n---\nbody\n");

    const { measurements } = runMechanicalChecks(config, ctx, "scoped");
    expect(measurements).toHaveLength(0);
  });

  it("records a failure and marks the check not applicable when a measure throws", () => {
    const config = makeConfig({
      words: {}, // deliberately missing the referenced word set
      checks: [
        makeCheck({
          id: "clarity.density",
          measure: { type: "wordDensity", params: { wordSet: "does-not-exist" } },
        }),
      ],
    });
    const ctx = prepareFile("a.md", "---\napplyTo: '**'\n---\nsome prose here\n");

    const { measurements, failures } = runMechanicalChecks(config, ctx, "scoped");

    expect(failures).toHaveLength(1);
    expect(failures[0]?.checkId).toBe("clarity.density");
    expect(measurements[0]).toEqual({ checkId: "clarity.density", applicable: false });
  });

  it("reports an unimplemented measure type as a failure without throwing", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "clarity.unknown",
          // @ts-expect-error deliberately invalid for the test
          measure: { type: "notARealMeasure" },
        }),
      ],
    });
    const ctx = prepareFile("a.md", "---\napplyTo: '**'\n---\nbody\n");

    const { failures } = runMechanicalChecks(config, ctx, "scoped");
    expect(failures[0]?.message).toContain("no implementation for measure");
  });
});

describe("analyze", () => {
  it("wires measurements through to real check scores from a config object", async () => {
    const config = makeConfig({
      checks: [makeCheck({ id: "clarity.frontmatter", measure: { type: "frontmatterValid" } })],
    });

    const result = await analyze(
      { path: "a.instructions.md", content: "---\napplyTo: '**'\n---\nbody\n" },
      { config },
    );

    expect(result.report.checkScores).toHaveLength(1);
    expect(result.report.checkScores[0]?.score).toBe(100);
    expect(result.failures).toHaveLength(0);
  });
});

describe("analyze with ai checks", () => {
  const FILE_CONTENT = "---\napplyTo: '**'\n---\nbody\n";

  function configWith(checks: Check[]) {
    return makeConfig({ checks });
  }

  it("merges mechanical and AI scores into one report", async () => {
    const config = configWith([
      makeCheck({ id: "clarity.frontmatter", measure: { type: "frontmatterValid" } }),
      makeAiCheck("clarity.concrete"),
    ]);
    const { provider, complete } = makeProvider(async () => ({
      output: {
        findings: [{ checkId: "clarity.concrete", score: 50, rationale: "Vague." }],
      },
      usage: { inputTokens: 42, outputTokens: 7 },
    }));

    const result = await analyze(
      { path: "a.instructions.md", content: FILE_CONTENT },
      { config, provider },
    );

    expect(complete).toHaveBeenCalledTimes(1);
    const request = complete.mock.calls[0]?.[0];
    expect(request?.user).toContain("clarity.concrete");
    expect(request?.user).toContain("body");
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 7 });

    expect(result.report.checkScores).toContainEqual(
      expect.objectContaining({
        checkId: "clarity.concrete",
        source: "ai",
        applicable: true,
        score: 50,
      }),
    );
    expect(result.report.checkScores).toContainEqual(
      expect.objectContaining({
        checkId: "clarity.frontmatter",
        source: "mechanical",
        score: 100,
      }),
    );

    const clarityAxis = result.report.axisScores.find((a) => a.axis === "clarity");
    expect(clarityAxis?.score).toBe(75);
    expect(clarityAxis?.checkCount).toBe(2);

    expect(result.aiError).toBeUndefined();
    expect(result.report.aiFindings).toHaveLength(1);
  });

  it("makes no AI call when no provider is set", async () => {
    const config = configWith([
      makeCheck({ id: "clarity.frontmatter", measure: { type: "frontmatterValid" } }),
      makeAiCheck("clarity.concrete"),
    ]);

    const result = await analyze({ path: "a.instructions.md", content: FILE_CONTENT }, { config });

    const aiScore = result.report.checkScores.find((c) => c.checkId === "clarity.concrete");
    expect(aiScore?.applicable).toBe(false);
    expect(result.report.aiFindings).toEqual([]);
  });

  it("prefers pre-computed aiFindings over calling the provider", async () => {
    const config = configWith([
      makeCheck({ id: "clarity.frontmatter", measure: { type: "frontmatterValid" } }),
      makeAiCheck("clarity.concrete"),
    ]);
    const { provider, complete } = makeProvider(async () => ({
      output: {
        findings: [{ checkId: "clarity.concrete", score: 50, rationale: "Vague." }],
      },
    }));

    const result = await analyze(
      { path: "a.instructions.md", content: FILE_CONTENT },
      {
        config,
        aiFindings: [{ checkId: "clarity.concrete", score: 80, rationale: "ok" }],
        provider,
      },
    );

    expect(complete).not.toHaveBeenCalled();
    const aiScore = result.report.checkScores.find((c) => c.checkId === "clarity.concrete");
    expect(aiScore?.score).toBe(80);
  });

  it("degrades to mechanical-only scoring when the provider throws", async () => {
    const config = configWith([
      makeCheck({ id: "clarity.frontmatter", measure: { type: "frontmatterValid" } }),
      makeAiCheck("clarity.concrete"),
    ]);
    const { provider } = makeProvider(async () => {
      throw new Error("401 unauthorized");
    });

    const result = await analyze(
      { path: "a.instructions.md", content: FILE_CONTENT },
      { config, provider },
    );

    expect(result.aiError).toMatch(/401 unauthorized/);
    expect(result.report.checkScores).toContainEqual(
      expect.objectContaining({
        checkId: "clarity.frontmatter",
        source: "mechanical",
        score: 100,
      }),
    );
    const aiScore = result.report.checkScores.find((c) => c.checkId === "clarity.concrete");
    expect(aiScore?.applicable).toBe(false);
    expect(result.report.aiFindings).toEqual([]);
  });

  it("makes no AI call when the config has no ai-mode checks", async () => {
    const config = configWith([
      makeCheck({ id: "clarity.frontmatter", measure: { type: "frontmatterValid" } }),
    ]);
    const { provider, complete } = makeProvider(async () => ({
      output: { findings: [] },
    }));

    const result = await analyze(
      { path: "a.instructions.md", content: FILE_CONTENT },
      { config, provider },
    );

    expect(complete).not.toHaveBeenCalled();
    expect(result.aiError).toBeUndefined();
  });
});

describe("validatePreset", () => {
  it("accepts a preset that exists on the config", () => {
    const config = makeConfig({ presets: { balanced: makePreset(), cost: makePreset() } });
    expect(() => validatePreset(config, "cost")).not.toThrow();
  });

  it("throws for an unknown preset, listing the known ones", () => {
    const config = makeConfig({ presets: { balanced: makePreset(), cost: makePreset() } });
    expect(() => validatePreset(config, "bogus")).toThrow(/Unknown preset "bogus".*balanced, cost/);
  });
});

describe("analyze with an unknown preset", () => {
  it("rejects the run instead of silently scoring with the default preset's weights", async () => {
    const config = makeConfig({
      checks: [makeCheck({ id: "clarity.frontmatter", measure: { type: "frontmatterValid" } })],
    });

    await expect(
      analyze(
        { path: "a.instructions.md", content: "---\napplyTo: '**'\n---\nbody\n" },
        { config, preset: "bogus" },
      ),
    ).rejects.toThrow(/Unknown preset "bogus"/);
  });
});

describe("pendingAiChecks", () => {
  it("returns only ai-mode checks that apply to the file kind", () => {
    const config = makeConfig({
      checks: [
        makeCheck({ id: "clarity.mechanical", measure: { type: "frontmatterValid" } }),
        {
          id: "clarity.ai-general",
          axis: "clarity",
          label: "General AI check",
          weight: 1,
          mode: "ai",
          appliesTo: [],
          scoring: { type: "ai" },
          fix: "fix it",
          question: "Q?",
        },
        {
          id: "clarity.ai-repo-only",
          axis: "clarity",
          label: "Repo-only AI check",
          weight: 1,
          mode: "ai",
          appliesTo: ["repo-wide"],
          scoring: { type: "ai" },
          fix: "fix it",
          question: "Q?",
        },
      ],
    });

    const pending = pendingAiChecks(config, "scoped");
    const ids = pending.map((c) => c.id);

    expect(ids).toContain("clarity.ai-general");
    expect(ids).not.toContain("clarity.ai-repo-only");
    expect(ids).not.toContain("clarity.mechanical");
  });
});
