import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  getLiveCommunityBridges,
  type CommunityBridge,
} from '../services/community-exchange.service';
import { EVENT_INTENT_LABELS } from '../services/event-intent.service';

interface Props {
  eventId: string;
  targetId: string;
  active: boolean;
}

/**
 * Shows community context only after the server proves that an active bilateral
 * exchange, two participant opt-ins, target badge visibility, fresh event state,
 * and a real declared-fit domain all intersect for this live target.
 *
 * The component never receives a community roster or connector count.
 */
export default function CommunityBridgeContextCard({ eventId, targetId, active }: Readonly<Props>) {
  const [bridges, setBridges] = useState<CommunityBridge[]>([]);

  useEffect(() => {
    if (!active || !eventId || !targetId) {
      setBridges([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const result = await getLiveCommunityBridges(eventId, [targetId]);
      if (cancelled) return;
      setBridges(result.error ? [] : result.data.filter((bridge) => bridge.target_id === targetId));
    })();
    return () => {
      cancelled = true;
    };
  }, [active, eventId, targetId]);

  const primary = useMemo(
    () => bridges.slice().sort((left, right) => (
      right.domains.length - left.domains.length
      || left.my_community_name.localeCompare(right.my_community_name)
      || left.target_community_name.localeCompare(right.target_community_name)
      || left.exchange_id.localeCompare(right.exchange_id)
    ))[0] ?? null,
    [bridges],
  );

  if (!primary) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>COMMUNITY BRIDGE</Text>
        <Text style={styles.badge}>OPT-IN</Text>
      </View>
      <Text style={styles.title}>
        {primary.my_community_name} ↔ {primary.target_community_name}
      </Text>
      <Text style={styles.detail}>
        Both communities approved this event exchange, both of you opted in, and this person chose to show their community badge. The bridge is relevant here because your explicit event focus overlaps on {primary.domains.map((domain) => EVENT_INTENT_LABELS[domain]).join(', ')}.
      </Text>
      <Text style={styles.boundary}>
        Community affiliation adds context to an already-real fit. It does not reveal either community's member list, relationship graph, or hidden popularity.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 14,
    padding: 13,
    borderRadius: 14,
    backgroundColor: 'rgba(109,40,217,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(196,181,253,0.34)',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  eyebrow: { color: '#C4B5FD', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  badge: { color: '#A78BFA', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  title: { marginTop: 7, color: '#F5F3FF', fontSize: 15, lineHeight: 20, fontWeight: '800' },
  detail: { marginTop: 6, color: '#DDD6FE', fontSize: 11, lineHeight: 16 },
  boundary: { marginTop: 7, color: '#7C7894', fontSize: 9, lineHeight: 14 },
});
