import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import {
  getEventCommunityExchanges,
  getEventCommunityPartnerships,
  getMyEventCommunityAffiliations,
  type CommunityAffiliation,
  type CommunityEventPartnership,
  type CommunityExchange,
} from '../services/community-exchange.service';

interface Props {
  eventId: string;
}

const REFRESH_MS = 45_000;

export default function CommunityExchangePreview({ eventId }: Readonly<Props>) {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const [partnerships, setPartnerships] = useState<CommunityEventPartnership[]>([]);
  const [affiliations, setAffiliations] = useState<CommunityAffiliation[]>([]);
  const [exchanges, setExchanges] = useState<CommunityExchange[]>([]);

  const refresh = useCallback(async () => {
    const [partnerResult, affiliationResult, exchangeResult] = await Promise.all([
      getEventCommunityPartnerships(eventId),
      getMyEventCommunityAffiliations(eventId),
      getEventCommunityExchanges(eventId),
    ]);
    if (!partnerResult.error) setPartnerships(partnerResult.data.filter((item) => item.state === 'active'));
    if (!affiliationResult.error) setAffiliations(affiliationResult.data);
    if (!exchangeResult.error) setExchanges(exchangeResult.data.filter((item) => item.state === 'active'));
  }, [eventId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const exchangeEnabledCount = affiliations.filter((item) => item.exchange_enabled).length;
  const activePartnerNames = useMemo(() => partnerships.slice(0, 3).map((item) => item.community_name), [partnerships]);

  if (partnerships.length === 0 && affiliations.length === 0 && exchanges.length === 0) return null;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => navigation.navigate('CommunityExchange', { eventId })}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>COMMUNITY EXCHANGE</Text>
          <Text style={styles.title}>
            {affiliations.length > 0
              ? `${affiliations.length} verified community ${affiliations.length === 1 ? 'affiliation' : 'affiliations'} in this event`
              : `${partnerships.length} partner ${partnerships.length === 1 ? 'community' : 'communities'} are active here`}
          </Text>
        </View>
        <Text style={styles.arrow}>→</Text>
      </View>

      <Text style={styles.detail}>
        {exchangeEnabledCount > 0
          ? `${exchangeEnabledCount} of your affiliations can participate in bilateral community exchange. Beacon only shows a peer’s community badge when they chose to show it and a real declared-fit domain crosses an approved community bridge.`
          : activePartnerNames.length > 0
            ? `Active partners include ${activePartnerNames.join(', ')}${partnerships.length > activePartnerNames.length ? ' and others' : ''}. Verify an affiliation with a partner-issued event code if one applies to you.`
            : 'Manage your event-scoped community affiliation and exchange preferences.'}
      </Text>

      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{partnerships.length}</Text>
          <Text style={styles.metricLabel}>partners</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{exchanges.length}</Text>
          <Text style={styles.metricLabel}>active exchanges</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{affiliations.length}</Text>
          <Text style={styles.metricLabel}>your affiliations</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    borderRadius: 22,
    padding: 17,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.28)',
  },
  pressed: { opacity: 0.78 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  eyebrow: { color: '#C4B5FD', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  title: { marginTop: 5, color: '#F5F3FF', fontSize: 17, lineHeight: 22, fontWeight: '800' },
  arrow: { color: '#C4B5FD', fontSize: 24, lineHeight: 26 },
  detail: { marginTop: 8, color: '#A8AFC0', fontSize: 11, lineHeight: 17 },
  metrics: { marginTop: 13, flexDirection: 'row', gap: 8 },
  metric: { flex: 1, borderRadius: 13, backgroundColor: 'rgba(76,29,149,0.16)', padding: 10 },
  metricValue: { color: '#F5F3FF', fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  metricLabel: { marginTop: 2, color: '#8B93A7', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 },
});
