export type Condition = 'control' | 'intervention';

export type Design =
  | { type: 'alternating' }
  | { type: 'randomized'; maxConsecutiveDays: number }
  | { type: 'blocks'; blockLength: number }
  | { type: 'randomized-blocks'; blockLength?: number; balanceWeekends?: boolean };

export type AdherenceStatus =
  | 'ADHERENT'
  | 'NON_ADHERENT'
  | 'CONTAMINATED'
  | 'CONTROL_CLEAN'
  | 'UNKNOWN';

/** General exposure rule interface so caffeine is one pluggable implementation */
export interface ExposureRule<TExposure = Record<string, unknown>> {
  readonly type: string;
  adherenceStatus(day: DayRecord<TExposure>): AdherenceStatus;
}

export interface CaffeineConditionRule {
  type: 'caffeine-cutoff';
  cutoffTime: string; // Local HH:mm, e.g. "12:00"
}

export type ConditionRuleConfig = CaffeineConditionRule | ExposureRule | { type: string; [key: string]: unknown };

export interface ExperimentDefinition {
  name: string;
  startDate: string; // YYYY-MM-DD; exposure day, linked to the following night's sleep.
  lengthDays: number;
  design: Design;
  seed: number;
  outcomeMetric: string; // e.g. 'sleepMinutes'
  conditionRule: ConditionRuleConfig;
}

export interface CaffeineExposure {
  lastCaffeineTime: string | null;
  servings: number | null;
  [key: string]: unknown;
}

export interface DayRecord<TExposure = CaffeineExposure> {
  date: string;
  assignedCondition: Condition;
  exposure: TExposure;
  covariates: {
    alcohol: boolean | null;
    illness: boolean | null;
    travel: boolean | null;
    lateWorkout: boolean | null;
    [key: string]: boolean | null | undefined;
  };
  outcome: {
    sleepMinutes: number | null;
    hrvMs: number | null;
    [key: string]: number | null | undefined;
  };
  exclusionReason: string | null;
}

export interface ScheduledDay {
  date: string;
  condition: Condition;
  blockIndex?: number;
}

export interface AdherenceSummary {
  estimand: string;
  counts: Record<AdherenceStatus, number>;
  total: number;
  known: number;
  overallAdherence: number | null;
  knownFraction: number | null;
  interventionAdherence: number | null;
  controlContamination: number | null;
}

export interface ExclusionConfig {
  illness: boolean;
  travel: boolean;
}

export type GatePolicy = 'A' | 'B' | 'C';
export type InflationRisk = 'high' | 'moderate' | 'low' | 'unknown';
export type EstimateReliability = 'high' | 'moderate' | 'low' | 'unknown';

export interface BaselineStatistics {
  mean: number | null;
  sd: number | null;
  lag1Autocorrelation: number | null;
}

export interface DisplayValues {
  interval95: [number, number] | null;
  conservative_estimate: number | null;
  inflation_risk: InflationRisk;
  planned_power_at_minimum_effect?: number | null;
  estimate_reliability?: EstimateReliability;
  ruled_out?: number | null;
}

export interface AnalysisConfig {
  permutations: number;
  bootstrapSamples: number;
  bootstrapBlockLength: number;
  bootstrapMethod?: 'percentile' | 'studentized';
  seed: number;
  exclusions: ExclusionConfig;
  baseline?: BaselineStatistics;
  assumedAdherence?: number;
}

export interface Estimate extends DisplayValues {
  estimand: string;
  controlCount: number;
  interventionCount: number;
  controlMean: number | null;
  interventionMean: number | null;
  difference: number | null; // Intervention minus control, units of outcomeMetric.
  interval95: [number, number] | null;
  bootstrapValidSamples: number;
  intervalMethod?: string;
}

export interface ComplierEstimate extends Estimate {
  label: string;
  adherenceDifference: number | null;
  weakInstrument: boolean;
  reason?: string;
}

export interface AnalysisResult extends DisplayValues {
  estimand: string;
  outcomeMetric: string;
  feasibility: FeasibilityResult;
  design: Design;
  analyzableDays: { control: number; intervention: number };
  unknownExposureDays: number;
  primary: Estimate & {
    pValue: number | null;
    permutationMethod: string;
    admissibleAssignmentsCount?: number;
    admissibleAssignmentsExact?: string;
    minAchievablePValue?: number;
    permutationWarning?: string;
  };
  secondary: Estimate & { label: string };
  adherence: AdherenceSummary;
  days: DayRecord<any>[];
  missingOutcomeDays: number;
  excludedDays: number;
  limitations: string[];
  statement?: string;
}

export interface VerdictConfig {
  gatePolicy: GatePolicy;
  minDaysPerCondition: number;
  minInterventionAdherence: number;
  maxControlContamination: number;
  minAdherence?: number; // Deprecated backward-compatible fallback
  minMeaningfulEffect: number;
  significanceLevel: number;
}

export interface Verdict extends DisplayValues {
  gate_policy: GatePolicy;
  effect_likely_understated: boolean | null;
  intervention_adherence: number | null;
  control_contamination: number | null;
  estimand: string;
  status: 'SUPPORTED' | 'NO_DETECTABLE_EFFECT' | 'INCONCLUSIVE';
  reasons: string[];
  size_uncertain: boolean;
  sizeUncertain: boolean;
  statement?: string;
}

export interface FeasibilityInput extends BaselineStatistics {
  duration: number;
  design: Design;
  startDate?: string;
  observedEffect?: number | null;
  outcomeRetention?: number; // default 1; optional expected observed-outcome fraction
  minMeaningfulEffect?: number; // default 15 outcome units
  assumedAdherence?: number;
}

export interface FeasibilityResult {
  estimand: string;
  supportsInference: boolean;
  minimumDetectableEffect70: number | 'not reachable within the duration' | null;
  minimumDetectableEffect70Reachable?: number | 'not reachable within the duration' | null;
  standardError: number | null;
  approximatePower: number | null;
  plannedPowerAtMinimumEffect: number | null;
  inflation_risk: InflationRisk;
  estimate_reliability: EstimateReliability;
  statement: string;
  limitations: string[];
}

export interface FeasibilityLookupInput {
  sd: number | null;
  lag1Autocorrelation: number | null;
  duration: number;
  adherence?: number; // e.g. 1.0 or 0.9
  minMeaningfulEffect?: number; // default 15
}

export interface FeasibilityLookupResult {
  status: 'ok' | 'unknown';
  detectionProbabilityAtMinimumEffect: number | null;
  minimumDetectableEffect70: number | 'not reachable within the duration' | null;
  statement: string;
}

export interface EligibilityConfig {
  minRunInDays?: number; // default 7
  minLateCaffeineShare?: number; // default 0.5 (50%)
  cutoffTime?: string; // default '12:00'
}

export interface EligibilityResult {
  estimand: string;
  eligible: boolean;
  runInDaysCount: number;
  lateCaffeineDaysCount: number;
  knownExposureDaysCount: number;
  unknownExposureDaysCount: number;
  lateCaffeineShare: number | null; // lateCaffeineDaysCount / runInDaysCount
  baselineOutcomeMean: number | null;
  baselineOutcomeSd: number | null;
  reasons: string[];
}
