import type { EventIntentKey } from '../services/event-intent.service';

export type ParticipantPlaybookMode = 'seeking' | 'offering' | 'both';
export type ParticipantPlaybookTier = 'established' | 'supported' | 'building';

export interface ParticipantEventHistoryRow {
  intentKey: EventIntentKey;
  seekingEventCount: number;
  offeringEventCount: number;
  declaredEventCount: number;
  observedMutualCount: number;
  twoWayMutualCount: number;
  alignedOutcomeCount: number;
  completedOutcomeCount: number;
  lastDeclaredAt: number | null;
  lastOutcomeAt: number | null;
}

export interface ParticipantPlaybookSuggestion {
  intentKey: EventIntentKey;
  mode: ParticipantPlaybookMode;
  tier: ParticipantPlaybookTier;
  evidenceWeight: number;
  mayApplyToDraft: boolean;
  title: string;
  rationale: string;
  evidence: string[];
  history: ParticipantEventHistoryRow;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function safeShare(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return clamp01(numerator / denominator);
}

function determineMode(row: ParticipantEventHistoryRow): ParticipantPlaybookMode {
  if (row.seekingEventCount > 0 && row.offeringEventCount > 0) {
    if (row.seekingEventCount >= row.offeringEventCount * 1.5) return 'seeking';
    if (row.offeringEventCount >= row.seekingEventCount * 1.5) return 'offering';
    return 'both';
  }
  return row.offeringEventCount > 0 ? 'offering' : 'seeking';
}

function determineTier(row: ParticipantEventHistoryRow): ParticipantPlaybookTier {
  if (
    row.declaredEventCount >= 3
    && row.observedMutualCount >= 3
    && (row.alignedOutcomeCount >= 2 || row.completedOutcomeCount >= 1)
  ) return 'established';

  if (
    row.declaredEventCount >= 2
    && (row.observedMutualCount >= 1 || row.alignedOutcomeCount >= 1)
  ) return 'supported';

  return 'building';
}

function recencySupport(row: ParticipantEventHistoryRow, now: number): number {
  const timestamp = row.lastOutcomeAt ?? row.lastDeclaredAt;
  if (timestamp == null || !Number.isFinite(timestamp)) return 0;
  const ageDays = Math.max(0, (now - timestamp) / 86_400_000);
  if (ageDays <= 30) return 1;
  if (ageDays >= 365) return 0;
  return 1 - ((ageDays - 30) / 335);
}

function evidenceWeight(row: ParticipantEventHistoryRow, now: number): number {
  const declarationDepth = clamp01(row.declaredEventCount / 4);
  const mutualDepth = clamp01(row.observedMutualCount / 4);
  const twoWayShare = safeShare(row.twoWayMutualCount, row.observedMutualCount);
  const alignmentDepth = clamp01(row.alignedOutcomeCount / 3);
  const completionDepth = clamp01(row.completedOutcomeCount / 2);
  const recency = recencySupport(row, now);

  return clamp01(
    declarationDepth * 0.2
      + mutualDepth * 0.24
      + twoWayShare * 0.16
      + alignmentDepth * 0.2
      + completionDepth * 0.15
      + recency * 0.05,
  );
}

function modeRationale(row: ParticipantEventHistoryRow, mode: ParticipantPlaybookMode): string {
  if (mode === 'both') {
    return `You carried this domain as both a need and a capability across ${row.declaredEventCount} ended event${row.declaredEventCount === 1 ? '' : 's'}. Beacon is preserving that two-sided posture rather than deciding which role you should play.`;
  }
  if (mode === 'seeking') {
    return `Your own ended-event history shows this domain more often under “looking for help” than “can help.” The suggestion carries that explicit pattern forward; it does not infer a need from browsing or movement.`;
  }
  return `Your own ended-event history shows this domain more often under “can help” than “looking for help.” The suggestion carries that explicit pattern forward; it does not infer expertise from profile activity.`;
}

function tierTitle(tier: ParticipantPlaybookTier): string {
  if (tier === 'established') return 'Repeated evidence across ended events';
  if (tier === 'supported') return 'Worth carrying into this event';
  return 'History is still forming';
}

function buildEvidence(row: ParticipantEventHistoryRow): string[] {
  const evidence = [
    `${row.declaredEventCount} ended event${row.declaredEventCount === 1 ? '' : 's'} with this domain explicitly declared`,
    `${row.observedMutualCount} captured mutual${row.observedMutualCount === 1 ? '' : 's'} carrying this domain`,
  ];

  if (row.twoWayMutualCount > 0) {
    evidence.push(`${row.twoWayMutualCount} of those mutuals had two-way declared fit`);
  }
  if (row.alignedOutcomeCount > 0) {
    evidence.push(`${row.alignedOutcomeCount} private outcome alignment${row.alignedOutcomeCount === 1 ? '' : 's'}`);
  }
  if (row.completedOutcomeCount > 0) {
    evidence.push(`${row.completedOutcomeCount} participant-confirmed completed outcome${row.completedOutcomeCount === 1 ? '' : 's'}`);
  }
  return evidence;
}

/**
 * Converts caller-private, ended-event evidence into a small transparent draft
 * aid. This is not a recommender trained on behavior, not a probability of success,
 * and not authority to edit the current event declaration. `evidenceWeight` is only a
 * bounded coverage score for deterministic ordering.
 */
export function buildParticipantEventPlaybook(input: {
  history: ParticipantEventHistoryRow[];
  now?: number;
  limit?: number;
}): ParticipantPlaybookSuggestion[] {
  const now = input.now ?? Date.now();
  const limit = Math.max(1, Math.min(6, input.limit ?? 4));

  return input.history
    .filter((row) => row.declaredEventCount > 0)
    .map<ParticipantPlaybookSuggestion>((row) => {
      const tier = determineTier(row);
      const mode = determineMode(row);
      return {
        intentKey: row.intentKey,
        mode,
        tier,
        evidenceWeight: evidenceWeight(row, now),
        mayApplyToDraft: tier !== 'building',
        title: tierTitle(tier),
        rationale: modeRationale(row, mode),
        evidence: buildEvidence(row),
        history: row,
      };
    })
    .sort((left, right) => {
      const tierRank: Record<ParticipantPlaybookTier, number> = {
        established: 3,
        supported: 2,
        building: 1,
      };
      return tierRank[right.tier] - tierRank[left.tier]
        || right.evidenceWeight - left.evidenceWeight
        || right.history.completedOutcomeCount - left.history.completedOutcomeCount
        || right.history.alignedOutcomeCount - left.history.alignedOutcomeCount
        || right.history.observedMutualCount - left.history.observedMutualCount
        || left.intentKey.localeCompare(right.intentKey);
    })
    .slice(0, limit);
}
