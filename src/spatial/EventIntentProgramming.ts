import type {
  DeclaredFitMutualDomain,
  EventIntentKey,
  EventIntentMixRow,
} from '../services/event-intent.service';

export type EventIntentProgrammingPosture =
  | 'add-structure'
  | 'activate-supply'
  | 'protect'
  | 'observe';

export interface EventIntentProgrammingAction {
  id: string;
  intentKey: EventIntentKey;
  posture: EventIntentProgrammingPosture;
  priority: number;
  title: string;
  rationale: string;
  suggestedAction: string;
  measurement: string;
  evidence: string[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Converts host-visible declared demand/supply into a small programming queue.
 * This is deterministic operational decision support, not person-level targeting.
 * It consumes only cohort-gated aggregates and never identifies who asked for or
 * offered a capability.
 *
 * Mutual-domain evidence is composition of actual mutual outcomes, not a causal
 * conversion rate. The adjustment remains a human programming decision and its
 * effect should be measured separately if the host acts on it.
 */
export function buildEventIntentProgramming(input: {
  mix: EventIntentMixRow[];
  mutualDomains: DeclaredFitMutualDomain[];
}): EventIntentProgrammingAction[] {
  const mutualByDomain = new Map(input.mutualDomains.map((domain) => [domain.intent_key, domain] as const));

  const actions = input.mix.map<EventIntentProgrammingAction>((row) => {
    const contributors = Math.max(1, row.contributor_count);
    const signedGap = (row.seeking_count - row.offering_count) / contributors;
    const gapMagnitude = Math.min(1, Math.abs(signedGap));
    const support = clamp01(row.contributor_count / 24);
    const mutual = mutualByDomain.get(row.intent_key) ?? null;
    const mutualSupport = mutual ? clamp01(mutual.mutual_match_count / 12) : 0;
    const twoWayShare = mutual?.two_way_share ?? 0;
    const evidence = [
      `${row.seeking_count} participants explicitly looking for help`,
      `${row.offering_count} participants explicitly open to helping`,
      `${row.contributor_count} participants in the released aggregate cohort`,
    ];
    if (mutual) {
      evidence.push(`${mutual.mutual_match_count} supported mutual outcomes carried this declared domain`);
      evidence.push(`${Math.round(twoWayShare * 100)}% of those supported domain mutuals were two-way declared fits`);
    }

    if (row.balance === 'need-heavy') {
      const noMeaningfulSupply = row.offering_count <= 1;
      return {
        id: `program-${row.intent_key}-structure`,
        intentKey: row.intent_key,
        posture: 'add-structure',
        priority: clamp01(0.58 + gapMagnitude * 0.24 + support * 0.12 + (1 - mutualSupport) * 0.06),
        title: noMeaningfulSupply
          ? 'This domain needs supply before it needs more promotion'
          : 'Turn declared demand into a structured interaction window',
        rationale: noMeaningfulSupply
          ? 'The released aggregate shows substantially more people asking for this capability than people explicitly open to providing it.'
          : 'The room already contains some declared supply, but demand materially exceeds it; leaving the interaction entirely unstructured can waste the available supply.',
        suggestedAction: noMeaningfulSupply
          ? 'If the program can still change, add a qualified facilitator, mentor, exhibitor, or office-hours resource for this domain. Do not manufacture a participant recommendation when the declared supply is not there.'
          : 'Create a bounded opt-in office-hours block, small roundtable, or facilitated introduction window around this domain so existing supply can serve more of the declared need.',
        measurement: 'After the programming change, compare the next cohort-gated declared-demand balance and supported mutual-domain composition. Do not treat a before/after change as causal proof without a controlled design.',
        evidence,
      };
    }

    if (row.balance === 'offer-heavy') {
      return {
        id: `program-${row.intent_key}-supply`,
        intentKey: row.intent_key,
        posture: 'activate-supply',
        priority: clamp01(0.46 + gapMagnitude * 0.22 + support * 0.16 + mutualSupport * 0.08),
        title: 'There is usable declared supply that the room is not fully activating',
        rationale: 'More participants are explicitly open to helping in this domain than are currently declaring that they need it.',
        suggestedAction: 'Use a clearly opt-in mentor table, office-hours slot, or program callout to make this supply legible without exposing who selected the capability or pressuring participants into interactions.',
        measurement: 'Watch whether the aggregate need/supply balance moves toward parity and whether supported mutual outcomes begin carrying this domain more often.',
        evidence,
      };
    }

    if (mutual && mutual.mutual_match_count >= 5 && twoWayShare >= 0.5) {
      return {
        id: `program-${row.intent_key}-protect`,
        intentKey: row.intent_key,
        posture: 'protect',
        priority: clamp01(0.42 + support * 0.18 + mutualSupport * 0.18 + twoWayShare * 0.12),
        title: 'This domain is balanced and already appearing in reciprocal mutual outcomes',
        rationale: 'The declared room mix is balanced enough that additional intervention could create noise, while cohort-gated mutual evidence shows the domain is already participating in two-way fits.',
        suggestedAction: 'Protect the current programming and facilitation pattern. Avoid adding another intervention solely because Beacon has data available.',
        measurement: 'Continue observing cohort-gated demand balance and mutual composition. Intervene only if the operating state materially changes.',
        evidence,
      };
    }

    return {
      id: `program-${row.intent_key}-observe`,
      intentKey: row.intent_key,
      posture: 'observe',
      priority: clamp01(0.24 + support * 0.18 + mutualSupport * 0.08),
      title: 'No programming change is justified yet',
      rationale: 'Declared need and supply are close enough that Beacon does not need to invent an intervention.',
      suggestedAction: 'Keep this domain observable and spend organizer attention on a larger released imbalance first.',
      measurement: 'Re-evaluate only after the declared cohort or supported mutual-outcome composition changes materially.',
      evidence,
    };
  });

  return actions
    .sort((left, right) => right.priority - left.priority || left.intentKey.localeCompare(right.intentKey))
    .slice(0, 6);
}
