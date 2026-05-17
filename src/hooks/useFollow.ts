import { useCallback, useEffect, useState } from 'react';
import {
  followUser,
  getFollowCounts,
  isFollowing,
  unfollowUser,
  type FollowCounts,
} from '../services/follow.service';
import type { UUID } from '../types/database';

interface State {
  following: boolean;
  counts: FollowCounts;
  loading: boolean;
}

const EMPTY: State = {
  following: false,
  counts: { followers: 0, following: 0 },
  loading: true,
};

export function useFollow(viewerId: UUID | null | undefined, targetId: UUID | null | undefined) {
  const [state, setState] = useState<State>(EMPTY);

  const refresh = useCallback(async () => {
    if (!targetId) {
      setState({ ...EMPTY, loading: false });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    const [counts, follows] = await Promise.all([
      getFollowCounts(targetId),
      viewerId && viewerId !== targetId ? isFollowing(viewerId, targetId) : Promise.resolve(false),
    ]);
    setState({ following: follows, counts, loading: false });
  }, [viewerId, targetId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggle = useCallback(async () => {
    if (!viewerId || !targetId || viewerId === targetId) return;
    const prev = state.following;
    setState((s) => ({
      ...s,
      following: !prev,
      counts: { ...s.counts, followers: s.counts.followers + (prev ? -1 : 1) },
    }));
    try {
      if (prev) await unfollowUser(viewerId, targetId);
      else await followUser(viewerId, targetId);
    } catch (e) {
      setState((s) => ({
        ...s,
        following: prev,
        counts: { ...s.counts, followers: s.counts.followers + (prev ? 1 : -1) },
      }));
      throw e;
    }
  }, [viewerId, targetId, state.following]);

  return { ...state, refresh, toggle, isSelf: !!viewerId && viewerId === targetId };
}
