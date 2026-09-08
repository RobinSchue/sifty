/**
 * Sifty — text preparation.
 *
 * Every measure works on the same prepared context, so the file is parsed once
 * per run instead of once per check.
 */

import matter from "gray-matter";

export interface Block {
  /** 1-based line where the block starts. */
  line: number;
  text: string;
  /** Length in lines and in characters — the caller picks the unit. */
  lines: number;
  chars: number;
}

export interface FileContext {
  path: string;
  /** File as it is on disk, including frontmatter. Security patterns run on this. */
  raw: string;
  rawLines: string[];
  frontmatterValid: boolean;
  frontmatterError?: string | undefined;
  frontmatterPresent: boolean;
  data: Record<string, unknown>;
  /** Body without frontmatter. */
  body: string;
  /** Line number in `raw` at which the body starts (1-based). */
  bodyOffset: number;
  /** Body without code fences, inline code and URLs — this is what humans read. */
  prose: string;
  proseWords: string[];
  tokenEstimate: number;
  hasCodeFence: boolean;
}

export function prepareFile(path: string, raw: string, charsPerToken = 4): FileContext {
  let frontmatterValid = true;
  let frontmatterError: string | undefined;
  let data: Record<string, unknown> = {};
  let body = raw;

  const frontmatterPresent = /^\s*---\r?\n/.test(raw);

  if (frontmatterPresent) {
    try {
      const parsed = matter(raw);
      data = parsed.data as Record<string, unknown>;
      body = parsed.content;
    } catch (error) {
      frontmatterValid = false;
      frontmatterError = error instanceof Error ? error.message : "unparsable frontmatter";
    }
  } else {
    frontmatterValid = false;
    frontmatterError = "no frontmatter block found";
  }

  const rawLines = raw.split(/\r?\n/);
  const bodyOffset = rawLines.length - body.split(/\r?\n/).length + 1;
  const prose = stripUrls(stripInlineCode(stripCodeFences(body)));

  return {
    path,
    raw,
    rawLines,
    frontmatterValid,
    frontmatterError,
    frontmatterPresent,
    data,
    body,
    bodyOffset,
    prose,
    proseWords: words(prose),
    tokenEstimate: Math.ceil(raw.length / charsPerToken),
    hasCodeFence: /^\s*```/m.test(body),
  };
}

/* ------------------------------------------------------------------ *
 * Stripping — all variants keep the line count intact so line numbers stay valid
 * ------------------------------------------------------------------ */

export function stripCodeFences(text: string): string {
  let inFence = false;
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return "";
      }
      return inFence ? "" : line;
    })
    .join("\n");
}

export function stripInlineCode(text: string): string {
  return text.replace(/`[^`\n]*`/g, " ");
}

export function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/g, " ");
}

export function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}][\p{L}'-]*/gu) ?? [];
}

/* ------------------------------------------------------------------ *
 * Positions
 * ------------------------------------------------------------------ */

/** 1-based line number of a character index. */
export function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/** Short context around a hit, whitespace collapsed. */
export function excerptAt(text: string, index: number, length = 60): string {
  const start = Math.max(0, index - 10);
  return text
    .slice(start, start + length)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Never print a full secret into the report — the report itself ends up in
 * terminals, CI logs and screenshots.
 */
export function redact(value: string, keep = 4): string {
  if (value.length <= keep) return "*".repeat(value.length);
  return `${value.slice(0, keep)}${"*".repeat(Math.min(12, value.length - keep))}`;
}

/* ------------------------------------------------------------------ *
 * Block extraction
 * ------------------------------------------------------------------ */

export function codeFenceBlocks(ctx: FileContext): Block[] {
  const blocks: Block[] = [];
  const lines = ctx.body.split(/\r?\n/);
  let start: number | null = null;
  let buffer: string[] = [];

  lines.forEach((line, index) => {
    if (!/^\s*```/.test(line)) {
      if (start !== null) buffer.push(line);
      return;
    }
    if (start === null) {
      start = index;
      buffer = [];
    } else {
      blocks.push(toBlock(buffer.join("\n"), start + ctx.bodyOffset + 1));
      start = null;
    }
  });

  return blocks;
}

export function listItemBlocks(ctx: FileContext): Block[] {
  const blocks: Block[] = [];
  const lines = stripCodeFences(ctx.body).split(/\r?\n/);
  let current: { line: number; parts: string[] } | null = null;

  const flush = () => {
    if (current) blocks.push(toBlock(current.parts.join(" "), current.line));
    current = null;
  };

  lines.forEach((line, index) => {
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      flush();
      current = {
        line: index + ctx.bodyOffset,
        parts: [line.replace(/^\s*([-*+]|\d+\.)\s+/, "")],
      };
    } else if (current && line.trim() !== "" && /^\s{2,}/.test(line)) {
      current.parts.push(line.trim());
    } else if (line.trim() === "") {
      flush();
    }
  });
  flush();

  return blocks;
}

export function paragraphBlocks(ctx: FileContext): Block[] {
  const blocks: Block[] = [];
  const lines = stripCodeFences(ctx.body).split(/\r?\n/);
  let current: { line: number; parts: string[] } | null = null;

  const flush = () => {
    if (current) blocks.push(toBlock(current.parts.join(" "), current.line));
    current = null;
  };

  lines.forEach((line, index) => {
    const isProse =
      line.trim() !== "" &&
      !/^\s*#/.test(line) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(line) &&
      !/^\s*>/.test(line) &&
      !/^\s*\|/.test(line);

    if (isProse) {
      if (!current) current = { line: index + ctx.bodyOffset, parts: [] };
      current.parts.push(line.trim());
    } else {
      flush();
    }
  });
  flush();

  return blocks;
}

function toBlock(text: string, line: number): Block {
  return {
    line,
    text,
    lines: text === "" ? 0 : text.split("\n").length,
    chars: text.length,
  };
}

/* ------------------------------------------------------------------ *
 * Matching helpers
 * ------------------------------------------------------------------ */

/** Word-ish boundaries, so "not" does not match inside "nothing". */
export function phraseRegex(phrase: string): RegExp {
  const escaped = phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}-])${escaped}(?![\\p{L}-])`, "giu");
}

export function countPhrase(haystack: string, phrase: string): number {
  return (haystack.match(phraseRegex(phrase)) ?? []).length;
}
