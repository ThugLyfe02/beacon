import { supabase } from '../lib/supabase';
import type { InternalGraphCapability, InternalOperatorContext } from './internalGraph.service';

export interface InternalOperatorSecurityEnvelope extends InternalOperatorContext {
  read: boolean;
  manage: boolean;
  restricted: boolean;
  export: boolean;
  grantedAt: string | null;
  leastPrivilegeRule: string;
}

const CAPABILITIES: InternalGraphCapability[] = [
  'graph_read',
  'graph_manage',
  'graph_restricted',
  'graph_export',
];

export async function getInternalOperatorSecurityEnvelope(): Promise<InternalOperatorSecurityEnvelope> {
  const { data, error } = await supabase.rpc('get_internal_operator_security_envelope');
  if (error || !data || typeof data !== 'object') {
    return {
      allowed: false,
      capabilities: [],
      expiresAt: null,
      read: false,
      manage: false,
      restricted: false,
      export: false,
      grantedAt: null,
      leastPrivilegeRule: 'Server capability envelope unavailable; internal operator access fails closed.',
    };
  }
  const row = data as Record<string, unknown>;
  const capabilities = Array.isArray(row.capabilities)
    ? row.capabilities.filter((item): item is InternalGraphCapability =>
        typeof item === 'string' && CAPABILITIES.includes(item as InternalGraphCapability))
    : [];
  return {
    allowed: row.allowed === true,
    capabilities,
    expiresAt: typeof row.expiresAt === 'string' ? row.expiresAt : null,
    read: row.read === true,
    manage: row.manage === true,
    restricted: row.restricted === true,
    export: row.export === true,
    grantedAt: typeof row.grantedAt === 'string' ? row.grantedAt : null,
    leastPrivilegeRule: typeof row.leastPrivilegeRule === 'string'
      ? row.leastPrivilegeRule
      : 'graph_read may be implied by a specialized grant; manage, restricted, and export never imply one another',
  };
}
