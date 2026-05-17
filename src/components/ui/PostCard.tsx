import React, { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { getPostImageUrl } from '../../services/post.service';
import { palette, radii, spacing } from '../../theme';
import type { FeedPost } from '../../types/database';
import { NeonText } from './NeonText';
import { Pill } from './Pill';
import { PremiumBadge } from './PremiumBadge';
import { Surface } from './Surface';

interface Props {
  post: FeedPost;
  onAuthorPress?: (authorId: string) => void;
  onLikePress?: (postId: string) => void;
  onDeletePress?: (postId: string) => void;
  isOwnPost?: boolean;
}

export function PostCard({
  post,
  onAuthorPress,
  onLikePress,
  onDeletePress,
  isOwnPost,
}: Readonly<Props>) {
  const imageUrl = useMemo(() => getPostImageUrl(post.image_path), [post.image_path]);
  const timeLabel = useMemo(() => relativeTime(post.created_at), [post.created_at]);

  return (
    <Surface elevated padded style={styles.card}>
      <View style={styles.header}>
        <Pressable
          onPress={() => onAuthorPress?.(post.author_id)}
          style={({ pressed }) => [styles.author, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.avatarRing}>
            <NeonText variant="h2" tone="accent" glow style={styles.avatarText}>
              {(post.author_name || '?').slice(0, 1).toUpperCase()}
            </NeonText>
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <NeonText variant="h2" style={{ fontSize: 16 }}>
                {post.author_name || 'Anonymous'}
              </NeonText>
              {post.author_is_premium ? <PremiumBadge size="sm" /> : null}
            </View>
            <View style={styles.metaRow}>
              {post.author_role ? (
                <NeonText variant="label" tone="accent">
                  {post.author_role}
                </NeonText>
              ) : null}
              <NeonText variant="label" tone="dim">
                · {timeLabel}
              </NeonText>
              {post.event_id ? <Pill label="EVENT" tone="neutral" /> : null}
            </View>
          </View>
        </Pressable>
        {isOwnPost && onDeletePress ? (
          <Pressable
            onPress={() => onDeletePress(post.id)}
            style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.6 }]}
            accessibilityLabel="Delete post"
          >
            <NeonText variant="label" tone="muted">···</NeonText>
          </Pressable>
        ) : null}
      </View>

      <NeonText variant="body" style={styles.body}>
        {post.body}
      </NeonText>

      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="cover" />
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={() => onLikePress?.(post.id)}
          style={({ pressed }) => [styles.likeBtn, pressed && { opacity: 0.7 }]}
          hitSlop={8}
        >
          <NeonText
            variant="h2"
            tone={post.viewer_liked ? 'accent' : 'muted'}
            glow={post.viewer_liked}
            style={styles.likeGlyph}
          >
            {post.viewer_liked ? '◆' : '◇'}
          </NeonText>
          <NeonText
            variant="label"
            tone={post.viewer_liked ? 'accent' : 'muted'}
          >
            {post.like_count}
          </NeonText>
        </Pressable>
      </View>
    </Surface>
  );
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.lg, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  author: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  avatarRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 16, lineHeight: 18 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  deleteBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  body: { lineHeight: 22 },
  image: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radii.md,
    backgroundColor: palette.surfaceElevated,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
  },
  likeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  likeGlyph: { fontSize: 18, lineHeight: 22 },
});
