import type { OrganizerCommand } from './SpatialOrganizerCommandEngine';
import type { VenueControlAdmissionResult } from './VenueControlAdmission';

export type DecisionDisposition = 'accepted' | 'deferred' | 'rejected' | 'reverted';

export interface VenueDecisionRecord {
  id: string;
  commandId: string;
  createdAt: number;
  disposition: DecisionDisposition;
  admission: VenueControlAdmissionResult['decision'];
  operatorReasonCode:
    | 'capacity'
    | 'staffing'
    | 'programming-conflict'
    | 'safety-preference'
    | 'local-context'
    | 'insufficient-evidence'
    | 'other';
  note?: string;
}

/**
 * Records operator judgment separately from model output. Beacon needs to learn
 * when experienced operators override a recommendation and why. That creates a
 * product feedback loop without treating disagreement as user error.
 */
export function recordVenueDecision(
  command: OrganizerCommand,
  admission: VenueControlAdmissionResult,
  disposition: DecisionDisposition,
  operatorReasonCode: VenueDecisionRecord['operatorReasonCode'],
  note?: string,
  now = Date.now(),
): VenueDecisionRecord {
  return {
    id: `${command.id}:${disposition}:${now}`,
    commandId: command.id,
    createdAt: now,
    disposition,
    admission: admission.decision,
    operatorReasonCode,
    note,
  };
}

export interface VenueDecisionSummary {
  total: number;
  acceptanceRate: number;
  rejectionRate: number;
  deferRate: number;
  overrideReasons: Array<{ reason: VenueDecisionRecord['operatorReasonCode']; count: number }>;
}

export function summarizeVenueDecisions(records: VenueDecisionRecord[]): VenueDecisionSummary {
  const total = records.length;
  const count = (d: DecisionDisposition) => records.filter((record) => record.disposition === d).length;
  const reasons = new Map<VenueDecisionRecord['operatorReasonCode'], number>();
  for (const record of records) {
    reasons.set(record.operatorReasonCode, (reasons.get(record.operatorReasonCode) ?? 0) + 1);
  }

  return {
    total,
    acceptanceRate: total === 0 ? 0 : count('accepted') / total,
    rejectionRate: total === 0 ? 0 : count('rejected') / total,
    deferRate: total === 0 ? 0 : count('deferred') / total,
    overrideReasons: [...reasons.entries()]
      .map(([reason, reasonCount]) => ({ reason, count: reasonCount }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
  };
}
