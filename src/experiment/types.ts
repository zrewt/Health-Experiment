import type {
  AdherenceSummary, AnalysisResult, BaselineStatistics,
  CaffeineExposure, Condition, DayRecord, ExperimentDefinition,
  FeasibilityLookupInput, FeasibilityLookupResult, ScheduledDay, Verdict,
  checkCaffeineEligibility, lookupFeasibility, generateSchedule,
  analyzeExperiment, getVerdict, adherenceStatus, parseDate,
} from '../engine';

export interface DailyEntry {
  date: string;
  sleepMinutes: number | null;
  lastCaffeineTime: string | 'none' | null;
}

export interface BaselineSummary {
  validDays: number;
  targetDays: number;
  sd: number | null;
  eligible: boolean;
  reasons: string[];
  engineReasons: string[];
  lateCaffeineDays: number;
  knownExposureDays: number;
  unknownExposureDays: number;
}

export type FeasibilityTier = 'informative' | 'long_shot' | 'not_informative' | 'cannot_assess';
export type MdeDirectMinutes = number | 'larger_than_60' | null;
export type NumericQualifier = 'at least' | 'unqualified';

export interface RhoLookupSnapshot {
  input: FeasibilityLookupInput;
  output: FeasibilityLookupResult;
}

export interface DurationOption {
  duration: number;
  plannedPowerAtMinimumEffect: number | null;
  mdeDirectMinutes: MdeDirectMinutes;
  mdeAssignedDayEquivalent: number | null;
  /** All displayed scenario outputs come from this single rho. */
  scenarioRho: number | null;
  /** Diagnostic only; never substituted for the scenario power. */
  minPlannedPowerAcrossRho: number | null;
  /** Null when any rho is unassessable; otherwise an engine statement verbatim. */
  statement: string | null;
  conservative: boolean;
  numberQualifier: NumericQualifier;
  mdeLabel: string;
  adherenceAssumptionText: string;
  rhoLookups: RhoLookupSnapshot[];
}

export interface FeasibilityViewModel {
  tier: FeasibilityTier;
  options: DurationOption[];
  defaultDuration: number | null;
  canStart: boolean;
  requiresAcknowledgement: boolean;
  conservative: boolean;
  numberQualifier: NumericQualifier;
  sdUsed: number | null;
  reasons: string[];
  mdeLabel: string;
  adherenceAssumptionText: string;
  autocorrelationAssumptionText: string;
  conservativeAssumptionText: string | null;
  inputs: {
    baseline: BaselineSummary;
    assumedAdherence: number;
    assumedContamination: number;
    minimumMeaningfulEffectMinutes: number;
    durations: number[];
    autocorrelations: number[];
  };
}

export interface ExperimentPlan {
  seed: number;
  analysisSeed: number;
  schedule: ScheduledDay[];
  chosenDuration: number;
  startDate: string;
  assumedAdherence: number;
  assumedContamination: number;
  baselineStats: {
    sd: number;
    assumedAutocorrelation: number;
    validDays: number;
  };
  definition: ExperimentDefinition;
  feasibilitySnapshot: FeasibilityViewModel;
}

export interface ResultViewModel {
  verdictLabel: Verdict['status'];
  statement: string;
  reasons: string[];
  conservativeEstimate: number | null;
  interval: [number, number] | null;
  ruledOut: number | null;
  daysAnalyzed: AnalysisResult['analyzableDays'];
  daysExcluded: number;
  missingOutcomeDays: number;
  unknownExposureDays: number;
  adherence: AdherenceSummary;
  reducedAdherence: boolean | null;
  plannedPowerRecomputed: number | null;
  plannedPowerSnapshot: number | null;
  limitations?: string[];
}

export interface ProgressSummary {
  daysLogged: number;
  daysRemaining: number;
  adherenceCounts: Record<'ADHERENT' | 'NON_ADHERENT' | 'CONTAMINATED' | 'CONTROL_CLEAN' | 'UNKNOWN', number>;
}

// Engine-native types are reused rather than recreating statistical contracts.
export type { BaselineStatistics, CaffeineExposure, Condition, DayRecord };


export type FeasibilityScreenState =
  | {
      kind: 'cannot_assess';
      message: string;
      detailsHeading: 'Details';
      reasons: string[];
      lateCaffeineDays: number;
      knownExposureDays: number;
      unknownExposureDays: number;      detailFacts: string[];
      actions: ['Keep logging for now', 'Not now'];
    }
  | {
    kind: 'ineligible';
      message: string;
      detailsHeading: 'Details';
      reasons: string[];
      lateCaffeineDays: number;
      knownExposureDays: number;
      unknownExposureDays: number;      detailFacts: string[];
      actions: ['Keep logging for now', 'Not now'];
    }
  | {
    kind: 'not_informative';
      message: string;
      detailsHeading: 'Details';
      reasons: string[];
      duration: number | null;
      mde: MdeDirectMinutes;
      actions: ['Keep logging for now', 'Not now'];
    }
  | {
      kind: 'informative' | 'long_shot';
      message: null;
      options: DurationOption[];
      defaultDuration: number;
      requiresAcknowledgement: boolean;
      cutoffTime: string;
      approximateLabel: 'Rough';
      simulationNote: string;
      conservativeNote: string | null;
      startInstruction: string;
    };

export interface EngineFacade {
  checkCaffeineEligibility: typeof checkCaffeineEligibility;
  lookupFeasibility: typeof lookupFeasibility;
  generateSchedule: typeof generateSchedule;
  analyzeExperiment: typeof analyzeExperiment;
  getVerdict: typeof getVerdict;
  adherenceStatus: typeof adherenceStatus;
  parseDate: typeof parseDate;
}

export type FeasibilityLookup = EngineFacade['lookupFeasibility'];
export type AdapterErrorCode = 'CANNOT_START' | 'ACKNOWLEDGEMENT_REQUIRED' |
  'INVALID_DURATION' | 'INTERIM_LOOK' | 'INVALID_ENTRY' | 'INVALID_PLAN' |
  'INVALID_FEASIBILITY' | 'INVALID_SEED' | 'MISSING_ENGINE_STATEMENT';

export interface ResultSnapshot extends ResultViewModel {
  evaluatedAt: string;
  adapterVersion?: string;
  engineVersion?: string;
}

export interface StoredExperimentPlanRecord {
  id: string;
  plan: ExperimentPlan;
  status: 'scheduled' | 'completed' | 'cancelled' | string;
  result?: ResultSnapshot | null;
  completed_at?: string | null;
}
