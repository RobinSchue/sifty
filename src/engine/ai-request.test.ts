import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { AiProvider } from "./ai-provider.js";
import { addUsage, requestStructured } from "./ai-request.js";

const schema = z.object({ answer: z.string() });
const request = { system: "sys", user: "usr", maxTokens: 100 };

function makeProvider(completeImpl: AiProvider["complete"]) {
  const complete = vi.fn<AiProvider["complete"]>(completeImpl);
  return { provider: { complete } satisfies AiProvider, complete };
}

describe("requestStructured", () => {
  it("passes the request through the port and returns validated data with usage", async () => {
    const { provider, complete } = makeProvider(async () => ({
      output: { answer: "yes" },
      usage: { inputTokens: 10, outputTokens: 2 },
    }));

    const result = await requestStructured(provider, request, schema);

    expect(result).toEqual({
      kind: "ok",
      data: { answer: "yes" },
      usage: { inputTokens: 10, outputTokens: 2 },
    });
    expect(complete).toHaveBeenCalledWith({ ...request, schema });
  });

  it("classifies output that fails the schema as invalid, naming the field", async () => {
    const { provider } = makeProvider(async () => ({
      output: { answer: 42 },
      usage: { inputTokens: 1, outputTokens: 1 },
    }));

    const result = await requestStructured(provider, request, schema);

    expect(result.kind).toBe("invalid");
    expect(result).toMatchObject({ usage: { inputTokens: 1, outputTokens: 1 } });
    if (result.kind === "invalid") expect(result.message).toContain('"answer"');
  });

  it("classifies a structured-output failure thrown by the provider as invalid", async () => {
    const { provider } = makeProvider(async () => {
      throw new Error("Could not parse structured output\n  from the model");
    });

    const result = await requestStructured(provider, request, schema);

    expect(result).toEqual({
      kind: "invalid",
      message: "Could not parse structured output from the model",
    });
  });

  it("classifies any other thrown error as an api-error", async () => {
    const { provider } = makeProvider(async () => {
      throw new Error("rate limited");
    });

    const result = await requestStructured(provider, request, schema);

    expect(result).toEqual({ kind: "api-error", message: "rate limited" });
  });
});

describe("addUsage", () => {
  it("keeps the running total when the next call reports no usage", () => {
    expect(addUsage(undefined, undefined)).toBeUndefined();
    expect(addUsage({ inputTokens: 3, outputTokens: 1 }, undefined)).toEqual({
      inputTokens: 3,
      outputTokens: 1,
    });
  });

  it("sums usage across calls", () => {
    const first = addUsage(undefined, { inputTokens: 3, outputTokens: 1 });
    expect(addUsage(first, { inputTokens: 4, outputTokens: 2 })).toEqual({
      inputTokens: 7,
      outputTokens: 3,
    });
  });
});
