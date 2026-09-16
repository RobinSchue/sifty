/**
 * Sifty — shared test fixtures.
 *
 * Minimal, synthetic `CriteriaConfig` builders so unit tests stay isolated
 * from `config/copilot.json` and only declare the pieces they actually need.
 * Not part of the published build (see tsconfig.build.json).
 */

import type {
  Axis,
  AxisId,
  Check,
  CriteriaConfig,
  FileKind,
  GradeBand,
  Measure,
  PatternDef,
  Preset,
} from "../criteria/types.js";
import type { CompositeRule, CompositeRules } from "../composite/rules.js";

const ALL_AXES: AxisId[] = ["clarity", "structure", "completeness", "cost", "security"];

/**
 * Every measure kind the engine implements (mirrors engine/measures.ts's
 * registry). Kept here, not imported from the engine, so criteria/load.ts
 * and its tests stay decoupled from src/engine/** — see ValidateCriteriaOptions.
 */
export const ALL_MEASURE_TYPES: Measure["type"][] = [
  "tokenCount",
  "frontmatterField",
  "frontmatterValid",
  "globValidity",
  "globBreadth",
  "wordDensity",
  "patternHits",
  "markerPresence",
  "headingStructure",
  "blockLength",
  "duplicateLines",
  "languageGuess",
];

export function makeAxes(): Axis[] {
  return ALL_AXES.map((id) => ({ id, label: id, description: `${id} axis` }));
}

export function makeWeights(
  overrides: Partial<Record<AxisId, number>> = {},
): Record<AxisId, number> {
  const base = Object.fromEntries(ALL_AXES.map((id) => [id, 1])) as Record<AxisId, number>;
  return { ...base, ...overrides };
}

export function makePreset(overrides: Partial<Record<AxisId, number>> = {}): Preset {
  return { label: "Balanced", weights: makeWeights(overrides) };
}

export function makeFileKinds(): FileKind[] {
  return [
    { id: "scoped", label: "Scoped", glob: "**/*.instructions.md" },
    { id: "repo-wide", label: "Repo-wide", glob: "**/copilot-instructions.md" },
  ];
}

export function makeGrades(): GradeBand[] {
  return [
    { min: 90, label: "excellent", color: "green" },
    { min: 70, label: "good", color: "green" },
    { min: 50, label: "needs work", color: "amber" },
    { min: 0, label: "poor", color: "red" },
  ];
}

export interface MakeConfigOptions {
  axes?: Axis[];
  checks?: Check[];
  words?: Record<string, string[]>;
  patterns?: Record<string, PatternDef[]>;
  fileKinds?: FileKind[];
  defaultFileKind?: string;
  presets?: Record<string, Preset>;
  defaultPreset?: string;
  blockerCapsOverallAt?: number;
  redactWith?: string[];
  grades?: GradeBand[];
}

/** A complete, minimal, valid CriteriaConfig — override only what a test needs. */
export function makeConfig(options: MakeConfigOptions = {}): CriteriaConfig {
  return {
    schemaVersion: 1,
    tool: "test-tool",
    criteriaVersion: "0.0.0-test",
    updated: "2024-01-01",
    axes: options.axes ?? makeAxes(),
    presets: options.presets ?? { balanced: makePreset() },
    defaultPreset: options.defaultPreset ?? "balanced",
    fileKinds: options.fileKinds ?? makeFileKinds(),
    defaultFileKind: options.defaultFileKind ?? "scoped",
    sets: {
      words: options.words ?? {},
      patterns: options.patterns ?? {},
    },
    checks: options.checks ?? [],
    grades: options.grades ?? makeGrades(),
    security: {
      blockerCapsOverallAt: options.blockerCapsOverallAt ?? 40,
      reportBlockersSeparately: true,
      ...(options.redactWith ? { redactWith: options.redactWith } : {}),
    },
  };
}

/** A minimal, valid mechanical Check — override only what a test needs. */
export function makeCheck(overrides: Partial<Check> & Pick<Check, "id" | "measure">): Check {
  return {
    axis: "clarity",
    label: overrides.id,
    weight: 1,
    mode: "mechanical",
    appliesTo: [],
    scoring: { type: "binary" },
    fix: `fix for ${overrides.id}`,
    ...overrides,
  };
}

/** A minimal, valid composite rule — override only what a test needs. */
export function makeCompositeRule(overrides: Partial<CompositeRule> = {}): CompositeRule {
  const id = overrides.id ?? "composite.example";
  return {
    id,
    label: id,
    severity: "warn",
    minFiles: 2,
    maxFindings: 10,
    maxInputChars: 100_000,
    question: `Question for ${id}?`,
    fix: `fix for ${id}`,
    ...overrides,
  };
}

export function makeCompositeRules(overrides: Partial<CompositeRules> = {}): CompositeRules {
  return {
    schemaVersion: 1,
    rulesVersion: "0.0.0-test",
    updated: "2026-01-01",
    rules: [makeCompositeRule()],
    ...overrides,
  };
}
