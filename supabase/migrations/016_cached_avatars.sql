-- Cache of generated avatars keyed by the sha256 of the input selfie. Same
-- selfie -> same glb URL -> no Replicate spend on re-runs. Edge functions
-- write through the service role; the table is read-only to the rest of the
-- world so a user can't poison another user's cache entry.

create table if not exists public.cached_avatars (
  image_sha256 text primary key,
  glb_url text not null,
  created_at timestamptz not null default now()
);

alter table public.cached_avatars enable row level security;

create policy "cached_avatars read" on public.cached_avatars
  for select using (true);
