import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadCompositeRules } from "./load.js";
import { makeCompositeRule, makeCompositeRules } from "../testing/fixtures.js";

const tempDirs: string[] = [];

function writeTempRules(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sifty-composite-"));
  tempDirs.push(dir);
  const path = join(dir, "composite.json");
  writeFileSync(path, content);
  return path;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadCompositeRules", () => {
  it("loads the real config/composite.json", () => {
    const rules = loadCompositeRules();
    expect(rules.schemaVersion).toBe(1);
    expect(rules.rules.map((rule) => rule.id)).toContain("composite.contradictions");
  });

  it("loads a custom rules file by path", () => {
    const path = writeTempRules(JSON.stringify(makeCompositeRules({ rulesVersion: "9.9.9" })));
    expect(loadCompositeRules(path).rulesVersion).toBe("9.9.9");
  });

  it("throws for a missing file", () => {
    expect(() => loadCompositeRules("/no/such/composite.json")).toThrow(/No composite rules file/);
  });

  it("throws a helpful error for invalid JSON", () => {
    const path = writeTempRules("{ not valid json");
    expect(() => loadCompositeRules(path)).toThrow(/not valid JSON/);
  });

  it("rejects an unsupported schemaVersion", () => {
    const path = writeTempRules(JSON.stringify({ ...makeCompositeRules(), schemaVersion: 2 }));
    expect(() => loadCompositeRules(path)).toThrow(/Invalid composite rules[\s\S]*schemaVersion/);
  });

  it("rejects duplicate rule ids", () => {
    const rules = makeCompositeRules({
      rules: [makeCompositeRule({ id: "composite.x" }), makeCompositeRule({ id: "composite.x" })],
    });
    const path = writeTempRules(JSON.stringify(rules));
    expect(() => loadCompositeRules(path)).toThrow(/duplicate rule id "composite.x"/);
  });

  it("rejects a rule that would run on fewer than two files", () => {
    const rules = makeCompositeRules({ rules: [makeCompositeRule({ minFiles: 1 })] });
    const path = writeTempRules(JSON.stringify(rules));
    expect(() => loadCompositeRules(path)).toThrow(/rules\.0\.minFiles/);
  });

  it("rejects a severity outside info|warn", () => {
    const rules = makeCompositeRules({ rules: [makeCompositeRule()] });
    const raw = JSON.parse(JSON.stringify(rules)) as { rules: { severity: string }[] };
    raw.rules[0]!.severity = "blocker";
    const path = writeTempRules(JSON.stringify(raw));
    expect(() => loadCompositeRules(path)).toThrow(/rules\.0\.severity/);
  });
});
