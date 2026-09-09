import type {
  InternalDecisionJournalEntry,
  InternalDecisionJournalStatus,
} from './internalDecisionJournal.service';
import type {
  InternalOperatorAdmissionState,
  InternalOperatorDecisionKind,
} from './InternalOperatorDecisionAdmission';

export type InternalDecisionCalibrationMaturity = 'nascent' | 'emerging' | 'maturing' | 'established';

export interface InternalDecisionCalibrationBucket {
  key: string;
  label: string;
  resolvedCount: number;
  supportedCount: number;
  weakenedCount: number;
  invalidatedCount: number;
  posteriorSupport: number;
  conservativeSupportFloor: number;
  averageAdmissionAuthority: number;
  calibrationGap: number;
  maturity: InternalDecisionCalibrationMaturity;
  interpretation: string;
}

export interface InternalDecisionCalibrationReport {
  generatedAt: string;
  resolvedCount: number;
  openCount: number;
  byDecisionKind: InternalDecisionCalibrationBucket[];
  byAdmissionState: InternalDecisionCalibrationBucket[];
  strongestCalibration: InternalDecisionCalibrationBucket | null;
  largestOverconfidence: InternalDecisionCalibrationBucket | null;
  methodology: string;
  operatingRule: string;
}

const STATUS_SCORE: Partial<Record<InternalDecisionJournalStatus, number>> = {
  supported: 1,
  weakened: 0.5,
  invalidated: 0,
};

const DECISION_LABELS: Record<InternalOperatorDecisionKind, string> = {
  analysis_review: 'Analysis Review',
  target_route_review: 'Target Routing',
  intervention_review: 'Intervention Review',
  restricted_forensics_review: 'Restricted Forensics',
  portable_export_review: 'Portable Export',
};

const ADMISSION_LABELS: Record<InternalOperatorAdmissionState, string> = {
  admitted_to_review: 'Admitted to Review',
  review_with_caution: 'Review With Caution',
  evidence_remediation_required: 'Evidence Remediation',
  capability_required: 'Capability Required',
  safety_blocked: 'Safety Blocked',
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function maturityForCount(count: number): InternalDecisionCalibrationMaturity {
  if (count < 3) return 'nascent';
  if (count < 8) return 'emerging';
  if (count < 20) return 'maturing';
  return 'established';
}

function buildBucket(
  key: string,
  label: string,
  entries: InternalDecisionJournalEntry[],
): InternalDecisionCalibrationBucket {
  const resolved = entries.filter((entry) => STATUS_SCORE[entry.status] != null);
  const supportedCount = resolved.filter((entry) => entry.status === 'supported').length;
  const weakenedCount = resolved.filter((entry) => entry.status === 'weakened').length;
  const invalidatedCount = resolved.filter((entry) => entry.status === 'invalidated').length;
  const successMass = supportedCount + weakenedCount * 0.5;
  const failureMass = invalidatedCount + weakenedCount * 0.5;

  // Beta(2,2) weakly skeptical prior: low-sample streaks shrink toward 50%.
  const alpha = 2 + successMass;
  const beta = 2 + failureMass;
  const posteriorSupport = alpha / (alpha + beta);
  const variance = (alpha * beta) / (((alpha + beta) ** 2) * (alpha + beta + 1));
  const conservativeSupportFloor = clamp01(posteriorSupport - 1.28 * Math.sqrt(variance));
  const averageAdmissionAuthority = resolved.length > 0
    ? resolved.reduce((sum, entry) => sum + entry.admissionAuthority, 0) / resolved.length
    : 0;
  const observedScore = resolved.length > 0
    ? resolved.reduce((sum, entry) => sum + (STATUS_SCORE[entry.status] ?? 0), 0) / resolved.length
    : 0;
  const calibrationGap = averageAdmissionAuthority - observedScore;
  const maturity = maturityForCount(resolved.length);

  const interpretation = resolved.length === 0
    ? 'No resolved hypotheses yet; do not infer calibration.'
    : calibrationGap >= 0.18
      ? 'Historical admission authority ran materially ahead of later evidence. Treat similar future conclusions more cautiously.'
      : calibrationGap <= -0.18
        ? 'Later evidence was stronger than the authority assigned at review time. The method may be overly conservative in this class.'
        : 'Admission authority and later evidence are reasonably aligned at the current sample size.';

  return {
    key,
    label,
    resolvedCount: resolved.length,
    supportedCount,
    weakenedCount,
    invalidatedCount,
    posteriorSupport,
    conservativeSupportFloor,
    averageAdmissionAuthority,
    calibrationGap,
    maturity,
    interpretation,
  };
}

/**
 * Calibrates Beacon's analytical method from falsifiable operator hypotheses.
 * This never scores a person/entity and never upgrades a journal conclusion into
 * canonical graph evidence. Low-sample outcomes are deliberately shrunk.
 */
export function analyzeInternalDecisionCalibration(
  entries: InternalDecisionJournalEntry[],
): InternalDecisionCalibrationReport {
  const byDecisionKind = (Object.keys(DECISION_LABELS) as InternalOperatorDecisionKind[])
    .map((kind) => buildBucket(kind, DECISION_LABELS[kind], entries.filter((entry) => entry.decisionKind === kind)));
  const byAdmissionState = (Object.keys(ADMISSION_LABELS) as InternalOperatorAdmissionState[])
    .map((state) => buildBucket(state, ADMISSION_LABELS[state], entries.filter((entry) => entry.admissionState === state)));
  const resolved = entries.filter((entry) => STATUS_SCORE[entry.status] != null);
  const matureBuckets = [...byDecisionKind, ...byAdmissionState].filter((bucket) => bucket.resolvedCount >= 3);
  const strongestCalibration = [...matureBuckets]
    .sort((left, right) => right.conservativeSupportFloor - left.conservativeSupportFloor || right.resolvedCount - left.resolvedCount)[0] ?? null;
  const largestOverconfidence = [...matureBuckets]
    .sort((left, right) => right.calibrationGap - left.calibrationGap || right.resolvedCount - left.resolvedCount)[0] ?? null;

  return {
    generatedAt: new Date().toISOString(),
    resolvedCount: resolved.length,
    openCount: entries.filter((entry) => entry.status === 'open').length,
    byDecisionKind,
    byAdmissionState,
    strongestCalibration,
    largestOverconfidence,
    methodology: 'Resolved hypotheses use supported=1, weakened=0.5, invalidated=0 with a Beta(2,2) shrinkage prior. Conservative support is an approximate one-sided 80% lower bound. Closed/no-verdict entries do not calibrate the method.',
    operatingRule: 'Decision calibration scores Beacon/operator analytical method classes only. It cannot score a person, organization, compatibility, trustworthiness, or create graph evidence.',
  };
}
