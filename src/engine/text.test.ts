import { describe, expect, it } from "vitest";

import {
  codeFenceBlocks,
  countPhrase,
  excerptAt,
  lineAt,
  listItemBlocks,
  paragraphBlocks,
  phraseRegex,
  prepareFile,
  redact,
  stripCodeFences,
  stripInlineCode,
  stripUrls,
  words,
} from "./text.js";

describe("prepareFile", () => {
  it("parses valid frontmatter and separates body", () => {
    const raw = "---\napplyTo: '**'\n---\n\nHello world.\n";
    const ctx = prepareFile("a.md", raw);

    expect(ctx.frontmatterPresent).toBe(true);
    expect(ctx.frontmatterValid).toBe(true);
    expect(ctx.frontmatterError).toBeUndefined();
    expect(ctx.data["applyTo"]).toBe("**");
    expect(ctx.body.trim()).toBe("Hello world.");
  });

  it("flags a missing frontmatter block", () => {
    const ctx = prepareFile("a.md", "Just prose, no frontmatter.\n");

    expect(ctx.frontmatterPresent).toBe(false);
    expect(ctx.frontmatterValid).toBe(false);
    expect(ctx.frontmatterError).toBe("no frontmatter block found");
    expect(ctx.data).toEqual({});
  });

  it("flags unparsable frontmatter without throwing", () => {
    const raw = "---\napplyTo: [unterminated\n---\nBody\n";
    const ctx = prepareFile("a.md", raw);

    expect(ctx.frontmatterPresent).toBe(true);
    expect(ctx.frontmatterValid).toBe(false);
    expect(ctx.frontmatterError).toBeTruthy();
  });

  it("computes bodyOffset so line numbers in the body map back to raw", () => {
    const raw = "---\napplyTo: '**'\n---\nLine one\nLine two\n";
    const ctx = prepareFile("a.md", raw);

    // Frontmatter is 3 raw lines (---, applyTo, ---), so the body starts at raw line 4.
    expect(ctx.bodyOffset).toBe(4);
  });
});

describe("stripCodeFences / stripInlineCode / stripUrls", () => {
  it("blanks fenced code but keeps the line count intact", () => {
    const text = "before\n```js\nconst x = 1;\n```\nafter";
    const stripped = stripCodeFences(text);

    expect(stripped.split("\n")).toHaveLength(text.split("\n").length);
    expect(stripped).not.toContain("const x = 1;");
    expect(stripped).toContain("before");
    expect(stripped).toContain("after");
  });

  it("removes inline code spans", () => {
    expect(stripInlineCode("Use `npm install` to set up.")).toBe("Use   to set up.");
  });

  it("removes URLs", () => {
    expect(stripUrls("See https://example.com/docs for more.")).toBe("See   for more.");
  });

  it("words() lowercases and splits on non-letters", () => {
    expect(words("Hello, World! Café-Bar")).toEqual(["hello", "world", "café-bar"]);
  });
});

describe("lineAt / excerptAt", () => {
  it("finds the 1-based line number of a character index", () => {
    const text = "one\ntwo\nthree";
    expect(lineAt(text, 0)).toBe(1);
    expect(lineAt(text, 4)).toBe(2);
    expect(lineAt(text, 9)).toBe(3);
  });

  it("returns a short, whitespace-collapsed excerpt around an index", () => {
    const text = "0123456789 hello   world 0123456789";
    const excerpt = excerptAt(text, 11, 20);
    expect(excerpt).not.toMatch(/\s{2,}/);
  });
});

describe("redact", () => {
  it("keeps a short prefix and masks the rest, capped at 12 asterisks", () => {
    expect(redact("sk-abcdefghijklmnopqrstuvwxyz")).toBe("sk-a************");
  });

  it("fully masks values not longer than the keep length", () => {
    expect(redact("abc", 4)).toBe("***");
  });
});

describe("block extraction", () => {
  it("codeFenceBlocks captures fenced content with a starting line number", () => {
    const raw = "---\napplyTo: '**'\n---\nintro\n```js\nconst x = 1;\nconst y = 2;\n```\noutro\n";
    const ctx = prepareFile("a.md", raw);
    const blocks = codeFenceBlocks(ctx);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.text).toContain("const x = 1;");
    expect(blocks[0]?.lines).toBe(2);
  });

  it("listItemBlocks groups a marker line with its continuation lines", () => {
    const raw = "---\napplyTo: '**'\n---\n- first item\n  continued\n- second item\n";
    const ctx = prepareFile("a.md", raw);
    const blocks = listItemBlocks(ctx);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.text).toBe("first item continued");
    expect(blocks[1]?.text).toBe("second item");
  });

  it("paragraphBlocks splits on headings, lists, quotes and tables", () => {
    const raw =
      "---\napplyTo: '**'\n---\nPara one line one\npara one line two\n\n# Heading\n\nPara two\n";
    const ctx = prepareFile("a.md", raw);
    const blocks = paragraphBlocks(ctx);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.text).toBe("Para one line one para one line two");
    expect(blocks[1]?.text).toBe("Para two");
  });
});

describe("phraseRegex / countPhrase", () => {
  it("matches whole words only", () => {
    expect(countPhrase("This is nothing at all.", "not")).toBe(0);
    expect(countPhrase("This is not great.", "not")).toBe(1);
  });

  it("is case-insensitive and counts multiple hits", () => {
    expect(countPhrase("Simply simply put, SIMPLY works.", "simply")).toBe(3);
  });

  it("phraseRegex escapes regex-special characters", () => {
    const re = phraseRegex("e.g.");
    expect(re.test("see e.g. this")).toBe(true);
  });
});
