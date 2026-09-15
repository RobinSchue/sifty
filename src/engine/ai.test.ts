import { describe, expect, it, vi } from "vitest";

import { AI_MODEL, buildAiRequest, runAiChecks, generateFixPrompt } from "./ai.js";
import type { Check } from "../criteria.types.js";
import type { AiClient } from "./ai.js";

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

function makeClient(parseImpl: AiClient["messages"]["parse"]) {
  const parse = vi.fn<AiClient["messages"]["parse"]>(parseImpl);
  return {
    client: {
      messages: { parse },
    } satisfies AiClient,
    parse,
  };
}

describe("buildAiRequest", () => {
  it("builds one structured request covering every check", () => {
    const request = buildAiRequest({
      checks: [makeAiCheck("clarity.tone"), makeAiCheck("structure.examples")],
      fileContent: "# Title\n\nBody",
      fileKind: "scoped",
      tool: "copilot",
    });

    expect(request.model).toBe(AI_MODEL);
    expect(request.messages[0]?.role).toBe("user");
    expect(String(request.messages[0]?.content)).toContain("clarity.tone");
    expect(String(request.messages[0]?.content)).toContain("structure.examples");
    expect(String(request.messages[0]?.content)).toContain("# Title");
    expect(request.output_config?.format?.type).toBe("json_schema");
  });
});

describe("runAiChecks", () => {
  it("returns no findings and makes no API call when no checks are pending", async () => {
    const { client, parse } = makeClient(async () => ({ parsed_output: { findings: [] } }));

    await expect(
      runAiChecks({
        checks: [],
        fileContent: "body",
        fileKind: "scoped",
        tool: "copilot",
        client,
      }),
    ).resolves.toEqual({ findings: [] });

    expect(parse).not.toHaveBeenCalled();
  });

  it("returns validated findings from a structured response", async () => {
    const checks = [makeAiCheck("clarity.tone"), makeAiCheck("structure.examples")];
    const { client, parse } = makeClient(async () => ({
      parsed_output: {
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
    }));

    const result = await runAiChecks({
      checks,
      fileContent: "body",
      fileKind: "scoped",
      tool: "copilot",
      client,
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
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("retries once when the first structured response is malformed", async () => {
    const checks = [makeAiCheck("clarity.tone")];
    const parseImpl = vi
      .fn<AiClient["messages"]["parse"]>()
      .mockResolvedValueOnce({ parsed_output: { nope: true } })
      .mockResolvedValueOnce({
        parsed_output: { findings: [{ checkId: "clarity.tone", score: 77, rationale: "Solid." }] },
      });
    const { client, parse } = makeClient(parseImpl);

    const result = await runAiChecks({
      checks,
      fileContent: "body",
      fileKind: "scoped",
      tool: "copilot",
      client,
    });

    expect(result).toEqual({
      findings: [{ checkId: "clarity.tone", score: 77, rationale: "Solid.", evidence: undefined }],
    });
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("returns an error when both structured responses are invalid", async () => {
    const checks = [makeAiCheck("clarity.tone")];
    const parseImpl = vi
      .fn<AiClient["messages"]["parse"]>()
      .mockResolvedValueOnce({ parsed_output: null })
      .mockResolvedValueOnce({ parsed_output: 42 });
    const { client, parse } = makeClient(parseImpl);

    const result = await runAiChecks({
      checks,
      fileContent: "body",
      fileKind: "scoped",
      tool: "copilot",
      client,
    });

    expect(result.findings).toEqual([]);
    expect(result.error).toMatch(/invalid after one retry/i);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("returns an error when the API call rejects", async () => {
    const checks = [makeAiCheck("clarity.tone")];
    const { client, parse } = makeClient(async () => {
      throw new Error("401 unauthorized");
    });

    const result = await runAiChecks({
      checks,
      fileContent: "body",
      fileKind: "scoped",
      tool: "copilot",
      client,
    });

    expect(result).toEqual({ findings: [], error: "AI checks failed: 401 unauthorized" });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("drops unknown check ids from the response", async () => {
    const checks = [makeAiCheck("clarity.tone")];
    const { client } = makeClient(async () => ({
      parsed_output: {
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
      client,
    });

    expect(result.findings).toEqual([
      { checkId: "clarity.tone", score: 85, rationale: "Good.", evidence: undefined },
    ]);
  });

  it("retries once when a response omits one of the requested check ids", async () => {
    const checks = [makeAiCheck("clarity.tone"), makeAiCheck("structure.examples")];
    const parseImpl = vi
      .fn<AiClient["messages"]["parse"]>()
      .mockResolvedValueOnce({
        parsed_output: { findings: [{ checkId: "clarity.tone", score: 80, rationale: "Fine." }] },
      })
      .mockResolvedValueOnce({
        parsed_output: {
          findings: [
            { checkId: "clarity.tone", score: 80, rationale: "Fine." },
            { checkId: "structure.examples", score: 88, rationale: "Present." },
          ],
        },
      });
    const { client, parse } = makeClient(parseImpl);

    const result = await runAiChecks({
      checks,
      fileContent: "body",
      fileKind: "scoped",
      tool: "copilot",
      client,
    });

    expect(result.error).toBeUndefined();
    expect(result.findings).toHaveLength(2);
    expect(parse).toHaveBeenCalledTimes(2);
  });
});

describe("generateFixPrompt", () => {
  it("returns empty prompts when there are no fixes", async () => {
    const { short, full, error } = await generateFixPrompt({
      report: { fixes: [] },
      fileContent: "body",
      fileKind: "scoped",
      tool: "copilot",
      client: makeClient(async () => ({ parsed_output: {} })).client,
    });

    expect(short).toBe("");
    expect(full).toBe("");
    expect(error).toBeUndefined();
  });

  it("generates fix prompts from a structured response", async () => {
    const { client, parse } = makeClient(async () => ({
      parsed_output: {
        short: "Issue 1: vague. Issue 2: lacks examples. Please fix.",
        full: "Here is your file: [...]. Problems: 1) vague. 2) lacks examples. Improve clarity and add examples.",
      },
    }));

    const { short, full, error } = await generateFixPrompt({
      report: { fixes: [{ text: "Add examples", impact: 50 }] },
      fileContent: "# Title\nbody",
      fileKind: "scoped",
      tool: "copilot",
      client,
    });

    expect(parse).toHaveBeenCalledOnce();
    expect(short).toContain("vague");
    expect(full).toContain("Problems");
    expect(error).toBeUndefined();
  });

  it("sends the full file content, not a truncated excerpt (regression)", async () => {
    const longContent = `# Title\n${"word ".repeat(200)}`; // > 500 chars
    expect(longContent.length).toBeGreaterThan(500);

    const { client, parse } = makeClient(async () => ({
      parsed_output: { short: "s", full: "f" },
    }));

    await generateFixPrompt({
      report: { fixes: [{ text: "Fix this", impact: 10 }] },
      fileContent: longContent,
      fileKind: "scoped",
      tool: "copilot",
      client,
    });

    const request = parse.mock.calls[0]?.[0];
    const sentContent = String(request?.messages[0]?.content);
    expect(sentContent).toContain(longContent);
    expect(sentContent).not.toContain("...\n```");
  });

  it("returns error when client throws", async () => {
    const { client } = makeClient(async () => {
      throw new Error("503 Service Unavailable");
    });

    const { short, full, error } = await generateFixPrompt({
      report: { fixes: [{ text: "Fix this", impact: 100 }] },
      fileContent: "body",
      fileKind: "scoped",
      tool: "copilot",
      client,
    });

    expect(short).toBe("");
    expect(full).toBe("");
    expect(error).toContain("503");
  });
});
