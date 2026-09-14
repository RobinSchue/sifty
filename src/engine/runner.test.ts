import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { analyzeContent, analyzeFile, pendingAiChecks, runMechanicalChecks } from "./runner.js";
import { prepareFile } from "./text.js";
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
