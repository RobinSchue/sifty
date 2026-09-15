/**
 * Sifty — golden tests (safety net).
 *
 * Pins the reported score for three representative files against the REAL
 * `config/copilot.json` — no synthetic `CriteriaConfig` fixture in this file.
 * If a change to `measures.ts`, `scoring.ts`, `text.ts`, or `config/copilot.json`
 * moves a score, one of these tests goes red. That is the point: nothing
 * else in the suite loads the real criteria file.
 *
 * Three variants per preset:
 *  (a) mechanical only (no AI findings)
 *  (b) mechanical + a fixed set of AiFinding objects passed in directly
 *  (c) mechanical + the same findings returned by a fake AiProvider — proves
 *      the AI wiring (prompt → parse → validate → merge) reproduces (b)
 *
 * Expected values live in `../testing/golden/expected/*.json`, generated
 * from a real `analyze()` run by `../testing/golden/generate.ts` and
 * reviewed by hand, not hand-calculated. Re-run that script and diff the
 * JSON after any deliberate change to scores.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadCriteria } from "../criteria/load.js";
import type { AiFinding, Report } from "../report.types.js";
import type { AiProvider } from "./ai-provider.js";
import { measures } from "./measures.js";
import { analyze } from "./runner.js";

const GOLDEN_DIR = resolve(process.cwd(), "src/testing/golden");
const CONFIG = loadCriteria("copilot", undefined, { measureTypes: Object.keys(measures) });

/** Fixed, synthetic AI findings — same values whether passed directly or via a fake client. */
const AI_FINDINGS: AiFinding[] = [
  { checkId: "clarity.concrete-instructions", score: 70, rationale: "synthetic" },
  { checkId: "clarity.contradictions", score: 90, rationale: "synthetic" },
  { checkId: "completeness.project-context", score: 60, rationale: "synthetic" },
  { checkId: "completeness.scope-statement", score: 80, rationale: "synthetic" },
  { checkId: "completeness.output-constraint-sensible", score: 75, rationale: "synthetic" },
];

interface ExpectedEntry {
  preset: string;
  withAi: boolean;
  overallScore: number;
  cappedFrom?: number;
  grade: { label: string; color: string };
  axisScores: { axis: string; score: number; checkCount: number; totalChecks: number }[];
  blockers: string[];
  fixes: string[];
  fileKind: string;
}

interface Fixture {
  name: string;
  /** File on disk under src/testing/golden/. */
  file: string;
  /** Path handed to analyze() — only used for file-kind detection and report.file. */
  virtualPath: string;
  expectedFile: string;
}

const FIXTURES: Fixture[] = [
  {
    name: "good (scoped, no violations)",
    file: "good.instructions.md",
    virtualPath: "example.instructions.md",
    expectedFile: "expected/good.json",
  },
  {
    name: "repo-wide (copilot-instructions.md)",
    file: "repo-wide.copilot-instructions.md",
    virtualPath: ".github/copilot-instructions.md",
    expectedFile: "expected/repo-wide.json",
  },
  {
    name: "blocker (secret + internal host)",
    file: "blocker.instructions.md",
    virtualPath: "blocker.instructions.md",
    expectedFile: "expected/blocker.json",
  },
];

/** The slice of a Report this safety net pins — everything score-relevant. */
function pinned(report: Report) {
  return {
    overallScore: report.overallScore,
    cappedFrom: report.cappedFrom,
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
  };
}

function expectedPinned(entry: ExpectedEntry) {
  return {
    overallScore: entry.overallScore,
    cappedFrom: entry.cappedFrom,
    grade: entry.grade,
    axisScores: entry.axisScores,
    blockers: entry.blockers,
    fixes: entry.fixes,
    fileKind: entry.fileKind,
  };
}

describe("golden: pinned scores against the real copilot criteria", () => {
  for (const fixture of FIXTURES) {
    const raw = readFileSync(resolve(GOLDEN_DIR, fixture.file), "utf8");
    const expected: ExpectedEntry[] = JSON.parse(
      readFileSync(resolve(GOLDEN_DIR, fixture.expectedFile), "utf8"),
    ) as ExpectedEntry[];

    describe(fixture.name, () => {
      for (const entry of expected) {
        const label = `preset "${entry.preset}", ${entry.withAi ? "with" : "without"} AI findings`;

        it(`matches the pinned report — ${label}`, async () => {
          const result = await analyze(
            { path: fixture.virtualPath, content: raw },
            {
              config: CONFIG,
              preset: entry.preset,
              ...(entry.withAi ? { aiFindings: AI_FINDINGS } : {}),
            },
          );

          expect(pinned(result.report)).toEqual(expectedPinned(entry));
        });
      }

      it("reproduces the pinned balanced+AI report via a fake AiProvider", async () => {
        const expectedEntry = expected.find((e) => e.preset === "balanced" && e.withAi);
        if (!expectedEntry) {
          throw new Error(
            `fixture "${fixture.name}" has no balanced+AI expectation to compare against`,
          );
        }

        const complete = vi.fn<AiProvider["complete"]>(async () => ({
          output: { findings: AI_FINDINGS },
        }));
        const provider: AiProvider = { complete };

        const result = await analyze(
          { path: fixture.virtualPath, content: raw },
          { config: CONFIG, preset: "balanced", provider },
        );

        expect(complete).toHaveBeenCalledTimes(1);
        expect(pinned(result.report)).toEqual(expectedPinned(expectedEntry));
      });
    });
  }
});
