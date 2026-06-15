-- Storage bucket for generated avatar glb files. Replicate's delivery URLs
-- expire ~24h, so the avatar-status edge function mirrors each successful
-- generation into this bucket on first detection of SUCCEEDED. The bucket
-- is public-read because glb URLs land directly in client renderers.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  20 * 1024 * 1024, -- 20 MB safety ceiling; Hunyuan outputs are ~14 MB
  array['model/gltf-binary']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read: anyone (matches `public = true` semantics for direct URL fetches).
drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Write: service role only. Edge functions hold the service key; nobody else
-- should be poisoning the avatar cache.
drop policy if exists "avatars service write" on storage.objects;
create policy "avatars service write"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.role() = 'service_role');

drop policy if exists "avatars service update" on storage.objects;
create policy "avatars service update"
  on storage.objects for update
  using (bucket_id = 'avatars' and auth.role() = 'service_role');
