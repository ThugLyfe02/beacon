import type { OrganizerCommand } from './SpatialOrganizerCommandEngine';
import type { VenueControlAdmissionResult } from './VenueControlAdmission';
import type { VenueLayoutDescriptor } from './VenueLayoutVersioning';
import type { VenueModelCredibilityState } from './VenueModelCredibility';
import type { VenueSourceQuorumState } from './VenueSourceQuorum';
import type { VenueTelemetryIntegrity } from './VenueTelemetryIntegrity';

export interface VenueDecisionProvenanceInput {
  command: OrganizerCommand;
  admission: VenueControlAdmissionResult;
  layout: VenueLayoutDescriptor;
  telemetry: VenueTelemetryIntegrity;
  quorum: VenueSourceQuorumState;
  credibility: VenueModelCredibilityState;
  observationKeys: string[];
  policyVersion: string;
  modelVersion: string;
  parentRecordId?: string;
  createdAt?: number;
}

export interface VenueDecisionProvenanceRecord {
  id: string;
  createdAt: number;
  commandId: string;
  commandKind: OrganizerCommand['kind'];
  targetZoneIds: string[];
  admissionDecision: VenueControlAdmissionResult['decision'];
  admissionScore: number;
  venueId: string;
  layoutVersion: string;
  geometryHash: string;
  policyVersion: string;
  modelVersion: string;
  telemetryLevel: VenueTelemetryIntegrity['level'];
  telemetryScore: number;
  quorumState: VenueSourceQuorumState['state'];
  quorumConfidence: number;
  credibilityBand: VenueModelCredibilityState['band'];
  credibilityScore: number;
  observationKeys: string[];
  parentRecordId?: string;
  completeness: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function stableToken(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Builds a compact evidence record for every operator recommendation boundary.
 * The record answers: which model, layout, policy, telemetry state, sensing
 * quorum, and aggregate observations supported this decision?
 *
 * `id` is a deterministic correlation token, not a cryptographic signature. A
 * server-side audit store should add authenticated append-only integrity if these
 * records are later used for compliance or contractual evidence.
 */
export function buildVenueDecisionProvenance(
  input: VenueDecisionProvenanceInput,
): VenueDecisionProvenanceRecord {
  const observationKeys = [...new Set(input.observationKeys)].sort();
  const targetZoneIds = [...new Set(input.command.targetZoneIds)].sort();
  const createdAt = input.createdAt ?? Date.now();

  const completenessSignals = [
    Boolean(input.command.id),
    Boolean(input.layout.venueId),
    Boolean(input.layout.layoutVersion),
    Boolean(input.layout.geometryHash),
    Boolean(input.policyVersion),
    Boolean(input.modelVersion),
    observationKeys.length > 0,
    input.telemetry.score >= 0,
    input.quorum.confidence >= 0,
    input.credibility.score >= 0,
  ];
  const completeness = completenessSignals.filter(Boolean).length / completenessSignals.length;
  const correlationMaterial = [
    input.command.id,
    input.layout.venueId,
    input.layout.layoutVersion,
    input.layout.geometryHash,
    input.policyVersion,
    input.modelVersion,
    input.admission.decision,
    ...targetZoneIds,
    ...observationKeys,
  ].join('|');

  return {
    id: `venue-decision:${stableToken(correlationMaterial)}`,
    createdAt,
    commandId: input.command.id,
    commandKind: input.command.kind,
    targetZoneIds,
    admissionDecision: input.admission.decision,
    admissionScore: clamp01(input.admission.score),
    venueId: input.layout.venueId,
    layoutVersion: input.layout.layoutVersion,
    geometryHash: input.layout.geometryHash,
    policyVersion: input.policyVersion,
    modelVersion: input.modelVersion,
    telemetryLevel: input.telemetry.level,
    telemetryScore: clamp01(input.telemetry.score),
    quorumState: input.quorum.state,
    quorumConfidence: clamp01(input.quorum.confidence),
    credibilityBand: input.credibility.band,
    credibilityScore: clamp01(input.credibility.score),
    observationKeys,
    parentRecordId: input.parentRecordId,
    completeness: clamp01(completeness),
  };
}

export interface VenueProvenanceValidation {
  completeEnoughForAudit: boolean;
  reasons: string[];
}

export function validateVenueDecisionProvenance(
  record: VenueDecisionProvenanceRecord,
): VenueProvenanceValidation {
  const reasons: string[] = [];
  if (record.completeness < 0.9) reasons.push('provenance record is missing required decision context');
  if (record.observationKeys.length === 0) reasons.push('decision has no aggregate observation references');
  if (!record.layoutVersion || !record.geometryHash) reasons.push('decision is not bound to a specific venue layout');
  if (!record.policyVersion || !record.modelVersion) reasons.push('decision is not bound to explicit policy and model versions');

  return {
    completeEnoughForAudit: reasons.length === 0,
    reasons: reasons.length > 0 ? reasons : ['decision provenance is complete enough for operational replay and review'],
  };
}
