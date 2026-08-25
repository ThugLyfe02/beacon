// =============================================================================
// supabase/functions/venue-sensor-ingest
// Machine-to-machine aggregate telemetry ingress for registered venue sources.
//
// Deploy with custom device authentication enabled:
//   supabase functions deploy venue-sensor-ingest --no-verify-jwt
//
// Device authentication is the unique bcn_... source credential. The function
// never logs or persists that plaintext token; Postgres stores only its digest.
// =============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type SensorKind = 'occupancy' | 'transition' | 'service-point';

interface SensorIngressBody {
  sourceId: string;
  token: string;
  schemaVersion: '1.0';
  layoutVersion: string;
  kind: SensorKind;
  sequence: number;
  observedAt: string;
  confidence: number;
  payload: Record<string, unknown>;
}

function json(status: number, body: Record<string, unknown>, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

function parseBody(value: unknown): SensorIngressBody | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.sourceId !== 'string' || body.sourceId.length < 8) return null;
  if (typeof body.token !== 'string' || body.token.length < 20) return null;
  if (body.schemaVersion !== '1.0') return null;
  if (typeof body.layoutVersion !== 'string' || body.layoutVersion.length === 0 || body.layoutVersion.length > 120) return null;
  if (body.kind !== 'occupancy' && body.kind !== 'transition' && body.kind !== 'service-point') return null;
  if (!Number.isSafeInteger(body.sequence) || (body.sequence as number) < 0) return null;
  if (typeof body.observedAt !== 'string' || !Number.isFinite(Date.parse(body.observedAt))) return null;
  if (typeof body.confidence !== 'number' || !Number.isFinite(body.confidence) || body.confidence < 0 || body.confidence > 1) return null;
  if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) return null;
  return body as unknown as SensorIngressBody;
}

function statusForDatabaseError(message: string): number {
  const normalized = message.toLowerCase();
  if (normalized.includes('rate limit')) return 429;
  if (normalized.includes('credential') || normalized.includes('source is revoked') || normalized.includes('source not found')) return 401;
  if (normalized.includes('replay') || normalized.includes('sequence')) return 409;
  if (
    normalized.includes('layout')
    || normalized.includes('schema')
    || normalized.includes('stale')
    || normalized.includes('future')
    || normalized.includes('payload')
    || normalized.includes('confidence')
    || normalized.includes('operational')
  ) return 422;
  return 400;
}

serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    return json(413, { error: 'payload_too_large' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return json(503, { error: 'ingress_not_configured' });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const body = parseBody(raw);
  if (!body) return json(400, { error: 'invalid_observation_envelope' });

  // The service-role client is confined to this one RPC. Do not use it to read
  // arbitrary application tables based on device-supplied identifiers.
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin
    .rpc('ingest_venue_sensor_observation', {
      p_source_id: body.sourceId,
      p_ingress_token: body.token,
      p_schema_version: body.schemaVersion,
      p_layout_version: body.layoutVersion,
      p_kind: body.kind,
      p_sequence: body.sequence,
      p_observed_at: body.observedAt,
      p_confidence: body.confidence,
      p_payload: body.payload,
    })
    .maybeSingle();

  if (error || !data) {
    // Never echo the database message: it may reveal source existence or policy
    // details useful to credential probing. The status class is enough for an
    // adapter to decide whether to retry, rotate, or inspect configuration.
    const status = statusForDatabaseError(error?.message ?? 'observation rejected');
    return json(status, {
      accepted: false,
      error: status === 429
        ? 'rate_limited'
        : status === 401
          ? 'credential_rejected'
          : status === 409
            ? 'sequence_conflict'
            : status === 422
              ? 'observation_rejected'
              : 'ingress_rejected',
    }, status === 429 ? { 'retry-after': '30' } : {});
  }

  const row = data as {
    observation_id: number;
    received_at: string;
    accepted_sequence: number;
  };

  return json(202, {
    accepted: true,
    observationId: row.observation_id,
    receivedAt: row.received_at,
    sequence: row.accepted_sequence,
  });
});
