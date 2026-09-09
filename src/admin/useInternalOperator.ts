import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getInternalOperatorContext,
  type InternalGraphCapability,
  type InternalOperatorContext,
} from './internalGraph.service';

const EMPTY: InternalOperatorContext = {
  allowed: false,
  capabilities: [],
  expiresAt: null,
};

/**
 * Client mirror of migration 049's server capability lattice.
 *
 * `graph_manage` is intentionally NOT a super-capability for restricted topology
 * or bulk export. Any UI surface that exposes those actions must see the exact
 * independent capability the server will require. `graph_read` is the only
 * implied baseline because every specialized graph capability necessarily needs
 * to read the ordinary graph to be useful.
 */
function hasCapability(
  capabilities: ReadonlySet<InternalGraphCapability>,
  capability: InternalGraphCapability,
): boolean {
  if (capability === 'graph_read') {
    return capabilities.has('graph_read')
      || capabilities.has('graph_manage')
      || capabilities.has('graph_restricted')
      || capabilities.has('graph_export');
  }
  return capabilities.has(capability);
}

export function useInternalOperator() {
  const [context, setContext] = useState<InternalOperatorContext>(EMPTY);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setContext(await getInternalOperatorContext());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const capabilities = useMemo(
    () => new Set<InternalGraphCapability>(context.capabilities),
    [context.capabilities],
  );
  const has = useCallback(
    (capability: InternalGraphCapability) => hasCapability(capabilities, capability),
    [capabilities],
  );

  return {
    ...context,
    loading,
    refresh,
    has,
  };
}
