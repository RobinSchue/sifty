/**
 * Sifty — CLI smoke test (part of the Wave 0 safety net).
 *
 * Spawns the real CLI as a subprocess (via tsx, no build step) against the
 * golden fixtures used by src/engine/golden.test.ts. Proves the wiring
 * end-to-end — argument parsing, exit code, stdout shape — that unit tests
 * calling analyzeContent() directly cannot: they never go through
 * src/index.ts.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const CLI_ENTRY = resolve(process.cwd(), "src/index.ts");
const GOLDEN_DIR = resolve(process.cwd(), "src/testing/golden");

function runCli(args: string[]) {
  // Empty, not deleted: dotenv fills in missing variables from a local .env,
  // but leaves present ones alone — so this keeps a developer's key out of the run.
  const env = { ...process.env, ANTHROPIC_API_KEY: "" };
  return spawnSync("npx", ["tsx", CLI_ENTRY, ...args], {
    encoding: "utf8",
    env,
  });
}

describe("CLI smoke test", () => {
  it("exits 0 and prints a score for a clean file", () => {
    const result = runCli([
      "check",
      resolve(GOLDEN_DIR, "good.instructions.md"),
      "--tool",
      "copilot",
      "--no-ai",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Overall score:");
    expect(result.stdout).toContain("77/100");
  });

  it("exits 1 and prints the blocker section for a file with a secret", () => {
    const result = runCli([
      "check",
      resolve(GOLDEN_DIR, "blocker.instructions.md"),
      "--tool",
      "copilot",
      "--no-ai",
    ]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Overall score:");
    expect(result.stdout).toContain("BLOCKER");
    expect(result.stdout).toContain("40/100");
  });

  it("exits 1 with a clear stderr message for a missing file", () => {
    const result = runCli(["check", "does-not-exist.instructions.md", "--tool", "copilot"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("File not found");
  });

  it("prints the package.json version, not a hardcoded one", () => {
    const result = runCli(["--version"]);

    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { version: string };

    expect(result.stdout.trim()).toBe(packageJson.version);
  });
});

/** Wave 1 — invalid input fails loudly instead of silently falling back. */
describe("CLI smoke test — boundary invariants", () => {
  it("rejects an unknown preset with a non-zero exit and a helpful message", () => {
    const result = runCli([
      "check",
      resolve(GOLDEN_DIR, "good.instructions.md"),
      "--tool",
      "copilot",
      "--no-ai",
      "--preset",
      "bogus",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown preset "bogus"');
    expect(result.stderr).toContain("balanced");
  });

  it("rejects an unknown --fix-prompt style via commander's own choice validation", () => {
    const result = runCli([
      "check",
      resolve(GOLDEN_DIR, "good.instructions.md"),
      "--tool",
      "copilot",
      "--no-ai",
      "--fix-prompt",
      "bogus",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Allowed choices are short, full");
  });

  it("suppresses --generate-fix-prompt entirely when --no-ai is set", () => {
    const result = runCli([
      "check",
      resolve(GOLDEN_DIR, "good.instructions.md"),
      "--tool",
      "copilot",
      "--no-ai",
      "--generate-fix-prompt",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("Proposed fix:");
    expect(result.stderr).not.toContain("Fix prompt generation skipped");
  });

  it("--show-tokens reports no AI call was made when AI is off (Wave 2)", () => {
    const result = runCli([
      "check",
      resolve(GOLDEN_DIR, "good.instructions.md"),
      "--tool",
      "copilot",
      "--no-ai",
      "--show-tokens",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Token usage:");
    expect(result.stdout).toContain("no AI call was made");
  });

  it("--format json prints exactly the { report, failures, aiError, usage } contract (Wave 3)", () => {
    const result = runCli([
      "check",
      resolve(GOLDEN_DIR, "good.instructions.md"),
      "--tool",
      "copilot",
      "--no-ai",
      "--format",
      "json",
    ]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["failures", "report"]);
    expect((parsed["report"] as { overallScore: number }).overallScore).toBe(77);
  });

  it("--format json exits 1 and reports blockers for a file with a secret", () => {
    const result = runCli([
      "check",
      resolve(GOLDEN_DIR, "blocker.instructions.md"),
      "--tool",
      "copilot",
      "--no-ai",
      "--format",
      "json",
    ]);

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as { report: { blockers: { checkId: string }[] } };
    expect(parsed.report.blockers.map((b) => b.checkId)).toContain("security.secrets");
  });
});

describe("CLI smoke test — composite", () => {
  const COMPOSITE_DIR = resolve(process.cwd(), "src/testing/composite");
  const TWO_FILES = [
    resolve(COMPOSITE_DIR, "repo-wide.copilot-instructions.md"),
    resolve(COMPOSITE_DIR, "scoped.instructions.md"),
  ];

  it("runs without an API key, explains why it could not review, and still exits 0", () => {
    const result = runCli(["composite", ...TWO_FILES]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("ANTHROPIC_API_KEY is not set");
    expect(result.stdout).toContain("Composite review: 2 files");
    expect(result.stdout).toContain("Review incomplete: Composite review requires an AI provider.");
    expect(result.stdout).not.toContain("No contradictions found");
  });

  it("--format json prints the { review, error, usage } contract", () => {
    const result = runCli(["composite", ...TWO_FILES, "--format", "json"]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["error", "review"]);
    const review = parsed["review"] as { files: { fileKind: string }[]; ruleIds: string[] };
    expect(review.files.map((file) => file.fileKind)).toEqual(["scoped", "scoped"]);
    expect(review.ruleIds).toEqual(["composite.contradictions"]);
  });

  it("refuses a single file", () => {
    const result = runCli(["composite", TWO_FILES[0]!]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("at least two files");
  });

  it("exits 1 for a missing file", () => {
    const result = runCli(["composite", TWO_FILES[0]!, "does-not-exist.md"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("File not found: does-not-exist.md");
  });

  it("exits 1 for a missing --rules file", () => {
    const result = runCli(["composite", ...TWO_FILES, "--rules", "no-such-rules.json"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No composite rules file");
  });
});
