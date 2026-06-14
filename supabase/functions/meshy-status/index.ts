// =============================================================================
// supabase/functions/meshy-status
// Polls Meshy.ai for an image-to-3D task and returns status + glb URL.
//
// Required secret:  MESHY_API_KEY  (same as meshy-generate)
//
// Request body:
//   { taskId: string }
//
// Response:
//   {
//     status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED',
//     progress: number,         // 0-100
//     glbUrl: string | null     // populated when SUCCEEDED
//   }
// =============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MESHY_BASE = 'https://api.meshy.ai/openapi/v1';

interface Body {
  taskId: string;
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

  const body = (await req.json()) as Body;
  if (!body.taskId) {
    return new Response(JSON.stringify({ error: 'Missing taskId' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const meshyResp = await fetch(`${MESHY_BASE}/image-to-3d/${body.taskId}`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });

  if (!meshyResp.ok) {
    const text = await meshyResp.text();
    return new Response(
      JSON.stringify({ error: `Meshy ${meshyResp.status}: ${text}` }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  const json = (await meshyResp.json()) as {
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
});
