import { calculateBucket, type PresenceState } from '../presence/PresenceEngine';
import type { SpatialProgressionState } from './SpatialProgressionEngine';

export type ContractKind = 'scan' | 'signal' | 'convert' | 'close';
export type ContractState = 'locked' | 'active' | 'complete';

export interface SpatialContract {
  id: string;
  kind: ContractKind;
  title: string;
  detail: string;
  current: number;
  target: number;
  progress: number;
  state: ContractState;
  premiumInsight?: string;
}

export interface SpatialContractBoard {
  active: SpatialContract;
  queue: SpatialContract[];
  completedCount: number;
  fieldMultiplier: number;
}

interface SpatialContractInput {
  presence: PresenceState;
  progression: SpatialProgressionState;
  signalsSent: number;
  mutualMatches: number;
  isPremium: boolean;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function contract(
  id: string,
  kind: ContractKind,
  title: string,
  detail: string,
  current: number,
  target: number,
  unlocked: boolean,
  premiumInsight?: string,
): SpatialContract {
  const progress = clamp01(current / Math.max(1, target));
  return {
    id,
    kind,
    title,
    detail,
    current,
    target,
    progress,
    state: !unlocked ? 'locked' : progress >= 1 ? 'complete' : 'active',
    premiumInsight,
  };
}

/**
 * Event-scoped mission board inspired by open-world contract systems.
 * Every objective is derived from activity Beacon can verify. There are no
 * random rewards, hidden odds, fabricated scarcity, or public social scores.
 */
export function buildSpatialContractBoard({
  presence,
  progression,
  signalsSent,
  mutualMatches,
  isPremium,
}: SpatialContractInput): SpatialContractBoard {
  const closeTargets = presence.visibleTargets.filter(
    (target) => calculateBucket(target.distanceFeet) >= 3,
  ).length;
  const contracts = [
    contract(
      'field-scan',
      'scan',
      'Read the room',
      'Bring three verified attendees into the live field.',
      presence.density,
      3,
      true,
      isPremium ? `${closeTargets} of the visible paths are already inside close range.` : undefined,
    ),
    contract(
      'first-signal',
      'signal',
      'Make the first move',
      'Send one intentional signal from the field.',
      signalsSent,
      1,
      presence.density > 0,
      isPremium && presence.visibleTargets.length > 0
        ? 'The closest highlighted route is the strongest current starting point.'
        : undefined,
    ),
    contract(
      'real-mutual',
      'convert',
      'Create a real opening',
      'Turn a live signal into a mutual connection.',
      mutualMatches,
      1,
      signalsSent > 0,
      isPremium
        ? 'A mutual unlocks the gold route and the next-step workflow.'
        : undefined,
    ),
    contract(
      'field-catalyst',
      'close',
      'Become the catalyst',
      'Reach Catalyst rank through verified event activity.',
      progression.level,
      6,
      mutualMatches > 0,
      isPremium
        ? `${Math.max(0, progression.nextLevelPoints - progression.currentPoints)} points remain before the next field level.`
        : undefined,
    ),
  ];

  const firstIncomplete = contracts.find((item) => item.state === 'active');
  const firstLocked = contracts.find((item) => item.state === 'locked');
  const active = firstIncomplete ?? firstLocked ?? contracts[contracts.length - 1];
  const completedCount = contracts.filter((item) => item.state === 'complete').length;

  return {
    active,
    queue: contracts,
    completedCount,
    fieldMultiplier: 1 + completedCount * 0.25,
  };
}
