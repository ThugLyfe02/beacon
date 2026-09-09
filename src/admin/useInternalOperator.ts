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

  const capabilities = useMemo(() => new Set(context.capabilities), [context.capabilities]);
  const has = useCallback(
    (capability: InternalGraphCapability) => capabilities.has('graph_manage') || capabilities.has(capability),
    [capabilities],
  );

  return {
    ...context,
    loading,
    refresh,
    has,
  };
}
