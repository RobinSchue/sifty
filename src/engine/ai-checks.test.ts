import { describe, expect, it, vi } from "vitest";

import type { AiProvider } from "./ai-provider.js";
import { buildAiRequest, runAiChecks } from "./ai-checks.js";
import type { Check } from "../criteria/types.js";

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

describe("buildAiRequest", () => {
  it("builds one prompt covering every check, with no model/transport concerns", () => {
    const request = buildAiRequest({
      checks: [makeAiCheck("clarity.tone"), makeAiCheck("structure.examples")],
      fileContent: "# Title\n\nBody",
      fileKind: "scoped",
      tool: "copilot",
    });

    expect(request.system).toContain("evaluating one AI tool instruction file");
    expect(request.user).toContain("clarity.tone");
    expect(request.user).toContain("structure.examples");
    expect(request.user).toContain("# Title");
    expect(request.user).toContain("Tool: copilot");
    expect(request.user).toContain("File kind: scoped");
  });

  it("appends a retry note when one is given", () => {
    const request = buildAiRequest({
      checks: [makeAiCheck("clarity.tone")],
      fileContent: "body",
      fileKind: "scoped",
      tool: "copilot",
      retryReason: "Missing check ids: clarity.tone.",
    });

    expect(request.user).toContain("Retry note:");
    expect(request.user).toContain("Missing check ids: clarity.tone.");
  });
});

describe("runAiChecks", () => {
  it("returns no findings and makes no provider call when no checks are pending", async () => {
    const { provider, complete } = makeProvider(async () => ({
      output: { findings: [] },
      usage: { inputTokens: 1, outputTokens: 1 },
    }));

    await expect(
      runAiChecks({
        checks: [],
        fileContent: "body",
        fileKind: "scoped",
        tool: "copilot",
        provider,
      }),
    ).resolves.toEqual({ findings: [] });

    expect(complete).not.toHaveBeenCalled();
  });

  it("returns an error, no findings, when no provider is given", async () => {
    const result = await runAiChecks({
      checks: [makeAiCheck("clarity.tone")],
      fileContent: "body",
      fileKind: "scoped",
      tool: "copilot",
    });

    expect(result).toEqual({ findings: [], error: "AI checks require an AI provider." });
  });

  it("returns validated findings from a structured response, plus provider usage", async () => {
    const checks = [makeAiCheck("clarity.tone"), makeAiCheck("structure.examples")];
    const { provider, complete } = makeProvider(async () => ({
      output: {
        findings: [
          {
            checkId: "clarity.tone",
            score: 82,
            rationale: "Mostly clear.",
            evidence: [{ line: 4, excerpt: "Use bullets.", hint: "good example" }],
          },
          {
            checkId: "structure.examples",
            score: 91,
            rationale: "Examples are concrete.",
          },
        ],
      },
      usage: { inputTokens: 500, outputTokens: 120 },
    }));

    const result = await runAiChecks({
      checks,
      fileContent: "body",
      fileKind: "scoped",
      tool: "copilot",
      provider,
    });

    expect(result.error).toBeUndefined();
    expect(result.findings).toEqual([
      {
        checkId: "clarity.tone",
        score: 82,
        rationale: "Mostly clear.",
        evidence: [{ line: 4, excerpt: "Use bullets.", hint: "good example" }],
      },
      {
        checkId: "structure.examples",
        score: 91,
        rationale: "Examples are concrete.",
        evidence: undefined,
      },
    ]);
    expect(result.usage).toEqual({ inputTokens: 500, outputTokens: 120 });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("retries once when the first structured response is malformed", async () => {
    const checks = [makeAiCheck("clarity.tone")];
    const completeImpl = vi
      .fn<AiProvider["complete"]>()
      .mockResolvedValueOnce({ output: { nope: true } })
      .mockResolvedValueOnce({
        output: { findings: [{ checkId: "clarity.tone", score: 77, rationale: "Solid." }] },
      });
    const { provider, complete } = makeProvider(completeImpl);

    const result = await runAiChecks({
      checks,
      fileContent: "body",
      fileKind: "scoped",
      tool: "copilot",
      provider,
    });

    expect(result.findings).toEqual([
      { checkId: "clarity.tone", score: 77, rationale: "Solid.", evidence: undefined },
    ]);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("returns an error when both structured responses are invalid", async () => {
    const checks = [makeAiCheck("clarity.tone")];
    const completeImpl = vi
      .fn<AiProvider["complete"]>()
      .mockResolvedValueOnce({ output: null })
      .mockResolvedValueOnce({ output: 42 });
    const { provider, complete } = makeProvider(completeImpl);

    const result = await runAiChecks({
      checks,
      fileContent: "body",
      fileKind: "scoped",
      tool: "copilot",
      provider,
    });

    expect(result.findings).toEqual([]);
    expect(result.error).toMatch(/invalid after one retry/i);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("returns an error when the provider call rejects", async () => {
    const checks = [makeAiCheck("clarity.tone")];
    const { provider, complete } = makeProvider(async () => {
      throw new Error("401 unauthorized");
    });

    const result = await runAiChecks({
      checks,
      fileContent: "body",
      fileKind: "scoped",
      tool: "copilot",
      provider,
    });

    expect(result).toEqual({ findings: [], error: "AI checks failed: 401 unauthorized" });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("drops unknown check ids from the response", async () => {
    const checks = [makeAiCheck("clarity.tone")];
    const { provider } = makeProvider(async () => ({
      output: {
        findings: [
          { checkId: "clarity.tone", score: 85, rationale: "Good." },
          { checkId: "invented.check", score: 99, rationale: "Ignore me." },
        ],
      },
    }));

    const result = await runAiChecks({
      checks,
      fileContent: "body",
      fileKind: "scoped",
      tool: "copilot",
      provider,
    });

    expect(result.findings).toEqual([
      { checkId: "clarity.tone", score: 85, rationale: "Good.", evidence: undefined },
    ]);
  });

  it("retries once when a response omits one of the requested check ids", async () => {
    const checks = [makeAiCheck("clarity.tone"), makeAiCheck("structure.examples")];
    const completeImpl = vi
      .fn<AiProvider["complete"]>()
      .mockResolvedValueOnce({
        output: { findings: [{ checkId: "clarity.tone", score: 80, rationale: "Fine." }] },
      })
      .mockResolvedValueOnce({
        output: {
          findings: [
            { checkId: "clarity.tone", score: 80, rationale: "Fine." },
            { checkId: "structure.examples", score: 88, rationale: "Present." },
          ],
        },
      });
    const { provider, complete } = makeProvider(completeImpl);

    const result = await runAiChecks({
      checks,
      fileContent: "body",
      fileKind: "scoped",
      tool: "copilot",
      provider,
    });

    expect(result.error).toBeUndefined();
    expect(result.findings).toHaveLength(2);
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
