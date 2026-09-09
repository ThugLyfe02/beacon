export interface InternalGraphEpochCommunity {
  id: number;
  label: string;
  size: number;
  personCount: number;
  cohesion: number;
  memberAliases: string[];
}

export interface InternalGraphEpochBroker {
  subjectAlias: string;
  rank: number;
  forensicScore: number;
  brokerScore: number;
  participationCoefficient: number;
  effectiveSize: number;
  redundancyRatio: number;
  articulation: boolean;
  crossCommunityCount: number;
}

export interface InternalGraphEpochMotif {
  key: string;
  count: number;
  strength: number;
  class: string | null;
}

export interface InternalGraphEpoch {
  epochId: string;
  eventId: string;
  eventName: string;
  capturedAt: string;
  topologyDigest: string;
  nodeCount: number;
  edgeCount: number;
  communityCount: number;
  articulationCount: number;
  criticalBridgeCount: number;
  structuralDependence: number;
  communities: InternalGraphEpochCommunity[];
  brokers: InternalGraphEpochBroker[];
  motifs: InternalGraphEpochMotif[];
}

export interface InternalGraphEpochHistory {
  generatedAt: string;
  epochs: InternalGraphEpoch[];
  retentionNote: string;
}

export type InternalCommunityLineageStatus =
  | 'continued'
  | 'expanded'
  | 'contracted'
  | 'converged'
  | 'split_fragment'
  | 'new';

export interface InternalCommunityLineage {
  currentEpochId: string;
  currentCommunityId: number;
  currentLabel: string;
  previousCommunityIds: number[];
  previousLabels: string[];
  status: InternalCommunityLineageStatus;
  retainedRatio: number;
  incomingRatio: number;
  jaccard: number;
  sharedMembers: number;
}

export interface InternalBrokerTrajectory {
  subjectAlias: string;
  currentRank: number;
  previousRank: number | null;
  rankDelta: number | null;
  forensicScore: number;
  previousForensicScore: number | null;
  scoreDelta: number | null;
  articulation: boolean;
  status: 'emerging' | 'rising' | 'stable' | 'decaying' | 'new';
}

export interface InternalMotifTrajectory {
  key: string;
  class: string | null;
  currentCount: number;
  previousCount: number;
  countDelta: number;
  currentStrength: number;
  previousStrength: number;
  strengthDelta: number;
  status: 'emerging' | 'accelerating' | 'stable' | 'fading';
}

export interface InternalEpochTransitionAnalysis {
  current: InternalGraphEpoch;
  previous: InternalGraphEpoch | null;
  communities: InternalCommunityLineage[];
  brokerTrajectories: InternalBrokerTrajectory[];
  motifTrajectories: InternalMotifTrajectory[];
  networkGrowth: {
    nodeDelta: number;
    edgeDelta: number;
    communityDelta: number;
    structuralDependenceDelta: number;
  };
  summary: string[];
}

function setOverlap(left: string[], right: string[]): { shared: number; union: number } {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let shared = 0;
  for (const value of leftSet) if (rightSet.has(value)) shared += 1;
  return { shared, union: leftSet.size + rightSet.size - shared };
}

function compareCommunity(
  current: InternalGraphEpochCommunity,
  previous: InternalGraphEpochCommunity,
): { shared: number; jaccard: number; retained: number; incoming: number } {
  const overlap = setOverlap(current.memberAliases, previous.memberAliases);
  return {
    shared: overlap.shared,
    jaccard: overlap.union > 0 ? overlap.shared / overlap.union : 0,
    retained: previous.personCount > 0 ? overlap.shared / previous.personCount : 0,
    incoming: current.personCount > 0 ? overlap.shared / current.personCount : 0,
  };
}

function communityLineage(current: InternalGraphEpoch, previous: InternalGraphEpoch | null): InternalCommunityLineage[] {
  if (!previous) {
    return current.communities.map((community) => ({
      currentEpochId: current.epochId,
      currentCommunityId: community.id,
      currentLabel: community.label,
      previousCommunityIds: [],
      previousLabels: [],
      status: 'new',
      retainedRatio: 0,
      incomingRatio: 0,
      jaccard: 0,
      sharedMembers: 0,
    }));
  }

  return current.communities.map((community) => {
    const candidates = previous.communities
      .map((prior) => ({ prior, ...compareCommunity(community, prior) }))
      .filter((candidate) => candidate.shared > 0)
      .sort((a, b) => b.jaccard - a.jaccard || b.shared - a.shared || a.prior.id - b.prior.id);

    if (candidates.length === 0) {
      return {
        currentEpochId: current.epochId,
        currentCommunityId: community.id,
        currentLabel: community.label,
        previousCommunityIds: [],
        previousLabels: [],
        status: 'new' as const,
        retainedRatio: 0,
        incomingRatio: 0,
        jaccard: 0,
        sharedMembers: 0,
      };
    }

    const meaningful = candidates.filter((candidate) => candidate.incoming >= 0.2 || candidate.retained >= 0.2);
    const best = candidates[0];
    let status: InternalCommunityLineageStatus;
    if (meaningful.length >= 2) status = 'converged';
    else if (best.jaccard >= 0.65 && community.personCount > best.prior.personCount * 1.2) status = 'expanded';
    else if (best.jaccard >= 0.65 && community.personCount < best.prior.personCount * 0.8) status = 'contracted';
    else if (best.jaccard >= 0.45) status = 'continued';
    else status = 'split_fragment';

    return {
      currentEpochId: current.epochId,
      currentCommunityId: community.id,
      currentLabel: community.label,
      previousCommunityIds: meaningful.map((candidate) => candidate.prior.id),
      previousLabels: meaningful.map((candidate) => candidate.prior.label),
      status,
      retainedRatio: best.retained,
      incomingRatio: best.incoming,
      jaccard: best.jaccard,
      sharedMembers: best.shared,
    };
  });
}

function brokerTrajectories(current: InternalGraphEpoch, previous: InternalGraphEpoch | null): InternalBrokerTrajectory[] {
  const previousByAlias = new Map((previous?.brokers ?? []).map((broker) => [broker.subjectAlias, broker] as const));
  return current.brokers.map((broker) => {
    const prior = previousByAlias.get(broker.subjectAlias) ?? null;
    const scoreDelta = prior ? broker.forensicScore - prior.forensicScore : null;
    const rankDelta = prior ? prior.rank - broker.rank : null; // positive means rank improved
    let status: InternalBrokerTrajectory['status'];
    if (!prior) status = 'new';
    else if ((rankDelta ?? 0) >= 4 || (scoreDelta ?? 0) > Math.max(1, prior.forensicScore * 0.35)) status = 'emerging';
    else if ((rankDelta ?? 0) >= 2 || (scoreDelta ?? 0) > Math.max(0.4, prior.forensicScore * 0.15)) status = 'rising';
    else if ((rankDelta ?? 0) <= -3 || (scoreDelta ?? 0) < -Math.max(0.5, prior.forensicScore * 0.2)) status = 'decaying';
    else status = 'stable';

    return {
      subjectAlias: broker.subjectAlias,
      currentRank: broker.rank,
      previousRank: prior?.rank ?? null,
      rankDelta,
      forensicScore: broker.forensicScore,
      previousForensicScore: prior?.forensicScore ?? null,
      scoreDelta,
      articulation: broker.articulation,
      status,
    };
  }).sort((a, b) => {
    const priority: Record<InternalBrokerTrajectory['status'], number> = { emerging: 0, new: 1, rising: 2, stable: 3, decaying: 4 };
    return priority[a.status] - priority[b.status] || a.currentRank - b.currentRank;
  });
}

function motifTrajectories(current: InternalGraphEpoch, previous: InternalGraphEpoch | null): InternalMotifTrajectory[] {
  const previousByKey = new Map((previous?.motifs ?? []).map((motif) => [motif.key, motif] as const));
  const keys = new Set([...current.motifs.map((motif) => motif.key), ...(previous?.motifs ?? []).map((motif) => motif.key)]);
  return [...keys].map((key) => {
    const now = current.motifs.find((motif) => motif.key === key) ?? null;
    const prior = previousByKey.get(key) ?? null;
    const currentCount = now?.count ?? 0;
    const previousCount = prior?.count ?? 0;
    const currentStrength = now?.strength ?? 0;
    const previousStrength = prior?.strength ?? 0;
    const countDelta = currentCount - previousCount;
    const strengthDelta = currentStrength - previousStrength;
    let status: InternalMotifTrajectory['status'];
    if (previousCount === 0 && currentCount > 0) status = 'emerging';
    else if (countDelta > Math.max(1, previousCount * 0.25) || strengthDelta > Math.max(1, previousStrength * 0.25)) status = 'accelerating';
    else if (countDelta < -Math.max(1, previousCount * 0.25) || strengthDelta < -Math.max(1, previousStrength * 0.25)) status = 'fading';
    else status = 'stable';
    return {
      key,
      class: now?.class ?? prior?.class ?? null,
      currentCount,
      previousCount,
      countDelta,
      currentStrength,
      previousStrength,
      strengthDelta,
      status,
    };
  }).sort((a, b) => Math.abs(b.strengthDelta) - Math.abs(a.strengthDelta) || a.key.localeCompare(b.key));
}

export function analyzeInternalEpochTransition(
  current: InternalGraphEpoch,
  previous: InternalGraphEpoch | null,
): InternalEpochTransitionAnalysis {
  const communities = communityLineage(current, previous);
  const brokers = brokerTrajectories(current, previous);
  const motifs = motifTrajectories(current, previous);
  const summary: string[] = [];

  const converged = communities.filter((community) => community.status === 'converged').length;
  const newCommunities = communities.filter((community) => community.status === 'new').length;
  const emergingBrokers = brokers.filter((broker) => broker.status === 'emerging' || broker.status === 'new').length;
  const acceleratingMotifs = motifs.filter((motif) => motif.status === 'accelerating' || motif.status === 'emerging').length;
  if (converged > 0) summary.push(`${converged} community lineage${converged === 1 ? '' : 's'} converged from multiple prior groups`);
  if (newCommunities > 0) summary.push(`${newCommunities} community${newCommunities === 1 ? '' : 'ies'} formed without a strong predecessor`);
  if (emergingBrokers > 0) summary.push(`${emergingBrokers} broker trajector${emergingBrokers === 1 ? 'y is' : 'ies are'} newly emerging`);
  if (acceleratingMotifs > 0) summary.push(`${acceleratingMotifs} structural motif${acceleratingMotifs === 1 ? '' : 's'} accelerated`);
  if (summary.length === 0) summary.push('Longitudinal structure is comparatively stable across these epochs');

  return {
    current,
    previous,
    communities,
    brokerTrajectories: brokers,
    motifTrajectories: motifs,
    networkGrowth: {
      nodeDelta: current.nodeCount - (previous?.nodeCount ?? 0),
      edgeDelta: current.edgeCount - (previous?.edgeCount ?? 0),
      communityDelta: current.communityCount - (previous?.communityCount ?? 0),
      structuralDependenceDelta: current.structuralDependence - (previous?.structuralDependence ?? 0),
    },
    summary,
  };
}
