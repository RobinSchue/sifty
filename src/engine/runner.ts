/**
 * Sifty — check runner.
 *
 * One file in, one report out. This is the only place that knows the order of
 * operations: load config → detect file kind → measure → ask the model → score.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { detectFileKind, loadCriteria } from "../config/load.js";
import type { Check, CriteriaConfig } from "../criteria.types.js";
import type { AiFinding, Measurement, Report } from "../report.types.js";
import { runAiChecks, type AiClient } from "./ai.js";
import { measures } from "./measures.js";
import { buildReport, resolveCheck } from "./scoring.js";
import { prepareFile, type FileContext } from "./text.js";

export interface AnalyzeOptions {
  tool: string;
  preset?: string;
  configPath?: string;
  /** Overrides glob detection — useful for testing and for odd file layouts. */
  fileKind?: string;
  /** Pre-computed findings (tests, web UI later). When set, no AI call is made. */
  aiFindings?: AiFinding[];
  /** How to reach the model for `mode: "ai"` checks. Omitted → mechanical checks only. */
  ai?: { apiKey?: string | undefined; client?: AiClient | undefined };
}

export interface AnalyzeResult {
  report: Report;
  context: FileContext;
  /** Checks whose measure threw — the run continues, they become not applicable. */
  failures: { checkId: string; message: string }[];
  /** Set when the AI call was attempted but produced no usable findings. */
  aiError?: string | undefined;
}

export async function analyzeFile(
  filePath: string,
  options: AnalyzeOptions,
): Promise<AnalyzeResult> {
  const absolutePath = resolve(process.cwd(), filePath);
  const raw = readFileSync(absolutePath, "utf8");
  return analyzeContent(filePath, raw, options);
}

/** Same as analyzeFile, but for content already in memory (tests, web UI later). */
export async function analyzeContent(
  filePath: string,
  raw: string,
  options: AnalyzeOptions,
): Promise<AnalyzeResult> {
  const config = loadCriteria(options.tool, options.configPath);
  if (options.preset !== undefined) validatePreset(config, options.preset);
  const fileKind = options.fileKind ?? detectFileKind(filePath, config);
  const context = prepareFile(filePath, raw);

  const { measurements, failures } = runMechanicalChecks(config, context, fileKind);
  const ai = await collectAiFindings(config, context, fileKind, options);

  const report = buildReport({
    config,
    file: filePath,
    fileKind,
    preset: options.preset,
    measurements,
    aiFindings: ai.findings,
  });

  return { report, context, failures, aiError: ai.error };
}

/**
 * One bundled model call for every pending AI check — or none at all when the
 * caller brought findings along or did not ask for AI checks. The AI layer never
 * throws; a failed call degrades to mechanical-only scoring with a diagnostic.
 */
async function collectAiFindings(
  config: CriteriaConfig,
  ctx: FileContext,
  fileKind: string,
  options: AnalyzeOptions,
): Promise<{ findings: AiFinding[]; error?: string | undefined }> {
  if (options.aiFindings) return { findings: options.aiFindings };
  if (!options.ai) return { findings: [] };

  return runAiChecks({
    checks: pendingAiChecks(config, fileKind),
    fileContent: ctx.raw,
    fileKind,
    tool: config.tool,
    apiKey: options.ai.apiKey,
    client: options.ai.client,
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
