import React from 'react';
import { Pressable, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { glow, palette, radii, spacing } from '../theme';

interface EventGatewayScreenProps {
  onJoinEvent: () => void;
  onCreateEvent: () => void;
}

export default function EventGatewayScreen({
  onJoinEvent,
  onCreateEvent,
}: Readonly<EventGatewayScreenProps>) {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <GridBackground />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Pill label="Step 02 · Choose lane" tone="accent" dot />
            <NeonText variant="display" tone="text" glow style={styles.title}>
              Where are you{'\n'}tonight?
            </NeonText>
            <NeonText variant="bodyMuted" style={styles.subtitle}>
              Join the signal in a room, or light your own beacon and pull others in.
            </NeonText>
          </View>

          <View style={styles.options}>
            <GatewayCard
              eyebrow="JOIN"
              glyph="◇"
              title="I have a code"
              description="Drop an access code to enter an active event."
              onPress={onJoinEvent}
            />
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <NeonText variant="label" tone="dim">OR</NeonText>
              <View style={styles.dividerLine} />
            </View>
            <GatewayCard
              eyebrow="HOST"
              glyph="◆"
              title="Light a beacon"
              description="Create an event and let the room discover it."
              onPress={onCreateEvent}
              accent
            />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

function GatewayCard({
  eyebrow,
  glyph,
  title,
  description,
  onPress,
  accent,
}: Readonly<{
  eyebrow: string;
  glyph: string;
  title: string;
  description: string;
  onPress: () => void;
  accent?: boolean;
}>) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [pressed && { transform: [{ scale: 0.98 }] }]}
    >
      <Surface elevated padded glow={accent} style={[styles.card, accent && styles.cardAccent]}>
        <View style={styles.cardHeader}>
          <NeonText variant="label" tone={accent ? 'accent' : 'muted'}>
            {eyebrow}
          </NeonText>
          <NeonText
            variant="display"
            tone="accent"
            glow={accent}
            style={accent ? glow.accentSoft : undefined}
          >
            {glyph}
          </NeonText>
        </View>
        <NeonText variant="h2" tone="text">
          {title}
        </NeonText>
        <NeonText variant="bodyMuted" style={styles.cardDesc}>
          {description}
        </NeonText>
      </Surface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.void },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    gap: spacing.xxl,
  },
  header: { gap: spacing.md },
  title: { lineHeight: 44 },
  subtitle: { lineHeight: 22, marginTop: spacing.xs },
  options: { gap: spacing.lg },
  card: {
    borderRadius: radii.xl,
    gap: spacing.md,
  },
  cardAccent: {
    borderColor: palette.accent,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardDesc: { lineHeight: 20 },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: palette.hairline },
});
