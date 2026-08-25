-- Sensor ingress edge boundary
-- Device tokens are authenticated by the venue-sensor-ingest Edge Function.
-- The lower-level SECURITY DEFINER RPC remains callable only by service_role so
-- unauthenticated clients cannot probe database error detail or bypass the
-- endpoint's bounded response contract.

revoke execute on function public.ingest_venue_sensor_observation(
  uuid,text,text,text,text,bigint,timestamptz,numeric,jsonb
) from anon, authenticated;

grant execute on function public.ingest_venue_sensor_observation(
  uuid,text,text,text,text,bigint,timestamptz,numeric,jsonb
) to service_role;

comment on function public.ingest_venue_sensor_observation(
  uuid,text,text,text,text,bigint,timestamptz,numeric,jsonb
) is
  'Service-role-only aggregate ingestion primitive. External devices use venue-sensor-ingest, which authenticates the unique source credential and returns a bounded error contract.';
