import { useCallback, useEffect, useState } from 'react';
import {
  getPremiumStatus,
  setDiscoverable as setDiscoverableSvc,
  setPremiumDev,
} from '../services/premium.service';

interface State {
  isPremium: boolean;
  isDiscoverable: boolean;
  premiumSince: string | null;
  loading: boolean;
}

const EMPTY: State = {
  isPremium: false,
  isDiscoverable: false,
  premiumSince: null,
  loading: true,
};

export function usePremium(userId: string | null | undefined) {
  const [state, setState] = useState<State>(EMPTY);

  const refresh = useCallback(async () => {
    if (!userId) {
      setState({ ...EMPTY, loading: false });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    const status = await getPremiumStatus(userId);
    setState({
      isPremium: status?.isPremium ?? false,
      isDiscoverable: status?.isDiscoverable ?? false,
      premiumSince: status?.premiumSince ?? null,
      loading: false,
    });
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const togglePremiumDev = useCallback(async () => {
    if (!userId) return;
    const next = !state.isPremium;
    setState((s) => ({ ...s, isPremium: next }));
    try {
      await setPremiumDev(next);
      await refresh();
    } catch (e) {
      setState((s) => ({ ...s, isPremium: !next }));
      throw e;
    }
  }, [state.isPremium, userId, refresh]);

  const setDiscoverable = useCallback(
    async (next: boolean) => {
      if (!userId) return;
      const prev = state.isDiscoverable;
      setState((s) => ({ ...s, isDiscoverable: next }));
      try {
        await setDiscoverableSvc(userId, next);
      } catch (e) {
        setState((s) => ({ ...s, isDiscoverable: prev }));
        throw e;
      }
    },
    [state.isDiscoverable, userId]
  );

  return {
    ...state,
    refresh,
    togglePremiumDev,
    setDiscoverable,
  };
}
