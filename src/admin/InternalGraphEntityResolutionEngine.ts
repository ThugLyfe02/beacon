import type { InternalGraphNode, InternalGraphPayload } from './InternalGraphEngine';

export interface InternalEntityResolutionCandidate {
  aliasNodeId: string;
  canonicalNodeId: string;
  kind: string;
  score: number;
  labelSimilarity: number;
  neighborhoodSimilarity: number;
  domainEquivalent: boolean;
  sharedNeighborCount: number;
  reasons: string[];
}

const RESOLVABLE_KINDS = new Set([
  'organization',
  'domain',
  'project',
  'topic',
  'venue',
  'role',
]);

function normalizeLabel(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function compactLabel(value: string): string {
  return normalizeLabel(value).replace(/\s+/g, '');
}

function tokens(value: string): Set<string> {
  return new Set(normalizeLabel(value).split(' ').filter((token) => token.length > 1));
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function trigramSet(value: string): Set<string> {
  const normalized = `  ${compactLabel(value)}  `;
  const result = new Set<string>();
  for (let index = 0; index <= normalized.length - 3; index += 1) {
    result.add(normalized.slice(index, index + 3));
  }
  return result;
}

function labelSimilarity(left: string, right: string): number {
  const compactLeft = compactLabel(left);
  const compactRight = compactLabel(right);
  if (!compactLeft || !compactRight) return 0;
  if (compactLeft === compactRight) return 1;
  const tokenScore = jaccard(tokens(left), tokens(right));
  const trigramScore = jaccard(trigramSet(left), trigramSet(right));
  return Math.max(tokenScore, trigramScore * 0.92);
}

function rootDomain(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];
  if (!normalized.includes('.')) return null;
  const parts = normalized.split('.').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('.') : normalized;
}

function nodeDomain(node: InternalGraphNode): string | null {
  if (node.kind === 'domain') return rootDomain(node.label);
  for (const key of ['domain', 'website', 'url', 'homepage']) {
    const value = node.attributes[key];
    if (typeof value === 'string') {
      const root = rootDomain(value);
      if (root) return root;
    }
  }
  return null;
}

function adjacency(payload: InternalGraphPayload): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const node of payload.nodes) graph.set(node.id, new Set());
  for (const edge of payload.edges) {
    graph.get(edge.source)?.add(edge.target);
    graph.get(edge.target)?.add(edge.source);
  }
  return graph;
}

function chooseCanonical(left: InternalGraphNode, right: InternalGraphNode, graph: Map<string, Set<string>>): [InternalGraphNode, InternalGraphNode] {
  const leftDegree = graph.get(left.id)?.size ?? 0;
  const rightDegree = graph.get(right.id)?.size ?? 0;
  if (leftDegree !== rightDegree) return leftDegree > rightDegree ? [left, right] : [right, left];
  const leftFirst = Date.parse(left.firstSeenAt);
  const rightFirst = Date.parse(right.firstSeenAt);
  if (Number.isFinite(leftFirst) && Number.isFinite(rightFirst) && leftFirst !== rightFirst) {
    return leftFirst < rightFirst ? [left, right] : [right, left];
  }
  return left.id < right.id ? [left, right] : [right, left];
}

/**
 * Conservative entity-resolution suggestions for non-person graph entities.
 *
 * Person nodes are categorically excluded. This engine never performs identity
 * resolution, contact matching, facial matching, or external enrichment. It only
 * suggests that two already-authorized business/context entities may represent
 * the same concept and requires operator approval before canonicalization.
 */
export function suggestInternalGraphEntityResolutions(
  payload: InternalGraphPayload,
  minScore = 0.72,
): InternalEntityResolutionCandidate[] {
  const graph = adjacency(payload);
  const nodes = payload.nodes
    .filter((node) => node.kind !== 'person' && RESOLVABLE_KINDS.has(node.kind))
    .sort((left, right) => left.id.localeCompare(right.id));
  const candidates: InternalEntityResolutionCandidate[] = [];

  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = nodes[leftIndex];
      const right = nodes[rightIndex];
      if (left.kind !== right.kind) continue;

      const labelScore = labelSimilarity(left.label, right.label);
      const leftNeighbors = graph.get(left.id) ?? new Set<string>();
      const rightNeighbors = graph.get(right.id) ?? new Set<string>();
      const neighborhoodScore = jaccard(leftNeighbors, rightNeighbors);
      const sharedNeighborCount = [...leftNeighbors].filter((nodeId) => rightNeighbors.has(nodeId)).length;
      const leftDomain = nodeDomain(left);
      const rightDomain = nodeDomain(right);
      const domainEquivalent = Boolean(leftDomain && rightDomain && leftDomain === rightDomain);

      let score = labelScore * 0.64 + neighborhoodScore * 0.3;
      if (domainEquivalent) score += 0.24;
      if (compactLabel(left.label) === compactLabel(right.label)) score = Math.max(score, 0.96);
      if (sharedNeighborCount >= 3) score += Math.min(0.08, sharedNeighborCount * 0.015);
      score = Math.max(0, Math.min(1, score));
      if (score < minScore) continue;

      const [canonical, alias] = chooseCanonical(left, right, graph);
      const reasons: string[] = [];
      if (labelScore >= 0.95) reasons.push('labels normalize to nearly the same entity name');
      else if (labelScore >= 0.72) reasons.push(`high label similarity ${Math.round(labelScore * 100)}%`);
      if (domainEquivalent) reasons.push(`same root domain ${leftDomain}`);
      if (neighborhoodScore >= 0.5) reasons.push(`shared graph neighborhood ${Math.round(neighborhoodScore * 100)}%`);
      if (sharedNeighborCount > 0) reasons.push(`${sharedNeighborCount} shared evidence neighbors`);
      reasons.push('operator approval required; no person identity resolution is permitted');

      candidates.push({
        aliasNodeId: alias.id,
        canonicalNodeId: canonical.id,
        kind: canonical.kind,
        score,
        labelSimilarity: labelScore,
        neighborhoodSimilarity: neighborhoodScore,
        domainEquivalent,
        sharedNeighborCount,
        reasons,
      });
    }
  }

  return candidates
    .sort((left, right) => right.score - left.score || left.aliasNodeId.localeCompare(right.aliasNodeId))
    .slice(0, 120);
}
