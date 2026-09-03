import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { EventIntentKey } from './event-intent.service';

export type CommunityPartnerProgramState = 'proposed' | 'active' | 'paused' | 'retired' | 'declined';

export interface CommunityPartnerProgram {
  program_id: string;
  community_a_id: string;
  community_a_name: string;
  community_b_id: string;
  community_b_name: string;
  name: string;
  domains: EventIntentKey[];
  state: CommunityPartnerProgramState;
  community_a_approved: boolean;
  community_b_approved: boolean;
  caller_owns_a: boolean;
  caller_owns_b: boolean;
  activated_at: string | null;
  updated_at: string;
}

export interface AvailableCommunityPartnerProgram {
  program_id: string;
  community_a_id: string;
  community_a_name: string;
  community_b_id: string;
  community_b_name: string;
  name: string;
  domains: EventIntentKey[];
}

export async function proposeCommunityPartnerProgram(input: {
  communityOneId: string;
  communityTwoId: string;
  name: string;
  domains: EventIntentKey[];
}): Promise<{ programId: string | null; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('propose_community_partner_program', {
    p_community_one: input.communityOneId,
    p_community_two: input.communityTwoId,
    p_name: input.name.trim(),
    p_domains: [...new Set(input.domains)].sort(),
  });
  return { programId: typeof data === 'string' ? data : null, error };
}

export async function respondToCommunityPartnerProgram(
  programId: string,
  accept: boolean,
): Promise<{ state: CommunityPartnerProgramState | null; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('respond_to_community_partner_program', {
    p_program_id: programId,
    p_accept: accept,
  });
  const state = data === 'proposed' || data === 'active' || data === 'paused' || data === 'retired' || data === 'declined'
    ? data
    : null;
  return { state, error };
}

export async function setCommunityPartnerProgramState(
  programId: string,
  state: 'active' | 'paused' | 'retired',
): Promise<{ changed: boolean; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('set_community_partner_program_state', {
    p_program_id: programId,
    p_state: state,
  });
  return { changed: data === true, error };
}

export async function getMyCommunityPartnerPrograms(): Promise<{
  data: CommunityPartnerProgram[];
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc('get_my_community_partner_programs');
  return { data: (data as CommunityPartnerProgram[] | null) ?? [], error };
}

export async function getEventAvailablePartnerPrograms(eventId: string): Promise<{
  data: AvailableCommunityPartnerProgram[];
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc('get_event_available_partner_programs', {
    p_event_id: eventId,
  });
  return { data: (data as AvailableCommunityPartnerProgram[] | null) ?? [], error };
}

export async function useCommunityPartnerProgram(eventId: string, programId: string): Promise<{
  exchangeId: string | null;
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc('use_community_partner_program', {
    p_event_id: eventId,
    p_program_id: programId,
  });
  return { exchangeId: typeof data === 'string' ? data : null, error };
}
