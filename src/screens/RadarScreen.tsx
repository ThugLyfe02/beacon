import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { getNearbyPremium } from '../services/premium.service';
import {
  GridBackground,
  Loader,
  NeonText,
  Pill,
  PremiumBadge,
  Surface,
} from '../components/ui';
import { glow, palette, radii, spacing } from '../theme';
import type { NearbyPremiumUser } from '../types/database';

type RadarRouteParams = { Radar: { eventId: string } };

const MAX_RANGE_M = 500; // radar outer edge represents 500m

export default function RadarScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RadarRouteParams, 'Radar'>>();
  const eventId = route.params?.eventId;
  const [peers, setPeers] = useState<NearbyPremiumUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<NearbyPremiumUser | null>(null);

  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 3200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    const tick = async () => {
      const result = await getNearbyPremium(eventId);
      if (cancelled) return;
      setPeers(result);
      setLoading(false);
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [eventId]);

  const { width } = Dimensions.get('window');
  const radarSize = Math.min(width - spacing.xl * 2, 380);
  const radius = radarSize / 2;

  const rotate = sweep.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const blips = useMemo(
    () =>
      peers.map((p) => {
        // Polar → cartesian. bearing_deg: 0=N, increases CW. Screen: 0=up, CW.
        const r = Math.min(p.distance_m / MAX_RANGE_M, 1) * (radius - 16);
        const theta = ((p.bearing_deg - 90) * Math.PI) / 180; // shift so 0deg → up
        return {
          peer: p,
          x: r * Math.cos(theta),
          y: r * Math.sin(theta),
        };
      }),
    [peers, radius]
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <GridBackground intensity={0.4} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <View>
            <Pill label="Radar · premium" tone="premium" dot />
            <NeonText variant="display" tone="premium" glow style={styles.title}>
              Scan
            </NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.xs }}>
              {peers.length} premium signal{peers.length === 1 ? '' : 's'} within {MAX_RANGE_M}m
            </NeonText>
          </View>
          <Pressable
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
            accessibilityLabel="Close radar"
          >
            <NeonText variant="h2" tone="muted">✕</NeonText>
          </Pressable>
        </View>

        <View style={styles.radarStage}>
          <View style={[styles.radarOuter, { width: radarSize, height: radarSize, borderRadius: radius }]}>
            {/* concentric range rings */}
            {[0.33, 0.66, 1].map((r) => (
              <View
                key={r}
                style={[
                  styles.ring,
                  {
                    width: radarSize * r,
                    height: radarSize * r,
                    borderRadius: (radarSize * r) / 2,
                    top: (radarSize - radarSize * r) / 2,
                    left: (radarSize - radarSize * r) / 2,
                  },
                ]}
              />
            ))}
            {/* crosshair */}
            <View style={[styles.crosshair, { top: radius - 0.5 }]} />
            <View style={[styles.crosshairV, { left: radius - 0.5 }]} />

            {/* sweep arm — Animated.View matches the radar bounds, so default
                rotation origin (center) IS the radar center */}
            <Animated.View
              style={[
                StyleSheet.absoluteFillObject,
                { transform: [{ rotate }] },
              ]}
              pointerEvents="none"
            >
              <View
                style={[
                  styles.sweepArm,
                  { left: radius - 1, height: radius },
                ]}
              />
              <View
                style={[
                  styles.sweepWedge,
                  {
                    left: radius,
                    width: radius,
                    height: radius,
                  },
                ]}
              />
            </Animated.View>

            {/* center dot (caller) */}
            <View style={[styles.selfDot, { left: radius - 6, top: radius - 6 }]} />

            {/* blips */}
            {blips.map(({ peer, x, y }) => (
              <Pressable
                key={peer.user_id}
                onPress={() => setSelected(peer)}
                style={[
                  styles.blip,
                  {
                    left: radius + x - 9,
                    top: radius + y - 9,
                  },
                ]}
              >
                <View style={styles.blipPulse} />
                <View style={styles.blipCore} />
              </Pressable>
            ))}

            {/* range labels */}
            <NeonText variant="label" tone="dim" style={[styles.rangeLabel, { top: 6 }]}>
              N
            </NeonText>
          </View>
        </View>

        <View style={styles.footer}>{renderFooter(loading, selected, peers.length)}</View>
      </SafeAreaView>
    </View>
  );
}

function renderFooter(
  loading: boolean,
  selected: NearbyPremiumUser | null,
  peerCount: number
) {
  if (loading) {
    return (
      <View style={styles.loadingRow}>
        <Loader size={24} />
        <NeonText variant="label" tone="accent">Sweeping…</NeonText>
      </View>
    );
  }
  if (selected) {
    return (
      <Surface elevated padded glow style={styles.selectedCard}>
        <View style={styles.selectedHeader}>
          <PremiumBadge />
          <NeonText variant="label" tone="dim">
            {Math.round(selected.distance_m)}m · {Math.round(selected.bearing_deg)}°
          </NeonText>
        </View>
        <NeonText variant="h2">{selected.name || 'Premium signal'}</NeonText>
        {selected.role ? (
          <NeonText variant="label" tone="accent">{selected.role}</NeonText>
        ) : null}
        {selected.one_liner ? (
          <NeonText variant="bodyMuted">{selected.one_liner}</NeonText>
        ) : null}
      </Surface>
    );
  }
  return (
    <NeonText variant="bodyMuted" style={{ textAlign: 'center' }}>
      {peerCount === 0
        ? 'No premium signals in range. Stay near the event.'
        : 'Tap a blip to view the signal.'}
    </NeonText>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.void },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: { fontSize: 40, marginTop: spacing.sm, letterSpacing: 2 },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.hairlineStrong,
  },
  radarStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarOuter: {
    borderWidth: 1,
    borderColor: palette.premium,
    backgroundColor: 'rgba(255,210,74,0.04)',
    overflow: 'hidden',
    ...glow.premium,
  },
  ring: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(255,210,74,0.25)',
  },
  crosshair: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,210,74,0.18)',
  },
  crosshairV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255,210,74,0.18)',
  },
  sweepArm: {
    position: 'absolute',
    top: 0,
    width: 2,
    backgroundColor: palette.premium,
    shadowColor: palette.premium,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  sweepWedge: {
    position: 'absolute',
    top: 0,
    backgroundColor: 'rgba(255,210,74,0.10)',
  },
  selfDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: palette.accent,
    borderWidth: 2,
    borderColor: palette.void,
    shadowColor: palette.accent,
    shadowOpacity: 0.9,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  blip: {
    position: 'absolute',
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blipPulse: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: palette.premium,
    opacity: 0.5,
  },
  blipCore: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.premium,
    shadowColor: palette.premium,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  rangeLabel: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: palette.void,
    paddingHorizontal: 6,
    color: palette.premium,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    paddingTop: spacing.md,
    minHeight: 120,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    justifyContent: 'center',
  },
  selectedCard: { borderRadius: radii.xl, gap: spacing.xs },
  selectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
