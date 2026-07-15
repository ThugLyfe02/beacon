export type SecurityRiskLevel = 'low' | 'guarded' | 'high' | 'critical';

export type SecurityAction =
  | 'signal'
  | 'office_hours'
  | 'access_drop'
  | 'proximity_reveal'
  | 'organizer_export'
  | 'role_attestation'
  | 'vip_policy_change';

export interface SecuritySignal {
  action: SecurityAction;
  allowed: boolean;
  reasonCode: string;
  occurredAt: number;
  targetId?: string | null;
}

export interface SecurityRiskInput {
  recentSignals: SecuritySignal[];
  distinctTargets: number;
  repeatedNonceDenials: number;
  blockedRelationshipAttempts: number;
  deniedActions: number;
  allowedActions: number;
  accountAgeMinutes?: number | null;
  verifiedEventRole: boolean;
  eventSecurityMode: 'normal' | 'restricted' | 'locked';
}

export interface SecurityRiskEvaluation {
  score: number;
  level: SecurityRiskLevel;
  shouldThrottle: boolean;
  shouldRequireReauth: boolean;
  shouldSuppressSensitiveReveal: boolean;
  reasons: string[];
  recommendedControl: string;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

export function evaluateSecurityRisk(input: SecurityRiskInput): SecurityRiskEvaluation {
  let score = 0;
  const reasons: string[] = [];

  if (input.eventSecurityMode === 'locked') {
    score += 100;
    reasons.push('The event security state is locked.');
  } else if (input.eventSecurityMode === 'restricted') {
    score += 25;
    reasons.push('The event is operating in restricted security mode.');
  }

  if (input.repeatedNonceDenials > 0) {
    score += Math.min(40, input.repeatedNonceDenials * 15);
    reasons.push('Repeated idempotency nonce reuse suggests replay or client retry abuse.');
  }

  if (input.blockedRelationshipAttempts > 0) {
    score += Math.min(45, input.blockedRelationshipAttempts * 20);
    reasons.push('Sensitive actions were attempted across a blocked relationship.');
  }

  if (input.deniedActions >= 3) {
    score += Math.min(30, input.deniedActions * 4);
    reasons.push('Multiple sensitive actions were denied in the current evaluation window.');
  }

  const totalActions = input.allowedActions + input.deniedActions;
  const denialRate = totalActions > 0 ? input.deniedActions / totalActions : 0;
  if (denialRate >= 0.5 && totalActions >= 4) {
    score += 20;
    reasons.push('The denial rate is unusually high for the current activity window.');
  }

  if (input.distinctTargets >= 12) {
    score += Math.min(25, (input.distinctTargets - 8) * 2);
    reasons.push('The action pattern spans an unusually broad set of recipients.');
  }

  if (input.accountAgeMinutes != null && input.accountAgeMinutes < 60) {
    score += 12;
    reasons.push('The account is newly created and has limited behavioral history.');
  }

  if (!input.verifiedEventRole && input.distinctTargets >= 8) {
    score += 10;
    reasons.push('High-volume access activity is not backed by an event-verified role.');
  }

  const rapidActions = input.recentSignals.filter(
    (signal) => Date.now() - signal.occurredAt <= 60_000,
  ).length;
  if (rapidActions >= 15) {
    score += Math.min(35, rapidActions - 10);
    reasons.push('Sensitive actions are occurring at burst velocity.');
  }

  score = clamp(Math.round(score));

  const level: SecurityRiskLevel =
    score >= 80 ? 'critical' : score >= 55 ? 'high' : score >= 25 ? 'guarded' : 'low';

  const shouldThrottle = level === 'high' || level === 'critical';
  const shouldRequireReauth = level === 'critical' || input.repeatedNonceDenials >= 2;
  const shouldSuppressSensitiveReveal =
    level === 'critical' ||
    input.eventSecurityMode === 'locked' ||
    input.blockedRelationshipAttempts > 0;

  const recommendedControl =
    level === 'critical'
      ? 'Lock sensitive actions, require reauthentication, and route the event to manual review.'
      : level === 'high'
      ? 'Throttle sensitive actions and suppress identity-bearing reveals until risk declines.'
      : level === 'guarded'
      ? 'Increase cooldowns and require explicit user confirmation for the next sensitive action.'
      : 'Continue normal operation while preserving replay protection and event scoping.';

  return {
    score,
    level,
    shouldThrottle,
    shouldRequireReauth,
    shouldSuppressSensitiveReveal,
    reasons,
    recommendedControl,
  };
}

export function summarizeSecurityWindow(signals: SecuritySignal[]): {
  allowed: number;
  denied: number;
  replayed: number;
  blockedRelationshipAttempts: number;
  distinctTargets: number;
} {
  const targets = new Set<string>();
  let allowed = 0;
  let denied = 0;
  let replayed = 0;
  let blockedRelationshipAttempts = 0;

  for (const signal of signals) {
    if (signal.allowed) allowed += 1;
    else denied += 1;

    if (signal.reasonCode === 'nonce_reuse') replayed += 1;
    if (signal.reasonCode === 'blocked_relationship') blockedRelationshipAttempts += 1;
    if (signal.targetId) targets.add(signal.targetId);
  }

  return {
    allowed,
    denied,
    replayed,
    blockedRelationshipAttempts,
    distinctTargets: targets.size,
  };
}
