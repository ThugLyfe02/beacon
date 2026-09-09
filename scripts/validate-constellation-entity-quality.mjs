import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing entity-quality file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
};
const requireText = (path, text, why) => {
  if (!read(path).includes(text)) failures.push(`${path}: ${why}`);
};
const forbidText = (path, text, why) => {
  if (read(path).includes(text)) failures.push(`${path}: ${why}`);
};

const files = [
  'src/admin/InternalGraphEntityResolutionEngine.ts',
  'src/admin/InternalGraphCanonicalizationEngine.ts',
  'src/admin/internalGraphEntityResolution.service.ts',
  'src/admin/internalGraph.service.ts',
  'src/screens/InternalEntityResolutionLabScreen.tsx',
  'src/screens/InternalOperatorHubScreen.tsx',
  'src/navigation/RootNavigator.tsx',
  'supabase/migrations/059_internal_graph_entity_resolution.sql',
  'supabase/migrations/060_internal_graph_canonical_version.sql',
  'supabase/migrations/061_internal_graph_canonical_persistence.sql',
];
files.forEach(read);

for (const [text, why] of [
  ["node.kind !== 'person'", 'person nodes must remain categorically excluded from resolution candidates'],
  ['RESOLVABLE_KINDS', 'entity resolution must retain an explicit non-person kind allowlist'],
  ['labelSimilarity', 'resolution candidates need explainable label evidence'],
  ['neighborhoodSimilarity', 'resolution candidates need graph-neighborhood evidence'],
  ['domainEquivalent', 'domain equivalence must remain an explicit evidence signal'],
  ['operator approval required; no person identity resolution is permitted', 'candidate semantics must keep the identity firewall explicit'],
]) requireText('src/admin/InternalGraphEntityResolutionEngine.ts', text, why);
forbidText('src/admin/InternalGraphEntityResolutionEngine.ts', 'supabase', 'entity suggestion math must remain pure and non-mutating');
forbidText('src/admin/InternalGraphEntityResolutionEngine.ts', 'fetch(', 'entity resolution must not become external enrichment');

for (const [text, why] of [
  ['applyInternalGraphEntityAliases', 'approved aliases must flow through one deterministic canonical rewrite'],
  ["alias.kind === 'person' || canonical.kind === 'person'", 'canonicalization engine must fail closed for person nodes'],
  ['alias.kind !== canonical.kind', 'canonicalization must preserve entity kind'],
  ['if (source === target) continue', 'alias collapse must remove self-loops'],
  ['evidenceCount: current.evidenceCount + incoming.evidenceCount', 'edge evidence counts must survive coalescing'],
  ['strength: Math.max(current.strength, incoming.strength)', 'canonicalization must not inflate edge strength by summing duplicates'],
  [':canon:', 'canonical topology must be versioned'],
]) requireText('src/admin/InternalGraphCanonicalizationEngine.ts', text, why);
forbidText('src/admin/InternalGraphCanonicalizationEngine.ts', 'supabase', 'canonicalization engine must remain pure in-memory analysis');

for (const [text, why] of [
  ["rpc('get_internal_graph_entity_aliases'", 'client alias map must use the controlled read RPC'],
  ["rpc('approve_internal_graph_entity_alias'", 'alias approval must use the controlled management RPC'],
  ["rpc('revoke_internal_graph_entity_alias'", 'alias revocation must use the controlled management RPC'],
  ['loadRawInternalGraphForEntityResolution', 'raw graph access must remain isolated to the quality workbench boundary'],
]) requireText('src/admin/internalGraphEntityResolution.service.ts', text, why);

for (const [text, why] of [
  ['loadInternalGraphEntityAliasState', 'normal graph loads must consume the approved canonicalization map'],
  ['applyInternalGraphEntityAliases(raw, aliasState.aliases, aliasState.canonicalizationVersion)', 'normal graph loads must canonicalize with the server-issued version'],
  ["rpc('get_internal_graph_export_payload'", 'export source must remain capability-gated'],
]) requireText('src/admin/internalGraph.service.ts', text, why);

for (const [text, why] of [
  ['internal_graph_entity_aliases', 'canonical alias table must remain available'],
  ['Person identity resolution is prohibited', 'database must reject person canonicalization explicitly'],
  ['Entity canonicalization requires matching node kinds', 'database must prevent cross-kind merges'],
  ['Canonical target is itself an alias; flatten the mapping first', 'alias chains must remain prohibited'],
  ['Chained canonicalization is prohibited', 'canonical alias graph must remain one-hop'],
  ['get_internal_intelligence_graph(p_event_id, false, 2000)', 'approval must revalidate nodes against the authorized graph'],
  ['revoke all on table public.internal_graph_entity_aliases from anon, authenticated', 'alias table must not have direct client access'],
  ['prune_internal_graph_entity_aliases', 'canonicalization memory must have bounded service-only pruning'],
]) requireText('supabase/migrations/059_internal_graph_entity_resolution.sql', text, why);

for (const [text, why] of [
  ['internal_graph_entity_alias_version', 'approved alias state must have a server-issued SHA-256 version'],
  ['canonicalizationVersion', 'alias read surface must expose the canonicalization version'],
]) requireText('supabase/migrations/060_internal_graph_canonical_version.sql', text, why);

for (const [text, why] of [
  ['internal_graph_canonical_summary', 'server must derive canonical topology metadata'],
  ["edge->>'scopeKey'", 'canonical edge digest must preserve graph edge scope'],
  ['mapped_source <> mapped_target', 'server canonical summary must remove alias-created self-loops'],
  ['topologyDigest', 'canonical topology must have a durable digest'],
  ['rekey_internal_casebook_pins_for_entity_alias', 'Casebook pins must follow approved canonical entities'],
  ['server-validated-canonical-event-graph', 'Epoch memory must identify canonical graph capture'],
  ['canonicalization_version', 'Epoch rows must persist canonicalization version'],
  ["v_summary := public.internal_graph_canonical_summary(p_event_id)", 'Machine and Epoch boundaries must share the same canonical summary'],
]) requireText('supabase/migrations/061_internal_graph_canonical_persistence.sql', text, why);

for (const [text, why] of [
  ['IDENTITY FIREWALL', 'Entity Resolution Lab must make the no-person boundary visible'],
  ['Person identity resolution is prohibited', 'operator UI must never imply person merging'],
  ['Approve canonical alias', 'canonicalization must remain explicit operator action'],
  ['CANONICAL GRAPH VERSION', 'operator must be able to inspect canonical topology version'],
  ['APPROVED CANONICALIZATION', 'approved mappings must remain inspectable/revocable'],
]) requireText('src/screens/InternalEntityResolutionLabScreen.tsx', text, why);

requireText('src/screens/InternalOperatorHubScreen.tsx', "route: 'InternalEntityResolutionLab'", 'Entity Resolution Lab must remain reachable from sealed Ops');
requireText('src/screens/InternalOperatorHubScreen.tsx', "capability: 'graph_manage'", 'entity canonicalization must remain graph-manage gated');
requireText('src/navigation/RootNavigator.tsx', 'name="InternalEntityResolutionLab"', 'Entity Resolution Lab route must remain registered');

if (failures.length) {
  console.error('\nConstellation entity-quality validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation non-person entity resolution, canonical graph, Epoch/Casebook persistence boundary passed.');
