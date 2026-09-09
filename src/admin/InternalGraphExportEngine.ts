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
    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function sortedNodes(payload: InternalGraphPayload): InternalGraphNode[] {
  return [...payload.nodes].sort((left, right) => left.id.localeCompare(right.id));
}

function sortedEdges(payload: InternalGraphPayload): InternalGraphEdge[] {
  return [...payload.edges].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Deterministic GraphML export for Gephi, yEd and other graph workbenches.
 * Person UUID attributes and raw location/contact fields are stripped even though
 * the server export payload is already capability gated.
 */
export function internalGraphToGraphML(payload: InternalGraphPayload): string {
  const nodes = sortedNodes(payload);
  const edges = sortedEdges(payload);
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
    `  <graph id="beacon-${xmlEscape(payload.eventId ?? 'global')}" edgedefault="undirected">`,
  ];

  for (const node of nodes) {
    lines.push(`    <node id="${xmlEscape(node.id)}">`);
    lines.push(`      <data key="label">${xmlEscape(node.label)}</data>`);
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
    lines.push(
      `    <edge id="${xmlEscape(edge.id)}" source="${xmlEscape(edge.source)}" target="${xmlEscape(edge.target)}"${edge.directed ? ' directed="true"' : ''}>`,
    );
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
 * Cypher export for Neo4j. IDs remain Constellation graph aliases/keys, never raw
 * user UUID attributes. Statements are deterministic and idempotent via MERGE.
 */
export function internalGraphToNeo4jCypher(payload: InternalGraphPayload): string {
  const lines = [
    '// Beacon Constellation export',
    `// generatedAt=${payload.generatedAt} graphVersion=${payload.graphVersion}`,
    'CREATE CONSTRAINT beacon_node_id IF NOT EXISTS FOR (n:BeaconNode) REQUIRE n.id IS UNIQUE;',
    '',
  ];

  for (const node of sortedNodes(payload)) {
    const attrs = sanitizeAttributes(node.attributes);
    const assignments = [
      `n.label = ${cypherString(node.label)}`,
      `n.kind = ${cypherString(node.kind)}`,
      `n.sensitivity = ${cypherString(node.sensitivity)}`,
      `n.firstSeenAt = ${cypherString(node.firstSeenAt)}`,
      `n.lastSeenAt = ${cypherString(node.lastSeenAt)}`,
      ...Object.entries(attrs).map(([key, value]) => `n.attr_${key.replace(/[^A-Za-z0-9_]/g, '_')} = ${cypherString(value)}`),
    ];
    lines.push(`MERGE (n:BeaconNode:${safeNeo4jLabel(node.kind)} {id: ${cypherString(node.id)}}) SET ${assignments.join(', ')};`);
  }

  lines.push('');
  for (const edge of sortedEdges(payload)) {
    const relation = safeRelation(edge.relation);
    lines.push(
      `MATCH (a:BeaconNode {id: ${cypherString(edge.source)}}), (b:BeaconNode {id: ${cypherString(edge.target)}}) ` +
      `MERGE (a)-[r:${relation} {edgeId: ${cypherString(edge.id)}}]->(b) ` +
      `SET r.confidence = ${cypherString(edge.confidence)}, r.sensitivity = ${cypherString(edge.sensitivity)}, ` +
      `r.strength = ${edge.strength}, r.evidenceCount = ${edge.evidenceCount}, ` +
      `r.firstSeenAt = ${cypherString(edge.firstSeenAt)}, r.lastSeenAt = ${cypherString(edge.lastSeenAt)};`,
    );
  }

  return lines.join('\n');
}
