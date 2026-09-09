import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing adaptive-command file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
};
const requireText = (path, text, why) => { if (!read(path).includes(text)) failures.push(`${path}: ${why}`); };
const forbidText = (path, text, why) => { if (read(path).includes(text)) failures.push(`${path}: ${why}`); };

const files = [
  'src/admin/InternalAdaptiveAgentOrchestrator.ts',
  'src/screens/InternalAdaptiveCommandScreen.tsx',
  'supabase/migrations/067_internal_operator_capability_leases.sql',
  'src/admin/internalOperatorSecurity.service.ts',
  'src/admin/useInternalOperator.ts',
  'src/screens/InternalPrivateAccessScreen.tsx',
  'src/screens/InternalOperatorHubScreen.tsx',
  'src/navigation/RootNavigator.tsx',
  'src/components/NetworkPulseCard.tsx',
];
files.forEach(read);

for (const [text, why] of [
  ['runAdaptiveInternalGraphAgentOrchestrator', 'adaptive orchestration entrypoint must remain available'],
  ['runInternalGraphAgentOrchestrator', 'adaptive layer must compose rather than replace stable strategy analysis'],
  ['analyzeInternalGraphEpistemicHealth', 'agent authority must use graph evidence health'],
  ['buildInternalTargetRoutingPortfolio', 'Pathfinder must use diversified target routing'],
  ["filter((mission) => mission.agent !== 'Pathfinder')", 'legacy single-path Pathfinder mission must be removed before adaptive replacement'],
  ['epistemic confidence multiplier', 'non-safety missions must disclose evidence-health authority scaling'],
  ['mission.agent === \'Sentinel\'', 'Sentinel safety missions must not be down-weighted'],
  ['Graph evidence is degraded', 'degraded graph state must raise a remediation mission'],
  ['Graph evidence is fragile', 'fragile graph state must raise a remediation mission'],
  ['Weak evidence reduces analytical authority; it never reduces a human score', 'adaptive authority must remain graph-scoped rather than person-scoped'],
  ['Authoritative block suppressions remain binding', 'adaptive routing must preserve block safety'],
]) requireText('src/admin/InternalAdaptiveAgentOrchestrator.ts', text, why);
forbidText('src/admin/InternalAdaptiveAgentOrchestrator.ts', 'supabase', 'adaptive orchestrator must remain pure in-memory analysis');
forbidText('src/admin/InternalAdaptiveAgentOrchestrator.ts', 'fetch(', 'adaptive orchestrator must not perform external enrichment');

for (const [text, why] of [
  ['ADAPTIVE NETWORK COMMAND', 'operator command surface must be explicit'],
  ['WATCHTOWER TRIAGE', 'Watchtower signals must be visible in command context'],
  ['TARGET ROUTING OBJECTIVE', 'diversified routing must be visible in command context'],
  ['ADAPTIVE MISSION QUEUE', 'health-calibrated missions must be visible'],
  ["operator.has('graph_manage')", 'adaptive command must remain graph-manage gated'],
  ['HUMAN APPROVAL REQUIRED', 'adaptive command must preserve human action authority'],
]) requireText('src/screens/InternalAdaptiveCommandScreen.tsx', text, why);

for (const [text, why] of [
  ['internal_operator_capability_leases', 'JIT lease table must exist'],
  ["capability in ('graph_restricted', 'graph_export')", 'only restricted/export may be leased'],
  ["expires_at <= granted_at + interval '2 hours'", 'lease table must hard-cap duration'],
  ["v_ttl < 5 or v_ttl > 120", 'grant RPC must enforce 5-120 minute TTL'],
  ["auth.role() <> 'service_role'", 'lease issuance and pruning must remain service-role-only'],
  ["'graph_manage' = any(access.capabilities)", 'lease target must already hold standing graph_manage'],
  ['revoke_my_internal_operator_capability_lease', 'operator must be able to end their own lease early'],
  ['lease.user_id = auth.uid()', 'self-revocation must be owner-scoped'],
  ['graph_manage is standing-only', 'management must not become lease-derived'],
  ['grant execute on function public.grant_internal_operator_capability_lease', 'grant RPC execute policy must remain explicit'],
  ['to service_role', 'lease grant must be service-role-only'],
]) requireText('supabase/migrations/067_internal_operator_capability_leases.sql', text, why);
forbidText('supabase/migrations/067_internal_operator_capability_leases.sql', 'grant execute on function public.grant_internal_operator_capability_lease(uuid, text, text, integer) to authenticated', 'mobile/authenticated clients must never self-grant a capability lease');

for (const [text, why] of [
  ['standingCapabilities', 'security envelope must distinguish standing privileges'],
  ['leasedCapabilities', 'security envelope must distinguish temporary privileges'],
  ['activeLeases', 'security envelope must surface only caller-active lease state'],
  ["rpc('revoke_my_internal_operator_capability_lease'", 'client may revoke only its own active lease'],
]) requireText('src/admin/internalOperatorSecurity.service.ts', text, why);
forbidText('src/admin/internalOperatorSecurity.service.ts', 'grant_internal_operator_capability_lease', 'client security service must contain no JIT grant RPC');

for (const [text, why] of [
  ['PRIVATE ACCESS CONTROL', 'private-access workbench must be explicit'],
  ['NO SELF-ELEVATION PATH', 'UI must explain no self-grant path'],
  ['Revoke now', 'operator must be able to terminate an active lease early'],
  ["operator.has('graph_manage')", 'private-access workbench must require standing management'],
]) requireText('src/screens/InternalPrivateAccessScreen.tsx', text, why);

for (const route of ['InternalAdaptiveCommand', 'InternalPrivateAccess']) {
  requireText('src/screens/InternalOperatorHubScreen.tsx', `route: '${route}'`, `${route} must remain exposed only from sealed Ops`);
  requireText('src/navigation/RootNavigator.tsx', `name="${route}"`, `${route} must remain registered`);
}

forbidText('src/components/NetworkPulseCard.tsx', 'InternalAdaptiveCommand', 'normal-user Network Pulse must not expose adaptive command');
forbidText('src/components/NetworkPulseCard.tsx', 'InternalPrivateAccess', 'normal-user Network Pulse must not expose private operator access');
forbidText('src/components/NetworkPulseCard.tsx', 'activeLeases', 'normal-user preview must not expose operator lease state');

if (failures.length) {
  console.error('\nConstellation adaptive command / JIT access validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation adaptive command, evidence authority, JIT lease, and private-access boundary passed.');
