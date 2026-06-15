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
const REPLICATE_TOKEN = Deno.env.get('REPLICATE_API_TOKEN');
const STORAGE_BUCKET = 'avatars';

// Downloads the Replicate-hosted glb and re-uploads to the avatars storage
// bucket. Returns the public storage URL on success, null on any failure
// (caller falls back to the Replicate URL — better a 24h URL than no URL).
async function mirrorToStorage(
  admin: ReturnType<typeof createClient>,
  sourceUrl: string,
  imageSha: string,
): Promise<string | null> {
  try {
    const path = `${imageSha}.glb`;
    const head = await admin.storage.from(STORAGE_BUCKET).list('', {
      search: path,
    });
    // Already mirrored — return the existing public URL without re-uploading.
    if (head.data?.some((f) => f.name === path)) {
      const { data } = admin.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      return data.publicUrl;
    }
    const resp = await fetch(sourceUrl);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const { error } = await admin.storage
      .from(STORAGE_BUCKET)
      .upload(path, blob, {
        contentType: 'model/gltf-binary',
        upsert: true,
      });
    if (error) {
      console.error('[avatar-status] storage upload failed', error);
      return null;
    }
    const { data } = admin.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  } catch (e) {
    console.error('[avatar-status] mirror error', e);
    return null;
  }
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

  const parts = body.taskId.includes(':')
    ? body.taskId.split(':')
    : ['meshy', body.taskId];
  const backend = parts[0];
  const id = parts[1];
  // `replicate:<predictionId>:<sha>` — sha is used to update cached_avatars
  // when the prediction finishes successfully.
  const imageSha = parts[2] ?? null;

  // ---------- Cache hit — selfie already turned into a glb. ----------
  if (backend === 'cached') {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!serviceKey) {
      return new Response(JSON.stringify({ error: 'Cache lookup requires service key' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
    const { data: row } = await admin
      .from('cached_avatars')
      .select('glb_url')
      .eq('image_sha256', id)
      .maybeSingle();
    if (!row?.glb_url) {
      return new Response(JSON.stringify({ error: 'Cache entry missing' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({ status: 'SUCCEEDED', progress: 100, glbUrl: row.glb_url }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }

  // ---------- Replicate (Hunyuan-3D-3.1) ----------
  if (backend === 'replicate') {
    if (!REPLICATE_TOKEN) {
      return new Response(JSON.stringify({ error: 'Replicate not configured' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    const resp = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { authorization: `Token ${REPLICATE_TOKEN}` },
    });
    if (!resp.ok) {
      const text = await resp.text();
      return new Response(
        JSON.stringify({ error: `Replicate ${resp.status}: ${text}` }),
        { status: 502, headers: { 'content-type': 'application/json' } }
      );
    }
    const json = (await resp.json()) as {
      status?: string;
      output?: string | null;
      error?: string | null;
    };
    // Map Replicate status -> client status.
    const map: Record<string, string> = {
      starting: 'PENDING',
      processing: 'IN_PROGRESS',
      succeeded: 'SUCCEEDED',
      failed: 'FAILED',
      canceled: 'CANCELED',
    };
    const status = map[json.status ?? 'starting'] ?? 'PENDING';

    // First time we observe SUCCEEDED, mirror the Replicate glb into Supabase
    // storage and cache the resulting permanent URL. Replicate delivery URLs
    // expire ~24h, so without this every avatar would 404 the next day.
    let glbUrl: string | null = json.output ?? null;
    if (status === 'SUCCEEDED' && json.output && imageSha) {
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (serviceKey) {
        const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
        const mirrored = await mirrorToStorage(admin, json.output, imageSha);
        glbUrl = mirrored ?? json.output;
        await admin
          .from('cached_avatars')
          .upsert(
            { image_sha256: imageSha, glb_url: glbUrl },
            { onConflict: 'image_sha256' }
          );
      }
    }

    return new Response(
      JSON.stringify({
        status,
        // Replicate gives no progress %; show 50% while processing as a best guess.
        progress: status === 'SUCCEEDED' ? 100 : status === 'IN_PROGRESS' ? 50 : 10,
        glbUrl,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }

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
