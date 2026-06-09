// =============================================================================
// livekit.service.ts
// Client-side wrapper that asks Supabase to mint a LiveKit token for an
// office-hours call. Server enforces auth + scheduling window.
// =============================================================================

import { supabase } from '../lib/supabase';

export interface LivekitGrant {
  wsUrl: string;
  token: string;
  room: string;
}

export async function getLivekitTokenForOfficeHours(
  officeHoursRequestId: string
): Promise<LivekitGrant> {
  const { data, error } = await supabase.functions.invoke<LivekitGrant>(
    'livekit-token',
    {
      body: { officeHoursRequestId },
    }
  );
  if (error || !data) {
    throw new Error(error?.message ?? 'Could not mint LiveKit token');
  }
  return data;
}
