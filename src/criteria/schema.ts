/**
 * Sifty — Zod schema for criteria configurations.
 *
 * Structural validation (types, ranges, enums) PLUS the cross-field business
 * rules that used to live as hand-written `fail(...)` calls in load.ts:
 * axis/fileKind/preset/check-id/requires/redactWith references, band
 * ordering, and the override constraints below. `loadCriteria()` runs this
 * once at startup — a typo fails loudly there, never silently inside a score.
 *
 * `types.ts` stays hand-written rather than `z.infer`-derived: `Check` is
 * self-referential (`overrides: Record<string, Partial<Check>>`), and Zod's
 * own recursive-schema pattern (`z.lazy`) needs a TS type to anchor itself
 * to — inferring that same type FROM the lazy schema is circular. Instead,
 * every schema below is annotated `z.ZodType<X>` against the type in
 * types.ts: if the two drift, this file fails to compile, which is the
 * property we actually want (one struct, checked two ways, never silently
 * out of sync) without fighting Zod's inference for a shape it can't infer
 * cleanly anyway.
 *
 * NOT checked here: `check.measure.type` against the engine's actual
 * implementations — that needs `measureTypes`, external runtime data the
 * composition root supplies (see load.ts's separate, small pass for it) —
 * keeping this schema itself free of any engine dependency (criteria must
 * not import the engine — see eslint.config.js's R5).
 */
import { z } from "zod";

import type {
  Axis,
  AxisId,
  Band,
  Check,
  CriteriaConfig,
  FileKind,
  GradeBand,
  Measure,
  PatternDef,
  Preset,
  Scoring,
  SecurityPolicy,
} from "./types.js";

const AXIS_IDS = ["clarity", "structure", "completeness", "cost", "security"] as const;

const axisIdSchema: z.ZodType<AxisId> = z.enum(AXIS_IDS);
const colorSchema = z.enum(["green", "amber", "red"]);
const severitySchema = z.enum(["info", "warn", "blocker"]);

const axisSchema: z.ZodType<Axis> = z.object({
  id: axisIdSchema,
  label: z.string(),
  description: z.string(),
});

const presetSchema: z.ZodType<Preset> = z.object({
  label: z.string(),
  weights: z.record(axisIdSchema, z.number().min(0)),
});

const fileKindSchema: z.ZodType<FileKind> = z.object({
  id: z.string(),
  label: z.string(),
  glob: z.string(),
  note: z.string().optional(),
});

const patternDefSchema: z.ZodType<PatternDef> = z.object({
  id: z.string(),
  re: z.string(),
  flags: z.string().optional(),
  hint: z.string(),
});

const measureSchema: z.ZodType<Measure> = z.object({
  // Not restricted to the known Measure["type"] literals here on purpose: which
  // measure kinds actually EXIST is a criteria-only concept (the union lives in
  // types.ts), but which ones are IMPLEMENTED is engine/measures.ts's registry —
  // external data load.ts's validateCriteria checks separately, via
  // `measureTypes`, to avoid a second, hand-maintained copy of that list here
  // that could silently drift from the registry.
  type: z.string() as z.ZodType<Measure["type"]>,
  params: z.record(z.string(), z.unknown()).optional(),
});

const bandSchema: z.ZodType<Band> = z.object({
  upTo: z.number().nullable(),
  score: z.number().min(0).max(100),
});

const scoringSchema: z.ZodType<Scoring> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("binary"), failScore: z.number().optional() }),
  z.object({ type: z.literal("bands"), bands: z.array(bandSchema).min(1) }),
  z.object({
    type: z.literal("penalty"),
    perHit: z.number().min(0),
    floor: z.number().min(0).max(100).optional(),
  }),
  z.object({ type: z.literal("ai") }),
]);

const gradeBandSchema: z.ZodType<GradeBand> = z.object({
  min: z.number().min(0).max(100),
  label: z.string(),
  color: colorSchema,
});

const securityPolicySchema: z.ZodType<SecurityPolicy> = z.object({
  blockerCapsOverallAt: z.number().min(0).max(100),
  reportBlockersSeparately: z.boolean(),
  redactWith: z.array(z.string()).optional(),
});

/**
 * `overrides` values are loosely typed here (Zod can't cheaply express
 * "Partial<Check> without id/mode/axis" as a static shape check) — the
 * `id`/`mode`/`axis` prohibition and the fileKind-membership check on
 * `overrides`' keys are both enforced in `criteriaConfigSchema`'s
 * `superRefine` below, where the surrounding config (its `fileKinds`) is
 * in scope.
 */
const checkSchema: z.ZodType<Check> = z.object({
  id: z.string(),
  axis: axisIdSchema,
  label: z.string(),
  weight: z.number().min(0),
  mode: z.enum(["mechanical", "ai"]),
  appliesTo: z.array(z.string()),
  requires: z.array(z.string()).optional(),
  measure: measureSchema.optional(),
  scoring: scoringSchema,
  severity: severitySchema.optional(),
  fix: z.string(),
  question: z.string().optional(),
  overrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional() as z.ZodType<
    Check["overrides"]
  >,
});

export const criteriaConfigSchema: z.ZodType<CriteriaConfig> = z
  .object({
    schemaVersion: z.literal(1),
    tool: z.string(),
    criteriaVersion: z.string(),
    updated: z.string(),
    axes: z.array(axisSchema).min(1),
    presets: z.record(z.string(), presetSchema),
    defaultPreset: z.string(),
    fileKinds: z.array(fileKindSchema).min(1),
    defaultFileKind: z.string(),
    sets: z.object({
      words: z.record(z.string(), z.array(z.string())),
      patterns: z.record(z.string(), z.array(patternDefSchema)),
    }),
    checks: z.array(checkSchema),
    grades: z.array(gradeBandSchema).min(1),
    security: securityPolicySchema,
  })
  .superRefine(validateCrossReferences);

/**
 * Everything that needs more than one field of the config at once — exactly
 * what a hand-written `validateCriteria` already did, now as Zod issues
 * (each with a `path`, so the error message can point at where in the JSON
 * to look) instead of a flat `fail(...)` list.
 */
function validateCrossReferences(config: CriteriaConfig, ctx: z.RefinementCtx): void {
  const axisIds = new Set(config.axes.map((axis) => axis.id));
  const fileKindIds = new Set(config.fileKinds.map((kind) => kind.id));

  if (!fileKindIds.has(config.defaultFileKind)) {
    ctx.addIssue({
      code: "custom",
      path: ["defaultFileKind"],
      message: `"${config.defaultFileKind}" is not a defined file kind`,
    });
  }
  if (!config.presets[config.defaultPreset]) {
    ctx.addIssue({
      code: "custom",
      path: ["defaultPreset"],
      message: `"${config.defaultPreset}" does not exist in presets`,
    });
  }

  // A weight per axis for every preset is already enforced structurally —
  // presetSchema.weights is z.record(axisIdSchema, z.number()), so a missing
  // key fails to parse before this refinement ever runs. No extra check here.

  const checkIds = new Set<string>();
  config.checks.forEach((check, index) => {
    if (checkIds.has(check.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["checks", index, "id"],
        message: `duplicate check id "${check.id}"`,
      });
    }
    checkIds.add(check.id);

    if (!axisIds.has(check.axis)) {
      ctx.addIssue({
        code: "custom",
        path: ["checks", index, "axis"],
        message: `check "${check.id}" points at unknown axis "${check.axis}"`,
      });
    }

    check.appliesTo.forEach((kind, kindIndex) => {
      if (!fileKindIds.has(kind)) {
        ctx.addIssue({
          code: "custom",
          path: ["checks", index, "appliesTo", kindIndex],
          message: `check "${check.id}" applies to unknown file kind "${kind}"`,
        });
      }
    });

    if (check.mode === "mechanical" && !check.measure) {
      ctx.addIssue({
        code: "custom",
        path: ["checks", index, "measure"],
        message: `mechanical check "${check.id}" has no measure`,
      });
    }
    if (check.mode === "ai" && !check.question) {
      ctx.addIssue({
        code: "custom",
        path: ["checks", index, "question"],
        message: `ai check "${check.id}" has no question`,
      });
    }

    if (check.scoring.type === "bands") {
      validateBandOrder(check.scoring.bands, check.id, index, ctx);
    }

    validateSetReferences(config, check, index, ctx);
    validateOverrides(check, index, fileKindIds, ctx);
  });

  config.checks.forEach((check, index) => {
    (check.requires ?? []).forEach((required, requiredIndex) => {
      if (!checkIds.has(required)) {
        ctx.addIssue({
          code: "custom",
          path: ["checks", index, "requires", requiredIndex],
          message: `check "${check.id}" requires unknown check "${required}"`,
        });
      }
    });
  });

  (config.security.redactWith ?? []).forEach((setId, setIndex) => {
    if (!config.sets.patterns[setId]) {
      ctx.addIssue({
        code: "custom",
        path: ["security", "redactWith", setIndex],
        message: `security.redactWith references unknown pattern set "${setId}"`,
      });
    }
  });
}

/** Bands ascend strictly by `upTo`, and only the LAST band may be open-ended (upTo: null). */
function validateBandOrder(
  bands: Band[],
  checkId: string,
  checkIndex: number,
  ctx: z.RefinementCtx,
): void {
  const last = bands.at(-1);
  if (!last || last.upTo !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["checks", checkIndex, "scoring", "bands"],
      message: `check "${checkId}": last band must be open ended (upTo: null)`,
    });
  }

  let previousUpTo: number | null = null;
  bands.forEach((band, bandIndex) => {
    if (bandIndex === bands.length - 1) return; // the last band's null is checked above
    if (band.upTo === null) {
      ctx.addIssue({
        code: "custom",
        path: ["checks", checkIndex, "scoring", "bands", bandIndex, "upTo"],
        message: `check "${checkId}": only the last band may have upTo: null`,
      });
      return;
    }
    if (previousUpTo !== null && band.upTo <= previousUpTo) {
      ctx.addIssue({
        code: "custom",
        path: ["checks", checkIndex, "scoring", "bands", bandIndex, "upTo"],
        message: `check "${checkId}": band upTo values must be strictly ascending`,
      });
    }
    previousUpTo = band.upTo;
  });
}

function validateSetReferences(
  config: CriteriaConfig,
  check: Check,
  checkIndex: number,
  ctx: z.RefinementCtx,
): void {
  const params = check.measure?.params;
  if (!params) return;

  const wordSetId = params["wordSet"];
  if (typeof wordSetId === "string" && !config.sets.words[wordSetId]) {
    ctx.addIssue({
      code: "custom",
      path: ["checks", checkIndex, "measure", "params", "wordSet"],
      message: `check "${check.id}" references unknown word set "${wordSetId}"`,
    });
  }

  const patternSetId = params["patternSet"];
  if (typeof patternSetId === "string" && !config.sets.patterns[patternSetId]) {
    ctx.addIssue({
      code: "custom",
      path: ["checks", checkIndex, "measure", "params", "patternSet"],
      message: `check "${check.id}" references unknown pattern set "${patternSetId}"`,
    });
  }

  const stopwordSets = params["stopwordSets"];
  if (stopwordSets && typeof stopwordSets === "object") {
    for (const [language, setId] of Object.entries(stopwordSets as Record<string, unknown>)) {
      if (typeof setId === "string" && !config.sets.words[setId]) {
        ctx.addIssue({
          code: "custom",
          path: ["checks", checkIndex, "measure", "params", "stopwordSets", language],
          message: `check "${check.id}" references unknown word set "${setId}"`,
        });
      }
    }
  }
}

const FORBIDDEN_OVERRIDE_KEYS = ["id", "mode", "axis"] as const;

function validateOverrides(
  check: Check,
  checkIndex: number,
  fileKindIds: Set<string>,
  ctx: z.RefinementCtx,
): void {
  for (const [fileKindId, override] of Object.entries(check.overrides ?? {})) {
    if (!fileKindIds.has(fileKindId)) {
      ctx.addIssue({
        code: "custom",
        path: ["checks", checkIndex, "overrides", fileKindId],
        message: `check "${check.id}" overrides unknown file kind "${fileKindId}"`,
      });
    }
    for (const forbidden of FORBIDDEN_OVERRIDE_KEYS) {
      if (override && typeof override === "object" && forbidden in override) {
        ctx.addIssue({
          code: "custom",
          path: ["checks", checkIndex, "overrides", fileKindId, forbidden],
          message: `check "${check.id}": an override for "${fileKindId}" must not set "${forbidden}"`,
        });
      }
    }
  }
}

/** One "path: message" line per Zod issue — the same shape the old fail() list had. */
export function describeSchemaIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });
}
