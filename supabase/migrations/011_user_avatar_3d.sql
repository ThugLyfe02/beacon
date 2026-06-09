-- =============================================================================
-- 011_user_avatar_3d.sql
-- Adds Ready Player Me avatar URL to user profile. Public glb URL hosted by RPM.
-- =============================================================================

alter table public.users
  add column if not exists avatar_url_3d text;
