import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing export-boundary file: ${path}`);
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
  'supabase/migrations/049_internal_graph_temporal_strategy_and_exports.sql',
  'supabase/migrations/066_internal_graph_export_receipts.sql',
  'src/admin/InternalGraphExportEngine.ts',
  'src/admin/InternalGraphExportService.ts',
  'src/admin/internalGraphExportAudit.service.ts',
];
files.forEach(read);

for (const [text, why] of [
  ["has_internal_operator_capability('graph_export')", 'bulk graph export must require the independent graph_export privilege'],
  ["p_include_restricted and not public.has_internal_operator_capability('graph_restricted')", 'restricted export must require graph_restricted in addition to export'],
]) requireText('supabase/migrations/049_internal_graph_temporal_strategy_and_exports.sql', text, why);

for (const [text, why] of [
  ['record_internal_graph_export_receipt', 'portable exports need a server receipt boundary'],
  ["has_internal_operator_capability('graph_export')", 'receipt sealing must re-check graph_export'],
  ["has_internal_operator_capability('graph_restricted')", 'restricted receipts must re-check graph_restricted'],
  ['internal_graph_canonical_summary', 'receipt sealing must re-derive current canonical graph state'],
  ['Graph changed before export could be sealed', 'stale export versions must fail closed'],
  ["'contentRetained', false", 'export receipts must explicitly avoid storing serialized graph content'],
]) requireText('supabase/migrations/066_internal_graph_export_receipts.sql', text, why);

for (const [text, why] of [
  ["InternalGraphExportPersonMode = 'pseudonymous' | 'labeled'", 'export privacy profile must remain explicit'],
  ["id: `person:export:${fnv1a", 'pseudonymous exports must re-key person graph aliases'],
  ['label: `Person ${String(ordinal)', 'pseudonymous exports must remove person names'],
  ["options.personMode ?? 'pseudonymous'", 'portable serialization must default to pseudonymous people'],
  ['PRIVATE_ATTRIBUTE_KEYS', 'direct private attributes must remain stripped'],
]) requireText('src/admin/InternalGraphExportEngine.ts', text, why);

for (const [text, why] of [
  ["const personMode = input.personMode ?? 'pseudonymous'", 'export service must default to pseudonymous mode'],
  ['freshExportSalt()', 'each portable pseudonymous export must use a fresh salt'],
  ['recordInternalGraphExportReceipt', 'share must be preceded by a sealed server receipt'],
  ['FileSystem.deleteAsync(uri, { idempotent: true })', 'unsealed cached exports must be deleted on receipt failure'],
  ['await Share.share', 'native sharing remains the final step after receipt sealing'],
]) requireText('src/admin/InternalGraphExportService.ts', text, why);

const service = read('src/admin/InternalGraphExportService.ts');
if (service.indexOf('recordInternalGraphExportReceipt') > service.indexOf('await Share.share')) {
  failures.push('src/admin/InternalGraphExportService.ts: export receipt must be sealed before the share sheet opens');
}
forbidText('src/admin/internalGraphExportAudit.service.ts', '.from(', 'export audit client must use RPC rather than direct private-table access');
requireText('src/admin/internalGraphExportAudit.service.ts', "rpc('record_internal_graph_export_receipt'", 'export receipt client must use the controlled RPC');

if (failures.length > 0) {
  console.error('\nConstellation export privacy validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation least-privilege, pseudonymous portable export, and provenance receipt boundary passed.');
