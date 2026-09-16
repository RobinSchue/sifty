/**
 * Sifty — the contradiction rule: one bundled request over every file.
 *
 * All files go into a single call (not pairwise): the model has to see a
 * third file that settles precedence, and a three-way conflict is one
 * finding, not three. Files are labelled f1..fN in the prompt so the model
 * echoes an id it cannot mangle; the mapping back to paths happens here.
 */
import { z } from "zod";

import type { CompositeRule } from "./rules.js";
import type { CompositeEvidence, CompositeFinding } from "./types.js";
import type { AiProvider, TokenUsage } from "../engine/ai-provider.js";
import { addUsage, requestStructured } from "../engine/ai-request.js";

export interface CompositeFile {
  path: string;
  content: string;
  fileKind: string;
}

export interface BuildCompositeRequestArgs {
  rule: CompositeRule;
  files: CompositeFile[];
  retryReason?: string | undefined;
}

export interface RunCompositeRuleArgs {
  rule: CompositeRule;
  files: CompositeFile[];
  provider: AiProvider;
}

const MAX_TOKENS = 4096;

const SYSTEM_PROMPT = [
  "You are reviewing several instruction files that are all loaded into the same AI coding assistant.",
  "Report only genuine conflicts BETWEEN different files, never within one file.",
  "Refer to files only by the file ids given; never invent ids.",
  "An empty findings array is a valid and expected answer when the files agree.",
  "Return only structured output matching the requested schema.",
].join(" ");

const compositeEvidenceSchema = z.object({
  fileId: z.string(),
  line: z.number().int().positive().optional(),
  excerpt: z.string().optional(),
});

const compositeFindingSchema = z.object({
  summary: z.string(),
  rationale: z.string(),
  evidence: z.array(compositeEvidenceSchema).min(2),
});

/** Object root: structured outputs are documented with an object at the top level, not an array. */
export const compositeFindingsResponseSchema = z.object({
  findings: z.array(compositeFindingSchema),
});

type CompositeFindingsResponse = z.infer<typeof compositeFindingsResponseSchema>["findings"];

function fileId(index: number): string {
  return `f${index + 1}`;
}

export function buildCompositeRequest(args: BuildCompositeRequestArgs): {
  system: string;
  user: string;
} {
  const fileSections = args.files.map((file, index) =>
    [
      `--- file id: ${fileId(index)}, path: ${file.path}, kind: ${file.fileKind} ---`,
      "```text",
      file.content,
      "```",
    ].join("\n"),
  );

  const promptSections = [
    `Rule: ${args.rule.id} — ${args.rule.label}`,
    args.rule.question,
    `Return at most ${args.rule.maxFindings} findings. Every finding must cite at least two different file ids.`,
    "Each finding must contain: summary, rationale, and evidence[] with fileId, optional 1-based line, and a short excerpt.",
    `Files: ${args.files.length}`,
    ...fileSections,
  ];

  if (args.retryReason) {
    promptSections.push(
      ["Retry note:", args.retryReason, "Return a complete replacement answer."].join("\n"),
    );
  }

  return { system: SYSTEM_PROMPT, user: promptSections.join("\n\n") };
}

export async function runContradictionRule(args: RunCompositeRuleArgs): Promise<{
  findings: CompositeFinding[];
  error?: string | undefined;
  usage?: TokenUsage | undefined;
}> {
  let retryReason: string | undefined;
  let totalUsage: TokenUsage | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    const request = buildCompositeRequest({ rule: args.rule, files: args.files, retryReason });
    const response = await requestStructured(
      args.provider,
      { ...request, maxTokens: MAX_TOKENS },
      compositeFindingsResponseSchema,
    );
    totalUsage = addUsage(totalUsage, response.usage);

    if (response.kind === "api-error") {
      return {
        findings: [],
        error: `Rule "${args.rule.id}" failed: ${response.message}`,
        usage: totalUsage,
      };
    }

    if (response.kind === "invalid") {
      if (attempt === 0) {
        retryReason = response.message;
        continue;
      }
      return {
        findings: [],
        error: `Rule "${args.rule.id}": AI response was invalid after one retry: ${response.message}`,
        usage: totalUsage,
      };
    }

    return {
      findings: normalizeFindings(response.data.findings, args.rule, args.files),
      usage: totalUsage,
    };
  }

  return { findings: [], error: "AI response was invalid after one retry.", usage: totalUsage };
}

/** Drops what the model got wrong (unknown ids, one-file findings), caps the count, stamps rule policy on. */
function normalizeFindings(
  findings: CompositeFindingsResponse,
  rule: CompositeRule,
  files: CompositeFile[],
): CompositeFinding[] {
  const pathById = new Map(files.map((file, index) => [fileId(index), file.path]));
  const normalized: CompositeFinding[] = [];

  for (const finding of findings) {
    const evidence: CompositeEvidence[] = [];
    for (const entry of finding.evidence) {
      const file = pathById.get(entry.fileId);
      if (!file) continue;
      evidence.push({ file, line: entry.line, excerpt: entry.excerpt });
    }
    if (new Set(evidence.map((entry) => entry.file)).size < 2) continue;

    normalized.push({
      ruleId: rule.id,
      severity: rule.severity,
      summary: finding.summary,
      rationale: finding.rationale,
      fix: rule.fix,
      evidence,
    });
    if (normalized.length === rule.maxFindings) break;
  }

  return normalized;
}
