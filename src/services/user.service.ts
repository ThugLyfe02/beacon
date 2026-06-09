// =============================================================================
// user.service.ts
// User profile management service
// =============================================================================

import { supabase } from '../lib/supabase';
import type { UserRow, UserUpdate } from '../types/database';

/**
 * Get current user profile
 */
export async function getCurrentUser(userId: string): Promise<UserRow | null> {
  console.log('[user.service] Fetching user profile for:', userId);

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('[user.service] Error fetching current user:', error);
    console.error('[user.service] Error code:', error.code);
    console.error('[user.service] Error message:', error.message);

    // Return null instead of throwing to allow graceful handling
    return null;
  }

  console.log('[user.service] User data retrieved:', data);
  return data;
}

/**
 * Update user profile
 */
export async function updateUserProfile(
  userId: string,
  updates: UserUpdate
): Promise<UserRow> {
  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    console.error('[user.service] Error updating user profile:', error);
    throw new Error('Failed to update profile');
  }

  return data;
}

/**
 * Persist the user's Ready Player Me avatar URL (public glb).
 */
export async function setAvatar3dUrl(userId: string, url: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ avatar_url_3d: url } as never)
    .eq('id', userId);
  if (error) {
    console.error('[user.service] setAvatar3dUrl error:', error);
    throw new Error('Failed to save avatar');
  }
}

/**
 * Check if user has completed profile setup
 */
export async function hasCompletedProfile(userId: string): Promise<boolean> {
  try {
    console.log('[user.service] Checking profile completion for:', userId);
    const user = await getCurrentUser(userId);

    console.log('[user.service] User retrieved:', {
      exists: user !== null,
      hasName: user?.name !== null && user?.name !== undefined,
      name: user?.name,
    });

    const isComplete = user !== null && user.name !== null && user.name.trim() !== '';
    console.log('[user.service] Profile complete:', isComplete);

    return isComplete;
  } catch (error) {
    console.error('[user.service] Error in hasCompletedProfile:', error);
    return false;
  }
}
