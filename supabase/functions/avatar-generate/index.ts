// =============================================================================
// supabase/functions/avatar-generate
// Submits a user selfie to whichever avatar backend is configured:
//   1. Self-hosted TripoSR GPU server  (env BEACON_AVATAR_GPU_URL)
//   2. Meshy.ai fallback                (env MESHY_API_KEY)
//
// Premium-gated (Meshy + your GPU cost money — premiums only).
//
// Request body:  { imageDataUri: string }
// Response:      { taskId: string, backend: 'gpu' | 'meshy' }
// =============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface Body {
  imageDataUri: string;
}

const GPU_URL = Deno.env.get('BEACON_AVATAR_GPU_URL');
const GPU_SECRET = Deno.env.get('BEACON_AVATAR_GPU_SECRET');
const MESHY_KEY = Deno.env.get('MESHY_API_KEY');

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

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

  // ---------- Backend 1: self-hosted TripoSR GPU ----------
  if (GPU_URL && GPU_SECRET) {
    const b64 = body.imageDataUri.split(',', 2)[1] ?? body.imageDataUri;
    const resp = await fetch(`${GPU_URL.replace(/\/$/, '')}/jobs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${GPU_SECRET}`,
      },
      body: JSON.stringify({ image_b64: b64 }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return new Response(
        JSON.stringify({ error: `GPU ${resp.status}: ${text}` }),
        { status: 502, headers: { 'content-type': 'application/json' } }
      );
    }
    const json = (await resp.json()) as { task_id?: string };
    if (!json.task_id) {
      return new Response(JSON.stringify({ error: 'GPU response missing task_id' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({ taskId: `gpu:${json.task_id}`, backend: 'gpu' }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }

  // ---------- Backend 2: Meshy fallback ----------
  if (MESHY_KEY) {
    const resp = await fetch('https://api.meshy.ai/openapi/v1/image-to-3d', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${MESHY_KEY}`,
      },
      body: JSON.stringify({
        image_url: body.imageDataUri,
        enable_pbr: true,
        should_remesh: true,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return new Response(
        JSON.stringify({ error: `Meshy ${resp.status}: ${text}` }),
        { status: 502, headers: { 'content-type': 'application/json' } }
      );
    }
    const json = (await resp.json()) as { result?: string };
    if (!json.result) {
      return new Response(JSON.stringify({ error: 'Meshy response missing result' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({ taskId: `meshy:${json.result}`, backend: 'meshy' }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({
      error:
        'No avatar backend configured. Set BEACON_AVATAR_GPU_URL+BEACON_AVATAR_GPU_SECRET, or MESHY_API_KEY.',
    }),
    { status: 500, headers: { 'content-type': 'application/json' } }
  );
});
