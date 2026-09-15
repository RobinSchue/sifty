import { describe, expect, it, vi } from "vitest";

import type { AiProvider } from "../engine/ai-provider.js";
import { generateFixPrompt } from "./generate.js";

function makeProvider(completeImpl: AiProvider["complete"]) {
  const complete = vi.fn<AiProvider["complete"]>(completeImpl);
  return { provider: { complete } satisfies AiProvider, complete };
}

describe("generateFixPrompt", () => {
  it("returns empty prompts when there are no fixes, without calling the provider", async () => {
    const { provider, complete } = makeProvider(async () => ({ output: {} }));

    const { short, full, error } = await generateFixPrompt({
      report: { fixes: [] },
      fileContent: "body",
      fileKind: "scoped",
      tool: "copilot",
      provider,
    });

    expect(short).toBe("");
    expect(full).toBe("");
    expect(error).toBeUndefined();
    expect(complete).not.toHaveBeenCalled();
  });

  it("returns an error, no prompts, when no provider is given", async () => {
    const { short, full, error } = await generateFixPrompt({
      report: { fixes: [{ text: "Fix this", impact: 10 }] },
      fileContent: "body",
      fileKind: "scoped",
      tool: "copilot",
    });

    expect(short).toBe("");
    expect(full).toBe("");
    expect(error).toBe("Fix prompt requires an AI provider.");
  });

  it("generates fix prompts from a structured response", async () => {
    const { provider, complete } = makeProvider(async () => ({
      output: {
        short: "Issue 1: vague. Issue 2: lacks examples. Please fix.",
        full: "Here is your file: [...]. Problems: 1) vague. 2) lacks examples. Improve clarity and add examples.",
      },
      usage: { inputTokens: 300, outputTokens: 90 },
    }));

    const { short, full, error, usage } = await generateFixPrompt({
      report: { fixes: [{ text: "Add examples", impact: 50 }] },
      fileContent: "# Title\nbody",
      fileKind: "scoped",
      tool: "copilot",
      provider,
    });

    expect(complete).toHaveBeenCalledOnce();
    expect(short).toContain("vague");
    expect(full).toContain("Problems");
    expect(error).toBeUndefined();
    expect(usage).toEqual({ inputTokens: 300, outputTokens: 90 });
  });

  it("sends the full file content, not a truncated excerpt (regression)", async () => {
    const longContent = `# Title\n${"word ".repeat(200)}`; // > 500 chars
    expect(longContent.length).toBeGreaterThan(500);

    const { provider, complete } = makeProvider(async () => ({
      output: { short: "s", full: "f" },
    }));

    await generateFixPrompt({
      report: { fixes: [{ text: "Fix this", impact: 10 }] },
      fileContent: longContent,
      fileKind: "scoped",
      tool: "copilot",
      provider,
    });

    const request = complete.mock.calls[0]?.[0];
    expect(request?.user).toContain(longContent);
    expect(request?.user).not.toContain("...\n```");
  });

  it("sends no system prompt (preserves the original request shape)", async () => {
    const { provider, complete } = makeProvider(async () => ({
      output: { short: "s", full: "f" },
    }));

    await generateFixPrompt({
      report: { fixes: [{ text: "Fix this", impact: 10 }] },
      fileContent: "body",
      fileKind: "scoped",
      tool: "copilot",
      provider,
    });

    expect(complete.mock.calls[0]?.[0]?.system).toBe("");
  });

  it("returns an error when the response does not match the schema", async () => {
    const { provider } = makeProvider(async () => ({ output: { short: "only-short" } }));

    const { short, full, error } = await generateFixPrompt({
      report: { fixes: [{ text: "Fix this", impact: 10 }] },
      fileContent: "body",
      fileKind: "scoped",
      tool: "copilot",
      provider,
    });

    expect(short).toBe("");
    expect(full).toBe("");
    expect(error).toContain("Invalid fix prompt response");
  });

  it("returns an error when the provider throws", async () => {
    const { provider } = makeProvider(async () => {
      throw new Error("503 Service Unavailable");
    });

    const { short, full, error } = await generateFixPrompt({
      report: { fixes: [{ text: "Fix this", impact: 100 }] },
      fileContent: "body",
      fileKind: "scoped",
      tool: "copilot",
      provider,
    });

    expect(short).toBe("");
    expect(full).toBe("");
    expect(error).toContain("503");
  });
});
