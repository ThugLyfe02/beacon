import type { PresenceState } from '../presence/PresenceEngine';
import type { RuntimeReliabilitySnapshot } from '../reliability/RuntimeReliabilityEngine';
import type { SpatialProgressionState } from './SpatialProgressionEngine';

export type SpatialAct = 'briefing' | 'exploration' | 'convergence' | 'closing' | 'afterglow';

export interface SpatialDirectorInput {
  presence: PresenceState;
  progression: SpatialProgressionState;
  runtime: RuntimeReliabilitySnapshot;
  eventStartsAt: string;
  eventEndsAt: string;
  now?: number;
}

export interface SpatialDirectorState {
  act: SpatialAct;
  title: string;
  direction: string;
  accent: string;
  worldIntensity: number;
  revealRadius: number;
  pulseRate: number;
  focusLimit: 1 | 2 | 3;
  degraded: boolean;
  closingMinutes: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function determineAct(
  now: number,
  startsAt: number,
  endsAt: number,
  presence: PresenceState,
): SpatialAct {
  if (now >= endsAt) return 'afterglow';
  const remainingMinutes = Math.max(0, Math.floor((endsAt - now) / 60_000));
  if (remainingMinutes <= 12) return 'closing';
  if (presence.urgencyLevel === 'surge' || presence.mutualMatches > 0) return 'convergence';
  if (now < startsAt + 12 * 60_000) return 'briefing';
  return 'exploration';
}

function copyForAct(
  act: SpatialAct,
  presence: PresenceState,
  progression: SpatialProgressionState,
  closingMinutes: number,
): Pick<SpatialDirectorState, 'title' | 'direction' | 'accent'> {
  switch (act) {
    case 'briefing':
      return {
        title: 'The room is opening',
        direction: 'Let the field settle, then choose one strong path instead of chasing every signal.',
        accent: '#60a5fa',
      };
    case 'convergence':
      return {
        title: 'The field is converging',
        direction: presence.mutualMatches > 0
          ? 'A verified mutual is active. Convert it into a real next step while the route is still live.'
          : 'Several signals are compressing into the same window. Commit to the strongest route now.',
        accent: '#fbbf24',
      };
    case 'closing':
      return {
        title: `${closingMinutes}m left in this field`,
        direction: progression.momentumChain > 0
          ? 'Finish the chain with one concrete follow-through before the event closes.'
          : 'Choose one nearby person and create a real next step before the field resets.',
        accent: '#fb7185',
      };
    case 'afterglow':
      return {
        title: 'The live field has closed',
        direction: 'Review the mutuals, commitments and missed paths that now belong in your Vault.',
        accent: '#a78bfa',
      };
    default:
      return {
        title: 'Explore with intent',
        direction: 'Move through the room and let Beacon narrow the field as stronger paths appear.',
        accent: '#818cf8',
      };
  }
}

/**
 * Deterministic scene director for the live field.
 *
 * It changes the world only from event time, verified presence, progression and
 * runtime health. It never invents people, demand, hidden intent or rewards.
 */
export function buildSpatialDirector(input: SpatialDirectorInput): SpatialDirectorState {
  const now = input.now ?? Date.now();
  const startsAt = new Date(input.eventStartsAt).getTime();
  const endsAt = new Date(input.eventEndsAt).getTime();
  const closingMinutes = Math.max(0, Math.floor((endsAt - now) / 60_000));
  const act = determineAct(now, startsAt, endsAt, input.presence);
  const degraded = input.runtime.state !== 'healthy';
  const copy = copyForAct(act, input.presence, input.progression, closingMinutes);

  const density = clamp01(input.presence.density / 12);
  const tension = clamp01(input.presence.tensionScore / 100);
  const progress = clamp01(input.progression.progress);
  const reliabilityPenalty = degraded ? 0.45 : 1;
  const actBoost = act === 'convergence' ? 0.18 : act === 'closing' ? 0.12 : 0;
  const worldIntensity = clamp01((0.18 + density * 0.32 + tension * 0.3 + progress * 0.2 + actBoost) * reliabilityPenalty);

  return {
    act,
    ...copy,
    worldIntensity,
    revealRadius: 6 + worldIntensity * 18,
    pulseRate: 0.35 + worldIntensity * 1.45,
    focusLimit: degraded ? 1 : act === 'convergence' || act === 'closing' ? 3 : 2,
    degraded,
    closingMinutes,
  };
}
