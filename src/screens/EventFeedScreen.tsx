import React, { useCallback } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import type { NavigationProp, RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  ComposeFab,
  GridBackground,
  Loader,
  NeonText,
  Pill,
  PostCard,
  Surface,
} from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useFeed } from '../hooks/useFeed';
import { deletePost } from '../services/post.service';
import { palette, radii, spacing } from '../theme';

type EventFeedParams = { EventFeed: { eventId: string; eventName: string } };

export default function EventFeedScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<EventFeedParams, 'EventFeed'>>();
  const { eventId, eventName } = route.params;
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const feed = useFeed({ kind: 'event', eventId });

  const onAuthorPress = useCallback(
    (authorId: string) => {
      navigation.navigate('Profile', { userId: authorId });
    },
    [navigation]
  );

  const onDelete = useCallback(
    (postId: string) => {
      Alert.alert(
        'Delete post?',
        'This removes it for everyone in this event.',
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
    },
    [feed]
  );

  const openCompose = () =>
    navigation.navigate('Compose', { userId, eventId, eventName });

  const openLobby = () =>
    navigation.navigate('EventLobby', { eventId, eventName });

  const openSpatialField = () =>
    navigation.navigate('SpatialField', { eventId });

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.35} />
      <View style={styles.header}>
        <Pill label="Event channel" tone="accent" dot />
        <NeonText variant="h1" tone="text" glow style={{ marginTop: spacing.sm }}>
          {eventName}
        </NeonText>
        <NeonText variant="bodyMuted" style={{ marginTop: spacing.xs }}>
          Only visible to approved participants.
        </NeonText>
        <View style={styles.presenceRow}>
          <Pressable onPress={openLobby} style={styles.presenceBtn}>
            <NeonText variant="label" tone="accent">LOBBY</NeonText>
          </Pressable>
          <Pressable onPress={openSpatialField} style={styles.presenceBtn}>
            <NeonText variant="label" tone="accent">FIELD</NeonText>
          </Pressable>
        </View>
      </View>

      {feed.loading ? (
        <View style={styles.centered}>
          <Loader size={48} />
          <NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>
            Loading channel
          </NeonText>
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
              onDeletePress={onDelete}
              isOwnPost={item.author_id === userId}
            />
          )}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={feed.refreshing}
              onRefresh={feed.refresh}
              tintColor={palette.accent}
            />
          }
          ListEmptyComponent={
            <Surface elevated padded glow style={styles.emptyCard}>
              <Pill label="Channel quiet" tone="neutral" dot />
              <NeonText variant="h1" style={{ marginTop: spacing.md }}>
                Be the first signal.
              </NeonText>
              <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
                Post something to the room. Approved participants will see it.
              </NeonText>
            </Surface>
          }
        />
      )}
      <View pointerEvents="box-none" style={styles.fabWrap}>
        <ComposeFab onPress={openCompose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.void },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: 2,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: spacing.lg, paddingBottom: 120 },
  emptyCard: { borderRadius: radii.xl, gap: spacing.xs, marginTop: spacing.xxl },
  fabWrap: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xl,
  },
  presenceRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  presenceBtn: {
    borderWidth: 1,
    borderColor: palette.accent,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
