// =============================================================================
// supabase/functions/meshy-generate
// Submits a user selfie to Meshy.ai's image-to-3D endpoint and returns the
// task id for the client to poll via meshy-status.
//
// Required secret:  MESHY_API_KEY  (format msy-... — from meshy.ai > Settings > API)
//
// Request body:
//   { imageDataUri: string }  // "data:image/jpeg;base64,..."
//
// Response:
//   { taskId: string }
// =============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MESHY_BASE = 'https://api.meshy.ai/openapi/v1';

interface Body {
  imageDataUri: string;
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const apiKey = Deno.env.get('MESHY_API_KEY');
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'MESHY_API_KEY not configured' }),
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

  // Gate to premium users — Meshy bills per generation.
  const { data: profile } = await supabase
    .from('users')
    .select('is_premium')
    .eq('id', user.id)
    .single();
  if (!(profile as { is_premium?: boolean } | null)?.is_premium) {
    return new Response(
      JSON.stringify({ error: 'Avatar generation is premium-only' }),
      { status: 402, headers: { 'content-type': 'application/json' } }
    );
  }

  const body = (await req.json()) as Body;
  if (!body.imageDataUri || !body.imageDataUri.startsWith('data:image/')) {
    return new Response(
      JSON.stringify({ error: 'imageDataUri must be a base64 data URI' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }

  const meshyResp = await fetch(`${MESHY_BASE}/image-to-3d`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      image_url: body.imageDataUri,
      enable_pbr: true,
      should_remesh: true,
    }),
  });

  if (!meshyResp.ok) {
    const text = await meshyResp.text();
    return new Response(
      JSON.stringify({ error: `Meshy ${meshyResp.status}: ${text}` }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  const json = (await meshyResp.json()) as { result?: string };
  if (!json.result) {
    return new Response(
      JSON.stringify({ error: 'Meshy response missing result' }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  return new Response(JSON.stringify({ taskId: json.result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});
