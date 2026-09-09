import { supabase } from '../lib/supabase';
import type { InternalGraphCapability, InternalOperatorContext } from './internalGraph.service';

export interface InternalOperatorCapabilityLease {
  id: string;
  capability: 'graph_restricted' | 'graph_export';
  reason: string;
  grantedAt: string;
  expiresAt: string;
}

export interface InternalOperatorSecurityEnvelope extends InternalOperatorContext {
  read: boolean;
  manage: boolean;
  restricted: boolean;
  export: boolean;
  grantedAt: string | null;
  leastPrivilegeRule: string;
  standingCapabilities: InternalGraphCapability[];
  leasedCapabilities: Array<'graph_restricted' | 'graph_export'>;
  activeLeases: InternalOperatorCapabilityLease[];
}

const CAPABILITIES: InternalGraphCapability[] = [
  'graph_read',
  'graph_manage',
  'graph_restricted',
  'graph_export',
];

function parseCapabilities(value: unknown): InternalGraphCapability[] {
  return Array.isArray(value)
    ? value.filter((item): item is InternalGraphCapability =>
        typeof item === 'string' && CAPABILITIES.includes(item as InternalGraphCapability))
    : [];
}

function parseLease(value: unknown): InternalOperatorCapabilityLease | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== 'string'
    || (row.capability !== 'graph_restricted' && row.capability !== 'graph_export')
    || typeof row.reason !== 'string'
    || typeof row.grantedAt !== 'string'
    || typeof row.expiresAt !== 'string'
  ) return null;
  return {
    id: row.id,
    capability: row.capability,
    reason: row.reason,
    grantedAt: row.grantedAt,
    expiresAt: row.expiresAt,
  };
}

const CLOSED: InternalOperatorSecurityEnvelope = {
  allowed: false,
  capabilities: [],
  expiresAt: null,
  read: false,
  manage: false,
  restricted: false,
  export: false,
  grantedAt: null,
  leastPrivilegeRule: 'Server capability envelope unavailable; internal operator access fails closed.',
  standingCapabilities: [],
  leasedCapabilities: [],
  activeLeases: [],
};

export async function getInternalOperatorSecurityEnvelope(): Promise<InternalOperatorSecurityEnvelope> {
  const { data, error } = await supabase.rpc('get_internal_operator_security_envelope');
  if (error || !data || typeof data !== 'object') return CLOSED;

  const row = data as Record<string, unknown>;
  const capabilities = parseCapabilities(row.capabilities);
  const standingCapabilities = parseCapabilities(row.standingCapabilities);
  const leasedCapabilities = parseCapabilities(row.leasedCapabilities)
    .filter((capability): capability is 'graph_restricted' | 'graph_export' =>
      capability === 'graph_restricted' || capability === 'graph_export');
  const activeLeases = Array.isArray(row.activeLeases)
    ? row.activeLeases.flatMap((lease) => {
        const parsed = parseLease(lease);
        return parsed ? [parsed] : [];
      })
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
      : 'graph_manage is standing-only; restricted/export remain independent and may be time-bounded',
    standingCapabilities,
    leasedCapabilities,
    activeLeases,
  };
}

export async function revokeMyInternalOperatorCapabilityLease(leaseId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_my_internal_operator_capability_lease', {
    p_lease_id: leaseId,
  });
  if (error) throw new Error(error.message ?? 'Unable to revoke temporary operator capability.');
}
