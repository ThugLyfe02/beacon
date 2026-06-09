// =============================================================================
// supabase/functions/livekit-token
// Mints a short-lived LiveKit access token for an office-hours call.
//
// Required env (set via: supabase secrets set LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=...):
//   LIVEKIT_API_KEY
//   LIVEKIT_API_SECRET
//   LIVEKIT_WS_URL          e.g. wss://your-project.livekit.cloud
//
// Deploy: supabase functions deploy livekit-token --no-verify-jwt=false
//
// Request body:
//   { officeHoursRequestId: string }
//
// Response:
//   { wsUrl: string, token: string, room: string }
// =============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AccessToken } from 'https://esm.sh/livekit-server-sdk@2.10.2';

interface Body {
  officeHoursRequestId: string;
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiKey = Deno.env.get('LIVEKIT_API_KEY');
  const apiSecret = Deno.env.get('LIVEKIT_API_SECRET');
  const wsUrl = Deno.env.get('LIVEKIT_WS_URL');
  if (!apiKey || !apiSecret || !wsUrl) {
    return new Response(
      JSON.stringify({ error: 'LiveKit secrets not configured' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response('Missing auth', { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) return new Response('Unauthorized', { status: 401 });

  const body: Body = await req.json();
  const { officeHoursRequestId } = body;
  if (!officeHoursRequestId) {
    return new Response('Missing officeHoursRequestId', { status: 400 });
  }

  // Gate: only accepted requests, only requester/recipient, only within slot window.
  const { data: ohr, error: ohrErr } = await supabase
    .from('office_hours_requests')
    .select('id, requester_id, recipient_id, status, proposed_start, proposed_end')
    .eq('id', officeHoursRequestId)
    .single();
  if (ohrErr || !ohr) return new Response('Not found', { status: 404 });

  if (ohr.status !== 'accepted' && ohr.status !== 'awaiting_escort') {
    return new Response('Request not accepted', { status: 403 });
  }
  if (user.id !== ohr.requester_id && user.id !== ohr.recipient_id) {
    return new Response('Not a party to this request', { status: 403 });
  }

  const now = Date.now();
  const start = new Date(ohr.proposed_start).getTime() - 5 * 60 * 1000;
  const end = new Date(ohr.proposed_end).getTime() + 5 * 60 * 1000;
  if (now < start || now > end) {
    return new Response('Outside scheduled window', { status: 403 });
  }

  const room = `oh_${ohr.id}`;
  const at = new AccessToken(apiKey, apiSecret, {
    identity: user.id,
    ttl: 60 * 60,
  });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });
  const token = await at.toJwt();

  return new Response(JSON.stringify({ wsUrl, token, room }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});
