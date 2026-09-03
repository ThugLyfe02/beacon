import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { EventIntentKey } from './event-intent.service';

export type CommunityExchangePosture =
  | 'two-way'
  | 'a-can-support-b'
  | 'b-can-support-a'
  | 'observe';

export interface CommunitySupplyDemandRow {
  intent_key: EventIntentKey;
  community_a_name: string;
  community_b_name: string;
  community_a_contributors: number;
  community_a_seeking: number;
  community_a_offering: number;
  community_b_contributors: number;
  community_b_seeking: number;
  community_b_offering: number;
  a_supply_for_b_need: number;
  b_supply_for_a_need: number;
  exchange_posture: CommunityExchangePosture;
}

/**
 * Planning-only aggregate. The database releases a domain only when at least
 * five exchange-enabled declaring participants from each community support that
 * row. It is not a participant-discovery endpoint and cannot activate an
 * exchange or identify who declared the underlying need/supply.
 */
export async function getCommunityPairSupplyDemand(input: {
  eventId: string;
  communityOneId: string;
  communityTwoId: string;
}): Promise<{ data: CommunitySupplyDemandRow[]; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_community_pair_supply_demand', {
    p_event_id: input.eventId,
    p_community_one: input.communityOneId,
    p_community_two: input.communityTwoId,
  });
  return { data: (data as CommunitySupplyDemandRow[] | null) ?? [], error };
}
