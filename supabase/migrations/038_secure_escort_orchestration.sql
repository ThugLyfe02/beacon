-- =============================================================================
-- 038_secure_escort_orchestration.sql
-- Reserve the security-control-plane action used by physical escort orchestration.
--
-- IMPORTANT: PostgreSQL enum values added with ALTER TYPE are not safely usable
-- by subsequent statements in the same migration transaction. The actual escort RPCs therefore live in migration 039, after this enum value has committed.
-- =============================================================================

alter type public.security_action_kind
  add value if not exists 'escort_assignment';
