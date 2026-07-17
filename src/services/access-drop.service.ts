import { supabase } from '../lib/supabase';
import type { AccessDrop, AccessDropStatus } from '../drops/AccessDropEngine';

export interface AccessDropRow {
  id: string;
  event_id: string;
  created_by: string;
  title: string;
  description: string | null;
  access_type: string;
  status: AccessDropStatus;
  capacity: number;
  confirmed_count: number;
  waitlist_enabled: boolean;
  eligible_role_keys: string[];
  requires_verified_role: boolean;
  starts_at: string;
  ends_at: string;
  created_at: string;
  updated_at: string;
}

export interface AccessDropClaimRow {
  drop_id: string;
  user_id: string;
  status: 'confirmed' | 'waitlisted' | 'cancelled' | 'completed';
  queue_position: number | null;
  claimed_at: string;
  updated_at: string;
}

function buildSecureNonce(): string {
  const random = Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${random}-${random.split('').reverse().join('')}`;
}

export function mapAccessDrop(row: AccessDropRow): AccessDrop {
  return {
    id: row.id,
    eventId: row.event_id,
    title: row.title,
    description: row.description,
    accessType: row.access_type,
    status: row.status,
    capacity: row.capacity,
    confirmedCount: row.confirmed_count,
    waitlistEnabled: row.waitlist_enabled,
    eligibleRoleKeys: row.eligible_role_keys ?? [],
    requiresVerifiedRole: row.requires_verified_role,
    startsAt: new Date(row.starts_at).getTime(),
    endsAt: new Date(row.ends_at).getTime(),
  };
}

export async function listEventAccessDrops(eventId: string): Promise<AccessDrop[]> {
  const { data, error } = await supabase
    .from('access_drop_windows')
    .select('*')
    .eq('event_id', eventId)
    .in('status', ['scheduled', 'open', 'filled'])
    .order('starts_at', { ascending: true });

  if (error) {
    console.error('[access-drop.service] listEventAccessDrops:', error);
    return [];
  }

  return ((data ?? []) as AccessDropRow[]).map(mapAccessDrop);
}

export async function listOwnDropClaims(userId: string): Promise<AccessDropClaimRow[]> {
  const { data, error } = await supabase
    .from('access_drop_claims')
    .select('*')
    .eq('user_id', userId)
    .order('claimed_at', { ascending: false });

  if (error) {
    console.error('[access-drop.service] listOwnDropClaims:', error);
    return [];
  }

  return (data ?? []) as AccessDropClaimRow[];
}

export async function claimAccessDrop(
  dropId: string,
  nonce = buildSecureNonce(),
): Promise<AccessDropClaimRow> {
  const { data, error } = await supabase
    .rpc('secure_claim_access_drop', {
      p_drop_id: dropId,
      p_nonce: nonce,
    })
    .single();

  if (error || !data) {
    console.error('[access-drop.service] claimAccessDrop:', error);
    const rawMessage = error?.message ?? 'Unable to claim this access window.';

    if (rawMessage.includes('event_locked')) {
      throw new Error('Access claims are temporarily locked for this event.');
    }
    if (rawMessage.includes('nonce_reuse')) {
      throw new Error('This access claim was already processed.');
    }
    if (rawMessage.includes('burst_limit')) {
      throw new Error('Access claims are arriving too quickly. Pause before trying again.');
    }
    if (rawMessage.includes('blocked_relationship')) {
      throw new Error('This access claim is unavailable because the relationship is blocked.');
    }

    throw new Error(rawMessage);
  }

  return data as AccessDropClaimRow;
}

export async function createAccessDrop(input: {
  eventId: string;
  createdBy: string;
  title: string;
  description?: string;
  accessType: string;
  capacity: number;
  waitlistEnabled: boolean;
  eligibleRoleKeys: string[];
  requiresVerifiedRole: boolean;
  startsAt: string;
  endsAt: string;
}): Promise<AccessDropRow> {
  const { data, error } = await supabase
    .from('access_drop_windows')
    .insert({
      event_id: input.eventId,
      created_by: input.createdBy,
      title: input.title,
      description: input.description ?? null,
      access_type: input.accessType,
      status: 'scheduled',
      capacity: input.capacity,
      waitlist_enabled: input.waitlistEnabled,
      eligible_role_keys: input.eligibleRoleKeys,
      requires_verified_role: input.requiresVerifiedRole,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
    })
    .select('*')
    .single();

  if (error || !data) {
    console.error('[access-drop.service] createAccessDrop:', error);
    throw new Error('Unable to create this access window.');
  }

  return data as AccessDropRow;
}
