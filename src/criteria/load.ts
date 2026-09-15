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

import { criteriaConfigSchema, describeSchemaIssues } from "./schema.js";
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
 * Structural and cross-field validation lives in `criteriaConfigSchema`
 * (schema.ts) — this function runs it, then adds the one check that schema
 * genuinely cannot do itself: whether `check.measure.type` is something the
 * ENGINE actually implements, which is external, runtime-supplied data
 * (`options.measureTypes`), not something a static schema can know.
 */
export function validateCriteria(
  config: CriteriaConfig,
  source: string,
  options: ValidateCriteriaOptions,
): void {
  const result = criteriaConfigSchema.safeParse(config);
  const problems = result.success ? [] : describeSchemaIssues(result.error);

  if (result.success) {
    for (const check of result.data.checks) {
      if (check.mode !== "mechanical") continue;
      // An override's measure replaces the base one at runtime (resolveCheck), so it
      // has to be implemented too.
      const candidates = [
        { measure: check.measure, where: "" },
        ...Object.entries(check.overrides ?? {}).map(([kind, override]) => ({
          measure: override.measure,
          where: ` (override for "${kind}")`,
        })),
      ];
      for (const { measure, where } of candidates) {
        if (measure && !options.measureTypes.includes(measure.type)) {
          problems.push(`check "${check.id}"${where} uses unimplemented measure "${measure.type}"`);
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid criteria config (${source}):\n  - ${problems.join("\n  - ")}`);
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
