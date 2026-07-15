import { supabase } from '../lib/supabase';
import type {
  VipVisibilityMode,
  VerifiedRoleKey,
  VerificationStatus,
} from '../access/VerifiedAccessEngine';

export interface EventRoleAttestationRow {
  id: string;
  event_id: string;
  user_id: string;
  role_key: VerifiedRoleKey;
  status: VerificationStatus;
  verified_by: string | null;
  evidence_label: string | null;
  verified_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VipVisibilitySettingsRow {
  event_id: string;
  user_id: string;
  visibility_mode: VipVisibilityMode;
  inbound_limit: number;
  accepted_inbound_count: number;
  office_hours_visible: boolean;
  allow_mutual_reveal: boolean;
  aggregate_role_hint: boolean;
  created_at: string;
  updated_at: string;
}

export async function listVerifiedEventRoles(
  eventId: string,
): Promise<EventRoleAttestationRow[]> {
  const { data, error } = await supabase
    .from('event_role_attestations')
    .select('*')
    .eq('event_id', eventId)
    .eq('status', 'verified');

  if (error) {
    console.error('[verified-access.service] listVerifiedEventRoles:', error);
    return [];
  }

  return (data ?? []) as EventRoleAttestationRow[];
}

export async function getOwnVipVisibilitySettings(
  eventId: string,
  userId: string,
): Promise<VipVisibilitySettingsRow | null> {
  const { data, error } = await supabase
    .from('vip_visibility_settings')
    .select('*')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[verified-access.service] getOwnVipVisibilitySettings:', error);
    return null;
  }

  return (data as VipVisibilitySettingsRow | null) ?? null;
}

export async function upsertVipVisibilitySettings(input: {
  eventId: string;
  userId: string;
  visibilityMode: VipVisibilityMode;
  inboundLimit: number;
  officeHoursVisible: boolean;
  allowMutualReveal: boolean;
  aggregateRoleHint: boolean;
}): Promise<VipVisibilitySettingsRow> {
  const payload = {
    event_id: input.eventId,
    user_id: input.userId,
    visibility_mode: input.visibilityMode,
    inbound_limit: input.inboundLimit,
    office_hours_visible: input.officeHoursVisible,
    allow_mutual_reveal: input.allowMutualReveal,
    aggregate_role_hint: input.aggregateRoleHint,
  };

  const { data, error } = await supabase
    .from('vip_visibility_settings')
    .upsert(payload, { onConflict: 'event_id,user_id' })
    .select('*')
    .single();

  if (error || !data) {
    console.error('[verified-access.service] upsertVipVisibilitySettings:', error);
    throw new Error('Unable to update event visibility controls.');
  }

  return data as VipVisibilitySettingsRow;
}

export async function listUserRoleAttestations(
  eventId: string,
  userId: string,
): Promise<EventRoleAttestationRow[]> {
  const { data, error } = await supabase
    .from('event_role_attestations')
    .select('*')
    .eq('event_id', eventId)
    .eq('user_id', userId);

  if (error) {
    console.error('[verified-access.service] listUserRoleAttestations:', error);
    return [];
  }

  return (data ?? []) as EventRoleAttestationRow[];
}
