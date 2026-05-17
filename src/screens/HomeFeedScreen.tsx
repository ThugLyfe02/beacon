import React, { useCallback } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NavigationProp } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import {
  ComposeFab,
  GridBackground,
  Loader,
  NeonText,
  Pill,
  PostCard,
  Surface,
} from '../components/ui';
import { useFeed } from '../hooks/useFeed';
import { deletePost } from '../services/post.service';
import { palette, radii, spacing } from '../theme';

interface Props {
  userId: string;
}

export default function HomeFeedScreen({ userId }: Readonly<Props>) {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const feed = useFeed({ kind: 'home' });

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
    },
    [feed]
  );

  const openCompose = () => navigation.navigate('Compose', { userId });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <GridBackground intensity={0.35} />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Pill label="Home · global feed" tone="accent" dot />
          <NeonText variant="display" tone="text" glow style={styles.title}>
            Signal
          </NeonText>
        </View>

        {feed.loading ? (
          <View style={styles.centered}>
            <Loader size={48} />
            <NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>
              Loading feed
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
                <Pill label="Empty signal" tone="neutral" dot />
                <NeonText variant="h1" style={{ marginTop: spacing.md }}>
                  Nothing in your feed yet.
                </NeonText>
                <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
                  Follow people from Discover or post your first signal.
                </NeonText>
              </Surface>
            }
          />
        )}
      </SafeAreaView>
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
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  title: { fontSize: 36, letterSpacing: 2 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    padding: spacing.lg,
    paddingBottom: 120,
  },
  emptyCard: {
    borderRadius: radii.xl,
    gap: spacing.xs,
    marginTop: spacing.xxl,
  },
  fabWrap: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xl,
  },
});
