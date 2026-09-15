/**
 * Sifty — criteria loader.
 *
 * Finds config/<tool>.json, parses it and validates it enough that a typo
 * fails loudly at startup instead of silently producing an empty axis.
 *
 * Does NOT import the engine: `measureTypes` — which measure kinds are
 * actually implemented — is supplied by the caller (the composition root,
 * which already knows the engine) instead of imported here. That keeps the
 * dependency direction one-way: engine depends on criteria, never the
 * reverse (enforced by eslint.config.js).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import picomatch from "picomatch";

import type { CriteriaConfig } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export interface ValidateCriteriaOptions {
  /** Measure type ids the engine actually implements — see engine/measures.js's registry. */
  measureTypes: string[];
}

/**
 * Works in dev (src/criteria/) and after a build (dist/criteria/), and does
 * NOT depend on the current working directory — the CLI is run from anywhere.
 */
export function findConfigDir(): string {
  const candidates = [
    resolve(HERE, "../../config"),
    resolve(HERE, "../../../config"),
    resolve(process.cwd(), "config"),
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(`No config directory found. Looked in:\n  ${candidates.join("\n  ")}`);
  }
  return found;
}

export function loadCriteria(
  tool: string,
  configPath: string | undefined,
  options: ValidateCriteriaOptions,
): CriteriaConfig {
  const path = configPath
    ? isAbsolute(configPath)
      ? configPath
      : resolve(process.cwd(), configPath)
    : resolve(findConfigDir(), `${tool}.json`);

  if (!existsSync(path)) {
    throw new Error(`No criteria file for tool "${tool}" (expected at ${path})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `${path} is not valid JSON: ${error instanceof Error ? error.message : error}`,
      { cause: error },
    );
  }

  const config = parsed as CriteriaConfig;
  validateCriteria(config, path, options);
  return config;
}

/**
 * Deliberately hand-written for now. Once the config grows, replace this with
 * a zod schema — the checks below are exactly what zod would generate.
 */
export function validateCriteria(
  config: CriteriaConfig,
  source: string,
  options: ValidateCriteriaOptions,
): void {
  const problems: string[] = [];
  const fail = (message: string) => problems.push(message);

  if (config.schemaVersion !== 1) {
    fail(`schemaVersion ${config.schemaVersion} is not supported (expected 1)`);
  }
  if (!config.criteriaVersion) fail("criteriaVersion is missing");

  const axisIds = new Set((config.axes ?? []).map((axis) => axis.id));
  if (axisIds.size === 0) fail("no axes defined");

  const fileKindIds = new Set((config.fileKinds ?? []).map((kind) => kind.id));
  if (!fileKindIds.has(config.defaultFileKind)) {
    fail(`defaultFileKind "${config.defaultFileKind}" is not a defined file kind`);
  }
  if (!config.presets?.[config.defaultPreset]) {
    fail(`defaultPreset "${config.defaultPreset}" does not exist`);
  }

  for (const [name, preset] of Object.entries(config.presets ?? {})) {
    for (const axisId of axisIds) {
      if (typeof preset.weights?.[axisId] !== "number") {
        fail(`preset "${name}" has no weight for axis "${axisId}"`);
      }
    }
  }

  const checkIds = new Set<string>();
  for (const check of config.checks ?? []) {
    if (checkIds.has(check.id)) fail(`duplicate check id "${check.id}"`);
    checkIds.add(check.id);

    if (!axisIds.has(check.axis)) {
      fail(`check "${check.id}" points at unknown axis "${check.axis}"`);
    }
    for (const kind of check.appliesTo ?? []) {
      if (!fileKindIds.has(kind)) {
        fail(`check "${check.id}" applies to unknown file kind "${kind}"`);
      }
    }
    if (check.mode === "mechanical") {
      if (!check.measure) {
        fail(`mechanical check "${check.id}" has no measure`);
      } else if (!options.measureTypes.includes(check.measure.type)) {
        fail(`check "${check.id}" uses unimplemented measure "${check.measure.type}"`);
      }
      validateSetReferences(config, check.id, check.measure?.params, fail);
    }
    if (check.mode === "ai" && !check.question) {
      fail(`ai check "${check.id}" has no question`);
    }
    if (check.scoring?.type === "bands") {
      const last = check.scoring.bands.at(-1);
      if (!last || last.upTo !== null) {
        fail(`check "${check.id}": last band must be open ended (upTo: null)`);
      }
    }
  }

  for (const check of config.checks ?? []) {
    for (const required of check.requires ?? []) {
      if (!checkIds.has(required)) {
        fail(`check "${check.id}" requires unknown check "${required}"`);
      }
    }
  }

  for (const setId of config.security?.redactWith ?? []) {
    if (!config.sets?.patterns?.[setId]) {
      fail(`security.redactWith references unknown pattern set "${setId}"`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid criteria config (${source}):\n  - ${problems.join("\n  - ")}`);
  }
}

function validateSetReferences(
  config: CriteriaConfig,
  checkId: string,
  params: Record<string, unknown> | undefined,
  fail: (message: string) => void,
): void {
  if (!params) return;

  const wordSetId = params["wordSet"];
  if (typeof wordSetId === "string" && !config.sets?.words?.[wordSetId]) {
    fail(`check "${checkId}" references unknown word set "${wordSetId}"`);
  }

  const patternSetId = params["patternSet"];
  if (typeof patternSetId === "string" && !config.sets?.patterns?.[patternSetId]) {
    fail(`check "${checkId}" references unknown pattern set "${patternSetId}"`);
  }

  const stopwordSets = params["stopwordSets"];
  if (stopwordSets && typeof stopwordSets === "object") {
    for (const setId of Object.values(stopwordSets as Record<string, unknown>)) {
      if (typeof setId === "string" && !config.sets?.words?.[setId]) {
        fail(`check "${checkId}" references unknown word set "${setId}"`);
      }
    }
  }
}

/** First matching file kind wins; falls back to the configured default. */
export function detectFileKind(filePath: string, config: CriteriaConfig): string {
  const normalized = filePath.replace(/\\/g, "/");
  const match = config.fileKinds.find((kind) =>
    picomatch.isMatch(normalized, kind.glob, { dot: true, basename: false }),
  );
  return match?.id ?? config.defaultFileKind;
}
