import type { InternalGraphEdge, InternalGraphPayload } from './InternalGraphEngine';

export type InternalGraphEpistemicBand = 'strong' | 'usable' | 'fragile' | 'degraded';

export interface InternalGraphEpistemicHealth {
  generatedAt: string;
  graphVersion: string;
  score: number;
  band: InternalGraphEpistemicBand;
  verifiedEdgeRatio: number;
  derivedEdgeRatio: number;
  ambiguousEdgeRatio: number;
  repeatedEvidenceRatio: number;
  freshEdgeRatio: number;
  staleEdgeRatio: number;
  weakContextRatio: number;
  canonicalizedAliasCount: number;
  canonicalCompressionRatio: number;
  warnings: string[];
  strengths: string[];
  methodology: string;
}

const CONTEXT_KINDS = new Set([
  'event', 'venue', 'room', 'role', 'organization', 'domain', 'project', 'topic', 'outcome',
]);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function ratio(count: number, total: number): number {
  return total <= 0 ? 0 : count / total;
}

function edgeAgeDays(edge: InternalGraphEdge, now: number): number {
  const parsed = Date.parse(edge.lastSeenAt);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now - parsed) / 86_400_000);
}

/**
 * Measures the epistemic condition of Constellation's evidence graph, not the
 * quality or value of any person. It answers: "how much should an operator trust
 * topology-level conclusions from this payload right now?"
 */
export function analyzeInternalGraphEpistemicHealth(
  payload: InternalGraphPayload,
  now = Date.now(),
): InternalGraphEpistemicHealth {
  const edges = payload.edges;
  const totalEdges = edges.length;
  const verifiedEdgeRatio = ratio(edges.filter((edge) => edge.confidence === 'VERIFIED').length, totalEdges);
  const derivedEdgeRatio = ratio(edges.filter((edge) => edge.confidence === 'DERIVED').length, totalEdges);
  const ambiguousEdgeRatio = ratio(edges.filter((edge) => edge.confidence === 'AMBIGUOUS').length, totalEdges);
  const repeatedEvidenceRatio = ratio(edges.filter((edge) => edge.evidenceCount >= 2).length, totalEdges);
  const freshEdgeRatio = ratio(edges.filter((edge) => edgeAgeDays(edge, now) <= 120).length, totalEdges);
  const staleEdgeRatio = ratio(edges.filter((edge) => edgeAgeDays(edge, now) > 365).length, totalEdges);

  const degree = new Map<string, number>();
  for (const node of payload.nodes) degree.set(node.id, 0);
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const contextNodes = payload.nodes.filter((node) => CONTEXT_KINDS.has(node.kind));
  const weakContextRatio = ratio(
    contextNodes.filter((node) => (degree.get(node.id) ?? 0) <= 1).length,
    contextNodes.length,
  );

  const canonicalizedAliasCount = payload.nodes.reduce((sum, node) => {
    const raw = Number(node.attributes?.canonicalizedAliasCount ?? 0);
    return sum + (Number.isFinite(raw) && raw > 0 ? raw : 0);
  }, 0);
  const preCanonicalNodeEstimate = payload.nodeCount + canonicalizedAliasCount;
  const canonicalCompressionRatio = preCanonicalNodeEstimate > 0
    ? canonicalizedAliasCount / preCanonicalNodeEstimate
    : 0;

  const evidenceFoundation = verifiedEdgeRatio * 0.42 + (1 - ambiguousEdgeRatio) * 0.18;
  const temporalFoundation = freshEdgeRatio * 0.18 + (1 - staleEdgeRatio) * 0.08;
  const repetitionFoundation = repeatedEvidenceRatio * 0.08;
  const contextFoundation = (1 - weakContextRatio) * 0.06;
  const score = clamp01(evidenceFoundation + temporalFoundation + repetitionFoundation + contextFoundation);
  const band: InternalGraphEpistemicBand = score >= 0.82
    ? 'strong'
    : score >= 0.65
      ? 'usable'
      : score >= 0.48
        ? 'fragile'
        : 'degraded';

  const warnings: string[] = [];
  const strengths: string[] = [];

  if (ambiguousEdgeRatio >= 0.12) warnings.push(`${Math.round(ambiguousEdgeRatio * 100)}% of visible edges are ambiguous evidence.`);
  if (derivedEdgeRatio >= 0.42) warnings.push(`${Math.round(derivedEdgeRatio * 100)}% of visible edges are derived rather than directly verified.`);
  if (staleEdgeRatio >= 0.2) warnings.push(`${Math.round(staleEdgeRatio * 100)}% of visible edges are older than one year.`);
  if (freshEdgeRatio < 0.45 && totalEdges > 0) warnings.push(`Only ${Math.round(freshEdgeRatio * 100)}% of visible edges were observed within 120 days.`);
  if (repeatedEvidenceRatio < 0.25 && totalEdges >= 8) warnings.push(`Only ${Math.round(repeatedEvidenceRatio * 100)}% of edges have repeated supporting evidence.`);
  if (weakContextRatio >= 0.4 && contextNodes.length >= 5) warnings.push(`${Math.round(weakContextRatio * 100)}% of contextual nodes have only one visible relationship and may fragment interpretation.`);

  if (verifiedEdgeRatio >= 0.8) strengths.push(`${Math.round(verifiedEdgeRatio * 100)}% of visible edges are directly verified.`);
  if (freshEdgeRatio >= 0.72) strengths.push(`${Math.round(freshEdgeRatio * 100)}% of visible edges were observed within 120 days.`);
  if (repeatedEvidenceRatio >= 0.5) strengths.push(`${Math.round(repeatedEvidenceRatio * 100)}% of edges have repeated evidence.`);
  if (canonicalizedAliasCount > 0) strengths.push(`${canonicalizedAliasCount} duplicate context aliases are already collapsed into canonical graph entities.`);

  return {
    generatedAt: new Date(now).toISOString(),
    graphVersion: payload.graphVersion,
    score,
    band,
    verifiedEdgeRatio,
    derivedEdgeRatio,
    ambiguousEdgeRatio,
    repeatedEvidenceRatio,
    freshEdgeRatio,
    staleEdgeRatio,
    weakContextRatio,
    canonicalizedAliasCount,
    canonicalCompressionRatio,
    warnings,
    strengths,
    methodology: 'Epistemic health describes evidence quality, freshness, repetition, and graph-context integrity only. It is not a score of any person, community, organization, or event outcome.',
  };
}
