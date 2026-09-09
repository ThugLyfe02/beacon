import type { InternalGraphConfidence, InternalGraphPayload } from './InternalGraphEngine';

export interface InternalOntologyKindStat {
  kind: string;
  count: number;
  share: number;
  averageDegree: number;
}

export interface InternalOntologyRelationSignature {
  key: string;
  sourceKind: string;
  relation: string;
  targetKind: string;
  count: number;
  verifiedRatio: number;
  repeatedEvidenceRatio: number;
  freshRatio: number;
  averageEvidenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface InternalOntologyDrift {
  newNodeKinds: string[];
  retiredNodeKinds: string[];
  newRelationSignatures: string[];
  retiredRelationSignatures: string[];
  schemaStability: number;
  schemaNovelty: number;
}

export interface InternalOntologyBlindSpot {
  key: string;
  title: string;
  severity: number;
  reasons: string[];
  recommendedSurface: 'InternalEvidenceDebt' | 'InternalEntityResolutionLab' | 'InternalPerspectiveLab' | 'InternalPatternQueryLab';
}

export interface InternalOntologyObservatoryReport {
  generatedAt: string;
  graphVersion: string;
  nodeKindEntropy: number;
  relationEntropy: number;
  nodeKinds: InternalOntologyKindStat[];
  relationSignatures: InternalOntologyRelationSignature[];
  drift: InternalOntologyDrift | null;
  blindSpots: InternalOntologyBlindSpot[];
  suggestedPerspectiveKinds: string[];
  suggestedRelations: string[];
  operatingRule: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function entropy(counts: number[]): number {
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;
  let result = 0;
  for (const count of counts) {
    if (count <= 0) continue;
    const p = count / total;
    result -= p * Math.log2(p);
  }
  const max = Math.log2(Math.max(1, counts.filter((value) => value > 0).length));
  return max > 0 ? result / max : 0;
}

function confidenceRank(confidence: InternalGraphConfidence): number {
  if (confidence === 'VERIFIED') return 2;
  if (confidence === 'DERIVED') return 1;
  return 0;
}

function relationSignature(sourceKind: string, relation: string, targetKind: string): string {
  return `${sourceKind}|${relation}|${targetKind}`;
}

function setJaccard(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / union.size;
}

function buildRelationStats(payload: InternalGraphPayload, now: number): InternalOntologyRelationSignature[] {
  const nodeById = new Map(payload.nodes.map((node) => [node.id, node] as const));
  const rows = new Map<string, {
    sourceKind: string;
    relation: string;
    targetKind: string;
    count: number;
    verified: number;
    repeated: number;
    fresh: number;
    evidenceTotal: number;
    firstSeenAt: string;
    lastSeenAt: string;
  }>();

  for (const edge of payload.edges) {
    const sourceKind = nodeById.get(edge.source)?.kind ?? 'unknown';
    const targetKind = nodeById.get(edge.target)?.kind ?? 'unknown';
    const key = relationSignature(sourceKind, edge.relation, targetKind);
    const current = rows.get(key) ?? {
      sourceKind,
      relation: edge.relation,
      targetKind,
      count: 0,
      verified: 0,
      repeated: 0,
      fresh: 0,
      evidenceTotal: 0,
      firstSeenAt: edge.firstSeenAt,
      lastSeenAt: edge.lastSeenAt,
    };
    current.count += 1;
    if (edge.confidence === 'VERIFIED') current.verified += 1;
    if (edge.evidenceCount >= 2) current.repeated += 1;
    const lastSeen = Date.parse(edge.lastSeenAt);
    if (Number.isFinite(lastSeen) && now - lastSeen <= 120 * 86_400_000) current.fresh += 1;
    current.evidenceTotal += Math.max(0, edge.evidenceCount);
    if (Date.parse(edge.firstSeenAt) < Date.parse(current.firstSeenAt)) current.firstSeenAt = edge.firstSeenAt;
    if (Date.parse(edge.lastSeenAt) > Date.parse(current.lastSeenAt)) current.lastSeenAt = edge.lastSeenAt;
    rows.set(key, current);
  }

  return [...rows.entries()].map(([key, row]) => ({
    key,
    sourceKind: row.sourceKind,
    relation: row.relation,
    targetKind: row.targetKind,
    count: row.count,
    verifiedRatio: row.count > 0 ? row.verified / row.count : 0,
    repeatedEvidenceRatio: row.count > 0 ? row.repeated / row.count : 0,
    freshRatio: row.count > 0 ? row.fresh / row.count : 0,
    averageEvidenceCount: row.count > 0 ? row.evidenceTotal / row.count : 0,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
  })).sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function buildKindStats(payload: InternalGraphPayload): InternalOntologyKindStat[] {
  const degree = new Map(payload.nodes.map((node) => [node.id, 0] as const));
  for (const edge of payload.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const grouped = new Map<string, string[]>();
  for (const node of payload.nodes) {
    const ids = grouped.get(node.kind) ?? [];
    ids.push(node.id);
    grouped.set(node.kind, ids);
  }
  return [...grouped.entries()].map(([kind, ids]) => ({
    kind,
    count: ids.length,
    share: payload.nodeCount > 0 ? ids.length / payload.nodeCount : 0,
    averageDegree: ids.length > 0 ? ids.reduce((sum, id) => sum + (degree.get(id) ?? 0), 0) / ids.length : 0,
  })).sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind));
}

function blindSpots(signatures: InternalOntologyRelationSignature[]): InternalOntologyBlindSpot[] {
  const result: InternalOntologyBlindSpot[] = [];
  for (const signature of signatures) {
    if (signature.count >= 3 && signature.verifiedRatio < 0.45) {
      result.push({
        key: `verification:${signature.key}`,
        title: `Low verification coverage: ${signature.sourceKind} → ${signature.relation} → ${signature.targetKind}`,
        severity: 7.2 + Math.min(1.8, signature.count / 12),
        reasons: [
          `${Math.round(signature.verifiedRatio * 100)}% verified across ${signature.count} relationships`,
          'this relationship signature is common enough to influence graph interpretation',
        ],
        recommendedSurface: 'InternalEvidenceDebt',
      });
    }
    if (signature.count >= 4 && signature.repeatedEvidenceRatio < 0.25) {
      result.push({
        key: `repetition:${signature.key}`,
        title: `One-shot relation family: ${signature.relation}`,
        severity: 5.8 + Math.min(1.6, signature.count / 16),
        reasons: [
          `${Math.round(signature.repeatedEvidenceRatio * 100)}% of relationships repeat in retained evidence`,
          'a common relation family with little repetition is more vulnerable to event-specific noise',
        ],
        recommendedSurface: 'InternalPerspectiveLab',
      });
    }
    if (signature.count >= 3 && signature.freshRatio < 0.35) {
      result.push({
        key: `freshness:${signature.key}`,
        title: `Aging relation family: ${signature.relation}`,
        severity: 5.5,
        reasons: [
          `only ${Math.round(signature.freshRatio * 100)}% of this signature was observed within 120 days`,
          'time-sensitive analysis should test whether conclusions survive a recent-evidence lens',
        ],
        recommendedSurface: 'InternalPerspectiveLab',
      });
    }
  }
  return result.sort((left, right) => right.severity - left.severity || left.key.localeCompare(right.key)).slice(0, 30);
}

/**
 * Observe how Constellation's own entity/relation language is changing. This is a
 * schema/data-model introspection layer only: it never infers new people, identities,
 * relationships, or social meaning from missing/novel signatures.
 */
export function analyzeInternalOntologyObservatory(input: {
  current: InternalGraphPayload;
  previous?: InternalGraphPayload | null;
  now?: number;
}): InternalOntologyObservatoryReport {
  const now = input.now ?? Date.now();
  const nodeKinds = buildKindStats(input.current);
  const relationSignatures = buildRelationStats(input.current, now);
  const currentKinds = new Set(nodeKinds.map((item) => item.kind));
  const currentSignatures = new Set(relationSignatures.map((item) => item.key));
  let drift: InternalOntologyDrift | null = null;

  if (input.previous) {
    const previousKinds = new Set(input.previous.nodes.map((node) => node.kind));
    const previousSignatures = new Set(buildRelationStats(input.previous, now).map((item) => item.key));
    const newNodeKinds = [...currentKinds].filter((kind) => !previousKinds.has(kind)).sort();
    const retiredNodeKinds = [...previousKinds].filter((kind) => !currentKinds.has(kind)).sort();
    const newRelationSignatures = [...currentSignatures].filter((key) => !previousSignatures.has(key)).sort();
    const retiredRelationSignatures = [...previousSignatures].filter((key) => !currentSignatures.has(key)).sort();
    const stability = (setJaccard(currentKinds, previousKinds) + setJaccard(currentSignatures, previousSignatures)) / 2;
    drift = {
      newNodeKinds,
      retiredNodeKinds,
      newRelationSignatures,
      retiredRelationSignatures,
      schemaStability: clamp01(stability),
      schemaNovelty: clamp01(1 - stability),
    };
  }

  const relationCounts = new Map<string, number>();
  for (const signature of relationSignatures) relationCounts.set(signature.relation, (relationCounts.get(signature.relation) ?? 0) + signature.count);
  const suggestedRelations = [...relationCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([relation]) => relation);
  const suggestedPerspectiveKinds = nodeKinds
    .filter((kind) => kind.count >= 2)
    .slice(0, 10)
    .map((kind) => kind.kind);

  return {
    generatedAt: new Date(now).toISOString(),
    graphVersion: input.current.graphVersion,
    nodeKindEntropy: entropy(nodeKinds.map((item) => item.count)),
    relationEntropy: entropy(relationSignatures.map((item) => item.count)),
    nodeKinds,
    relationSignatures,
    drift,
    blindSpots: blindSpots(relationSignatures),
    suggestedPerspectiveKinds,
    suggestedRelations,
    operatingRule: 'Ontology Observatory describes the shape and evidence coverage of Beacon’s graph language. Novel or missing schema signatures are not evidence that any person, organization, or relationship exists.',
  };
}
