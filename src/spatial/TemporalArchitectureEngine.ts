import type { PresenceState } from '../presence/PresenceEngine';
import type { RuntimeReliabilitySnapshot } from '../reliability/RuntimeReliabilityEngine';
import type { SpatialProgressionState } from './SpatialProgressionEngine';

export type TemporalPhase =
  | 'arrival'
  | 'discovery'
  | 'peak'
  | 'commitment'
  | 'closing'
  | 'reflection';

export interface TemporalArchitectureInput {
  presence: PresenceState;
  progression: SpatialProgressionState;
  runtime: RuntimeReliabilitySnapshot;
  mutualMatches: number;
  eventStartsAt: string;
  eventEndsAt: string;
  now?: number;
}

export interface TemporalArchitectureState {
  phase: TemporalPhase;
  phaseProgress: number;
  title: string;
  narrative: string;
  routeWeightMultiplier: number;
  contractWeightMultiplier: number;
  environmentIntensity: number;
  avatarMotionMultiplier: number;
  routeCadenceSeconds: number;
  opportunityCadenceSeconds: number;
  districtCadenceSeconds: number;
  environmentCadenceSeconds: number;
  focusBias: 'breadth' | 'balanced' | 'conversion' | 'follow-through' | 'recap';
  availableContractKinds: Array<'scan' | 'signal' | 'convert' | 'close'>;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function safeTime(value: string, fallback: number): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function determinePhase(input: TemporalArchitectureInput, now: number): TemporalPhase {
  const startsAt = safeTime(input.eventStartsAt, now - 15 * 60_000);
  const endsAt = safeTime(input.eventEndsAt, now + 60 * 60_000);
  if (now >= endsAt) return 'reflection';

  const duration = Math.max(1, endsAt - startsAt);
  const elapsed = clamp01((now - startsAt) / duration);
  const remainingMinutes = Math.max(0, (endsAt - now) / 60_000);

  if (remainingMinutes <= 10) return 'closing';
  if (input.mutualMatches > 0 || input.progression.momentumChain >= 3) return 'commitment';
  if (input.presence.urgencyLevel === 'surge' || input.presence.tensionScore >= 72 || elapsed >= 0.48) return 'peak';
  if (elapsed <= 0.16) return 'arrival';
  return 'discovery';
}

function phaseProgress(phase: TemporalPhase, now: number, startsAt: number, endsAt: number): number {
  if (phase === 'reflection') return clamp01((now - endsAt) / (20 * 60_000));
  const duration = Math.max(1, endsAt - startsAt);
  const elapsed = clamp01((now - startsAt) / duration);
  const ranges: Record<Exclude<TemporalPhase, 'reflection'>, [number, number]> = {
    arrival: [0, 0.16],
    discovery: [0.12, 0.48],
    peak: [0.38, 0.78],
    commitment: [0.28, 0.9],
    closing: [0.84, 1],
  };
  const [from, to] = ranges[phase];
  return clamp01((elapsed - from) / Math.max(0.01, to - from));
}

/**
 * Narrative rules for the live world. Each phase changes system behavior, not
 * merely copy or color. Timing remains deterministic and all urgency is tied to
 * real event time, verified presence, mutuals and runtime confidence.
 */
export function buildTemporalArchitecture(input: TemporalArchitectureInput): TemporalArchitectureState {
  const now = input.now ?? Date.now();
  const startsAt = safeTime(input.eventStartsAt, now - 15 * 60_000);
  const endsAt = safeTime(input.eventEndsAt, now + 60 * 60_000);
  const phase = determinePhase(input, now);
  const progress = phaseProgress(phase, now, startsAt, endsAt);
  const degraded = input.runtime.health !== 'healthy';
  const reliabilityMultiplier = degraded ? 0.64 : 1;

  const definitions: Record<TemporalPhase, Omit<TemporalArchitectureState, 'phase' | 'phaseProgress'>> = {
    arrival: {
      title: 'Arrival · orient the field',
      narrative: 'The world opens slowly, prioritizing room comprehension before action.',
      routeWeightMultiplier: 0.72,
      contractWeightMultiplier: 0.82,
      environmentIntensity: 0.42,
      avatarMotionMultiplier: 0.64,
      routeCadenceSeconds: 3.8,
      opportunityCadenceSeconds: 6.5,
      districtCadenceSeconds: 24,
      environmentCadenceSeconds: 17,
      focusBias: 'breadth',
      availableContractKinds: ['scan', 'signal'],
    },
    discovery: {
      title: 'Discovery · read the room',
      narrative: 'Routes broaden while Beacon surfaces independent pockets of verified activity.',
      routeWeightMultiplier: 1,
      contractWeightMultiplier: 1,
      environmentIntensity: 0.62,
      avatarMotionMultiplier: 0.72,
      routeCadenceSeconds: 2.8,
      opportunityCadenceSeconds: 5.1,
      districtCadenceSeconds: 21,
      environmentCadenceSeconds: 15,
      focusBias: 'balanced',
      availableContractKinds: ['scan', 'signal', 'convert'],
    },
    peak: {
      title: 'Peak · opportunity density is compressing',
      narrative: 'The field increases route clarity and shortens feedback cadence around real momentum.',
      routeWeightMultiplier: 1.28,
      contractWeightMultiplier: 1.12,
      environmentIntensity: 0.9,
      avatarMotionMultiplier: 0.8,
      routeCadenceSeconds: 1.75,
      opportunityCadenceSeconds: 3.6,
      districtCadenceSeconds: 18,
      environmentCadenceSeconds: 12,
      focusBias: 'conversion',
      availableContractKinds: ['signal', 'convert', 'close'],
    },
    commitment: {
      title: 'Commitment · turn signal into a next step',
      narrative: 'The world quiets around active mutuals so follow-through becomes more legible than noise.',
      routeWeightMultiplier: 1.18,
      contractWeightMultiplier: 1.34,
      environmentIntensity: 0.78,
      avatarMotionMultiplier: 0.58,
      routeCadenceSeconds: 2.1,
      opportunityCadenceSeconds: 4.4,
      districtCadenceSeconds: 22,
      environmentCadenceSeconds: 16,
      focusBias: 'follow-through',
      availableContractKinds: ['convert', 'close'],
    },
    closing: {
      title: 'Closing · preserve what can still become real',
      narrative: 'Beacon compresses the field toward a small set of honest, actionable routes before time expires.',
      routeWeightMultiplier: 1.36,
      contractWeightMultiplier: 1.42,
      environmentIntensity: 0.86,
      avatarMotionMultiplier: 0.5,
      routeCadenceSeconds: 1.6,
      opportunityCadenceSeconds: 3.2,
      districtCadenceSeconds: 19,
      environmentCadenceSeconds: 13,
      focusBias: 'follow-through',
      availableContractKinds: ['convert', 'close'],
    },
    reflection: {
      title: 'Reflection · the live world becomes memory',
      narrative: 'The district powers down gradually while verified outcomes and unfinished paths transfer into the Vault.',
      routeWeightMultiplier: 0.32,
      contractWeightMultiplier: 0.7,
      environmentIntensity: 0.28,
      avatarMotionMultiplier: 0.24,
      routeCadenceSeconds: 5.5,
      opportunityCadenceSeconds: 8,
      districtCadenceSeconds: 30,
      environmentCadenceSeconds: 20,
      focusBias: 'recap',
      availableContractKinds: ['close'],
    },
  };

  const base = definitions[phase];
  return {
    phase,
    phaseProgress: progress,
    ...base,
    environmentIntensity: base.environmentIntensity * reliabilityMultiplier,
    routeWeightMultiplier: base.routeWeightMultiplier * reliabilityMultiplier,
    avatarMotionMultiplier: base.avatarMotionMultiplier * reliabilityMultiplier,
  };
}
