import { describe, expect, it } from "vitest";

import type { AiFinding, Measurement } from "../report.types.js";
import { buildReport, resolveCheck } from "./scoring.js";
import { makeCheck, makeConfig, makePreset } from "../testing/fixtures.js";

describe("resolveCheck", () => {
  it("applies the override for a matching file kind", () => {
    const check = makeCheck({
      id: "cost.length",
      measure: { type: "tokenCount" },
      overrides: { "repo-wide": { weight: 5 } },
    });

    expect(resolveCheck(check, "repo-wide").weight).toBe(5);
    expect(resolveCheck(check, "scoped").weight).toBe(1);
  });
});

describe("buildReport — per-check scoring", () => {
  it("scores a binary check pass/fail", () => {
    const config = makeConfig({
      checks: [
        makeCheck({ id: "clarity.pass", measure: { type: "frontmatterValid" } }),
        makeCheck({
          id: "clarity.fail",
          measure: { type: "frontmatterValid" },
          scoring: { type: "binary", failScore: 20 },
        }),
      ],
    });
    const measurements: Measurement[] = [
      { checkId: "clarity.pass", value: true, applicable: true },
      { checkId: "clarity.fail", value: false, applicable: true },
    ];

    const report = buildReport({
      config,
      file: "a.md",
      fileKind: "scoped",
      measurements,
    });

    const pass = report.checkScores.find((c) => c.checkId === "clarity.pass");
    const fail = report.checkScores.find((c) => c.checkId === "clarity.fail");
    expect(pass?.score).toBe(100);
    expect(fail?.score).toBe(20);
  });

  it("maps a value into ascending bands, last band open-ended", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "cost.length",
          measure: { type: "tokenCount" },
          scoring: {
            type: "bands",
            bands: [
              { upTo: 100, score: 100 },
              { upTo: 200, score: 50 },
              { upTo: null, score: 0 },
            ],
          },
        }),
      ],
    });

    const scoreFor = (value: number) =>
      buildReport({
        config,
        file: "a.md",
        fileKind: "scoped",
        measurements: [{ checkId: "cost.length", value, applicable: true }],
      }).checkScores[0]?.score;

    expect(scoreFor(50)).toBe(100);
    expect(scoreFor(150)).toBe(50);
    expect(scoreFor(1000)).toBe(0);
  });

  it("floors a penalty score at the configured floor", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "clarity.filler",
          measure: { type: "wordDensity" },
          scoring: { type: "penalty", perHit: 30, floor: 10 },
        }),
      ],
    });

    const report = buildReport({
      config,
      file: "a.md",
      fileKind: "scoped",
      measurements: [{ checkId: "clarity.filler", value: 10, applicable: true }],
    });

    expect(report.checkScores[0]?.score).toBe(10);
  });

  it("scores an ai check from an AiFinding, not from a measurement", () => {
    const config = makeConfig({
      checks: [
        {
          id: "clarity.tone",
          axis: "clarity",
          label: "Tone",
          weight: 1,
          mode: "ai",
          appliesTo: [],
          scoring: { type: "ai" },
          fix: "improve tone",
          question: "Is the tone appropriate?",
        },
      ],
    });
    const aiFindings: AiFinding[] = [
      { checkId: "clarity.tone", score: 83, rationale: "mostly fine" },
    ];

    const report = buildReport({
      config,
      file: "a.md",
      fileKind: "scoped",
      measurements: [],
      aiFindings,
    });

    expect(report.checkScores[0]?.score).toBe(83);
    expect(report.checkScores[0]?.source).toBe("ai");
  });

  it("marks a check not applicable when its measurement says so", () => {
    const config = makeConfig({
      checks: [makeCheck({ id: "clarity.x", measure: { type: "frontmatterValid" } })],
    });

    const report = buildReport({
      config,
      file: "a.md",
      fileKind: "scoped",
      measurements: [{ checkId: "clarity.x", applicable: false }],
    });

    expect(report.checkScores[0]?.applicable).toBe(false);
    expect(report.checkScores[0]?.score).toBeUndefined();
  });
});

describe("buildReport — evidence redaction", () => {
  const AWS_KEY_PATTERN = { id: "aws-key", re: "AKIA[0-9A-Z]{16}", hint: "AWS access key id" };

  it("redacts a secret an AI finding quoted in plain text, per security.redactWith", () => {
    const config = makeConfig({
      patterns: { secrets: [AWS_KEY_PATTERN] },
      redactWith: ["secrets"],
      checks: [
        {
          id: "clarity.tone",
          axis: "clarity",
          label: "Tone",
          weight: 1,
          mode: "ai",
          appliesTo: [],
          scoring: { type: "ai" },
          fix: "improve tone",
          question: "Is the tone appropriate?",
        },
      ],
    });
    const aiFindings: AiFinding[] = [
      {
        checkId: "clarity.tone",
        score: 50,
        rationale: "cites a real key",
        evidence: [
          {
            excerpt: 'the staging key is AKIAIOSFODNN7EXAMPLE, written as "key: ..."',
            hint: "found key AKIAIOSFODNN7EXAMPLE in the example",
          },
        ],
      },
    ];

    const report = buildReport({
      config,
      file: "a.md",
      fileKind: "scoped",
      measurements: [],
      aiFindings,
    });

    const evidence = report.checkScores[0]?.evidence?.[0];
    expect(evidence?.excerpt).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(evidence?.excerpt).toContain("AKIA********");
    expect(evidence?.hint).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("leaves evidence untouched when security.redactWith is not set", () => {
    const config = makeConfig({
      patterns: { secrets: [AWS_KEY_PATTERN] },
      checks: [
        {
          id: "clarity.tone",
          axis: "clarity",
          label: "Tone",
          weight: 1,
          mode: "ai",
          appliesTo: [],
          scoring: { type: "ai" },
          fix: "improve tone",
          question: "Is the tone appropriate?",
        },
      ],
    });
    const aiFindings: AiFinding[] = [
      {
        checkId: "clarity.tone",
        score: 50,
        rationale: "cites a real key",
        evidence: [{ excerpt: "key: AKIAIOSFODNN7EXAMPLE" }],
      },
    ];

    const report = buildReport({
      config,
      file: "a.md",
      fileKind: "scoped",
      measurements: [],
      aiFindings,
    });

    expect(report.checkScores[0]?.evidence?.[0]?.excerpt).toContain("AKIAIOSFODNN7EXAMPLE");
  });
});

describe("buildReport — requires-gating", () => {
  it("gates a dependent check off when its requirement is imperfect", () => {
    const config = makeConfig({
      checks: [
        makeCheck({ id: "clarity.base", measure: { type: "frontmatterValid" } }),
        makeCheck({
          id: "clarity.dependent",
          measure: { type: "wordDensity" },
          requires: ["clarity.base"],
        }),
      ],
    });

    const report = buildReport({
      config,
      file: "a.md",
      fileKind: "scoped",
      measurements: [
        { checkId: "clarity.base", value: false, applicable: true },
        { checkId: "clarity.dependent", value: 5, applicable: true },
      ],
    });

    const dependent = report.checkScores.find((c) => c.checkId === "clarity.dependent");
    expect(dependent?.applicable).toBe(false);
  });

  it("keeps a dependent check gated on when its requirement is a clean pass", () => {
    const config = makeConfig({
      checks: [
        makeCheck({ id: "clarity.base", measure: { type: "frontmatterValid" } }),
        makeCheck({
          id: "clarity.dependent",
          measure: { type: "wordDensity" },
          requires: ["clarity.base"],
        }),
      ],
    });

    const report = buildReport({
      config,
      file: "a.md",
      fileKind: "scoped",
      measurements: [
        { checkId: "clarity.base", value: true, applicable: true },
        { checkId: "clarity.dependent", value: 5, applicable: true },
      ],
    });

    const dependent = report.checkScores.find((c) => c.checkId === "clarity.dependent");
    expect(dependent?.applicable).toBe(true);
  });

  it("resolves a multi-level requires chain (regression: German-file gating)", () => {
    const config = makeConfig({
      checks: [
        makeCheck({ id: "structure.a", measure: { type: "frontmatterValid" } }),
        makeCheck({
          id: "structure.b",
          measure: { type: "frontmatterField" },
          requires: ["structure.a"],
        }),
        makeCheck({
          id: "structure.c",
          measure: { type: "frontmatterField" },
          requires: ["structure.b"],
        }),
      ],
    });

    const report = buildReport({
      config,
      file: "a.md",
      fileKind: "scoped",
      measurements: [
        { checkId: "structure.a", value: false, applicable: true }, // fails → breaks the whole chain
        { checkId: "structure.b", value: true, applicable: true },
        { checkId: "structure.c", value: true, applicable: true },
      ],
    });

    expect(report.checkScores.find((c) => c.checkId === "structure.b")?.applicable).toBe(false);
    expect(report.checkScores.find((c) => c.checkId === "structure.c")?.applicable).toBe(false);
  });
});

describe("buildReport — axis aggregation", () => {
  it("computes a weighted mean, excluding checks without data", () => {
    const config = makeConfig({
      checks: [
        makeCheck({ id: "clarity.a", measure: { type: "frontmatterValid" }, weight: 1 }),
        makeCheck({ id: "clarity.b", measure: { type: "frontmatterValid" }, weight: 3 }),
        makeCheck({ id: "clarity.c", measure: { type: "frontmatterValid" }, weight: 10 }),
      ],
    });

    const report = buildReport({
      config,
      file: "a.md",
      fileKind: "scoped",
      measurements: [
        { checkId: "clarity.a", value: true, applicable: true }, // 100
        { checkId: "clarity.b", value: false, applicable: true }, // 0
        { checkId: "clarity.c", applicable: false }, // excluded entirely
      ],
    });

    const clarity = report.axisScores.find((a) => a.axis === "clarity");
    // (1*100 + 3*0) / (1+3) = 25, check c contributes to neither side.
    expect(clarity?.score).toBe(25);
    expect(clarity?.checkCount).toBe(2);
    expect(clarity?.totalChecks).toBe(3);
  });
});

describe("buildReport — overall score", () => {
  it("excludes axes with zero contributing checks from the weighted average (regression)", () => {
    const config = makeConfig({
      presets: { balanced: makePreset({ clarity: 1, completeness: 1 }) },
      checks: [
        makeCheck({ id: "clarity.a", measure: { type: "frontmatterValid" } }),
        makeCheck({
          id: "completeness.a",
          measure: { type: "frontmatterValid" },
          axis: "completeness",
        }),
      ],
    });

    const report = buildReport({
      config,
      file: "a.md",
      fileKind: "scoped",
      measurements: [
        { checkId: "clarity.a", value: true, applicable: true }, // clarity: 100
        { checkId: "completeness.a", applicable: false }, // completeness: no data at all
      ],
    });

    // If the zero-checkCount completeness axis were treated as a 0, the
    // overall score would be 50. It must instead equal clarity alone: 100.
    expect(report.overallScore).toBe(100);
  });

  it("weights axes by the selected preset", () => {
    const config = makeConfig({
      presets: {
        balanced: makePreset({ clarity: 1, security: 1 }),
        security: makePreset({ clarity: 0, security: 1 }),
      },
      checks: [
        makeCheck({ id: "clarity.a", measure: { type: "frontmatterValid" } }),
        makeCheck({
          id: "security.a",
          measure: { type: "frontmatterValid" },
          axis: "security",
          scoring: { type: "binary", failScore: 0 },
        }),
      ],
    });

    const measurements: Measurement[] = [
      { checkId: "clarity.a", value: true, applicable: true }, // 100
      { checkId: "security.a", value: false, applicable: true }, // 0
    ];

    const balanced = buildReport({
      config,
      file: "a.md",
      fileKind: "scoped",
      preset: "balanced",
      measurements,
    });
    const security = buildReport({
      config,
      file: "a.md",
      fileKind: "scoped",
      preset: "security",
      measurements,
    });

    expect(balanced.overallScore).toBe(50);
    expect(security.overallScore).toBe(0);
  });
});

describe("buildReport — blocker cap", () => {
  it("caps the overall score when a blocker check is imperfect, and records cappedFrom", () => {
    const config = makeConfig({
      blockerCapsOverallAt: 40,
      checks: [
        makeCheck({ id: "clarity.a", measure: { type: "frontmatterValid" } }),
        makeCheck({
          id: "security.secret",
          measure: { type: "patternHits" },
          axis: "security",
          severity: "blocker",
          scoring: { type: "binary", failScore: 0 },
        }),
      ],
    });

    const report = buildReport({
      config,
      file: "a.md",
      fileKind: "scoped",
      measurements: [
        { checkId: "clarity.a", value: true, applicable: true },
        { checkId: "security.secret", value: false, applicable: true },
      ],
    });

    expect(report.overallScore).toBe(40);
    expect(report.cappedFrom).toBe(50);
    expect(report.blockers).toHaveLength(1);
    expect(report.blockers[0]?.checkId).toBe("security.secret");
  });

  it("does not cap the score when there are no blockers", () => {
    const config = makeConfig({
      blockerCapsOverallAt: 40,
      checks: [makeCheck({ id: "clarity.a", measure: { type: "frontmatterValid" } })],
    });

    const report = buildReport({
      config,
      file: "a.md",
      fileKind: "scoped",
      measurements: [{ checkId: "clarity.a", value: true, applicable: true }],
    });

    expect(report.overallScore).toBe(100);
    expect(report.cappedFrom).toBeUndefined();
    expect(report.blockers).toHaveLength(0);
  });
});

describe("buildReport — grade resolution", () => {
  it("picks the highest grade whose min threshold the score meets", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "clarity.a",
          measure: { type: "tokenCount" },
          scoring: { type: "bands", bands: [{ upTo: null, score: 70 }] },
        }),
      ],
    });

    const report = buildReport({
      config,
      file: "a.md",
      fileKind: "scoped",
      measurements: [{ checkId: "clarity.a", value: 1, applicable: true }],
    });

    expect(report.grade.label).toBe("good");
  });
});

describe("buildReport — fix list", () => {
  it("sorts fixes by impact (weight * (100 - score)) descending", () => {
    const config = makeConfig({
      checks: [
        makeCheck({ id: "clarity.small", measure: { type: "frontmatterValid" }, weight: 1 }),
        makeCheck({ id: "clarity.big", measure: { type: "frontmatterValid" }, weight: 10 }),
      ],
    });

    const report = buildReport({
      config,
      file: "a.md",
      fileKind: "scoped",
      measurements: [
        { checkId: "clarity.small", value: false, applicable: true },
        { checkId: "clarity.big", value: false, applicable: true },
      ],
    });

    expect(report.fixes.map((f) => f.checkId)).toEqual(["clarity.big", "clarity.small"]);
  });

  it("omits checks that scored a clean 100 from the fix list", () => {
    const config = makeConfig({
      checks: [makeCheck({ id: "clarity.a", measure: { type: "frontmatterValid" } })],
    });

    const report = buildReport({
      config,
      file: "a.md",
      fileKind: "scoped",
      measurements: [{ checkId: "clarity.a", value: true, applicable: true }],
    });

    expect(report.fixes).toHaveLength(0);
  });
});
