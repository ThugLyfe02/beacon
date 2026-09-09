import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InternalGraphCapability } from './internalGraph.service';
import {
  getInternalOperatorSecurityEnvelope,
  type InternalOperatorSecurityEnvelope,
} from './internalOperatorSecurity.service';

const EMPTY: InternalOperatorSecurityEnvelope = {
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

/**
 * Server-backed Constellation operator capability state.
 *
 * The hook does not infer specialized privileges from `graph_manage`. The database
 * computes the exact security envelope and this client mirror only provides a
 * convenient `has()` API for rendering. `graph_read` is the sole implied baseline.
 */
function hasCapability(
  envelope: InternalOperatorSecurityEnvelope,
  capability: InternalGraphCapability,
): boolean {
  if (capability === 'graph_read') return envelope.read;
  if (capability === 'graph_manage') return envelope.manage;
  if (capability === 'graph_restricted') return envelope.restricted;
  return envelope.export;
}

export function useInternalOperator() {
  const [context, setContext] = useState<InternalOperatorSecurityEnvelope>(EMPTY);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setContext(await getInternalOperatorSecurityEnvelope());
    } catch {
      setContext(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const capabilities = useMemo(
    () => new Set<InternalGraphCapability>(context.capabilities),
    [context.capabilities],
  );
  const has = useCallback(
    (capability: InternalGraphCapability) => hasCapability(context, capability),
    [context],
  );

  return {
    ...context,
    capabilities: [...capabilities],
    loading,
    refresh,
    has,
  };
}
