// =============================================================================
// follow.service.ts
// One-way follows (migration 007).
// =============================================================================

import { supabase } from '../lib/supabase';
import type { UUID } from '../types/database';

export interface FollowCounts {
  followers: number;
  following: number;
}

export async function followUser(followerId: UUID, followedId: UUID): Promise<void> {
  if (followerId === followedId) return;
  const { error } = await supabase
    .from('follows')
    .insert({ follower_id: followerId, followed_id: followedId });
  if (error && error.code !== '23505') {
    // 23505 = already following (composite-PK conflict). Treat as no-op.
    console.error('[follow.service] followUser error:', error);
    throw new Error('Could not follow user');
  }
}

export async function unfollowUser(followerId: UUID, followedId: UUID): Promise<void> {
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('followed_id', followedId);
  if (error) {
    console.error('[follow.service] unfollowUser error:', error);
    throw new Error('Could not unfollow user');
  }
}

export async function isFollowing(
  followerId: UUID,
  followedId: UUID
): Promise<boolean> {
  const { data, error } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('follower_id', followerId)
    .eq('followed_id', followedId)
    .maybeSingle();
  if (error) {
    console.error('[follow.service] isFollowing error:', error);
    return false;
  }
  return !!data;
}

export async function getFollowCounts(userId: UUID): Promise<FollowCounts> {
  const [followers, following] = await Promise.all([
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('followed_id', userId),
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId),
  ]);
  return {
    followers: followers.count ?? 0,
    following: following.count ?? 0,
  };
}
