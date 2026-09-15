import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { detectFileKind, loadCriteria, validateCriteria } from "./load.js";
import { ALL_MEASURE_TYPES, makeCheck, makeConfig } from "../testing/fixtures.js";

const VALIDATE_OPTIONS = { measureTypes: ALL_MEASURE_TYPES };

const tempDirs: string[] = [];

function writeTempConfig(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sifty-config-"));
  tempDirs.push(dir);
  const path = join(dir, "tool.json");
  writeFileSync(path, content);
  return path;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadCriteria", () => {
  it("loads and returns a valid config", () => {
    const config = makeConfig({
      checks: [makeCheck({ id: "clarity.example", measure: { type: "frontmatterValid" } })],
    });
    const path = writeTempConfig(JSON.stringify(config));

    const loaded = loadCriteria("ignored-tool-name", path, VALIDATE_OPTIONS);
    expect(loaded.tool).toBe("test-tool");
    expect(loaded.checks).toHaveLength(1);
  });

  it("throws for a missing file", () => {
    expect(() => loadCriteria("no-such-tool", undefined, VALIDATE_OPTIONS)).toThrow(
      /No criteria file for tool/,
    );
  });

  it("throws a helpful error for invalid JSON", () => {
    const path = writeTempConfig("{ not valid json");
    expect(() => loadCriteria("ignored", path, VALIDATE_OPTIONS)).toThrow(/not valid JSON/);
  });
});

describe("validateCriteria", () => {
  it("accepts a well-formed config", () => {
    const config = makeConfig({
      checks: [makeCheck({ id: "clarity.example", measure: { type: "frontmatterValid" } })],
    });
    expect(() => validateCriteria(config, "test", VALIDATE_OPTIONS)).not.toThrow();
  });

  it("rejects an unsupported schemaVersion", () => {
    const config = makeConfig();
    // @ts-expect-error deliberately invalid for the test
    config.schemaVersion = 2;
    expect(() => validateCriteria(config, "test", VALIDATE_OPTIONS)).toThrow(/schemaVersion/);
  });

  it("rejects a check pointing at an unknown axis", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "bad.axis",
          measure: { type: "frontmatterValid" },
          // @ts-expect-error deliberately invalid for the test
          axis: "nonexistent",
        }),
      ],
    });
    expect(() => validateCriteria(config, "test", VALIDATE_OPTIONS)).toThrow(/unknown axis/);
  });

  it("rejects a duplicate check id", () => {
    const config = makeConfig({
      checks: [
        makeCheck({ id: "clarity.dup", measure: { type: "frontmatterValid" } }),
        makeCheck({ id: "clarity.dup", measure: { type: "frontmatterValid" } }),
      ],
    });
    expect(() => validateCriteria(config, "test", VALIDATE_OPTIONS)).toThrow(/duplicate check id/);
  });

  it("rejects a preset missing a weight for an axis", () => {
    const config = makeConfig({
      presets: { balanced: { label: "Balanced", weights: { clarity: 1 } as never } },
    });
    expect(() => validateCriteria(config, "test", VALIDATE_OPTIONS)).toThrow(
      /has no weight for axis/,
    );
  });

  it("rejects a check applying to an unknown file kind", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "clarity.example",
          measure: { type: "frontmatterValid" },
          appliesTo: ["no-such-kind"],
        }),
      ],
    });
    expect(() => validateCriteria(config, "test", VALIDATE_OPTIONS)).toThrow(/unknown file kind/);
  });

  it("rejects a mechanical check with an unimplemented measure type", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "clarity.example",
          // @ts-expect-error deliberately invalid for the test
          measure: { type: "notARealMeasure" },
        }),
      ],
    });
    expect(() => validateCriteria(config, "test", VALIDATE_OPTIONS)).toThrow(
      /unimplemented measure/,
    );
  });

  it("rejects an ai check with no question", () => {
    const config = makeConfig({
      checks: [
        {
          id: "clarity.ai-check",
          axis: "clarity",
          label: "AI check",
          weight: 1,
          mode: "ai",
          appliesTo: [],
          scoring: { type: "ai" },
          fix: "fix it",
        },
      ],
    });
    expect(() => validateCriteria(config, "test", VALIDATE_OPTIONS)).toThrow(/has no question/);
  });

  it("rejects a bands scoring whose last band is not open-ended", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "clarity.bands",
          measure: { type: "tokenCount" },
          scoring: { type: "bands", bands: [{ upTo: 100, score: 100 }] },
        }),
      ],
    });
    expect(() => validateCriteria(config, "test", VALIDATE_OPTIONS)).toThrow(
      /last band must be open ended/,
    );
  });

  it("rejects a check that requires an unknown check", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "clarity.example",
          measure: { type: "frontmatterValid" },
          requires: ["clarity.missing"],
        }),
      ],
    });
    expect(() => validateCriteria(config, "test", VALIDATE_OPTIONS)).toThrow(
      /requires unknown check/,
    );
  });

  it("rejects a check referencing an unknown word set", () => {
    const config = makeConfig({
      checks: [
        makeCheck({
          id: "clarity.example",
          measure: { type: "wordDensity", params: { wordSet: "missing-set" } },
        }),
      ],
    });
    expect(() => validateCriteria(config, "test", VALIDATE_OPTIONS)).toThrow(/unknown word set/);
  });

  it("rejects security.redactWith referencing an unknown pattern set", () => {
    const config = makeConfig({ redactWith: ["missing-set"] });
    expect(() => validateCriteria(config, "test", VALIDATE_OPTIONS)).toThrow(
      /redactWith references unknown pattern set "missing-set"/,
    );
  });

  it("accepts security.redactWith referencing a real pattern set", () => {
    const config = makeConfig({
      patterns: { secrets: [{ id: "x", re: "x", hint: "x" }] },
      redactWith: ["secrets"],
    });
    expect(() => validateCriteria(config, "test", VALIDATE_OPTIONS)).not.toThrow();
  });
});

describe("detectFileKind", () => {
  it("returns the first matching file kind", () => {
    const config = makeConfig();
    expect(detectFileKind("some/path/foo.instructions.md", config)).toBe("scoped");
    expect(detectFileKind("some/path/copilot-instructions.md", config)).toBe("repo-wide");
  });

  it("falls back to the default file kind when nothing matches", () => {
    const config = makeConfig({
      fileKinds: [
        { id: "scoped", label: "Scoped", glob: "**/*.instructions.md" },
        { id: "fallback", label: "Fallback", glob: "**/never-matches-anything.md" },
      ],
      defaultFileKind: "fallback",
    });
    expect(detectFileKind("some/path/readme.md", config)).toBe("fallback");
  });
});
