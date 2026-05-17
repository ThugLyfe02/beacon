import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NavigationProp, RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  FollowButton,
  GlowButton,
  GridBackground,
  Loader,
  NeonText,
  Pill,
  PostCard,
  PremiumBadge,
  PremiumDrawer,
  Surface,
} from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useFollow } from '../hooks/useFollow';
import { usePremium } from '../hooks/usePremium';
import { useFeed } from '../hooks/useFeed';
import { getCurrentUser } from '../services/user.service';
import { deletePost } from '../services/post.service';
import { palette, radii, spacing } from '../theme';
import type { UserRow } from '../types/database';

type ProfileParams = { Profile: { userId: string } };

export default function ProfileScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<ProfileParams, 'Profile'>>();
  const { user: authUser } = useAuth();
  const viewerId = authUser?.id ?? null;
  const targetId = route.params?.userId ?? viewerId ?? '';
  const isSelf = !!viewerId && viewerId === targetId;

  const [user, setUser] = useState<UserRow | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const follow = useFollow(viewerId, targetId);
  const premium = usePremium(isSelf ? viewerId : null);
  const feed = useFeed({ kind: 'user', userId: targetId });

  const loadUser = useCallback(async () => {
    setLoadingUser(true);
    const u = await getCurrentUser(targetId);
    setUser(u);
    setLoadingUser(false);
  }, [targetId]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const onAuthorPress = (authorId: string) => {
    if (authorId === targetId) return;
    navigation.navigate('Profile', { userId: authorId });
  };

  const onDeletePost = (postId: string) => {
    Alert.alert(
      'Delete post?',
      'This removes it for everyone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePost(postId);
              feed.removePost(postId);
            } catch {
              Alert.alert('Could not delete', 'Try again.');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <GridBackground intensity={0.35} />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.headerBar}>
          <Pressable
            onPress={() => navigation.canGoBack() && navigation.goBack()}
            hitSlop={12}
            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
          >
            <NeonText variant="label" tone="muted">
              {navigation.canGoBack() ? '← BACK' : 'PROFILE'}
            </NeonText>
          </Pressable>
          {isSelf ? (
            <Pressable onPress={() => setDrawerOpen(true)} hitSlop={12}>
              <NeonText variant="label" tone="accent">PREMIUM</NeonText>
            </Pressable>
          ) : <View style={{ width: 1 }} />}
        </View>

        {loadingUser ? (
          <View style={styles.centered}>
            <Loader size={48} />
          </View>
        ) : (
          <FlatList
            data={feed.posts}
            keyExtractor={(p) => p.id}
            renderItem={({ item }) => (
              <PostCard
                post={item}
                onAuthorPress={onAuthorPress}
                onLikePress={feed.toggleLike}
                onDeletePress={onDeletePost}
                isOwnPost={item.author_id === viewerId}
              />
            )}
            ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={feed.refreshing}
                onRefresh={() => {
                  feed.refresh();
                  follow.refresh();
                  loadUser();
                }}
                tintColor={palette.accent}
              />
            }
            ListHeaderComponent={
              <ProfileHeader
                user={user}
                followCounts={follow.counts}
                followLoading={follow.loading}
                following={follow.following}
                onFollowPress={async () => {
                  try {
                    await follow.toggle();
                  } catch {
                    Alert.alert('Action failed', 'Could not update follow.');
                  }
                }}
                isSelf={isSelf}
                onEdit={() => Alert.alert('Coming soon', 'Profile editing lives in Settings.')}
                postCount={feed.posts.length}
              />
            }
            ListEmptyComponent={
              !loadingUser && !feed.loading ? (
                <Surface elevated padded style={styles.emptyCard}>
                  <NeonText variant="h2" tone="muted">No posts yet.</NeonText>
                  <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
                    {isSelf
                      ? 'Tap the + on the Home feed to transmit your first signal.'
                      : 'This signal hasn’t posted anything yet.'}
                  </NeonText>
                </Surface>
              ) : null
            }
          />
        )}
      </SafeAreaView>

      <PremiumDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        isPremium={premium.isPremium}
        isDiscoverable={premium.isDiscoverable}
        premiumSince={premium.premiumSince}
        onTogglePremiumDev={premium.togglePremiumDev}
        onToggleDiscoverable={premium.setDiscoverable}
      />
    </View>
  );
}

interface HeaderProps {
  user: UserRow | null;
  followCounts: { followers: number; following: number };
  followLoading: boolean;
  following: boolean;
  onFollowPress: () => void;
  isSelf: boolean;
  onEdit: () => void;
  postCount: number;
}

function ProfileHeader({
  user,
  followCounts,
  followLoading,
  following,
  onFollowPress,
  isSelf,
  onEdit,
  postCount,
}: Readonly<HeaderProps>) {
  return (
    <Surface elevated padded style={styles.profileCard}>
      <View style={styles.avatarRow}>
        <View style={styles.avatar}>
          <NeonText variant="display" tone="accent" glow style={styles.avatarText}>
            {(user?.name || '?').slice(0, 1).toUpperCase()}
          </NeonText>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.nameRow}>
            <NeonText variant="h1">{user?.name || 'Anonymous'}</NeonText>
            {user?.is_premium ? <PremiumBadge size="md" /> : null}
          </View>
          {user?.role ? (
            <NeonText variant="label" tone="accent">{user.role}</NeonText>
          ) : null}
        </View>
      </View>

      {user?.one_liner ? (
        <NeonText variant="body" style={{ marginTop: spacing.md, lineHeight: 22 }}>
          {user.one_liner}
        </NeonText>
      ) : null}

      <View style={styles.statRow}>
        <View style={styles.statBlock}>
          <NeonText variant="h1" tone="accent" glow>{postCount}</NeonText>
          <NeonText variant="label" tone="muted">POSTS</NeonText>
        </View>
        <View style={styles.statBlock}>
          <NeonText variant="h1" tone="accent" glow>{followCounts.followers}</NeonText>
          <NeonText variant="label" tone="muted">FOLLOWERS</NeonText>
        </View>
        <View style={styles.statBlock}>
          <NeonText variant="h1" tone="accent" glow>{followCounts.following}</NeonText>
          <NeonText variant="label" tone="muted">FOLLOWING</NeonText>
        </View>
      </View>

      {isSelf ? (
        <GlowButton
          label="Edit profile"
          onPress={onEdit}
          variant="ghost"
          fullWidth
          style={{ marginTop: spacing.md }}
        />
      ) : (
        <FollowButton
          following={following}
          loading={followLoading}
          onPress={onFollowPress}
          fullWidth
          size="md"
        />
      )}

      <View style={styles.divider} />
      <Pill label="POSTS" tone="accent" dot />
    </Surface>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.void },
  headerBar: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: spacing.lg, paddingBottom: 120 },
  profileCard: {
    borderRadius: radii.xl,
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  avatarRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 28, lineHeight: 32 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },
  statBlock: { alignItems: 'center', flex: 1 },
  divider: { height: spacing.sm },
  emptyCard: { borderRadius: radii.lg, marginTop: spacing.md },
});
