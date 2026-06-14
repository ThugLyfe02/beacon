// =============================================================================
// supabase/functions/avaturn-session
// Mints an Avaturn iframe session URL using the developer API key, so the
// client never sees the key.
//
// Required env (supabase secrets set ...):
//   AVATURN_API_KEY      from https://avaturn.me developer console
//   AVATURN_SUBDOMAIN    e.g. "beacon"  → uses https://beacon.avaturn.dev
//                        (optional; defaults to "demo")
//
// Deploy:  supabase functions deploy avaturn-session
//
// Response: { url: string }
// =============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const AVATURN_API_BASE = 'https://api.avaturn.me';

serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiKey = Deno.env.get('AVATURN_API_KEY');
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'AVATURN_API_KEY not configured' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Missing auth', { status: 401 });

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

  // Mint a fresh session for this user. Avaturn ties the session to a userId
  // so we get per-user avatar history.
  const sessionResp = await fetch(`${AVATURN_API_BASE}/v1/sessions/new`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({ user_id: user.id }),
  });

  if (!sessionResp.ok) {
    const text = await sessionResp.text();
    return new Response(
      JSON.stringify({ error: `Avaturn API ${sessionResp.status}: ${text}` }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  const body = (await sessionResp.json()) as { url?: string; session_id?: string };
  if (!body.url) {
    return new Response(
      JSON.stringify({ error: 'Avaturn response missing url' }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  return new Response(JSON.stringify({ url: body.url }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});
