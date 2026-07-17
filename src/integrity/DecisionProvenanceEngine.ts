export type DecisionDomain =
  | 'opportunity_surge'
  | 'next_best_action'
  | 'verified_access'
  | 'signal_scarcity'
  | 'office_hours_queue'
  | 'access_drop'
  | 'outcome_handshake'
  | 'vault'
  | 'security';

export type DecisionOutcome = 'allow' | 'deny' | 'defer' | 'recommend' | 'align' | 'complete';

export interface DecisionProvenanceInput {
  eventId: string;
  domain: DecisionDomain;
  outcome: DecisionOutcome;
  reasonCodes: string[];
  policyVersion: string;
  featureFlags?: Record<string, boolean>;
  subjectId?: string | null;
  expiresAt?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface DecisionProvenanceEnvelope extends DecisionProvenanceInput {
  schemaVersion: '1.0';
  createdAt: string;
  inputFingerprint: string;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`)
    .join(',')}}`;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createDecisionProvenance(
  input: DecisionProvenanceInput,
  now = new Date(),
): DecisionProvenanceEnvelope {
  const normalized = {
    ...input,
    reasonCodes: [...new Set(input.reasonCodes)].sort(),
    featureFlags: input.featureFlags
      ? Object.fromEntries(Object.entries(input.featureFlags).sort(([a], [b]) => a.localeCompare(b)))
      : undefined,
    metadata: input.metadata
      ? Object.fromEntries(Object.entries(input.metadata).sort(([a], [b]) => a.localeCompare(b)))
      : undefined,
  };

  return {
    ...normalized,
    schemaVersion: '1.0',
    createdAt: now.toISOString(),
    inputFingerprint: fnv1a(stableSerialize(normalized)),
  };
}

export interface RuntimeInvariantViolation {
  code: string;
  severity: 'warning' | 'critical';
  explanation: string;
}

export function evaluateRuntimeInvariants(input: {
  hiddenIdentityRetainsSubjectId?: boolean;
  activeOpportunityExpiresAt?: string | null;
  remainingCapacity?: number | null;
  eventLockedButActionAllowed?: boolean;
  alignedWithoutActivationType?: boolean;
  now?: number;
}): RuntimeInvariantViolation[] {
  const violations: RuntimeInvariantViolation[] = [];
  const now = input.now ?? Date.now();

  if (input.hiddenIdentityRetainsSubjectId) {
    violations.push({
      code: 'hidden_identity_leak',
      severity: 'critical',
      explanation: 'A concealed identity retained a subject identifier.',
    });
  }
  if (input.remainingCapacity != null && input.remainingCapacity < 0) {
    violations.push({
      code: 'negative_capacity',
      severity: 'critical',
      explanation: 'A capacity-controlled surface reported negative remaining capacity.',
    });
  }
  if (input.eventLockedButActionAllowed) {
    violations.push({
      code: 'locked_event_action_allowed',
      severity: 'critical',
      explanation: 'A sensitive action was allowed while the event security mode was locked.',
    });
  }
  if (input.alignedWithoutActivationType) {
    violations.push({
      code: 'alignment_without_activation',
      severity: 'warning',
      explanation: 'An aligned outcome is missing its activation category.',
    });
  }
  if (input.activeOpportunityExpiresAt) {
    const expiry = Date.parse(input.activeOpportunityExpiresAt);
    if (Number.isFinite(expiry) && expiry <= now) {
      violations.push({
        code: 'expired_opportunity_active',
        severity: 'warning',
        explanation: 'An expired opportunity window is still marked active.',
      });
    }
  }

  return violations;
}
