/**
 * Sifty — bundled AI evaluation.
 *
 * Builds the single structured request for all pending AI checks, sends it
 * through an `AiProvider` (see ai-provider.ts — no SDK import here, on
 * purpose), validates the response, and retries once when the model returns
 * malformed or incomplete structured data.
 */
import { z } from "zod";

import type { AiProvider, TokenUsage } from "./ai-provider.js";
import type { Check } from "../criteria/types.js";
import type { AiFinding, Evidence } from "../report.types.js";

export const aiEvidenceSchema = z.object({
  line: z.number().int().positive().optional(),
  excerpt: z.string().optional(),
  hint: z.string().optional(),
});

export const aiFindingSchema = z.object({
  checkId: z.string(),
  score: z.number().min(0).max(100),
  rationale: z.string(),
  evidence: z.array(aiEvidenceSchema).optional(),
});

/** Object root: structured outputs are documented with an object at the top level, not an array. */
export const aiFindingsResponseSchema = z.object({
  findings: z.array(aiFindingSchema),
});

export type AiFindingsResponse = z.infer<typeof aiFindingsResponseSchema>["findings"];

export interface BuildAiRequestArgs {
  checks: Check[];
  fileContent: string;
  fileKind: string;
  tool: string;
  retryReason?: string | undefined;
}

export interface RunAiChecksArgs {
  checks: Check[];
  fileContent: string;
  fileKind: string;
  tool: string;
  provider?: AiProvider | undefined;
}

const MAX_TOKENS = 4096;

const SYSTEM_PROMPT = [
  "You are evaluating one AI tool instruction file for Sifty.",
  "Answer every requested check independently.",
  "Use each provided check id exactly as the response checkId.",
  "Scores must be numbers from 0 to 100 inclusive.",
  "Return only structured output matching the requested schema.",
].join(" ");

/** The two pieces an AiProvider needs — model, token budget and output format are its concern, not ours. */
export function buildAiRequest(args: BuildAiRequestArgs): { system: string; user: string } {
  const retryNote = args.retryReason
    ? [
        "Retry note:",
        args.retryReason,
        "Return a complete replacement answer covering every requested check id.",
      ].join("\n")
    : undefined;

  const checkList = args.checks
    .map((check, index) => {
      const question = check.question?.trim() || `Assess "${check.label}".`;
      return [
        `${index + 1}. id: ${check.id}`,
        `   label: ${check.label}`,
        `   question: ${question}`,
      ].join("\n");
    })
    .join("\n");

  const promptSections = [
    `Tool: ${args.tool}`,
    `File kind: ${args.fileKind}`,
    `Requested checks: ${args.checks.length}`,
    "Return exactly one findings entry per requested check id. Do not invent or rename check ids.",
    "Each entry must contain: checkId, score, rationale, and optional evidence[].",
    "If you include evidence, keep excerpts short and line numbers 1-based.",
    "Checks:",
    checkList,
    "File content:",
    "```text",
    args.fileContent,
    "```",
  ];

  if (retryNote) {
    promptSections.push(retryNote);
  }

  return { system: SYSTEM_PROMPT, user: promptSections.join("\n\n") };
}

export async function runAiChecks(args: RunAiChecksArgs): Promise<{
  findings: AiFinding[];
  error?: string;
  usage?: TokenUsage | undefined;
}> {
  if (args.checks.length === 0) {
    return { findings: [] };
  }

  if (!args.provider) {
    return {
      findings: [],
      error: "AI checks require an AI provider.",
    };
  }

  let retryReason: string | undefined;
  let totalUsage: TokenUsage | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    const request = buildAiRequest({
      checks: args.checks,
      fileContent: args.fileContent,
      fileKind: args.fileKind,
      tool: args.tool,
      retryReason,
    });

    const response = await requestFindings(args.provider, request);
    if (response.usage) {
      totalUsage = {
        inputTokens: (totalUsage?.inputTokens ?? 0) + response.usage.inputTokens,
        outputTokens: (totalUsage?.outputTokens ?? 0) + response.usage.outputTokens,
      };
    }

    if (response.kind === "api-error") {
      return { findings: [], error: `AI checks failed: ${response.message}`, usage: totalUsage };
    }

    if (response.kind === "invalid") {
      if (attempt === 0) {
        retryReason = response.message;
        continue;
      }
      return {
        findings: [],
        error: `AI response was invalid after one retry: ${response.message}`,
        usage: totalUsage,
      };
    }

    const selected = selectRequestedFindings(response.findings, args.checks);
    if (selected.missingIds.length > 0) {
      if (attempt === 0) {
        retryReason = `The previous response was incomplete. Missing check ids: ${selected.missingIds.join(", ")}.`;
        continue;
      }
      return {
        findings: [],
        error: `AI response was incomplete after one retry: missing ${selected.missingIds.join(", ")}.`,
        usage: totalUsage,
      };
    }

    return { findings: selected.findings, usage: totalUsage };
  }

  return { findings: [], error: "AI response was invalid after one retry.", usage: totalUsage };
}

type RequestFindingsResult = (
  | { kind: "ok"; findings: AiFindingsResponse }
  | { kind: "invalid"; message: string }
  | { kind: "api-error"; message: string }
) & { usage?: TokenUsage | undefined };

async function requestFindings(
  provider: AiProvider,
  request: { system: string; user: string },
): Promise<RequestFindingsResult> {
  try {
    const response = await provider.complete({
      system: request.system,
      user: request.user,
      schema: aiFindingsResponseSchema,
      maxTokens: MAX_TOKENS,
    });
    const parsed = aiFindingsResponseSchema.safeParse(response.output);
    if (!parsed.success) {
      return { kind: "invalid", message: describeZodError(parsed.error), usage: response.usage };
    }
    return { kind: "ok", findings: parsed.data.findings, usage: response.usage };
  } catch (error) {
    const message = oneLine(error instanceof Error ? error.message : String(error));
    return looksLikeStructuredOutputError(message)
      ? { kind: "invalid", message }
      : { kind: "api-error", message };
  }
}

function describeZodError(error: z.ZodError): string {
  const firstIssue = error.issues[0];
  if (!firstIssue) return "The response did not match the expected findings object.";

  const path = firstIssue.path.length > 0 ? firstIssue.path.join(".") : "response";
  return oneLine(`The response field "${path}" ${firstIssue.message}.`);
}

function looksLikeStructuredOutputError(message: string): boolean {
  return /parse structured output|structured output|json/i.test(message);
}

function selectRequestedFindings(
  findings: AiFindingsResponse,
  checks: Check[],
): { findings: AiFinding[]; missingIds: string[] } {
  const requestedIds = new Set(checks.map((check) => check.id));
  const findingById = new Map<string, AiFinding>();

  for (const finding of findings) {
    if (!requestedIds.has(finding.checkId)) continue;
    findingById.set(finding.checkId, normalizeFinding(finding));
  }

  const orderedFindings: AiFinding[] = [];
  const missingIds: string[] = [];

  for (const check of checks) {
    const finding = findingById.get(check.id);
    if (finding) {
      orderedFindings.push(finding);
    } else {
      missingIds.push(check.id);
    }
  }

  return { findings: orderedFindings, missingIds };
}

function normalizeFinding(finding: z.infer<typeof aiFindingSchema>): AiFinding {
  // No clamp here: aiFindingSchema already validates score with .min(0).max(100) —
  // clamping an already-validated value would only hide a schema bug. scoring.ts
  // keeps the one real clampScore(), for AiFinding values supplied directly via
  // AnalyzeDeps.aiFindings, which bypass this schema entirely.
  return {
    checkId: finding.checkId,
    score: finding.score,
    rationale: finding.rationale,
    evidence: normalizeEvidence(finding.evidence),
  };
}

function normalizeEvidence(
  evidence: z.infer<typeof aiEvidenceSchema>[] | undefined,
): Evidence[] | undefined {
  if (!evidence || evidence.length === 0) return undefined;
  return evidence.map((entry) => ({
    line: entry.line,
    excerpt: entry.excerpt,
    hint: entry.hint,
  }));
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
