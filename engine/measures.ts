/**
 * Sifty — mechanical measures.
 *
 * One function per `measure.type`. All of them are free and offline.
 * They only MEASURE — turning a value into a score is the engine's job.
 *
 * The registry is typed as Record<Measure["type"], MeasureFn>: add a new type
 * to the union in criteria.types.ts and TypeScript demands the implementation here.
 */

import picomatch from "picomatch";

import type { CriteriaConfig, Measure, PatternDef } from "../criteria.types";
import type { Evidence } from "../report.types";
import {
    codeFenceBlocks,
    countPhrase,
    excerptAt,
    lineAt,
    listItemBlocks,
    paragraphBlocks,
    phraseRegex,
    redact,
    type Block,
    type FileContext,
} from "./text";

export interface MeasureOutcome {
    value: number | boolean;
    evidence?: Evidence[];
    /** Set to false when this file cannot be measured at all. */
    applicable?: boolean;
}

export interface MeasureArgs {
    ctx: FileContext;
    params: Record<string, unknown>;
    config: CriteriaConfig;
}

export type MeasureFn = (args: MeasureArgs) => MeasureOutcome;

/* ------------------------------------------------------------------ *
 * Param helpers — the config is untyped JSON, so read it defensively
 * ------------------------------------------------------------------ */

function str(params: Record<string, unknown>, key: string, fallback = ""): string {
    const value = params[key];
    return typeof value === "string" ? value : fallback;
}

function num(params: Record<string, unknown>, key: string, fallback: number): number {
    const value = params[key];
    return typeof value === "number" ? value : fallback;
}

function bool(params: Record<string, unknown>, key: string, fallback: boolean): boolean {
    const value = params[key];
    return typeof value === "boolean" ? value : fallback;
}

function wordSet(config: CriteriaConfig, id: string): string[] {
    const set = config.sets.words[id];
    if (!set) throw new Error(`Unknown word set "${id}"`);
    return set;
}

function patternSet(config: CriteriaConfig, id: string): PatternDef[] {
    const set = config.sets.patterns[id];
    if (!set) throw new Error(`Unknown pattern set "${id}"`);
    return set;
}

/** Frontmatter values may be a string, a comma-separated list or an array. */
function fieldValues(ctx: FileContext, field: string): string[] {
    const value = ctx.data[field];
    if (typeof value === "string") {
        return value
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean);
    }
    if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === "string");
    }
    return [];
}

/** Line of a frontmatter key, so the fix list can point at it. */
function frontmatterLine(ctx: FileContext, field: string): number | undefined {
    const index = ctx.rawLines.findIndex((line) =>
        new RegExp(`^\\s*${field}\\s*:`, "i").test(line),
    );
    return index === -1 ? undefined : index + 1;
}

/* ------------------------------------------------------------------ *
 * Measures
 * ------------------------------------------------------------------ */

const tokenCount: MeasureFn = ({ ctx, params }) => {
    const estimator = str(params, "estimator", "chars/4");
    const divisor = Number(estimator.split("/")[1]) || 4;
    const tokens = Math.ceil(ctx.raw.length / divisor);
    return {
        value: tokens,
        evidence: [
            {
                hint: `${ctx.raw.length} characters ≈ ${tokens} tokens (estimator: ${estimator})`,
            },
        ],
    };
};

const frontmatterValid: MeasureFn = ({ ctx }) => ({
    value: ctx.frontmatterValid,
    evidence: ctx.frontmatterValid
        ? []
        : [{ line: 1, hint: ctx.frontmatterError ?? "invalid frontmatter" }],
});

const frontmatterField: MeasureFn = ({ ctx, params }) => {
    const field = str(params, "field");
    const present = fieldValues(ctx, field).length > 0;
    return {
        value: present,
        evidence: present
            ? [{ line: frontmatterLine(ctx, field), hint: `${field} is set` }]
            : [{ line: 1, hint: `${field} is missing or empty` }],
    };
};

const globValidity: MeasureFn = ({ ctx, params }) => {
    const field = str(params, "field");
    const values = fieldValues(ctx, field);
    const line = frontmatterLine(ctx, field);
    const broken: Evidence[] = [];

    for (const value of values) {
        if (!isCompilableGlob(value)) {
            broken.push({ line, excerpt: value, hint: "not a usable glob" });
        }
    }

    return { value: values.length > 0 && broken.length === 0, evidence: broken };
};

const globBreadth: MeasureFn = ({ ctx, params, config }) => {
    const field = str(params, "field");
    const patterns = compile(patternSet(config, str(params, "patternSet")));
    const line = frontmatterLine(ctx, field);
    const tooBroad: Evidence[] = [];

    for (const value of fieldValues(ctx, field)) {
        for (const { re, hint } of patterns) {
            re.lastIndex = 0;
            if (re.test(value)) tooBroad.push({ line, excerpt: value, hint });
        }
    }

    return { value: tooBroad.length === 0, evidence: tooBroad };
};

const wordDensity: MeasureFn = ({ ctx, params, config }) => {
    const per = num(params, "per", 100);
    const set = wordSet(config, str(params, "wordSet"));
    const total = ctx.proseWords.length;
    if (total === 0) return { value: 0 };

    const evidence: Evidence[] = [];
    let hits = 0;

    for (const phrase of set) {
        const count = countPhrase(ctx.prose, phrase);
        if (count === 0) continue;
        hits += count;
        evidence.push({ excerpt: phrase, hint: `${count}×` });
    }

    evidence.sort((a, b) => (b.hint ?? "").localeCompare(a.hint ?? "", undefined, { numeric: true }));

    return {
        value: (hits / total) * per,
        evidence: evidence.slice(0, 8),
    };
};

const patternHits: MeasureFn = ({ ctx, params, config }) => {
    const patterns = compile(patternSet(config, str(params, "patternSet")));
    const evidence: Evidence[] = [];

    for (const { re, hint } of patterns) {
        re.lastIndex = 0;
        for (const match of ctx.raw.matchAll(re)) {
            const index = match.index ?? 0;
            evidence.push({
                line: lineAt(ctx.raw, index),
                // Redact the match itself, keep a little context around it.
                excerpt: `${redact(match[0])} — ${excerptAt(ctx.raw, index)}`,
                hint,
            });
        }
    }

    return { value: evidence.length, evidence };
};

const markerPresence: MeasureFn = ({ ctx, params, config }) => {
    const set = wordSet(config, str(params, "wordSet"));
    const found = set.filter((marker) => countPhrase(ctx.prose, marker) > 0);
    const viaFence = bool(params, "orCodeFence", false) && ctx.hasCodeFence;

    return {
        value: found.length > 0 || viaFence,
        evidence:
            found.length > 0
                ? [{ hint: `found: ${found.slice(0, 5).join(", ")}` }]
                : viaFence
                    ? [{ hint: "code block counts as an example" }]
                    : [{ hint: "no marker found" }],
    };
};

const headingStructure: MeasureFn = ({ ctx, params }) => {
    const minFromLines = num(params, "minHeadingsFromLines", 40);
    const allowSkips = bool(params, "allowLevelSkips", false);
    const evidence: Evidence[] = [];
    let problems = 0;

    const headings = ctx.body
        .split(/\r?\n/)
        .map((line, index) => ({ line: index + ctx.bodyOffset, match: /^(#{1,6})\s+\S/.exec(line) }))
        .filter((item): item is { line: number; match: RegExpExecArray } => item.match !== null)
        .map((item) => ({ line: item.line, level: item.match[1].length }));

    if (ctx.rawLines.length >= minFromLines && headings.length < 2) {
        problems++;
        evidence.push({
            hint: `${ctx.rawLines.length} lines with ${headings.length} heading(s) — no outline`,
        });
    }

    if (!allowSkips) {
        for (let i = 1; i < headings.length; i++) {
            if (headings[i].level - headings[i - 1].level > 1) {
                problems++;
                evidence.push({
                    line: headings[i].line,
                    hint: `level jumps from h${headings[i - 1].level} to h${headings[i].level}`,
                });
            }
        }
    }

    return { value: problems, evidence };
};

const blockLength: MeasureFn = ({ ctx, params }) => {
    const kind = str(params, "kind", "paragraph");
    const unit = str(params, "unit", "chars");
    const limit = num(params, "limit", 400);

    const blocks: Block[] =
        kind === "codeFence"
            ? codeFenceBlocks(ctx)
            : kind === "listItem"
                ? listItemBlocks(ctx)
                : paragraphBlocks(ctx);

    const oversized = blocks.filter(
        (block) => (unit === "lines" ? block.lines : block.chars) > limit,
    );

    return {
        value: oversized.length,
        evidence: oversized.slice(0, 8).map((block) => ({
            line: block.line,
            excerpt: block.text.slice(0, 60).replace(/\s+/g, " ").trim(),
            hint: `${unit === "lines" ? block.lines : block.chars} ${unit}, limit ${limit}`,
        })),
    };
};

const duplicateLines: MeasureFn = ({ ctx, params }) => {
    const minLength = num(params, "minLength", 25);
    const shouldNormalize = bool(params, "normalize", true);
    const seen = new Map<string, number>();
    const evidence: Evidence[] = [];
    let duplicates = 0;

    ctx.rawLines.forEach((line, index) => {
        const key = shouldNormalize ? normalizeLine(line) : line.trim();
        if (key.length < minLength) return;

        const first = seen.get(key);
        if (first === undefined) {
            seen.set(key, index + 1);
            return;
        }
        duplicates++;
        evidence.push({
            line: index + 1,
            excerpt: line.trim().slice(0, 60),
            hint: `already stated on line ${first}`,
        });
    });

    return { value: duplicates, evidence };
};

const languageGuess: MeasureFn = ({ ctx, params, config }) => {
    const expected = str(params, "expected", "en");
    const minWords = num(params, "minWords", 40);
    const assumeOnUncertain = bool(params, "assumeOnUncertain", true);
    const sets = (params.stopwordSets ?? {}) as Record<string, string>;

    if (ctx.proseWords.length < minWords) {
        return {
            value: assumeOnUncertain,
            evidence: [
                {
                    hint: `only ${ctx.proseWords.length} words of prose — too short to detect the language reliably`,
                },
            ],
        };
    }

    const counts = Object.entries(sets).map(([language, setId]) => {
        const stopwords = new Set(wordSet(config, setId));
        const hits = ctx.proseWords.filter((word) => stopwords.has(word)).length;
        return { language, hits };
    });

    const total = counts.reduce((sum, item) => sum + item.hits, 0);
    const best = counts.sort((a, b) => b.hits - a.hits)[0];

    if (!best || total === 0) {
        return {
            value: assumeOnUncertain,
            evidence: [{ hint: "no stopwords matched — language undetermined" }],
        };
    }

    const confidence = Math.round((best.hits / total) * 100);
    return {
        value: best.language === expected,
        evidence: [
            {
                hint: `detected "${best.language}" (${confidence}% of matched stopwords), expected "${expected}"`,
            },
        ],
    };
};

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

export const measures: Record<Measure["type"], MeasureFn> = {
    tokenCount,
    frontmatterValid,
    frontmatterField,
    globValidity,
    globBreadth,
    wordDensity,
    patternHits,
    markerPresence,
    headingStructure,
    blockLength,
    duplicateLines,
    languageGuess,
};

/* ------------------------------------------------------------------ *
 * Local helpers
 * ------------------------------------------------------------------ */

function compile(patterns: PatternDef[]): { re: RegExp; hint: string }[] {
    return patterns.map((pattern) => ({
        re: new RegExp(pattern.re, ensureGlobal(pattern.flags)),
        hint: pattern.hint,
    }));
}

function ensureGlobal(flags = ""): string {
    return flags.includes("g") ? flags : `${flags}g`;
}

function isCompilableGlob(value: string): boolean {
    if (value.trim() === "") return false;
    // Unbalanced braces or brackets are the failure mode we actually see.
    if (countChar(value, "{") !== countChar(value, "}")) return false;
    if (countChar(value, "[") !== countChar(value, "]")) return false;
    try {
        picomatch(value);
        return true;
    } catch {
        return false;
    }
}

function countChar(value: string, char: string): number {
    return value.split(char).length - 1;
}

function normalizeLine(line: string): string {
    return line
        .trim()
        .toLowerCase()
        .replace(/^([-*+]|\d+\.)\s+/, "")
        .replace(/\s+/g, " ")
        .replace(/[.:;,]+$/, "");
}

export { phraseRegex };
