import type {
  InternalGraphConfidence,
  InternalGraphEdge,
  InternalGraphNode,
  InternalGraphPayload,
} from './InternalGraphEngine';

export interface InternalGraphEntityAlias {
  id: string;
  aliasNodeId: string;
  canonicalNodeId: string;
  kind: string;
  confidence: number;
  reason: string | null;
  updatedAt: string;
  expiresAt: string;
}

const CONFIDENCE_RANK: Record<InternalGraphConfidence, number> = {
  AMBIGUOUS: 0,
  DERIVED: 1,
  VERIFIED: 2,
};

function strongestConfidence(left: InternalGraphConfidence, right: InternalGraphConfidence): InternalGraphConfidence {
  return CONFIDENCE_RANK[left] >= CONFIDENCE_RANK[right] ? left : right;
}

function earlier(left: string, right: string): string {
  const l = Date.parse(left);
  const r = Date.parse(right);
  if (!Number.isFinite(l)) return right;
  if (!Number.isFinite(r)) return left;
  return l <= r ? left : right;
}

function later(left: string, right: string): string {
  const l = Date.parse(left);
  const r = Date.parse(right);
  if (!Number.isFinite(l)) return right;
  if (!Number.isFinite(r)) return left;
  return l >= r ? left : right;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function aliasSignature(aliases: InternalGraphEntityAlias[]): string {
  return fnv1a(
    aliases
      .map((alias) => `${alias.aliasNodeId}->${alias.canonicalNodeId}:${alias.kind}:${alias.confidence.toFixed(4)}`)
      .sort()
      .join('|'),
  );
}

function edgeKey(edge: InternalGraphEdge): string {
  return [
    edge.scopeKey,
    edge.source,
    edge.target,
    edge.relation,
    edge.directed ? 'd' : 'u',
    edge.sensitivity,
  ].join('|');
}

function mergeNode(canonical: InternalGraphNode, alias: InternalGraphNode, aliasCount: number): InternalGraphNode {
  return {
    ...canonical,
    sensitivity: canonical.sensitivity === 'restricted' || alias.sensitivity === 'restricted' ? 'restricted' : 'standard',
    firstSeenAt: earlier(canonical.firstSeenAt, alias.firstSeenAt),
    lastSeenAt: later(canonical.lastSeenAt, alias.lastSeenAt),
    attributes: {
      ...alias.attributes,
      ...canonical.attributes,
      canonicalizedAliasCount: aliasCount,
    },
  };
}

function mergeEdge(current: InternalGraphEdge, incoming: InternalGraphEdge): InternalGraphEdge {
  const incomingIsNewer = Date.parse(incoming.lastSeenAt) > Date.parse(current.lastSeenAt);
  return {
    ...current,
    confidence: strongestConfidence(current.confidence, incoming.confidence),
    sensitivity: current.sensitivity === 'restricted' || incoming.sensitivity === 'restricted' ? 'restricted' : 'standard',
    strength: Math.max(current.strength, incoming.strength),
    firstSeenAt: earlier(current.firstSeenAt, incoming.firstSeenAt),
    lastSeenAt: later(current.lastSeenAt, incoming.lastSeenAt),
    evidenceCount: current.evidenceCount + incoming.evidenceCount,
    evidence: incomingIsNewer ? incoming.evidence : current.evidence,
  };
}

/**
 * Apply operator-approved canonical aliases to an already-authorized graph.
 *
 * Person nodes can never be canonicalized here, even if a malformed mapping is
 * somehow supplied. Mappings are one-hop and must preserve node kind. The rewrite
 * is deterministic and non-mutating; all downstream graph math receives the same
 * canonical topology without altering source-of-truth event evidence.
 */
export function applyInternalGraphEntityAliases(
  payload: InternalGraphPayload,
  aliases: InternalGraphEntityAlias[],
): InternalGraphPayload {
  if (aliases.length === 0) return payload;

  const nodeById = new Map(payload.nodes.map((node) => [node.id, node] as const));
  const validAliases = aliases.filter((mapping) => {
    const alias = nodeById.get(mapping.aliasNodeId);
    const canonical = nodeById.get(mapping.canonicalNodeId);
    if (!alias || !canonical) return false;
    if (alias.kind === 'person' || canonical.kind === 'person') return false;
    if (alias.kind !== canonical.kind || alias.kind !== mapping.kind) return false;
    if (mapping.aliasNodeId === mapping.canonicalNodeId) return false;
    return true;
  });
  if (validAliases.length === 0) return payload;

  const canonicalByAlias = new Map(validAliases.map((mapping) => [mapping.aliasNodeId, mapping.canonicalNodeId] as const));
  const aliasCountByCanonical = new Map<string, number>();
  for (const mapping of validAliases) {
    aliasCountByCanonical.set(mapping.canonicalNodeId, (aliasCountByCanonical.get(mapping.canonicalNodeId) ?? 0) + 1);
  }

  const mergedNodes = new Map<string, InternalGraphNode>();
  for (const node of payload.nodes) {
    const canonicalId = canonicalByAlias.get(node.id) ?? node.id;
    const canonicalSource = nodeById.get(canonicalId) ?? node;
    const existing = mergedNodes.get(canonicalId);
    if (!existing) {
      mergedNodes.set(canonicalId, {
        ...canonicalSource,
        attributes: {
          ...canonicalSource.attributes,
          ...(aliasCountByCanonical.has(canonicalId)
            ? { canonicalizedAliasCount: aliasCountByCanonical.get(canonicalId) }
            : {}),
        },
      });
    }
    if (node.id !== canonicalId) {
      const current = mergedNodes.get(canonicalId)!;
      mergedNodes.set(canonicalId, mergeNode(current, node, aliasCountByCanonical.get(canonicalId) ?? 1));
    }
  }

  const mergedEdges = new Map<string, InternalGraphEdge>();
  for (const edge of payload.edges) {
    let source = canonicalByAlias.get(edge.source) ?? edge.source;
    let target = canonicalByAlias.get(edge.target) ?? edge.target;
    if (source === target) continue;
    if (!edge.directed && source > target) [source, target] = [target, source];
    const normalized: InternalGraphEdge = {
      ...edge,
      id: edge.id,
      source,
      target,
    };
    const key = edgeKey(normalized);
    const existing = mergedEdges.get(key);
    if (existing) mergedEdges.set(key, mergeEdge(existing, normalized));
    else mergedEdges.set(key, normalized);
  }

  const nodes = [...mergedNodes.values()].sort((left, right) => left.id.localeCompare(right.id));
  const edges = [...mergedEdges.values()].sort((left, right) => {
    const leftKey = edgeKey(left);
    const rightKey = edgeKey(right);
    return leftKey.localeCompare(rightKey);
  });

  return {
    ...payload,
    graphVersion: `${payload.graphVersion}:canon:${aliasSignature(validAliases)}`,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
  };
}
