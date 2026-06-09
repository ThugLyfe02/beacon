// =============================================================================
// abuse.service.ts
// User blocks + abuse reports (Phase 7).
// =============================================================================

import { supabase } from '../lib/supabase';

export async function blockUser(
  blockerId: string,
  blockedId: string,
  reason?: string
): Promise<void> {
  const { error } = await supabase
    .from('user_blocks')
    .insert({ blocker_id: blockerId, blocked_id: blockedId, reason: reason ?? null } as never);
  if (error && error.code !== '23505') {
    // 23505 = unique violation (already blocked) — treat as success
    console.error('[abuse.service] block error:', error);
    throw new Error(error.message);
  }
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  const { error } = await supabase
    .from('user_blocks')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);
  if (error) {
    console.error('[abuse.service] unblock error:', error);
    throw new Error(error.message);
  }
}

export async function reportUser(input: {
  reporterId: string;
  targetId: string;
  eventId: string | null;
  reason: string;
}): Promise<void> {
  const { error } = await supabase.from('abuse_reports').insert({
    reporter_id: input.reporterId,
    target_id: input.targetId,
    event_id: input.eventId,
    reason: input.reason,
  } as never);
  if (error) {
    console.error('[abuse.service] report error:', error);
    throw new Error(error.message);
  }
}
