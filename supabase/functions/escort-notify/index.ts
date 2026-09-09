// =============================================================================
// supabase/functions/escort-notify
// Privileged, idempotent push notification after a host assigns an escort room.
//
// The caller is authenticated with the anon client, then every sensitive lookup
// (event ownership, room assignment, push tokens, delivery ledger) is performed
// with service-role access only after host identity is verified. Client-supplied
// room metadata is never trusted.
// =============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface Body {
  officeHoursRequestId?: string;
}

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'Notification service is not configured' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userError,
  } = await callerClient.auth.getUser();
  if (userError || !user) return json({ error: 'Unauthorized' }, 401);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const requestId = body.officeHoursRequestId?.trim();
  if (!requestId) return json({ error: 'Missing Office Hours request' }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: request, error: requestError } = await admin
    .from('office_hours_requests')
    .select('id, event_id, requester_id, recipient_id, room_id, status')
    .eq('id', requestId)
    .maybeSingle();

  if (
    requestError
    || !request
    || request.status !== 'awaiting_escort'
    || !request.room_id
  ) {
    return json({ error: 'Escort notification is not available' }, 403);
  }

  const { data: event } = await admin
    .from('events')
    .select('host_id, finalized_at')
    .eq('id', request.event_id)
    .maybeSingle();

  if (!event || event.host_id !== user.id || event.finalized_at) {
    return json({ error: 'Escort notification is not available' }, 403);
  }

  const { data: room } = await admin
    .from('venue_rooms')
    .select('id, label')
    .eq('id', request.room_id)
    .eq('event_id', request.event_id)
    .maybeSingle();

  if (!room) return json({ error: 'Escort notification is not available' }, 403);

  // Claim delivery before the external side effect. A concurrent/replayed call for
  // the same request-room pair loses the unique race and cannot send a duplicate.
  const { error: claimError } = await admin
    .from('escort_notification_deliveries')
    .insert({ request_id: request.id, room_id: room.id });

  if (claimError) {
    if (claimError.code === '23505') {
      return json({ delivered: 0, duplicate: true });
    }
    return json({ error: 'Could not claim notification delivery' }, 500);
  }

  const { data: people, error: peopleError } = await admin
    .from('users')
    .select('id, name, expo_push_token')
    .in('id', [request.requester_id, request.recipient_id]);

  if (peopleError) {
    await admin
      .from('escort_notification_deliveries')
      .delete()
      .eq('request_id', request.id)
      .eq('room_id', room.id);
    return json({ error: 'Could not resolve notification recipients' }, 500);
  }

  const byId = new Map((people ?? []).map((person) => [person.id, person] as const));
  const requester = byId.get(request.requester_id);
  const recipient = byId.get(request.recipient_id);

  const messages = [
    requester?.expo_push_token && {
      to: requester.expo_push_token,
      title: `${room.label} is ready`,
      body: `Head over for your Office Hours session with ${recipient?.name ?? 'your counterpart'}.`,
      data: { officeHoursRequestId: request.id, kind: 'escort' },
    },
    recipient?.expo_push_token && {
      to: recipient.expo_push_token,
      title: `${room.label} is ready`,
      body: `Head over for your Office Hours session with ${requester?.name ?? 'your counterpart'}.`,
      data: { officeHoursRequestId: request.id, kind: 'escort' },
    },
  ].filter(Boolean);

  if (messages.length === 0) {
    await admin
      .from('escort_notification_deliveries')
      .update({ delivered_at: new Date().toISOString(), expo_status: null })
      .eq('request_id', request.id)
      .eq('room_id', room.id);
    return json({ delivered: 0 });
  }

  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  const expoHeaders: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (accessToken) expoHeaders.authorization = `Bearer ${accessToken}`;

  let expoResponse: Response;
  try {
    expoResponse = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: expoHeaders,
      body: JSON.stringify(messages),
    });
  } catch {
    await admin
      .from('escort_notification_deliveries')
      .delete()
      .eq('request_id', request.id)
      .eq('room_id', room.id);
    return json({ error: 'Push provider unavailable' }, 502);
  }

  if (!expoResponse.ok) {
    await admin
      .from('escort_notification_deliveries')
      .delete()
      .eq('request_id', request.id)
      .eq('room_id', room.id);
    return json({ error: 'Push provider rejected notification' }, 502);
  }

  await admin
    .from('escort_notification_deliveries')
    .update({
      delivered_at: new Date().toISOString(),
      expo_status: expoResponse.status,
    })
    .eq('request_id', request.id)
    .eq('room_id', room.id);

  return json({ delivered: messages.length, duplicate: false });
});
