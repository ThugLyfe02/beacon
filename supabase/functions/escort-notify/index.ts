// =============================================================================
// supabase/functions/escort-notify
// Sends an Expo push notification to both parties of an office-hours request
// when a host assigns a room.
//
// Optional env:
//   EXPO_ACCESS_TOKEN  (only required if your Expo project has enhanced security
//   enabled; otherwise unauthenticated POST to exp.host/--/api/v2/push/send is ok)
//
// Request body:
//   { officeHoursRequestId: string, roomId: string }
// =============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface Body {
  officeHoursRequestId: string;
  roomId: string;
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Missing auth', { status: 401 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const body: Body = await req.json();

  const { data: ohr, error } = await supabase
    .from('office_hours_requests')
    .select(
      'id, requester_id, recipient_id, requester:users!office_hours_requests_requester_id_fkey(expo_push_token, name), recipient:users!office_hours_requests_recipient_id_fkey(expo_push_token, name), venue_rooms(label)'
    )
    .eq('id', body.officeHoursRequestId)
    .single();
  if (error || !ohr) return new Response('Not found', { status: 404 });

  const room = (ohr as any).venue_rooms?.label ?? 'your room';
  const requesterToken = (ohr as any).requester?.expo_push_token as string | null;
  const recipientToken = (ohr as any).recipient?.expo_push_token as string | null;
  const requesterName = (ohr as any).requester?.name ?? 'attendee';
  const recipientName = (ohr as any).recipient?.name ?? 'attendee';

  const messages = [
    requesterToken && {
      to: requesterToken,
      title: `${room} is ready`,
      body: `Head over — escort meeting you with ${recipientName}.`,
      data: { officeHoursRequestId: ohr.id, kind: 'escort' },
    },
    recipientToken && {
      to: recipientToken,
      title: `${room} is ready`,
      body: `Head over — escort meeting you with ${requesterName}.`,
      data: { officeHoursRequestId: ohr.id, kind: 'escort' },
    },
  ].filter(Boolean);

  if (messages.length === 0) {
    return new Response(JSON.stringify({ delivered: 0 }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  const expoHeaders: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (accessToken) expoHeaders.authorization = `Bearer ${accessToken}`;

  const resp = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: expoHeaders,
    body: JSON.stringify(messages),
  });

  return new Response(JSON.stringify({ delivered: messages.length, expoStatus: resp.status }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});
