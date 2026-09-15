/**
 * Sifty — schema for criteria configurations.
 *
 * Core principle: the scoring engine knows NO tool-specific rules.
 * It reads this structure and does the math. All tool knowledge lives in the JSON.
 */

/** Version of the config FORMAT (not of the criteria). Bump when the engine breaks. */
export type SchemaVersion = 1;

export type AxisId = "clarity" | "structure" | "completeness" | "cost" | "security";

export interface CriteriaConfig {
  schemaVersion: SchemaVersion;
  /** Tool identifier, e.g. "copilot" | "claude-code". */
  tool: string;
  /** Version of THIS criteria set. Recorded in every report. */
  criteriaVersion: string;
  updated: string;
  axes: Axis[];
  /** Axis weights for different scoring focuses. */
  presets: Record<string, Preset>;
  defaultPreset: string;
  /** File kinds of the tool — decide which checks apply at all. */
  fileKinds: FileKind[];
  defaultFileKind: string;
  /** Reusable word lists and regex sets, referenced by id. */
  sets: {
    words: Record<string, string[]>;
    patterns: Record<string, PatternDef[]>;
  };
  checks: Check[];
  /** Thresholds for the rating badge in the report. */
  grades: Grade[];
  security: SecurityPolicy;
}

export interface Axis {
  id: AxisId;
  label: string;
  /** One sentence — shown above the rationale in the report. */
  description: string;
}

export interface Preset {
  label: string;
  /** Relative axis weights. Normalized internally, need not sum to 1. */
  weights: Record<AxisId, number>;
}

export interface FileKind {
  id: string;
  label: string;
  /** Glob matched against the file path. First match wins. */
  glob: string;
  note?: string;
}

export interface PatternDef {
  id: string;
  /** Regex as a string — compiled to RegExp at runtime. */
  re: string;
  flags?: string;
  /** Plain-language hint shown in the fix list. */
  hint: string;
}

export interface Check {
  /** Stable id, shape: "<axis>.<short-name>". Never rename, only deprecate. */
  id: string;
  axis: AxisId;
  label: string;
  /** Own weight WITHIN the axis (weighted mean). */
  weight: number;
  /** mechanical = free/offline. ai = bundled into ONE request. */
  mode: "mechanical" | "ai";
  /** Empty array = applies to all file kinds. Otherwise n/a → dropped from numerator AND denominator. */
  appliesTo: string[];
  /** n/a as long as the listed checks did not pass (e.g. validating a glob without applyTo). */
  requires?: string[];
  /** Mechanical only: what gets measured. */
  measure?: Measure;
  scoring: Scoring;
  severity?: "info" | "warn" | "blocker";
  /** Text for the fix list when the check scores poorly. */
  fix: string;
  /** AI only: the concrete question sent to the model. */
  question?: string;
  /** Fields overridden per file kind, e.g. stricter token limits. */
  overrides?: Record<string, Partial<Check>>;
}

export interface Measure {
  type:
    | "tokenCount" // estimated token count of the file
    | "frontmatterField" // field present / non-empty in YAML frontmatter
    | "frontmatterValid" // frontmatter parses at all
    | "globValidity" // is the value a valid glob?
    | "globBreadth" // how broadly does the glob match?
    | "wordDensity" // word-list hits per 100 words
    | "patternHits" // number of regex matches (with line numbers)
    | "markerPresence" // does at least one marker occur?
    | "headingStructure" // heading count, skipped levels
    | "blockLength" // longest paragraph / code block in lines
    | "duplicateLines" // identical normalized lines
    | "languageGuess"; // stopword ratio → is the prose written in the expected language?
  params?: Record<string, unknown>;
}

export type Scoring =
  /** Passed = 100, failed = 0. */
  | { type: "binary"; failScore?: number }
  /** Measured value mapped into score bands. Bands ascending, last upTo = null. */
  | { type: "bands"; bands: Band[] }
  /** Starts at 100, every hit costs. Never below floor. */
  | { type: "penalty"; perHit: number; floor?: number }
  /** The model returns 0–100 plus rationale and evidence lines. */
  | { type: "ai" };

export interface Band {
  /** Upper bound of the band (inclusive). null = everything above. */
  upTo: number | null;
  score: number;
}

export interface Grade {
  min: number;
  label: string;
  color: "green" | "amber" | "red";
}

export interface SecurityPolicy {
  /**
   * Answer to the open design question: security is a regular fifth axis,
   * BUT a blocker finding caps the overall score. A hardcoded key must not be
   * averaged away by five good axes.
   */
  blockerCapsOverallAt: number;
  /** Also surface blockers as a separate warning above the report. */
  reportBlockersSeparately: boolean;
  /**
   * Pattern set ids (keys into `sets.patterns`) run over every Evidence's
   * `excerpt` and `hint` before it reaches the report — mechanical evidence is
   * usually pre-redacted at the source already (see measures.ts patternHits),
   * but AI findings quote the file directly and are not. Applied once, here,
   * regardless of source. Omit or leave empty to redact nothing.
   */
  redactWith?: string[];
}
