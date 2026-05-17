import { useCallback, useEffect, useState } from 'react';
import {
  getEventFeed,
  getHomeFeed,
  getUserPosts,
  togglePostLike,
} from '../services/post.service';
import type { FeedPost, UUID } from '../types/database';

export type FeedScope =
  | { kind: 'home' }
  | { kind: 'event'; eventId: UUID }
  | { kind: 'user'; userId: UUID };

interface State {
  posts: FeedPost[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
}

const INITIAL: State = { posts: [], loading: true, refreshing: false, error: null };

async function fetchScope(scope: FeedScope): Promise<FeedPost[]> {
  if (scope.kind === 'home') return getHomeFeed();
  if (scope.kind === 'event') return getEventFeed(scope.eventId);
  return getUserPosts(scope.userId);
}

export function useFeed(scope: FeedScope) {
  const [state, setState] = useState<State>(INITIAL);
  const scopeKey =
    scope.kind === 'home'
      ? 'home'
      : scope.kind === 'event'
        ? `event:${scope.eventId}`
        : `user:${scope.userId}`;

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      setState((s) => ({ ...s, loading: mode === 'initial', refreshing: mode === 'refresh' }));
      try {
        const posts = await fetchScope(scope);
        setState({ posts, loading: false, refreshing: false, error: null });
      } catch (e) {
        const err = e instanceof Error ? e.message : 'Failed to load feed';
        setState((s) => ({ ...s, loading: false, refreshing: false, error: err }));
      }
    },
    // we intentionally depend on the serialized scope so identity changes don't reload
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopeKey]
  );

  useEffect(() => {
    load('initial');
  }, [load]);

  const refresh = useCallback(() => load('refresh'), [load]);

  const toggleLike = useCallback(async (postId: UUID) => {
    // Optimistic
    setState((s) => ({
      ...s,
      posts: s.posts.map((p) =>
        p.id === postId
          ? {
              ...p,
              viewer_liked: !p.viewer_liked,
              like_count: p.like_count + (p.viewer_liked ? -1 : 1),
            }
          : p
      ),
    }));
    try {
      const result = await togglePostLike(postId);
      setState((s) => ({
        ...s,
        posts: s.posts.map((p) =>
          p.id === postId
            ? { ...p, viewer_liked: result.liked, like_count: result.like_count }
            : p
        ),
      }));
    } catch {
      // Revert
      setState((s) => ({
        ...s,
        posts: s.posts.map((p) =>
          p.id === postId
            ? {
                ...p,
                viewer_liked: !p.viewer_liked,
                like_count: p.like_count + (p.viewer_liked ? -1 : 1),
              }
            : p
        ),
      }));
    }
  }, []);

  const prependPost = useCallback((post: FeedPost) => {
    setState((s) => ({ ...s, posts: [post, ...s.posts] }));
  }, []);

  const removePost = useCallback((postId: UUID) => {
    setState((s) => ({ ...s, posts: s.posts.filter((p) => p.id !== postId) }));
  }, []);

  return { ...state, refresh, toggleLike, prependPost, removePost };
}
