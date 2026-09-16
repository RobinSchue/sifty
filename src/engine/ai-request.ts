/**
 * Sifty — one structured request through the AiProvider port.
 *
 * Shared by every caller that asks the model for a Zod-shaped answer: sends
 * the request, validates the output, and classifies what came back so the
 * caller can decide whether a retry makes sense.
 */
import type { z } from "zod";

import type { AiProvider, TokenUsage } from "./ai-provider.js";

export type StructuredResult<T> = (
  | { kind: "ok"; data: T }
  | { kind: "invalid"; message: string }
  | { kind: "api-error"; message: string }
) & { usage?: TokenUsage | undefined };

export async function requestStructured<T>(
  provider: AiProvider,
  request: { system: string; user: string; maxTokens: number },
  schema: z.ZodType<T>,
): Promise<StructuredResult<T>> {
  try {
    const response = await provider.complete({
      system: request.system,
      user: request.user,
      schema,
      maxTokens: request.maxTokens,
    });
    const parsed = schema.safeParse(response.output);
    if (!parsed.success) {
      return { kind: "invalid", message: describeZodError(parsed.error), usage: response.usage };
    }
    return { kind: "ok", data: parsed.data, usage: response.usage };
  } catch (error) {
    const message = oneLine(error instanceof Error ? error.message : String(error));
    return looksLikeStructuredOutputError(message)
      ? { kind: "invalid", message }
      : { kind: "api-error", message };
  }
}

export function addUsage(
  total: TokenUsage | undefined,
  next: TokenUsage | undefined,
): TokenUsage | undefined {
  if (!next) return total;
  return {
    inputTokens: (total?.inputTokens ?? 0) + next.inputTokens,
    outputTokens: (total?.outputTokens ?? 0) + next.outputTokens,
  };
}

function describeZodError(error: z.ZodError): string {
  const firstIssue = error.issues[0];
  if (!firstIssue) return "The response did not match the expected schema.";

  const path = firstIssue.path.length > 0 ? firstIssue.path.join(".") : "response";
  return oneLine(`The response field "${path}" ${firstIssue.message}.`);
}

function looksLikeStructuredOutputError(message: string): boolean {
  return /parse structured output|structured output|json/i.test(message);
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
