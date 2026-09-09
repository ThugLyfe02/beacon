// =============================================================================
// supabase/functions/livekit-token
// Mints a short-lived LiveKit access token for an evidence-backed Office Hours call.
//
// Required env:
//   LIVEKIT_API_KEY
//   LIVEKIT_API_SECRET
//   LIVEKIT_WS_URL
//
// Authorization policy lives in Postgres (`get_office_hours_call_context`) so
// lifecycle, security controls, block relationships and time windows cannot drift
// between the database and this edge function.
// =============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AccessToken } from 'https://esm.sh/livekit-server-sdk@2.10.2';

interface Body {
  officeHoursRequestId?: string;
}

interface CallContext {
  request_id: string;
  event_id: string;
  requester_id: string;
  recipient_id: string;
  proposed_start: string;
  proposed_end: string;
  window_closes_at: string;
  token_ttl_seconds: number;
}

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: JSON_HEADERS,
  });
}

serve(async (req) => {
  if (req.method !== 'POST') return jsonError('Method not allowed', 405);

  const apiKey = Deno.env.get('LIVEKIT_API_KEY');
  const apiSecret = Deno.env.get('LIVEKIT_API_SECRET');
  const wsUrl = Deno.env.get('LIVEKIT_WS_URL');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!apiKey || !apiSecret || !wsUrl || !supabaseUrl || !supabaseAnonKey) {
    return jsonError('Call service is not configured', 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonError('Unauthorized', 401);

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return jsonError('Unauthorized', 401);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const requestId = body.officeHoursRequestId?.trim();
  if (!requestId) return jsonError('Missing Office Hours request', 400);

  const { data, error } = await supabase
    .rpc('get_office_hours_call_context', { p_request_id: requestId })
    .maybeSingle();

  // Deliberately collapse request-not-found, non-party, blocked relationship,
  // finalization, security lock and schedule-window failures into one response.
  if (error || !data) return jsonError('Call is not currently available', 403);

  const context = data as CallContext;
  if (
    user.id !== context.requester_id
    && user.id !== context.recipient_id
  ) {
    return jsonError('Call is not currently available', 403);
  }

  const ttlSeconds = Math.max(30, Math.min(3600, Number(context.token_ttl_seconds) || 30));
  const room = `oh_${context.request_id}`;
  const accessToken = new AccessToken(apiKey, apiSecret, {
    identity: user.id,
    ttl: ttlSeconds,
  });

  accessToken.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });

  const token = await accessToken.toJwt();

  return new Response(JSON.stringify({
    wsUrl,
    token,
    room,
    expiresAt: context.window_closes_at,
  }), {
    status: 200,
    headers: JSON_HEADERS,
  });
});
