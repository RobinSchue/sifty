/**
 * Sifty — check runner.
 *
 * `analyze()` is the engine's one entry point: config and content in, a
 * report out. Pure — no file system, no `process`, no network. It DOES take
 * a pre-loaded `CriteriaConfig` and, optionally, an `AiProvider`, because
 * loading a config from disk and reaching a real model are composition-root
 * concerns (see src/cli.ts), not scoring concerns. That is what makes this
 * function safe to call from a web UI or a test with nothing but an object.
 */

import { detectFileKind } from "../criteria/load.js";
import type { Check, CriteriaConfig } from "../criteria/types.js";
import type { AiFinding, Measurement, Report } from "../report.types.js";
import { runAiChecks } from "./ai-checks.js";
import type { AiProvider, TokenUsage } from "./ai-provider.js";
import { measures } from "./measures.js";
import { buildReport, resolveCheck } from "./scoring.js";
import { prepareFile, type FileContext } from "./text.js";

export interface AnalyzeInput {
  /** Used for file-kind detection (unless `fileKind` overrides it) and recorded on the report. */
  path: string;
  content: string;
}

export interface AnalyzeDeps {
  config: CriteriaConfig;
  preset?: string | undefined;
  /** Overrides glob detection — useful for testing and for odd file layouts. */
  fileKind?: string | undefined;
  /** Pre-computed findings (tests, web UI later). When set, no provider call is made. */
  aiFindings?: AiFinding[] | undefined;
  /** How to reach the model for `mode: "ai"` checks. Omitted → mechanical checks only. */
  provider?: AiProvider | undefined;
}

export interface AnalyzeResult {
  report: Report;
  /** Checks whose measure threw — the run continues, they become not applicable. */
  failures: { checkId: string; message: string }[];
  /** Set when the AI call was attempted but produced no usable findings. */
  aiError?: string | undefined;
  /** Token usage of the bundled AI call, when a provider ran and reported it. */
  usage?: TokenUsage | undefined;
}

export async function analyze(input: AnalyzeInput, deps: AnalyzeDeps): Promise<AnalyzeResult> {
  if (deps.preset !== undefined) validatePreset(deps.config, deps.preset);
  const fileKind = deps.fileKind ?? detectFileKind(input.path, deps.config);
  const context = prepareFile(input.path, input.content);

  const { measurements, failures } = runMechanicalChecks(deps.config, context, fileKind);
  const ai = await collectAiFindings(deps.config, context, fileKind, deps);

  const report = buildReport({
    config: deps.config,
    file: input.path,
    fileKind,
    preset: deps.preset,
    measurements,
    aiFindings: ai.findings,
  });

  return { report, failures, aiError: ai.error, usage: ai.usage };
}

/**
 * One bundled provider call for every pending AI check — or none at all when
 * the caller brought findings along or did not ask for AI checks. The AI
 * layer never throws; a failed call degrades to mechanical-only scoring
 * with a diagnostic.
 */
async function collectAiFindings(
  config: CriteriaConfig,
  ctx: FileContext,
  fileKind: string,
  deps: AnalyzeDeps,
): Promise<{ findings: AiFinding[]; error?: string | undefined; usage?: TokenUsage | undefined }> {
  if (deps.aiFindings) return { findings: deps.aiFindings };
  if (!deps.provider) return { findings: [] };

  return runAiChecks({
    checks: pendingAiChecks(config, fileKind),
    fileContent: ctx.raw,
    fileKind,
    tool: config.tool,
    provider: deps.provider,
  });
}

export function runMechanicalChecks(
  config: CriteriaConfig,
  ctx: FileContext,
  fileKind: string,
): { measurements: Measurement[]; failures: AnalyzeResult["failures"] } {
  const measurements: Measurement[] = [];
  const failures: AnalyzeResult["failures"] = [];

  for (const rawCheck of config.checks) {
    if (rawCheck.mode !== "mechanical") continue;

    const check: Check = resolveCheck(rawCheck, fileKind);
    if (check.appliesTo.length > 0 && !check.appliesTo.includes(fileKind)) continue;
    if (!check.measure) continue;

    const measure = measures[check.measure.type];
    if (!measure) {
      failures.push({
        checkId: check.id,
        message: `no implementation for measure "${check.measure.type}"`,
      });
      continue;
    }

    try {
      const outcome = measure({
        ctx,
        params: check.measure.params ?? {},
        config,
      });
      measurements.push({
        checkId: check.id,
        value: outcome.value,
        applicable: outcome.applicable,
        evidence: outcome.evidence,
      });
    } catch (error) {
      // A broken measure must not take the whole run down: the check drops out
      // as "not applicable" and the reason is reported alongside.
      failures.push({
        checkId: check.id,
        message: error instanceof Error ? error.message : String(error),
      });
      measurements.push({ checkId: check.id, applicable: false });
    }
  }

  return { measurements, failures };
}

/**
 * A report that claims a preset it did not actually score with is worse than a
 * crash — fail loudly here instead of silently falling back to the default
 * preset's weights inside scoring (see scoring.ts computeOverallScore).
 */
export function validatePreset(config: CriteriaConfig, preset: string): void {
  if (config.presets[preset]) return;
  const known = Object.keys(config.presets).sort().join(", ");
  throw new Error(`Unknown preset "${preset}" for tool "${config.tool}". Known presets: ${known}`);
}

/** Collects the questions for the single bundled AI call. */
export function pendingAiChecks(config: CriteriaConfig, fileKind: string): Check[] {
  return config.checks
    .map((check) => resolveCheck(check, fileKind))
    .filter(
      (check) =>
        check.mode === "ai" && (check.appliesTo.length === 0 || check.appliesTo.includes(fileKind)),
    );
}
