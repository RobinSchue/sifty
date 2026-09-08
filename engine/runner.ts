/**
 * Sifty — check runner.
 *
 * One file in, one report out. This is the only place that knows the order of
 * operations: load config → detect file kind → measure → score.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { detectFileKind, loadCriteria } from "../config/load";
import type { Check, CriteriaConfig } from "../criteria.types";
import type { AiFinding, Measurement, Report } from "../report.types";
import { measures } from "./measures";
import { buildReport, resolveCheck } from "./scoring";
import { prepareFile, type FileContext } from "./text";

export interface AnalyzeOptions {
    tool: string;
    preset?: string;
    configPath?: string;
    /** Overrides glob detection — useful for testing and for odd file layouts. */
    fileKind?: string;
    /** Results of the bundled AI call. Omitted → mechanical checks only. */
    aiFindings?: AiFinding[];
}

export interface AnalyzeResult {
    report: Report;
    context: FileContext;
    /** Checks whose measure threw — the run continues, they become not applicable. */
    failures: { checkId: string; message: string }[];
}

export function analyzeFile(filePath: string, options: AnalyzeOptions): AnalyzeResult {
    const absolutePath = resolve(process.cwd(), filePath);
    const raw = readFileSync(absolutePath, "utf8");
    return analyzeContent(filePath, raw, options);
}

/** Same as analyzeFile, but for content already in memory (tests, web UI later). */
export function analyzeContent(
    filePath: string,
    raw: string,
    options: AnalyzeOptions,
): AnalyzeResult {
    const config = loadCriteria(options.tool, options.configPath);
    const fileKind = options.fileKind ?? detectFileKind(filePath, config);
    const context = prepareFile(filePath, raw);

    const { measurements, failures } = runMechanicalChecks(config, context, fileKind);

    const report = buildReport({
        config,
        file: filePath,
        fileKind,
        preset: options.preset,
        measurements,
        aiFindings: options.aiFindings,
    });

    return { report, context, failures };
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

/** Collects the questions for the single bundled AI call — used in the next step. */
export function pendingAiChecks(config: CriteriaConfig, fileKind: string): Check[] {
    return config.checks
        .map((check) => resolveCheck(check, fileKind))
        .filter(
            (check) =>
                check.mode === "ai" &&
                (check.appliesTo.length === 0 || check.appliesTo.includes(fileKind)),
        );
}