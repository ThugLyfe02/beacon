// =============================================================================
// post.service.ts
// Posts + likes for the social feed (migration 007).
// =============================================================================

import { supabase } from '../lib/supabase';
import type { FeedPost, PostRow, Timestamp, UUID } from '../types/database';

const POST_IMAGE_BUCKET = 'post-images';

export async function getHomeFeed(opts: { limit?: number; before?: Timestamp } = {}): Promise<FeedPost[]> {
  const { data, error } = await supabase.rpc('get_home_feed', {
    p_limit: opts.limit ?? 50,
    p_before: opts.before ?? null,
  });
  if (error) {
    console.error('[post.service] getHomeFeed error:', error);
    return [];
  }
  return (data ?? []) as FeedPost[];
}

export async function getEventFeed(
  eventId: UUID,
  opts: { limit?: number; before?: Timestamp } = {}
): Promise<FeedPost[]> {
  const { data, error } = await supabase.rpc('get_event_feed', {
    p_event_id: eventId,
    p_limit: opts.limit ?? 50,
    p_before: opts.before ?? null,
  });
  if (error) {
    console.error('[post.service] getEventFeed error:', error);
    return [];
  }
  return (data ?? []) as FeedPost[];
}

export async function getUserPosts(
  userId: UUID,
  opts: { limit?: number; before?: Timestamp } = {}
): Promise<FeedPost[]> {
  const { data, error } = await supabase.rpc('get_user_posts', {
    p_user_id: userId,
    p_limit: opts.limit ?? 50,
    p_before: opts.before ?? null,
  });
  if (error) {
    console.error('[post.service] getUserPosts error:', error);
    return [];
  }
  return (data ?? []) as FeedPost[];
}

interface CreatePostInput {
  authorId: UUID;
  body: string;
  eventId?: UUID | null;
  imageUri?: string | null;
}

export async function createPost(input: CreatePostInput): Promise<PostRow> {
  let imagePath: string | null = null;

  if (input.imageUri) {
    imagePath = await uploadPostImage(input.authorId, input.imageUri);
  }

  const { data, error } = await supabase
    .from('posts')
    .insert({
      author_id: input.authorId,
      body: input.body,
      event_id: input.eventId ?? null,
      image_path: imagePath,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('[post.service] createPost error:', error);
    throw new Error('Could not create post');
  }
  return data as PostRow;
}

export async function deletePost(postId: UUID): Promise<void> {
  const { error } = await supabase.from('posts').delete().eq('id', postId);
  if (error) {
    console.error('[post.service] deletePost error:', error);
    throw new Error('Could not delete post');
  }
}

export async function togglePostLike(
  postId: UUID
): Promise<{ liked: boolean; like_count: number }> {
  const { data, error } = await supabase.rpc('toggle_post_like', { p_post_id: postId });
  if (error) {
    console.error('[post.service] togglePostLike error:', error);
    throw new Error('Could not update like');
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    liked: !!row?.liked,
    like_count: Number(row?.like_count ?? 0),
  };
}

// ─── Image upload ───────────────────────────────────────────────────────────

async function uploadPostImage(userId: UUID, localUri: string): Promise<string> {
  const ext = guessExtension(localUri);
  const filename = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  // RN file URIs need to be turned into a Blob/ArrayBuffer for Supabase upload.
  const response = await fetch(localUri);
  const blob = await response.blob();

  const { error } = await supabase.storage
    .from(POST_IMAGE_BUCKET)
    .upload(filename, blob, {
      contentType: blob.type || `image/${ext}`,
      upsert: false,
    });
  if (error) {
    console.error('[post.service] image upload error:', error);
    throw new Error('Image upload failed');
  }
  return filename;
}

export function getPostImageUrl(imagePath: string | null): string | null {
  if (!imagePath) return null;
  const { data } = supabase.storage.from(POST_IMAGE_BUCKET).getPublicUrl(imagePath);
  return data.publicUrl;
}

function guessExtension(uri: string): string {
  const match = /\.([a-zA-Z0-9]+)(?:\?|$)/.exec(uri);
  const raw = match?.[1]?.toLowerCase() ?? 'jpg';
  if (raw === 'jpeg' || raw === 'jpg') return 'jpg';
  if (raw === 'png') return 'png';
  if (raw === 'webp') return 'webp';
  if (raw === 'heic') return 'heic';
  return 'jpg';
}
