import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AiClient } from "./ai.js";
import { analyzeContent, analyzeFile, pendingAiChecks, runMechanicalChecks } from "./runner.js";
import { prepareFile } from "./text.js";
import type { Check } from "../criteria.types.js";
import { makeCheck, makeConfig } from "../testing/fixtures.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeTempTree(configJson: string, fileName: string, fileContent: string) {
  const dir = mkdtempSync(join(tmpdir(), "sifty-runner-"));
  tempDirs.push(dir);
  const configPath = join(dir, "tool.json");
  writeFileSync(configPath, configJson);
  const filePath = join(dir, fileName);
  writeFileSync(filePath, fileContent);
  return { configPath, filePath };
}

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

describe("analyzeContent", () => {
  it("wires measurements through to real check scores via a temp config file", async () => {
    const config = makeConfig({
      checks: [makeCheck({ id: "clarity.frontmatter", measure: { type: "frontmatterValid" } })],
    });
    const { configPath } = writeTempTree(JSON.stringify(config), "a.instructions.md", "irrelevant");

    const result = await analyzeContent("a.md", "---\napplyTo: '**'\n---\nbody\n", {
      tool: "ignored",
      configPath,
    });

    expect(result.report.checkScores).toHaveLength(1);
    expect(result.report.checkScores[0]?.score).toBe(100);
    expect(result.failures).toHaveLength(0);
  });
});

describe("analyzeContent with ai checks", () => {
  const FILE_CONTENT = "---\napplyTo: '**'\n---\nbody\n";

  function tempConfig(checks: Check[]) {
    const config = makeConfig({ checks });
    return writeTempTree(JSON.stringify(config), "a.instructions.md", "irrelevant");
  }

  it("merges mechanical and AI scores into one report", async () => {
    const { configPath } = tempConfig([
      makeCheck({ id: "clarity.frontmatter", measure: { type: "frontmatterValid" } }),
      makeAiCheck("clarity.concrete"),
    ]);
    const { client, parse } = makeClient(async () => ({
      parsed_output: {
        findings: [{ checkId: "clarity.concrete", score: 50, rationale: "Vague." }],
      },
    }));

    const result = await analyzeContent("a.md", FILE_CONTENT, {
      tool: "ignored",
      configPath,
      ai: { client },
    });

    expect(parse).toHaveBeenCalledTimes(1);
    const request = parse.mock.calls[0]?.[0];
    const content = String(request?.messages[0]?.content);
    expect(content).toContain("clarity.concrete");
    expect(content).toContain("body");

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

  it("makes no AI call when the ai option is not set", async () => {
    const { configPath } = tempConfig([
      makeCheck({ id: "clarity.frontmatter", measure: { type: "frontmatterValid" } }),
      makeAiCheck("clarity.concrete"),
    ]);

    const result = await analyzeContent("a.md", FILE_CONTENT, {
      tool: "ignored",
      configPath,
    });

    const aiScore = result.report.checkScores.find((c) => c.checkId === "clarity.concrete");
    expect(aiScore?.applicable).toBe(false);
    expect(result.report.aiFindings).toEqual([]);
  });

  it("prefers pre-computed aiFindings over calling the client", async () => {
    const { configPath } = tempConfig([
      makeCheck({ id: "clarity.frontmatter", measure: { type: "frontmatterValid" } }),
      makeAiCheck("clarity.concrete"),
    ]);
    const { client, parse } = makeClient(async () => ({
      parsed_output: {
        findings: [{ checkId: "clarity.concrete", score: 50, rationale: "Vague." }],
      },
    }));

    const result = await analyzeContent("a.md", FILE_CONTENT, {
      tool: "ignored",
      configPath,
      aiFindings: [{ checkId: "clarity.concrete", score: 80, rationale: "ok" }],
      ai: { client },
    });

    expect(parse).not.toHaveBeenCalled();
    const aiScore = result.report.checkScores.find((c) => c.checkId === "clarity.concrete");
    expect(aiScore?.score).toBe(80);
  });

  it("degrades to mechanical-only scoring when the client throws", async () => {
    const { configPath } = tempConfig([
      makeCheck({ id: "clarity.frontmatter", measure: { type: "frontmatterValid" } }),
      makeAiCheck("clarity.concrete"),
    ]);
    const { client } = makeClient(async () => {
      throw new Error("401 unauthorized");
    });

    const result = await analyzeContent("a.md", FILE_CONTENT, {
      tool: "ignored",
      configPath,
      ai: { client },
    });

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
    const { configPath } = tempConfig([
      makeCheck({ id: "clarity.frontmatter", measure: { type: "frontmatterValid" } }),
    ]);
    const { client, parse } = makeClient(async () => ({
      parsed_output: { findings: [] },
    }));

    const result = await analyzeContent("a.md", FILE_CONTENT, {
      tool: "ignored",
      configPath,
      ai: { client },
    });

    expect(parse).not.toHaveBeenCalled();
    expect(result.aiError).toBeUndefined();
  });
});

describe("analyzeFile", () => {
  it("reads the file from disk and analyzes it", async () => {
    const config = makeConfig({
      checks: [makeCheck({ id: "clarity.frontmatter", measure: { type: "frontmatterValid" } })],
    });
    const { configPath, filePath } = writeTempTree(
      JSON.stringify(config),
      "a.instructions.md",
      "---\napplyTo: '**'\n---\nbody\n",
    );

    const result = await analyzeFile(filePath, { tool: "ignored", configPath });

    expect(result.report.file).toBe(filePath);
    expect(result.report.checkScores[0]?.score).toBe(100);
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
