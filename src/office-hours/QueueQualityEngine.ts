export interface HostQueuePreferences {
  acceptedRoles: string[];
  acceptedIntents: string[];
  minimumFitScore: number;
  inboundCap: number;
  requiresVerifiedRole: boolean;
}

export interface OfficeHoursCandidate {
  requestId: string;
  requesterId: string;
  requesterRole: string | null;
  requesterRoleVerified: boolean;
  intentKey: string;
  relevanceReason: string;
  priorMutual: boolean;
  proximityBucket: 0 | 1 | 2 | 3;
  requestedAt: number;
  hasRecentCancellation: boolean;
}

export interface QueueQualityEvaluation {
  requestId: string;
  fitScore: number;
  eligible: boolean;
  rankBand: 'priority' | 'strong' | 'possible' | 'decline';
  reasons: string[];
  riskFlags: string[];
}

function normalize(value: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

export function scoreOfficeHoursCandidate(
  candidate: OfficeHoursCandidate,
  preferences: HostQueuePreferences,
  now = Date.now(),
): QueueQualityEvaluation {
  const reasons: string[] = [];
  const riskFlags: string[] = [];
  let score = 0;

  const role = normalize(candidate.requesterRole);
  const acceptedRoles = preferences.acceptedRoles.map(normalize);
  const acceptedIntents = preferences.acceptedIntents.map(normalize);
  const intent = normalize(candidate.intentKey);

  const roleAccepted = acceptedRoles.length === 0 || acceptedRoles.includes(role);
  const intentAccepted = acceptedIntents.length === 0 || acceptedIntents.includes(intent);

  if (roleAccepted && role.length > 0) {
    score += 20;
    reasons.push('Role aligns with the host’s stated focus.');
  } else if (acceptedRoles.length > 0) {
    riskFlags.push('Role is outside the host’s stated focus.');
  }

  if (intentAccepted) {
    score += 24;
    reasons.push('Request intent matches the host’s availability criteria.');
  } else {
    riskFlags.push('Intent does not match the host’s current criteria.');
  }

  if (candidate.requesterRoleVerified) {
    score += 14;
    reasons.push('Requester role is verified for this event.');
  } else if (preferences.requiresVerifiedRole) {
    riskFlags.push('Verified event role is required.');
  }

  if (candidate.priorMutual) {
    score += 18;
    reasons.push('A prior mutual signal indicates reciprocal relevance.');
  }

  if (candidate.proximityBucket === 3) {
    score += 12;
    reasons.push('Both participants are already within activation range.');
  } else if (candidate.proximityBucket === 2) {
    score += 7;
    reasons.push('Participants recently crossed into silhouette range.');
  }

  const reasonLength = candidate.relevanceReason.trim().length;
  if (reasonLength >= 80) {
    score += 8;
    reasons.push('The request includes specific context.');
  } else if (reasonLength < 20) {
    riskFlags.push('The relevance explanation is too thin.');
  }

  const ageMinutes = Math.max(0, (now - candidate.requestedAt) / 60000);
  if (ageMinutes <= 5) {
    score += 4;
  } else if (ageMinutes > 45) {
    score -= 6;
    riskFlags.push('The request is aging and may no longer match the room state.');
  }

  if (candidate.hasRecentCancellation) {
    score -= 18;
    riskFlags.push('Requester has a recent cancellation in this event.');
  }

  const eligible =
    roleAccepted &&
    intentAccepted &&
    (!preferences.requiresVerifiedRole || candidate.requesterRoleVerified) &&
    score >= preferences.minimumFitScore;

  const clampedScore = Math.max(0, Math.min(Math.round(score), 100));
  const rankBand: QueueQualityEvaluation['rankBand'] = !eligible
    ? 'decline'
    : clampedScore >= 78
      ? 'priority'
      : clampedScore >= 58
        ? 'strong'
        : clampedScore >= 38
          ? 'possible'
          : 'decline';

  return {
    requestId: candidate.requestId,
    fitScore: clampedScore,
    eligible,
    rankBand,
    reasons,
    riskFlags,
  };
}

export function rankOfficeHoursQueue(
  candidates: OfficeHoursCandidate[],
  preferences: HostQueuePreferences,
  acceptedCount: number,
  now = Date.now(),
): {
  ranked: QueueQualityEvaluation[];
  remainingCapacity: number;
  queueClosed: boolean;
} {
  const remainingCapacity = Math.max(0, preferences.inboundCap - acceptedCount);
  const ranked = candidates
    .map((candidate) => scoreOfficeHoursCandidate(candidate, preferences, now))
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return b.fitScore - a.fitScore;
    });

  return {
    ranked,
    remainingCapacity,
    queueClosed: remainingCapacity === 0,
  };
}
