/**
 * Sifty — criteriaConfigSchema tests.
 *
 * Focused on the refinements added in this wave that load.test.ts's
 * (pre-existing) hand-check migration doesn't already cover: numeric
 * ranges, band ordering, and the override constraints. Cross-reference
 * checks that existed before (unknown axis/fileKind, duplicate id,
 * requires, redactWith, missing question/measure) are exercised via
 * validateCriteria() in load.test.ts — no need to duplicate them here.
 */
import { describe, expect, it } from "vitest";

import { criteriaConfigSchema } from "./schema.js";
import { makeCheck, makeConfig } from "../testing/fixtures.js";

function firstIssuePath(result: ReturnType<typeof criteriaConfigSchema.safeParse>): string {
  if (result.success) throw new Error("expected parse to fail");
  return result.error.issues[0]?.path.join(".") ?? "";
}

describe("criteriaConfigSchema — weight", () => {
  it("rejects a negative check weight", () => {
    const config = makeConfig({
      checks: [makeCheck({ id: "clarity.x", measure: { type: "frontmatterValid" }, weight: -1 })],
    });
    const result = criteriaConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toContain("weight");
  });

  it("accepts a zero weight (a check that never moves the axis score but still runs)", () => {
    const config = makeConfig({
      checks: [makeCheck({ id: "clarity.x", measure: { type: "frontmatterValid" }, weight: 0 })],
    });
    expect(criteriaConfigSchema.safeParse(config).success).toBe(true);
  });
});

describe("criteriaConfigSchema — bands", () => {
  it("rejects a band score above 100", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "clarity.x",
          measure: { type: "tokenCount" },
          scoring: { type: "bands", bands: [{ upTo: null, score: 150 }] },
        }),
      ],
    });
    expect(criteriaConfigSchema.safeParse(config).success).toBe(false);
  });

  it("rejects a band score below 0", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "clarity.x",
          measure: { type: "tokenCount" },
          scoring: { type: "bands", bands: [{ upTo: null, score: -1 }] },
        }),
      ],
    });
    expect(criteriaConfigSchema.safeParse(config).success).toBe(false);
  });

  it("rejects non-ascending upTo values", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "clarity.x",
          measure: { type: "tokenCount" },
          scoring: {
            type: "bands",
            bands: [
              { upTo: 500, score: 100 },
              { upTo: 200, score: 50 }, // goes backwards
              { upTo: null, score: 0 },
            ],
          },
        }),
      ],
    });
    const result = criteriaConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("ascending"))).toBe(true);
    }
  });

  it("rejects a non-terminal band with upTo: null", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "clarity.x",
          measure: { type: "tokenCount" },
          scoring: {
            type: "bands",
            bands: [
              { upTo: null, score: 100 }, // only the LAST band may be null
              { upTo: 500, score: 0 },
            ],
          },
        }),
      ],
    });
    const result = criteriaConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("only the last band"))).toBe(true);
    }
  });

  it("accepts strictly ascending bands with an open-ended last band", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "clarity.x",
          measure: { type: "tokenCount" },
          scoring: {
            type: "bands",
            bands: [
              { upTo: 200, score: 100 },
              { upTo: 500, score: 50 },
              { upTo: null, score: 0 },
            ],
          },
        }),
      ],
    });
    expect(criteriaConfigSchema.safeParse(config).success).toBe(true);
  });
});

describe("criteriaConfigSchema — penalty scoring", () => {
  it("rejects a negative perHit", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "clarity.x",
          measure: { type: "duplicateLines" },
          scoring: { type: "penalty", perHit: -5 },
        }),
      ],
    });
    expect(criteriaConfigSchema.safeParse(config).success).toBe(false);
  });

  it("rejects a floor outside 0-100", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "clarity.x",
          measure: { type: "duplicateLines" },
          scoring: { type: "penalty", perHit: 5, floor: 150 },
        }),
      ],
    });
    expect(criteriaConfigSchema.safeParse(config).success).toBe(false);
  });

  it("accepts a non-negative perHit and an in-range floor", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "clarity.x",
          measure: { type: "duplicateLines" },
          scoring: { type: "penalty", perHit: 5, floor: 20 },
        }),
      ],
    });
    expect(criteriaConfigSchema.safeParse(config).success).toBe(true);
  });
});

describe("criteriaConfigSchema — security.blockerCapsOverallAt", () => {
  it("rejects a value above 100", () => {
    const config = makeConfig({ blockerCapsOverallAt: 150 });
    expect(criteriaConfigSchema.safeParse(config).success).toBe(false);
  });

  it("rejects a negative value", () => {
    const config = makeConfig({ blockerCapsOverallAt: -1 });
    expect(criteriaConfigSchema.safeParse(config).success).toBe(false);
  });

  it("accepts a value within 0-100", () => {
    const config = makeConfig({ blockerCapsOverallAt: 40 });
    expect(criteriaConfigSchema.safeParse(config).success).toBe(true);
  });
});

describe("criteriaConfigSchema — check.overrides", () => {
  it("rejects an override keyed by a file kind that does not exist", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "cost.x",
          measure: { type: "tokenCount" },
          overrides: { "no-such-kind": { weight: 5 } },
        }),
      ],
    });
    const result = criteriaConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("unknown file kind"))).toBe(true);
    }
  });

  it("rejects an override that sets id", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "cost.x",
          measure: { type: "tokenCount" },
          overrides: { "repo-wide": { id: "cost.renamed" } },
        }),
      ],
    });
    const result = criteriaConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('must not set "id"'))).toBe(true);
    }
  });

  it("rejects an override that sets mode", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "cost.x",
          measure: { type: "tokenCount" },
          overrides: { "repo-wide": { mode: "ai" } },
        }),
      ],
    });
    const result = criteriaConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('must not set "mode"'))).toBe(true);
    }
  });

  it("rejects an override that sets axis", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "cost.x",
          measure: { type: "tokenCount" },
          overrides: { "repo-wide": { axis: "security" } },
        }),
      ],
    });
    const result = criteriaConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('must not set "axis"'))).toBe(true);
    }
  });

  it("accepts an override on a real file kind that only touches allowed fields", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "cost.x",
          measure: { type: "tokenCount" },
          overrides: { "repo-wide": { weight: 8 } },
        }),
      ],
    });
    expect(criteriaConfigSchema.safeParse(config).success).toBe(true);
  });
});
