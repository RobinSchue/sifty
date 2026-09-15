/**
 * Sifty — Anthropic provider adapter tests.
 *
 * Exercises request/response mapping only, via the `client` test seam
 * (no network, no real Anthropic instance). What actually gets sent to the
 * live API is out of scope here — that's the SDK's own contract, not ours.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { DEFAULT_MODEL, createAnthropicProvider } from "./anthropic.js";

const SCHEMA = z.object({ answer: z.string() });

function makeFakeClient(
  parseImpl: (request: unknown) => Promise<{
    parsed_output: unknown;
    usage: { input_tokens: number; output_tokens: number };
  }>,
) {
  const parse = vi.fn(parseImpl);
  return { client: { messages: { parse } }, parse };
}

describe("createAnthropicProvider", () => {
  it("maps a completion request onto the SDK's parse() call, using the default model", async () => {
    const { client, parse } = makeFakeClient(async () => ({
      parsed_output: { answer: "42" },
      usage: { input_tokens: 10, output_tokens: 5 },
    }));

    const provider = createAnthropicProvider({ apiKey: "unused", client });
    const result = await provider.complete({
      system: "system prompt",
      user: "user prompt",
      schema: SCHEMA,
      maxTokens: 123,
    });

    expect(parse).toHaveBeenCalledTimes(1);
    const request = parse.mock.calls[0]?.[0] as {
      model: string;
      max_tokens: number;
      system: string;
      messages: { role: string; content: string }[];
      output_config: { format: unknown };
    };
    expect(request.model).toBe(DEFAULT_MODEL);
    expect(request.max_tokens).toBe(123);
    expect(request.system).toBe("system prompt");
    expect(request.messages).toEqual([{ role: "user", content: "user prompt" }]);
    expect(request.output_config.format).toBeDefined();

    expect(result.output).toEqual({ answer: "42" });
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("uses the model passed in options instead of the default", async () => {
    const { client, parse } = makeFakeClient(async () => ({
      parsed_output: {},
      usage: { input_tokens: 0, output_tokens: 0 },
    }));

    const provider = createAnthropicProvider({
      apiKey: "unused",
      model: "claude-sonnet-5",
      client,
    });
    await provider.complete({ system: "s", user: "u", schema: SCHEMA, maxTokens: 10 });

    const request = parse.mock.calls[0]?.[0] as { model: string };
    expect(request.model).toBe("claude-sonnet-5");
  });

  it("propagates a rejected parse() call unchanged", async () => {
    const { client } = makeFakeClient(async () => {
      throw new Error("401 unauthorized");
    });

    const provider = createAnthropicProvider({ apiKey: "unused", client });

    await expect(
      provider.complete({ system: "s", user: "u", schema: SCHEMA, maxTokens: 10 }),
    ).rejects.toThrow("401 unauthorized");
  });
});
