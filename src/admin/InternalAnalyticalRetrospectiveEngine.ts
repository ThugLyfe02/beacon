import type {
  InternalDecisionRetrospectiveRow,
  InternalDecisionJournalStatus,
} from './internalDecisionJournal.service';

export type InternalRetrospectiveSignatureKey =
  | 'low_temporal_coherence'
  | 'route_concentration'
  | 'weak_verification'
  | 'high_ambiguity'
  | 'chronology_gap'
  | 'incident_pressure'
  | 'calibration_penalty';

export type InternalRetrospectiveMaturity = 'nascent' | 'emerging' | 'maturing' | 'established';

export interface InternalRetrospectiveSignature {
  key: InternalRetrospectiveSignatureKey;
  label: string;
  sampleSize: number;
  supportedCount: number;
  weakenedCount: number;
  invalidatedCount: number;
  posteriorAdverseAssociation: number;
  conservativeAdverseFloor: number;
  maturity: InternalRetrospectiveMaturity;
  priority: number;
  reasons: string[];
  recommendedSurface:
    | 'InternalAgenticTimeline'
    | 'InternalTargetRouting'
    | 'InternalEvidenceDebt'
    | 'InternalWatchtower'
    | 'InternalDecisionCalibration';
}

export interface InternalRetrospectiveDecisionClass {
  decisionKind: string;
  resolvedCount: number;
  supportedCount: number;
  weakenedCount: number;
  invalidatedCount: number;
  averageCreatedAuthority: number;
  averageResolvedHealthDelta: number;
  signatures: InternalRetrospectiveSignature[];
}

export interface InternalAnalyticalRetrospectiveReport {
  generatedAt: string;
  resolvedCount: number;
  withContextCount: number;
  strongestAssociations: InternalRetrospectiveSignature[];
  byDecisionKind: InternalRetrospectiveDecisionClass[];
  operatingRule: string;
}

interface SignatureDefinition {
  key: InternalRetrospectiveSignatureKey;
  label: string;
  matches: (row: InternalDecisionRetrospectiveRow) => boolean;
  recommendedSurface: InternalRetrospectiveSignature['recommendedSurface'];
  explanation: string;
}

const SIGNATURES: SignatureDefinition[] = [
  {
    key: 'low_temporal_coherence',
    label: 'Low temporal coherence at decision time',
    matches: (row) => row.createdTemporalOverlap != null && row.createdTemporalOverlap < 0.5,
    recommendedSurface: 'InternalAgenticTimeline',
    explanation: 'The leading route or evidence chain lacked a strong overlapping retained observation window.',
  },
  {
    key: 'route_concentration',
    label: 'Route concentration / shared bottleneck dependence',
    matches: (row) => (row.createdRouteDiversity != null && row.createdRouteDiversity < 0.42) || row.createdSharedBottlenecks > 0,
    recommendedSurface: 'InternalTargetRouting',
    explanation: 'Displayed route plurality depended on low diversity or shared structural bottlenecks.',
  },
  {
    key: 'weak_verification',
    label: 'Weak verification coverage at decision time',
    matches: (row) => row.createdVerifiedRatio < 0.62 || row.createdRepeatedRatio < 0.35,
    recommendedSurface: 'InternalEvidenceDebt',
    explanation: 'The graph had limited verified or repeated first-party support when the hypothesis was sealed.',
  },
  {
    key: 'high_ambiguity',
    label: 'High ambiguous-evidence load',
    matches: (row) => row.createdAmbiguousRatio >= 0.08,
    recommendedSurface: 'InternalEvidenceDebt',
    explanation: 'Ambiguous relationships represented a meaningful share of the retained graph evidence.',
  },
  {
    key: 'chronology_gap',
    label: 'Observation-order gaps were present',
    matches: (row) => row.createdChronologyGaps > 0,
    recommendedSurface: 'InternalAgenticTimeline',
    explanation: 'At least one retained relationship progression contained an observation-order gap.',
  },
  {
    key: 'incident_pressure',
    label: 'Open Watchtower incident pressure',
    matches: (row) => row.createdCriticalIncidents > 0 || row.createdOpenIncidents >= 3,
    recommendedSurface: 'InternalWatchtower',
    explanation: 'The hypothesis was formed while multiple unresolved structural-change signals were active.',
  },
  {
    key: 'calibration_penalty',
    label: 'Historical method overconfidence penalty was already active',
    matches: (row) => row.createdCalibrationPenalty >= 0.05,
    recommendedSurface: 'InternalDecisionCalibration',
    explanation: 'The decision class already carried a downward calibration penalty from prior resolved hypotheses.',
  },
];

function isResolved(status: InternalDecisionJournalStatus): boolean {
  return status === 'supported' || status === 'weakened' || status === 'invalidated';
}

function outcomeMass(status: InternalDecisionJournalStatus): number {
  if (status === 'invalidated') return 1;
  if (status === 'weakened') return 0.5;
  return 0;
}

function maturityFor(count: number): InternalRetrospectiveMaturity {
  if (count < 3) return 'nascent';
  if (count < 8) return 'emerging';
  if (count < 20) return 'maturing';
  return 'established';
}

function signatureReport(
  definition: SignatureDefinition,
  rows: InternalDecisionRetrospectiveRow[],
): InternalRetrospectiveSignature | null {
  const matching = rows.filter((row) => isResolved(row.status) && definition.matches(row));
  if (matching.length === 0) return null;
  const supportedCount = matching.filter((row) => row.status === 'supported').length;
  const weakenedCount = matching.filter((row) => row.status === 'weakened').length;
  const invalidatedCount = matching.filter((row) => row.status === 'invalidated').length;
  const adverseMass = matching.reduce((sum, row) => sum + outcomeMass(row.status), 0);
  const favorableMass = matching.length - adverseMass;

  // Beta(2,2) shrinkage: tiny samples cannot create confident retrospective rules.
  const alpha = 2 + adverseMass;
  const beta = 2 + favorableMass;
  const posterior = alpha / (alpha + beta);
  const variance = (alpha * beta) / (((alpha + beta) ** 2) * (alpha + beta + 1));
  const conservativeFloor = Math.max(0, posterior - 1.28 * Math.sqrt(variance));
  const maturity = maturityFor(matching.length);
  const maturityWeight = maturity === 'established' ? 1 : maturity === 'maturing' ? 0.86 : maturity === 'emerging' ? 0.66 : 0.38;
  const priority = Math.min(10, (4.5 + posterior * 4.2 + conservativeFloor * 2.2) * maturityWeight);

  return {
    key: definition.key,
    label: definition.label,
    sampleSize: matching.length,
    supportedCount,
    weakenedCount,
    invalidatedCount,
    posteriorAdverseAssociation: posterior,
    conservativeAdverseFloor: conservativeFloor,
    maturity,
    priority,
    reasons: [
      definition.explanation,
      `${matching.length} resolved hypothesis${matching.length === 1 ? '' : 'es'} matched this decision-time condition`,
      `${invalidatedCount} invalidated · ${weakenedCount} weakened · ${supportedCount} supported`,
      `shrinkage-adjusted adverse association ${Math.round(posterior * 100)}%; conservative floor ${Math.round(conservativeFloor * 100)}%`,
      'This is retrospective association, not evidence that the condition caused the outcome.',
    ],
    recommendedSurface: definition.recommendedSurface,
  };
}

function decisionClass(rows: InternalDecisionRetrospectiveRow[], decisionKind: string): InternalRetrospectiveDecisionClass {
  const resolved = rows.filter((row) => row.decisionKind === decisionKind && isResolved(row.status));
  const healthDeltas = resolved
    .filter((row) => row.resolvedHealthScore != null)
    .map((row) => (row.resolvedHealthScore ?? row.createdHealthScore) - row.createdHealthScore);
  const signatures = SIGNATURES
    .map((definition) => signatureReport(definition, resolved))
    .filter((value): value is InternalRetrospectiveSignature => value != null)
    .sort((left, right) => right.priority - left.priority || right.sampleSize - left.sampleSize || left.key.localeCompare(right.key));
  return {
    decisionKind,
    resolvedCount: resolved.length,
    supportedCount: resolved.filter((row) => row.status === 'supported').length,
    weakenedCount: resolved.filter((row) => row.status === 'weakened').length,
    invalidatedCount: resolved.filter((row) => row.status === 'invalidated').length,
    averageCreatedAuthority: resolved.length > 0 ? resolved.reduce((sum, row) => sum + row.admissionAuthority, 0) / resolved.length : 0,
    averageResolvedHealthDelta: healthDeltas.length > 0 ? healthDeltas.reduce((sum, value) => sum + value, 0) / healthDeltas.length : 0,
    signatures,
  };
}

/**
 * Learn recurring analytical conditions from bounded decision metrics. This engine
 * calibrates investigative method only. It never attributes causation, scores a
 * person/entity, mutates canonical evidence, or authorizes an intervention.
 */
export function analyzeInternalDecisionRetrospectives(
  rows: InternalDecisionRetrospectiveRow[],
): InternalAnalyticalRetrospectiveReport {
  const resolved = rows.filter((row) => isResolved(row.status));
  const kinds = [...new Set(resolved.map((row) => row.decisionKind))].sort();
  const strongestAssociations = SIGNATURES
    .map((definition) => signatureReport(definition, resolved))
    .filter((value): value is InternalRetrospectiveSignature => value != null)
    .sort((left, right) => right.priority - left.priority || right.sampleSize - left.sampleSize || left.key.localeCompare(right.key));

  return {
    generatedAt: new Date().toISOString(),
    resolvedCount: resolved.length,
    withContextCount: rows.length,
    strongestAssociations: strongestAssociations.slice(0, 12),
    byDecisionKind: kinds.map((kind) => decisionClass(rows, kind)),
    operatingRule: 'Analytical Retrospectives identify recurring decision-time conditions associated with later supported/weakened/invalidated hypotheses. Associations are shrinkage-adjusted method signals, never causal claims or scores of people/entities.',
  };
}
