// =============================================================================
// supabase/functions/avatar-status
// Polls whichever backend produced the task (prefix-based routing).
//
// Request body: { taskId: string }   // 'gpu:<id>' or 'meshy:<id>'
// Response:
//   {
//     status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED',
//     progress: number,
//     glbUrl: string | null
//   }
// =============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface Body {
  taskId: string;
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

  const body = (await req.json()) as Body;
  if (!body.taskId) {
    return new Response(JSON.stringify({ error: 'Missing taskId' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const [backend, id] = body.taskId.includes(':')
    ? body.taskId.split(':', 2)
    : ['meshy', body.taskId]; // pre-prefix tasks default to meshy

  // ---------- Self-hosted GPU ----------
  if (backend === 'gpu') {
    if (!GPU_URL || !GPU_SECRET) {
      return new Response(JSON.stringify({ error: 'GPU backend not configured' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    const resp = await fetch(`${GPU_URL.replace(/\/$/, '')}/jobs/${id}`, {
      headers: { authorization: `Bearer ${GPU_SECRET}` },
    });
    if (!resp.ok) {
      const text = await resp.text();
      return new Response(
        JSON.stringify({ error: `GPU ${resp.status}: ${text}` }),
        { status: 502, headers: { 'content-type': 'application/json' } }
      );
    }
    const json = (await resp.json()) as {
      status?: string;
      progress?: number;
      glb_url?: string | null;
    };
    return new Response(
      JSON.stringify({
        status: json.status ?? 'PENDING',
        progress: json.progress ?? 0,
        glbUrl: json.glb_url
          ? json.glb_url.startsWith('http')
            ? json.glb_url
            : `${GPU_URL.replace(/\/$/, '')}${json.glb_url}`
          : null,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }

  // ---------- Meshy ----------
  if (backend === 'meshy') {
    if (!MESHY_KEY) {
      return new Response(JSON.stringify({ error: 'Meshy not configured' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    const resp = await fetch(`https://api.meshy.ai/openapi/v1/image-to-3d/${id}`, {
      headers: { authorization: `Bearer ${MESHY_KEY}` },
    });
    if (!resp.ok) {
      const text = await resp.text();
      return new Response(
        JSON.stringify({ error: `Meshy ${resp.status}: ${text}` }),
        { status: 502, headers: { 'content-type': 'application/json' } }
      );
    }
    const json = (await resp.json()) as {
      status?: string;
      progress?: number;
      model_urls?: { glb?: string };
    };
    return new Response(
      JSON.stringify({
        status: json.status ?? 'PENDING',
        progress: json.progress ?? 0,
        glbUrl: json.model_urls?.glb ?? null,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }

  return new Response(JSON.stringify({ error: `Unknown backend: ${backend}` }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });
});
