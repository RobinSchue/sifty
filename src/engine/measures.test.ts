import { describe, expect, it } from "vitest";

import { measures } from "./measures.js";
import { prepareFile } from "./text.js";
import { makeConfig } from "../testing/fixtures.js";

function ctxFor(body: string, frontmatter = "applyTo: '**'"): ReturnType<typeof prepareFile> {
  return prepareFile("a.md", `---\n${frontmatter}\n---\n${body}\n`);
}

describe("tokenCount", () => {
  it("estimates tokens from the chars/N estimator", () => {
    const ctx = ctxFor("hello");
    const outcome = measures.tokenCount({
      ctx,
      params: { estimator: "chars/4" },
      config: makeConfig(),
    });
    expect(outcome.value).toBe(Math.ceil(ctx.raw.length / 4));
  });
});

describe("frontmatterValid", () => {
  it("passes for valid frontmatter", () => {
    const ctx = ctxFor("body");
    const outcome = measures.frontmatterValid({ ctx, params: {}, config: makeConfig() });
    expect(outcome.value).toBe(true);
    expect(outcome.evidence).toEqual([]);
  });

  it("fails with evidence when frontmatter is missing", () => {
    const ctx = prepareFile("a.md", "no frontmatter here\n");
    const outcome = measures.frontmatterValid({ ctx, params: {}, config: makeConfig() });
    expect(outcome.value).toBe(false);
    expect(outcome.evidence?.[0]?.hint).toBe("no frontmatter block found");
  });
});

describe("frontmatterField", () => {
  it("is present for a non-empty string field", () => {
    const ctx = ctxFor("body", "applyTo: '**'\ndescription: hi");
    const outcome = measures.frontmatterField({
      ctx,
      params: { field: "description" },
      config: makeConfig(),
    });
    expect(outcome.value).toBe(true);
  });

  it("is absent when the field is missing", () => {
    const ctx = ctxFor("body");
    const outcome = measures.frontmatterField({
      ctx,
      params: { field: "description" },
      config: makeConfig(),
    });
    expect(outcome.value).toBe(false);
    expect(outcome.evidence?.[0]?.hint).toContain("missing or empty");
  });

  it("reads array and comma-separated values", () => {
    const arrCtx = ctxFor("body", "applyTo:\n  - '**/*.ts'\n  - '**/*.md'");
    expect(
      measures.frontmatterField({ ctx: arrCtx, params: { field: "applyTo" }, config: makeConfig() })
        .value,
    ).toBe(true);

    const csvCtx = ctxFor("body", "applyTo: '**/*.ts, **/*.md'");
    expect(
      measures.frontmatterField({ ctx: csvCtx, params: { field: "applyTo" }, config: makeConfig() })
        .value,
    ).toBe(true);
  });
});

describe("globValidity", () => {
  it("accepts a well-formed glob", () => {
    const ctx = ctxFor("body", "applyTo: '**/*.ts'");
    const outcome = measures.globValidity({
      ctx,
      params: { field: "applyTo" },
      config: makeConfig(),
    });
    expect(outcome.value).toBe(true);
  });

  it("rejects a glob with unbalanced braces", () => {
    const ctx = ctxFor("body", "applyTo: '**/*.{ts'");
    const outcome = measures.globValidity({
      ctx,
      params: { field: "applyTo" },
      config: makeConfig(),
    });
    expect(outcome.value).toBe(false);
    expect(outcome.evidence?.length).toBeGreaterThan(0);
  });

  it("rejects a missing field", () => {
    const ctx = ctxFor("body", "description: hi");
    const outcome = measures.globValidity({
      ctx,
      params: { field: "applyTo" },
      config: makeConfig(),
    });
    expect(outcome.value).toBe(false);
  });
});

describe("globBreadth", () => {
  it("flags globs matching a too-broad pattern set", () => {
    const config = makeConfig({
      patterns: { broad: [{ id: "star", re: "^\\*\\*$", hint: "matches everything" }] },
    });
    const ctx = ctxFor("body", "applyTo: '**'");
    const outcome = measures.globBreadth({
      ctx,
      params: { field: "applyTo", patternSet: "broad" },
      config,
    });
    expect(outcome.value).toBe(false);
    expect(outcome.evidence?.[0]?.hint).toBe("matches everything");
  });

  it("passes when nothing matches the pattern set", () => {
    const config = makeConfig({
      patterns: { broad: [{ id: "star", re: "^\\*\\*$", hint: "matches everything" }] },
    });
    const ctx = ctxFor("body", "applyTo: '**/*.ts'");
    const outcome = measures.globBreadth({
      ctx,
      params: { field: "applyTo", patternSet: "broad" },
      config,
    });
    expect(outcome.value).toBe(true);
  });
});

describe("wordDensity", () => {
  it("computes hits per N words", () => {
    const config = makeConfig({ words: { filler: ["basically", "just"] } });
    const ctx = ctxFor("This is basically just a test of basically nothing.");
    const outcome = measures.wordDensity({
      ctx,
      params: { wordSet: "filler", per: 100 },
      config,
    });
    expect(outcome.value).toBeGreaterThan(0);
  });

  it("returns 0 without dividing by zero when there is no prose", () => {
    const config = makeConfig({ words: { filler: ["basically"] } });
    const ctx = prepareFile("a.md", "---\napplyTo: '**'\n---\n```\ncode only\n```\n");
    const outcome = measures.wordDensity({ ctx, params: { wordSet: "filler" }, config });
    expect(outcome.value).toBe(0);
  });
});

describe("patternHits", () => {
  it("counts matches and redacts the secret in the excerpt", () => {
    const config = makeConfig({
      patterns: { secrets: [{ id: "key", re: "sk-[a-zA-Z0-9]{16,}", hint: "hardcoded key" }] },
    });
    const ctx = ctxFor("Here is a key: sk-abcdefghijklmnopqrstuvwxyz");
    const outcome = measures.patternHits({ ctx, params: { patternSet: "secrets" }, config });

    expect(outcome.value).toBe(1);
    const excerpt = outcome.evidence?.[0]?.excerpt;
    expect(excerpt).toBeDefined();
    // The excerpt must contain the redacted form but never the literal plaintext secret
    expect(excerpt).toMatch(/sk-a\*+/);
    // Verify the full unredacted secret is not present anywhere in the excerpt
    expect(excerpt).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("redacts secrets even when they appear in the middle of a line", () => {
    const config = makeConfig({
      patterns: { secrets: [{ id: "key", re: "sk-[a-zA-Z0-9]{16,}", hint: "hardcoded key" }] },
    });
    const ctx = ctxFor("The secret sk-abcdefghijklmnopqrstuvwxyz is embedded");
    const outcome = measures.patternHits({ ctx, params: { patternSet: "secrets" }, config });

    expect(outcome.value).toBe(1);
    const excerpt = outcome.evidence?.[0]?.excerpt;
    expect(excerpt).toBeDefined();
    // Verify no unredacted secret appears
    expect(excerpt).not.toContain("abcdefghijklmnopqrstuvwxyz");
    // Verify the redacted form is present
    expect(excerpt).toMatch(/sk-a\*+/);
  });
});

describe("markerPresence", () => {
  it("finds a marker word", () => {
    const config = makeConfig({ words: { examples: ["for example"] } });
    const ctx = ctxFor("Here is an example: for example, do this.");
    const outcome = measures.markerPresence({ ctx, params: { wordSet: "examples" }, config });
    expect(outcome.value).toBe(true);
  });

  it("falls back to a code fence when orCodeFence is set", () => {
    const config = makeConfig({ words: { examples: ["nonexistent-marker"] } });
    const ctx = prepareFile("a.md", "---\napplyTo: '**'\n---\n```\ncode\n```\n");
    const outcome = measures.markerPresence({
      ctx,
      params: { wordSet: "examples", orCodeFence: true },
      config,
    });
    expect(outcome.value).toBe(true);
  });

  it("is false when nothing is found", () => {
    const config = makeConfig({ words: { examples: ["nonexistent-marker"] } });
    const ctx = ctxFor("plain prose");
    const outcome = measures.markerPresence({ ctx, params: { wordSet: "examples" }, config });
    expect(outcome.value).toBe(false);
  });
});

describe("headingStructure", () => {
  it("flags a long file with no heading outline", () => {
    const longBody = Array.from({ length: 45 }, (_, i) => `line ${i}`).join("\n");
    const ctx = ctxFor(longBody);
    const outcome = measures.headingStructure({
      ctx,
      params: { minHeadingsFromLines: 40 },
      config: makeConfig(),
    });
    expect(outcome.value).toBeGreaterThan(0);
  });

  it("flags a heading level skip", () => {
    const ctx = ctxFor("# Title\n\n### Subsection\n");
    const outcome = measures.headingStructure({
      ctx,
      params: { allowLevelSkips: false },
      config: makeConfig(),
    });
    expect(outcome.value).toBe(1);
  });

  it("allows level skips when configured", () => {
    const ctx = ctxFor("# Title\n\n### Subsection\n");
    const outcome = measures.headingStructure({
      ctx,
      params: { allowLevelSkips: true },
      config: makeConfig(),
    });
    expect(outcome.value).toBe(0);
  });
});

describe("blockLength", () => {
  it("counts oversized paragraphs by char limit", () => {
    const ctx = ctxFor(`${"a".repeat(500)}\n`);
    const outcome = measures.blockLength({
      ctx,
      params: { kind: "paragraph", unit: "chars", limit: 400 },
      config: makeConfig(),
    });
    expect(outcome.value).toBe(1);
  });

  it("counts oversized code fences by line limit", () => {
    const codeLines = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n");
    const ctx = ctxFor(`\`\`\`\n${codeLines}\n\`\`\`\n`);
    const outcome = measures.blockLength({
      ctx,
      params: { kind: "codeFence", unit: "lines", limit: 5 },
      config: makeConfig(),
    });
    expect(outcome.value).toBe(1);
  });
});

describe("duplicateLines", () => {
  it("flags a normalized duplicate line", () => {
    const ctx = ctxFor(
      "This is a fairly long line that repeats.\nThis is a fairly long line that repeats.\n",
    );
    const outcome = measures.duplicateLines({
      ctx,
      params: { minLength: 10 },
      config: makeConfig(),
    });
    expect(outcome.value).toBe(1);
  });

  it("ignores short lines below minLength", () => {
    const ctx = ctxFor("short\nshort\n");
    const outcome = measures.duplicateLines({
      ctx,
      params: { minLength: 25 },
      config: makeConfig(),
    });
    expect(outcome.value).toBe(0);
  });
});

describe("languageGuess", () => {
  it("assumes the expected language when there is too little prose to judge", () => {
    const ctx = ctxFor("Hi.");
    const outcome = measures.languageGuess({
      ctx,
      params: { expected: "en", minWords: 40, assumeOnUncertain: true, stopwordSets: {} },
      config: makeConfig(),
    });
    expect(outcome.value).toBe(true);
  });

  it("detects the expected language via stopwords", () => {
    const config = makeConfig({
      words: {
        enStop: ["the", "and", "is", "of", "to", "in", "a", "that", "for", "on"],
        deStop: ["der", "die", "das", "und", "ist"],
      },
    });
    const prose = Array.from({ length: 45 }, () => "the and is of to").join(" ");
    const ctx = ctxFor(prose);
    const outcome = measures.languageGuess({
      ctx,
      params: {
        expected: "en",
        minWords: 40,
        assumeOnUncertain: false,
        stopwordSets: { en: "enStop", de: "deStop" },
      },
      config,
    });
    expect(outcome.value).toBe(true);
  });

  it("detects a mismatch against the expected language", () => {
    const config = makeConfig({
      words: {
        enStop: ["the", "and", "is"],
        deStop: ["der", "die", "das", "und", "ist"],
      },
    });
    const prose = Array.from({ length: 45 }, () => "der die das und ist").join(" ");
    const ctx = ctxFor(prose);
    const outcome = measures.languageGuess({
      ctx,
      params: {
        expected: "en",
        minWords: 40,
        assumeOnUncertain: false,
        stopwordSets: { en: "enStop", de: "deStop" },
      },
      config,
    });
    expect(outcome.value).toBe(false);
  });
});
