import type { InternalGraphEdge, InternalGraphNode, InternalGraphPayload } from './InternalGraphEngine';

const PRIVATE_ATTRIBUTE_KEYS = new Set([
  'subjectUserId',
  'userId',
  'email',
  'last_known_lat',
  'last_known_lng',
  'latitude',
  'longitude',
  'expo_push_token',
]);

export type InternalGraphExportPersonMode = 'pseudonymous' | 'labeled';

export interface InternalGraphSerializationOptions {
  personMode?: InternalGraphExportPersonMode;
  exportSalt?: string;
}

function xmlEscape(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function cypherString(value: unknown): string {
  return `'${String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\n', '\\n')}'`;
}

function sanitizeAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (PRIVATE_ATTRIBUTE_KEYS.has(key)) continue;
    if (/email|latitude|longitude|push.?token/i.test(key)) continue;
    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) sanitized[key] = value;
  }
  return sanitized;
}

function sortedNodes(payload: InternalGraphPayload): InternalGraphNode[] {
  return [...payload.nodes].sort((left, right) => left.id.localeCompare(right.id));
}

function sortedEdges(payload: InternalGraphPayload): InternalGraphEdge[] {
  return [...payload.edges].sort((left, right) => left.id.localeCompare(right.id));
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function exportIdentityMap(
  payload: InternalGraphPayload,
  options: InternalGraphSerializationOptions,
): Map<string, { id: string; label: string }> {
  const mode = options.personMode ?? 'pseudonymous';
  const salt = options.exportSalt ?? 'beacon-deterministic-export';
  const people = sortedNodes(payload).filter((node) => node.kind === 'person');
  const personOrdinal = new Map(people.map((node, index) => [node.id, index + 1] as const));
  return new Map(sortedNodes(payload).map((node) => {
    if (node.kind !== 'person' || mode === 'labeled') return [node.id, { id: node.id, label: node.label }] as const;
    const ordinal = personOrdinal.get(node.id) ?? 0;
    return [node.id, {
      id: `person:export:${fnv1a(`${salt}|${node.id}`)}`,
      label: `Person ${String(ordinal).padStart(3, '0')}`,
    }] as const;
  }));
}

/**
 * Deterministic GraphML serialization for a fixed exportSalt. The export service
 * supplies a fresh salt by default so person identifiers cannot be correlated
 * across separate files. Raw person UUID attributes and contact/location fields
 * are stripped in both labeled and pseudonymous modes.
 */
export function internalGraphToGraphML(
  payload: InternalGraphPayload,
  options: InternalGraphSerializationOptions = {},
): string {
  const nodes = sortedNodes(payload);
  const edges = sortedEdges(payload);
  const identities = exportIdentityMap(payload, options);
  const personMode = options.personMode ?? 'pseudonymous';
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="label" for="node" attr.name="label" attr.type="string"/>',
    '  <key id="kind" for="node" attr.name="kind" attr.type="string"/>',
    '  <key id="sensitivity" for="all" attr.name="sensitivity" attr.type="string"/>',
    '  <key id="firstSeenAt" for="all" attr.name="firstSeenAt" attr.type="string"/>',
    '  <key id="lastSeenAt" for="all" attr.name="lastSeenAt" attr.type="string"/>',
    '  <key id="relation" for="edge" attr.name="relation" attr.type="string"/>',
    '  <key id="confidence" for="edge" attr.name="confidence" attr.type="string"/>',
    '  <key id="strength" for="edge" attr.name="strength" attr.type="double"/>',
    '  <key id="evidenceCount" for="edge" attr.name="evidenceCount" attr.type="int"/>',
    `  <!-- Beacon Constellation graphVersion=${xmlEscape(payload.graphVersion)} personMode=${personMode} -->`,
    `  <graph id="beacon-${xmlEscape(payload.eventId ?? 'global')}" edgedefault="undirected">`,
  ];

  for (const node of nodes) {
    const identity = identities.get(node.id)!;
    lines.push(`    <node id="${xmlEscape(identity.id)}">`);
    lines.push(`      <data key="label">${xmlEscape(identity.label)}</data>`);
    lines.push(`      <data key="kind">${xmlEscape(node.kind)}</data>`);
    lines.push(`      <data key="sensitivity">${xmlEscape(node.sensitivity)}</data>`);
    lines.push(`      <data key="firstSeenAt">${xmlEscape(node.firstSeenAt)}</data>`);
    lines.push(`      <data key="lastSeenAt">${xmlEscape(node.lastSeenAt)}</data>`);
    for (const [key, value] of Object.entries(sanitizeAttributes(node.attributes))) {
      lines.push(`      <data key="attr_${xmlEscape(key)}">${xmlEscape(value)}</data>`);
    }
    lines.push('    </node>');
  }

  for (const edge of edges) {
    const source = identities.get(edge.source)?.id ?? edge.source;
    const target = identities.get(edge.target)?.id ?? edge.target;
    lines.push(`    <edge id="${xmlEscape(edge.id)}" source="${xmlEscape(source)}" target="${xmlEscape(target)}"${edge.directed ? ' directed="true"' : ''}>`);
    lines.push(`      <data key="relation">${xmlEscape(edge.relation)}</data>`);
    lines.push(`      <data key="confidence">${xmlEscape(edge.confidence)}</data>`);
    lines.push(`      <data key="sensitivity">${xmlEscape(edge.sensitivity)}</data>`);
    lines.push(`      <data key="strength">${edge.strength}</data>`);
    lines.push(`      <data key="evidenceCount">${edge.evidenceCount}</data>`);
    lines.push(`      <data key="firstSeenAt">${xmlEscape(edge.firstSeenAt)}</data>`);
    lines.push(`      <data key="lastSeenAt">${xmlEscape(edge.lastSeenAt)}</data>`);
    lines.push('    </edge>');
  }

  lines.push('  </graph>', '</graphml>');
  return lines.join('\n');
}

function safeNeo4jLabel(kind: string): string {
  const normalized = kind.replace(/[^A-Za-z0-9_]/g, '_');
  return normalized.length > 0 ? `Beacon_${normalized}` : 'Beacon_Node';
}

function safeRelation(relation: string): string {
  const normalized = relation.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  return normalized.length > 0 ? `BEACON_${normalized}` : 'BEACON_RELATED';
}

/**
 * Cypher export for Neo4j. In pseudonymous mode person graph aliases and labels
 * are re-keyed for this export salt; non-person evidence identifiers stay stable
 * so graph context remains inspectable. Statements are idempotent within a file.
 */
export function internalGraphToNeo4jCypher(
  payload: InternalGraphPayload,
  options: InternalGraphSerializationOptions = {},
): string {
  const identities = exportIdentityMap(payload, options);
  const personMode = options.personMode ?? 'pseudonymous';
  const lines = [
    '// Beacon Constellation export',
    `// generatedAt=${payload.generatedAt} graphVersion=${payload.graphVersion} personMode=${personMode}`,
    'CREATE CONSTRAINT beacon_node_id IF NOT EXISTS FOR (n:BeaconNode) REQUIRE n.id IS UNIQUE;',
    '',
  ];

  for (const node of sortedNodes(payload)) {
    const identity = identities.get(node.id)!;
    const attrs = sanitizeAttributes(node.attributes);
    const assignments = [
      `n.label = ${cypherString(identity.label)}`,
      `n.kind = ${cypherString(node.kind)}`,
      `n.sensitivity = ${cypherString(node.sensitivity)}`,
      `n.firstSeenAt = ${cypherString(node.firstSeenAt)}`,
      `n.lastSeenAt = ${cypherString(node.lastSeenAt)}`,
      ...Object.entries(attrs).map(([key, value]) => `n.attr_${key.replace(/[^A-Za-z0-9_]/g, '_')} = ${cypherString(value)}`),
    ];
    lines.push(`MERGE (n:BeaconNode:${safeNeo4jLabel(node.kind)} {id: ${cypherString(identity.id)}}) SET ${assignments.join(', ')};`);
  }

  lines.push('');
  for (const edge of sortedEdges(payload)) {
    const relation = safeRelation(edge.relation);
    const source = identities.get(edge.source)?.id ?? edge.source;
    const target = identities.get(edge.target)?.id ?? edge.target;
    lines.push(
      `MATCH (a:BeaconNode {id: ${cypherString(source)}}), (b:BeaconNode {id: ${cypherString(target)}}) ` +
      `MERGE (a)-[r:${relation} {edgeId: ${cypherString(edge.id)}}]->(b) ` +
      `SET r.confidence = ${cypherString(edge.confidence)}, r.sensitivity = ${cypherString(edge.sensitivity)}, ` +
      `r.strength = ${edge.strength}, r.evidenceCount = ${edge.evidenceCount}, ` +
      `r.firstSeenAt = ${cypherString(edge.firstSeenAt)}, r.lastSeenAt = ${cypherString(edge.lastSeenAt)};`,
    );
  }

  return lines.join('\n');
}
