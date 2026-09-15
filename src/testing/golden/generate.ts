/**
 * Sifty — regenerates the golden `expected/*.json` files.
 *
 * Run after a deliberate change to a golden fixture, to `config/copilot.json`,
 * or to scoring/measure logic that is meant to move these numbers. NOT part
 * of the test run and NOT part of the build (excluded via tsconfig.build.json
 * `src/testing/**`).
 *
 * Usage: npx tsx src/testing/golden/generate.ts
 *
 * Review the diff by hand before committing — this script proves the numbers
 * are reproducible, it does not decide whether they are correct.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { analyzeContent } from "../../engine/runner.js";
import type { AiFinding } from "../../report.types.js";

const GOLDEN_DIR = resolve(process.cwd(), "src/testing/golden");
const PRESETS = ["balanced", "cost", "security"];

/** Kept in sync with src/engine/golden.test.ts — same fixed findings, same file. */
const AI_FINDINGS: AiFinding[] = [
  { checkId: "clarity.concrete-instructions", score: 70, rationale: "synthetic" },
  { checkId: "clarity.contradictions", score: 90, rationale: "synthetic" },
  { checkId: "completeness.project-context", score: 60, rationale: "synthetic" },
  { checkId: "completeness.scope-statement", score: 80, rationale: "synthetic" },
  { checkId: "completeness.output-constraint-sensible", score: 75, rationale: "synthetic" },
];

const FIXTURES: { file: string; virtualPath: string; expectedFile: string }[] = [
  {
    file: "good.instructions.md",
    virtualPath: "example.instructions.md",
    expectedFile: "expected/good.json",
  },
  {
    file: "repo-wide.copilot-instructions.md",
    virtualPath: ".github/copilot-instructions.md",
    expectedFile: "expected/repo-wide.json",
  },
  {
    file: "blocker.instructions.md",
    virtualPath: "blocker.instructions.md",
    expectedFile: "expected/blocker.json",
  },
];

async function main() {
  for (const fixture of FIXTURES) {
    const raw = readFileSync(resolve(GOLDEN_DIR, fixture.file), "utf8");
    const entries = [];

    for (const preset of PRESETS) {
      for (const withAi of [false, true]) {
        const result = await analyzeContent(fixture.virtualPath, raw, {
          tool: "copilot",
          preset,
          ...(withAi ? { aiFindings: AI_FINDINGS } : {}),
        });
        const report = result.report;

        entries.push({
          preset,
          withAi,
          overallScore: report.overallScore,
          ...(report.cappedFrom !== undefined ? { cappedFrom: report.cappedFrom } : {}),
          grade: report.grade,
          axisScores: report.axisScores.map((a) => ({
            axis: a.axis,
            score: a.score,
            checkCount: a.checkCount,
            totalChecks: a.totalChecks,
          })),
          blockers: report.blockers.map((b) => b.checkId),
          fixes: report.fixes.map((f) => f.checkId),
          fileKind: report.fileKind,
        });
      }
    }

    const outPath = resolve(GOLDEN_DIR, fixture.expectedFile);
    writeFileSync(outPath, JSON.stringify(entries, null, 2) + "\n");
    console.log(`wrote ${fixture.expectedFile} (${entries.length} entries)`);
  }
}

await main();
