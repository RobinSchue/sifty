/**
 * Sifty — AI-assisted fix prompt generation.
 *
 * Turns a completed Report's fix list into two ready-to-use prompts (a short
 * one and a full one) via an AiProvider. Separate from src/engine/ai-checks.ts
 * on purpose: different concern (writing a helpful prompt, not scoring),
 * different model tier chosen by the caller when it builds the provider —
 * this module does not know or care which model answers it.
 */
import { z } from "zod";

import type { AiProvider, TokenUsage } from "../engine/ai-provider.js";

export const fixPromptResponseSchema = z.object({
  short: z.string(),
  full: z.string(),
});

export type FixPromptResponse = z.infer<typeof fixPromptResponseSchema>;

export interface GenerateFixPromptArgs {
  report: { readonly fixes: ReadonlyArray<{ readonly text: string; readonly impact: number }> };
  fileContent: string;
  fileKind: string;
  tool: string;
  provider?: AiProvider | undefined;
}

const MAX_TOKENS = 2048;

/**
 * Generate human-friendly fix prompts from a completed report.
 * Produces two formats: short (quick list) and full (detailed prompt for Claude/ChatGPT).
 * No provider call if there are no fixes — just return empty prompts.
 */
export async function generateFixPrompt(args: GenerateFixPromptArgs): Promise<{
  short: string;
  full: string;
  error?: string;
  usage?: TokenUsage | undefined;
}> {
  if (!args.report.fixes || args.report.fixes.length === 0) {
    return { short: "", full: "" };
  }

  if (!args.provider) {
    return { short: "", full: "", error: "Fix prompt requires an AI provider." };
  }

  try {
    const response = await args.provider.complete({
      // The original request had no system prompt at all; "" preserves that
      // (an empty system string adds no instructions) while satisfying the
      // port's required `system: string`.
      system: "",
      user: buildFixPromptRequest(args),
      schema: fixPromptResponseSchema,
      maxTokens: MAX_TOKENS,
    });
    const parsed = fixPromptResponseSchema.safeParse(response.output);

    if (!parsed.success) {
      return {
        short: "",
        full: "",
        error: `Invalid fix prompt response: ${parsed.error.issues[0]?.message ?? "unknown"}`,
        usage: response.usage,
      };
    }

    return { short: parsed.data.short, full: parsed.data.full, usage: response.usage };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { short: "", full: "", error: `Fix prompt generation failed: ${message}` };
  }
}

function buildFixPromptRequest(args: GenerateFixPromptArgs): string {
  const fixList = args.report.fixes
    .map((fix, i) => `${i + 1}. ${fix.text} (impact: ${fix.impact})`)
    .join("\n");

  return [
    `File: ${args.fileKind} (${args.tool})`,
    // Full content, not a truncated excerpt — the "full" style below is documented
    // to include the whole file, and a prompt for Claude/ChatGPT that quotes only
    // an excerpt would generate fixes for text the model never saw.
    `Content:\n\`\`\`\n${args.fileContent}\n\`\`\``,
    "Found issues (ranked by impact):",
    fixList,
    "",
    "Generate two prompts:",
    '1. "short": A brief 1-2 sentence suggestion: "Here are the issues: [...]. Please fix them."',
    '2. "full": A complete, ready-to-use prompt for Claude/ChatGPT that includes the full file content and a detailed ask to improve it.',
    "",
    'Return only valid JSON matching: {"short": "...", "full": "..."}',
  ].join("\n");
}
