import type { SpatialCommitmentCandidate, SpatialCommitmentState } from './SpatialCommitmentEngine';
import type { SpatialOutcomeBridge } from './SpatialOutcomeBridgeEngine';
import type { SpatialProgressionState } from './SpatialProgressionEngine';
import type { TemporalArchitectureState } from './TemporalArchitectureEngine';

export type ReciprocityState = 'not-ready' | 'credible' | 'reciprocal' | 'scheduled' | 'fulfilled';
export type ReciprocityAction = 'open-commitment' | 'request-time' | 'open-mutuals' | 'review-vault' | 'none';

export interface ReciprocityEvidence {
  id: string;
  label: string;
  weight: number;
  source: 'mutual' | 'signal' | 'contract' | 'momentum' | 'phase' | 'handoff';
}

export interface ReciprocityPath {
  commitmentId: string;
  title: string;
  state: ReciprocityState;
  confidence: number;
  readiness: number;
  evidence: ReciprocityEvidence[];
  nextAction: ReciprocityAction;
  explanation: string;
}

export interface SpatialReciprocityState {
  paths: ReciprocityPath[];
  primary: ReciprocityPath | null;
  credibleCount: number;
  reciprocalCount: number;
  fulfilledCount: number;
  systemNarrative: string;
}

interface Input {
  commitments: SpatialCommitmentState;
  bridge: SpatialOutcomeBridge;
  temporal: TemporalArchitectureState;
  progression: SpatialProgressionState;
  mutualMatches: number;
  signalsSent: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function evidenceForCandidate(candidate: SpatialCommitmentCandidate, input: Input): ReciprocityEvidence[] {
  const evidence: ReciprocityEvidence[] = [];

  if (input.mutualMatches > 0 && candidate.kind === 'follow-up') {
    evidence.push({ id: 'verified-mutual', label: `${input.mutualMatches} verified mutual${input.mutualMatches === 1 ? '' : 's'}`, weight: 0.36, source: 'mutual' });
  }
  if (input.signalsSent > 0) {
    evidence.push({ id: 'verified-signals', label: `${input.signalsSent} verified signal${input.signalsSent === 1 ? '' : 's'}`, weight: Math.min(0.22, input.signalsSent * 0.05), source: 'signal' });
  }
  if (candidate.evidence.length > 0) {
    evidence.push({ id: `candidate-${candidate.id}`, label: candidate.evidence[0], weight: 0.18, source: 'contract' });
  }
  if (input.progression.momentumChain > 0) {
    evidence.push({ id: 'momentum-chain', label: `Momentum chain ${input.progression.momentumChain}`, weight: Math.min(0.14, input.progression.momentumChain * 0.025), source: 'momentum' });
  }
  if (input.temporal.phase === 'closing' || input.temporal.phase === 'reflection') {
    evidence.push({ id: 'handoff-phase', label: `${input.temporal.phase} handoff phase`, weight: 0.1, source: 'phase' });
  }
  if (input.bridge.handoffWeight >= 0.45) {
    evidence.push({ id: 'handoff-weight', label: 'Verified handoff threshold reached', weight: 0.12, source: 'handoff' });
  }

  return evidence;
}

function derivePath(candidate: SpatialCommitmentCandidate, input: Input): ReciprocityPath {
  const evidence = evidenceForCandidate(candidate, input);
  const evidenceWeight = evidence.reduce((sum, item) => sum + item.weight, 0);
  const readiness = clamp01(candidate.confidence * 0.5 + evidenceWeight * 0.5);

  let state: ReciprocityState = 'not-ready';
  if (candidate.status === 'complete') state = 'fulfilled';
  else if (candidate.kind === 'follow-up' && input.mutualMatches > 0) state = readiness >= 0.82 ? 'reciprocal' : 'credible';
  else if (candidate.status === 'ready' && input.temporal.phase === 'reflection') state = 'scheduled';
  else if (readiness >= 0.58) state = 'credible';

  const nextAction: ReciprocityAction = state === 'fulfilled'
    ? 'none'
    : candidate.kind === 'follow-up'
      ? 'open-mutuals'
      : candidate.kind === 'office-hours'
        ? 'request-time'
        : candidate.destination === 'VaultRecap'
          ? 'review-vault'
          : 'open-commitment';

  const explanation = state === 'fulfilled'
    ? 'This commitment is already complete and no additional action is being invented.'
    : state === 'reciprocal'
      ? 'Verified reciprocal value exists, so Beacon can safely elevate this path without inferring private intent.'
      : state === 'scheduled'
        ? 'The event has ended and this verified path is ready to be carried into explicit follow-through.'
        : state === 'credible'
          ? 'Multiple verified signals support this path, but the user still controls whether it becomes a real commitment.'
          : 'The available evidence is not strong enough for Beacon to present this as a credible reciprocal path.';

  return {
    commitmentId: candidate.id,
    title: candidate.title,
    state,
    confidence: candidate.confidence,
    readiness,
    evidence,
    nextAction,
    explanation,
  };
}

/**
 * Converts evidence-backed commitments into explicit reciprocity paths.
 *
 * The engine never infers hidden interest, availability, rejection, or consent.
 * It only distinguishes between unready, credible, reciprocal, scheduled, and
 * fulfilled states using actions Beacon can prove occurred in the event.
 */
export function buildSpatialReciprocity(input: Input): SpatialReciprocityState {
  const paths = input.commitments.candidates
    .map((candidate) => derivePath(candidate, input))
    .sort((left, right) => {
      const rank: Record<ReciprocityState, number> = { fulfilled: 5, scheduled: 4, reciprocal: 3, credible: 2, 'not-ready': 1 };
      const stateDelta = rank[right.state] - rank[left.state];
      if (stateDelta !== 0) return stateDelta;
      if (left.readiness !== right.readiness) return right.readiness - left.readiness;
      return left.commitmentId.localeCompare(right.commitmentId);
    });

  const credibleCount = paths.filter((path) => path.state === 'credible').length;
  const reciprocalCount = paths.filter((path) => path.state === 'reciprocal' || path.state === 'scheduled').length;
  const fulfilledCount = paths.filter((path) => path.state === 'fulfilled').length;
  const primary = paths.find((path) => path.state !== 'not-ready' && path.state !== 'fulfilled') ?? paths[0] ?? null;

  return {
    paths,
    primary,
    credibleCount,
    reciprocalCount,
    fulfilledCount,
    systemNarrative: primary
      ? `Beacon has reduced the event to ${paths.length} explicit reciprocity path${paths.length === 1 ? '' : 's'}; ${primary.title.toLowerCase()} is the strongest evidence-backed transition from spatial activity into real-world value.`
      : 'No evidence-backed reciprocity path exists yet. Beacon will not manufacture one.',
  };
}
