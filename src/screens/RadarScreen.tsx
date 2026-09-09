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
import { getEventById } from '../services/event.service';
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

const MAX_RANGE_M = 500;

interface RadarLifecycle {
  endsAt: string | null;
  finalizedAt: string | null;
}

export default function RadarScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RadarRouteParams, 'Radar'>>();
  const eventId = route.params?.eventId;
  const [peers, setPeers] = useState<NearbyPremiumUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<NearbyPremiumUser | null>(null);
  const [lifecycle, setLifecycle] = useState<RadarLifecycle | null>(null);
  const [lifecycleNow, setLifecycleNow] = useState(Date.now());

  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;

    const refreshLifecycle = async () => {
      const event = await getEventById(eventId);
      if (cancelled) return;
      setLifecycle(event ? {
        endsAt: event.ends_at,
        finalizedAt: event.finalized_at,
      } : null);
      setLifecycleNow(Date.now());
    };

    refreshLifecycle();
    const timer = setInterval(refreshLifecycle, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [eventId]);

  useEffect(() => {
    const timer = setInterval(() => setLifecycleNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const sealed = useMemo(() => {
    if (lifecycle?.finalizedAt) return true;
    if (!lifecycle?.endsAt) return false;
    const endsAt = Date.parse(lifecycle.endsAt);
    return Number.isFinite(endsAt) && endsAt <= lifecycleNow;
  }, [lifecycle, lifecycleNow]);

  useEffect(() => {
    if (sealed) {
      sweep.stopAnimation();
      sweep.setValue(0);
      return;
    }

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
  }, [sealed, sweep]);

  useEffect(() => {
    if (!eventId) return;
    if (sealed) {
      setPeers([]);
      setSelected(null);
      setLoading(false);
      return;
    }

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
  }, [eventId, sealed]);

  const { width } = Dimensions.get('window');
  const radarSize = Math.min(width - spacing.xl * 2, 380);
  const radius = radarSize / 2;

  const rotate = sweep.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const blips = useMemo(
    () =>
      peers.map((peer) => {
        const r = Math.min(peer.distance_m / MAX_RANGE_M, 1) * (radius - 16);
        const theta = ((peer.bearing_deg - 90) * Math.PI) / 180;
        return {
          peer,
          x: r * Math.cos(theta),
          y: r * Math.sin(theta),
        };
      }),
    [peers, radius]
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <GridBackground intensity={sealed ? 0.18 : 0.4} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <View>
            <Pill label={sealed ? 'Radar · sealed' : 'Radar · premium'} tone={sealed ? 'neutral' : 'premium'} dot />
            <NeonText variant="display" tone={sealed ? 'text' : 'premium'} glow={!sealed} style={styles.title}>
              {sealed ? 'Afterglow' : 'Scan'}
            </NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.xs }}>
              {sealed
                ? 'Live proximity is closed. Verified event history remains preserved.'
                : `${peers.length} premium signal${peers.length === 1 ? '' : 's'} within ${MAX_RANGE_M}m`}
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

        <View style={[styles.radarStage, sealed && styles.radarStageSealed]}>
          <View style={[styles.radarOuter, { width: radarSize, height: radarSize, borderRadius: radius }]}>
            {[0.33, 0.66, 1].map((ringScale) => (
              <View
                key={ringScale}
                style={[
                  styles.ring,
                  sealed && styles.ringSealed,
                  {
                    width: radarSize * ringScale,
                    height: radarSize * ringScale,
                    borderRadius: (radarSize * ringScale) / 2,
                    top: (radarSize - radarSize * ringScale) / 2,
                    left: (radarSize - radarSize * ringScale) / 2,
                  },
                ]}
              />
            ))}
            <View style={[styles.crosshair, sealed && styles.crosshairSealed, { top: radius - 0.5 }]} />
            <View style={[styles.crosshairV, sealed && styles.crosshairSealed, { left: radius - 0.5 }]} />

            {!sealed ? (
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
            ) : null}

            <View style={[styles.selfDot, sealed && styles.selfDotSealed, { left: radius - 6, top: radius - 6 }]} />

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

            <NeonText variant="label" tone="dim" style={[styles.rangeLabel, { top: 6 }]}>
              N
            </NeonText>
          </View>
        </View>

        <View style={styles.footer}>{renderFooter(loading, selected, peers.length, sealed)}</View>
      </SafeAreaView>
    </View>
  );
}

function renderFooter(
  loading: boolean,
  selected: NearbyPremiumUser | null,
  peerCount: number,
  sealed: boolean,
) {
  if (sealed) {
    return (
      <Surface elevated padded style={styles.selectedCard}>
        <Pill label="LIVE WINDOW SEALED" tone="neutral" dot />
        <NeonText variant="h2" style={{ marginTop: spacing.sm }}>No more proximity reveals.</NeonText>
        <NeonText variant="bodyMuted" style={{ marginTop: spacing.xs }}>
          Radar motion stopped at the same lifecycle boundary enforced by the database. Mutuals, Vault and outcome evidence remain available through their post-event surfaces.
        </NeonText>
      </Surface>
    );
  }
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
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  title: { marginTop: spacing.xs },
  closeBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairlineStrong,
  },
  radarStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarStageSealed: { opacity: 0.58 },
  radarOuter: {
    borderWidth: 1,
    borderColor: palette.premium,
    backgroundColor: 'rgba(255,210,74,0.025)',
    overflow: 'hidden',
    ...glow.premium,
  },
  ring: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(255,210,74,0.22)',
  },
  ringSealed: { borderColor: palette.hairlineStrong },
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
  crosshairSealed: { backgroundColor: palette.hairlineStrong },
  sweepArm: {
    position: 'absolute',
    top: 0,
    width: 2,
    backgroundColor: palette.premium,
    opacity: 0.75,
  },
  sweepWedge: {
    position: 'absolute',
    top: 0,
    backgroundColor: 'rgba(255,210,74,0.035)',
  },
  selfDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: palette.accent,
    ...glow.accent,
  },
  selfDotSealed: { backgroundColor: palette.textMuted },
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
    backgroundColor: palette.premiumSoft,
    borderWidth: 1,
    borderColor: palette.premium,
  },
  blipCore: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: palette.premium,
    ...glow.premium,
  },
  rangeLabel: {
    position: 'absolute',
    alignSelf: 'center',
    left: 0,
    right: 0,
    textAlign: 'center',
  },
  footer: {
    minHeight: 130,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    justifyContent: 'center',
  },
  loadingRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedCard: {
    borderRadius: radii.xl,
    gap: spacing.xs,
  },
  selectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
});