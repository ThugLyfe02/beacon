import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { EventIntentKey } from './event-intent.service';

export interface CommunityPartner {
  community_id: string;
  name: string;
  slug: string;
  description: string | null;
  state: 'active' | 'paused';
  created_at: string;
}

export interface CommunityEventPartnership {
  community_id: string;
  community_name: string;
  community_slug: string;
  state: 'invited' | 'active' | 'declined' | 'retired';
  goals: EventIntentKey[];
  caller_is_owner: boolean;
}

export interface CommunityAffiliation {
  community_id: string;
  community_name: string;
  community_slug: string;
  visibility: 'private' | 'badge';
  exchange_enabled: boolean;
  verified_at: string;
}

export interface CommunityExchange {
  exchange_id: string;
  community_a_id: string;
  community_a_name: string;
  community_b_id: string;
  community_b_name: string;
  domains: EventIntentKey[];
  state: 'proposed' | 'active' | 'declined' | 'closed';
  community_a_approved: boolean;
  community_b_approved: boolean;
  caller_can_respond: boolean;
  activated_at: string | null;
}

export interface CommunityBridge {
  target_id: string;
  my_community_id: string;
  my_community_name: string;
  target_community_id: string;
  target_community_name: string;
  exchange_id: string;
  domains: EventIntentKey[];
}

export interface CommunityExchangeSummary {
  supported: boolean;
  community_a_name: string;
  community_b_name: string;
  community_a_opted_count: number | null;
  community_b_opted_count: number | null;
  cross_community_mutual_count: number | null;
  declared_fit_mutual_count: number | null;
  two_way_declared_fit_mutual_count: number | null;
  declared_fit_share: number | null;
  two_way_share: number | null;
}

export interface CommunityExchangePortfolio {
  ended_event_count: number;
  partner_community_count: number;
  supported_exchange_count: number;
  cross_community_mutual_count: number;
  declared_fit_mutual_count: number;
  latest_event_ended_at: string | null;
}

export async function createCommunityPartner(input: {
  name: string;
  slug: string;
  description?: string;
}): Promise<{ data: CommunityPartner | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .rpc('create_community_partner', {
      p_name: input.name.trim(),
      p_slug: input.slug.trim().toLowerCase(),
      p_description: input.description?.trim() || null,
    })
    .maybeSingle();
  return { data: (data as CommunityPartner | null) ?? null, error };
}

export async function getMyCommunityPartners(): Promise<{ data: CommunityPartner[]; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_my_community_partners');
  return { data: (data as CommunityPartner[] | null) ?? [], error };
}

export async function inviteCommunityPartnerToEvent(input: {
  eventId: string;
  communitySlug: string;
  goals: EventIntentKey[];
}): Promise<{ data: CommunityEventPartnership | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .rpc('invite_community_partner_to_event', {
      p_event_id: input.eventId,
      p_community_slug: input.communitySlug.trim().toLowerCase(),
      p_goals: [...new Set(input.goals)].sort(),
    })
    .maybeSingle();
  return { data: (data as CommunityEventPartnership | null) ?? null, error };
}

export async function respondToCommunityEventPartnership(input: {
  eventId: string;
  communityId: string;
  accept: boolean;
}): Promise<{ changed: boolean; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('respond_to_community_event_partnership', {
    p_event_id: input.eventId,
    p_community_id: input.communityId,
    p_accept: input.accept,
  });
  return { changed: data === true, error };
}

export async function getEventCommunityPartnerships(eventId: string): Promise<{
  data: CommunityEventPartnership[];
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc('get_event_community_partnerships', { p_event_id: eventId });
  return { data: (data as CommunityEventPartnership[] | null) ?? [], error };
}

export async function createCommunityEventInviteCode(input: {
  eventId: string;
  communityId: string;
  maxUses?: number;
  validMinutes?: number;
}): Promise<{ data: { invite_id: string; invite_code: string; expires_at: string; max_uses: number } | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .rpc('create_community_event_invite_code', {
      p_event_id: input.eventId,
      p_community_id: input.communityId,
      p_max_uses: input.maxUses ?? 100,
      p_valid_minutes: input.validMinutes ?? 1440,
    })
    .maybeSingle();
  return { data: (data as { invite_id: string; invite_code: string; expires_at: string; max_uses: number } | null) ?? null, error };
}

export async function claimEventCommunityAffiliation(input: {
  eventId: string;
  inviteCode: string;
  visibility: 'private' | 'badge';
  exchangeEnabled: boolean;
}): Promise<{ data: CommunityAffiliation | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .rpc('claim_event_community_affiliation', {
      p_event_id: input.eventId,
      p_invite_code: input.inviteCode.trim().toUpperCase(),
      p_visibility: input.visibility,
      p_exchange_enabled: input.exchangeEnabled,
    })
    .maybeSingle();
  return { data: (data as CommunityAffiliation | null) ?? null, error };
}

export async function setMyEventCommunityAffiliation(input: {
  eventId: string;
  communityId: string;
  visibility: 'private' | 'badge';
  exchangeEnabled: boolean;
}): Promise<{ changed: boolean; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('set_my_event_community_affiliation', {
    p_event_id: input.eventId,
    p_community_id: input.communityId,
    p_visibility: input.visibility,
    p_exchange_enabled: input.exchangeEnabled,
  });
  return { changed: data === true, error };
}

export async function getMyEventCommunityAffiliations(eventId: string): Promise<{
  data: CommunityAffiliation[];
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc('get_my_event_community_affiliations', { p_event_id: eventId });
  return { data: (data as CommunityAffiliation[] | null) ?? [], error };
}

export async function proposeCommunityExchange(input: {
  eventId: string;
  communityOneId: string;
  communityTwoId: string;
  domains: EventIntentKey[];
}): Promise<{ exchangeId: string | null; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('propose_community_exchange', {
    p_event_id: input.eventId,
    p_community_one: input.communityOneId,
    p_community_two: input.communityTwoId,
    p_domains: [...new Set(input.domains)].sort(),
  });
  return { exchangeId: typeof data === 'string' ? data : null, error };
}

export async function respondToCommunityExchange(exchangeId: string, accept: boolean): Promise<{
  state: CommunityExchange['state'] | null;
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc('respond_to_community_exchange', {
    p_exchange_id: exchangeId,
    p_accept: accept,
  });
  const state = data === 'proposed' || data === 'active' || data === 'declined' || data === 'closed' ? data : null;
  return { state, error };
}

export async function getEventCommunityExchanges(eventId: string): Promise<{
  data: CommunityExchange[];
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc('get_event_community_exchanges', { p_event_id: eventId });
  return { data: (data as CommunityExchange[] | null) ?? [], error };
}

export async function getLiveCommunityBridges(eventId: string, targetIds: string[]): Promise<{
  data: CommunityBridge[];
  error: PostgrestError | null;
}> {
  if (targetIds.length === 0) return { data: [], error: null };
  const { data, error } = await supabase.rpc('get_live_community_bridges', {
    p_event_id: eventId,
    p_target_ids: [...new Set(targetIds)].slice(0, 40),
  });
  return { data: (data as CommunityBridge[] | null) ?? [], error };
}

export async function getCommunityExchangeSummary(exchangeId: string): Promise<{
  data: CommunityExchangeSummary | null;
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase
    .rpc('get_community_exchange_summary', { p_exchange_id: exchangeId })
    .maybeSingle();
  return { data: (data as CommunityExchangeSummary | null) ?? null, error };
}

export async function getMyCommunityExchangePortfolio(communityId: string): Promise<{
  data: CommunityExchangePortfolio | null;
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase
    .rpc('get_my_community_exchange_portfolio', { p_community_id: communityId })
    .maybeSingle();
  return { data: (data as CommunityExchangePortfolio | null) ?? null, error };
}
