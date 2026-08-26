import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import {
  EVENT_INTENT_KEYS,
  EVENT_INTENT_LABELS,
  type EventIntentKey,
} from '../services/event-intent.service';
import {
  getWarmIntroductionAvailability,
  requestWarmIntroduction,
  type WarmIntroductionAvailability,
} from '../services/warm-introduction.service';

interface Props {
  eventId: string;
  targetId: string;
  domains: string[];
}

function allowedDomain(value: string): value is EventIntentKey {
  return (EVENT_INTENT_KEYS as readonly string[]).includes(value);
}

function unavailableCopy(reason: WarmIntroductionAvailability['reason']): string | null {
  if (reason === 'already-requested') return 'An introduction request is already active for this person.';
  if (reason === 'request-limit') return 'Your active introduction queue is full for this event.';
  if (reason === 'no-opted-in-connector') return 'No opted-in mutual connector is available right now.';
  return null;
}

/**
 * Live selected-person action for a privacy-preserving warm introduction. The
 * server—not the client—selects one opted-in connector with verified mutual
 * edges to both sides. No connector list or graph-degree score is exposed.
 */
export default function WarmIntroductionRequestCard({
  eventId,
  targetId,
  domains,
}: Readonly<Props>) {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();

  // AvatarActionSheet derives this array from live signal metadata and may create
  // a new array instance during an otherwise equivalent render. Use a canonical
  // primitive key so that equivalent evidence does not restart the availability
  // request and create a polling storm while the sheet is open.
  const domainKey = [...new Set(domains.filter(allowedDomain))].sort().join('|');
  const localDomains = useMemo<EventIntentKey[]>(
    () => domainKey.length > 0 ? domainKey.split('|').filter(allowedDomain) : [],
    [domainKey],
  );

  const [availability, setAvailability] = useState<WarmIntroductionAvailability | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<EventIntentKey | null>(localDomains[0] ?? null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setAvailability(null);
    setRequested(false);
    setError(null);
    getWarmIntroductionAvailability({ eventId, targetId })
      .then((result) => {
        if (cancelled) return;
        if (result.error) {
          setError('Warm introduction availability could not be checked.');
          return;
        }
        setAvailability(result.data);
        const eligible = result.data?.eligible_domains ?? [];
        setSelectedDomain((current) => (
          current && eligible.includes(current)
            ? current
            : eligible[0] ?? localDomains[0] ?? null
        ));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, localDomains, targetId]);

  const eligibleDomains = useMemo(() => {
    const serverDomains = availability?.eligible_domains ?? [];
    return serverDomains.filter((domain) => localDomains.includes(domain));
  }, [availability?.eligible_domains, localDomains]);

  const request = async () => {
    if (!selectedDomain) return;
    setRequesting(true);
    setError(null);
    const result = await requestWarmIntroduction({
      eventId,
      targetId,
      intentKey: selectedDomain,
    });
    if (result.error || !result.data) {
      setError(result.error?.message ?? 'The introduction request was not created.');
    } else {
      setRequested(true);
      setAvailability({
        available: false,
        reason: 'already-requested',
        eligible_domains: availability?.eligible_domains ?? [selectedDomain],
      });
    }
    setRequesting(false);
  };

  if (loading) {
    return (
      <View style={styles.loadingCard}>
        <ActivityIndicator color="#FBBF24" size="small" />
        <Text style={styles.loadingText}>Checking for an opted-in mutual connector…</Text>
      </View>
    );
  }

  if (requested || availability?.reason === 'already-requested') {
    return (
      <View style={styles.card}>
        <Text style={styles.eyebrow}>WARM INTRODUCTION</Text>
        <Text style={styles.title}>One connector has the request.</Text>
        <Text style={styles.body}>
          Their identity stays private unless they accept. If they do, the target still controls whether the introduction opens.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('IntroductionInbox', { eventId })}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>Open introduction inbox</Text>
        </Pressable>
      </View>
    );
  }

  if (!availability?.available) {
    const copy = availability ? unavailableCopy(availability.reason) : error;
    if (!copy) return null;
    return (
      <View style={styles.unavailableCard}>
        <Text style={styles.unavailableEyebrow}>WARM INTRODUCTION</Text>
        <Text style={styles.unavailableText}>{copy}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>WARM INTRODUCTION</Text>
      <Text style={styles.title}>A verified mutual can open this conversation.</Text>
      <Text style={styles.body}>
        Beacon found one opted-in participant who already has a real mutual with both of you. You will not see who it is unless they accept this specific request.
      </Text>

      {eligibleDomains.length > 1 ? (
        <View style={styles.domainRow}>
          {eligibleDomains.map((domain) => (
            <Pressable
              key={domain}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedDomain === domain }}
              disabled={requesting}
              onPress={() => setSelectedDomain(domain)}
              style={[styles.domainChip, selectedDomain === domain && styles.domainChipActive]}
            >
              <Text style={[styles.domainText, selectedDomain === domain && styles.domainTextActive]}>
                {EVENT_INTENT_LABELS[domain]}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : selectedDomain ? (
        <Text style={styles.reasonLine}>Reason: {EVENT_INTENT_LABELS[selectedDomain]}</Text>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        accessibilityRole="button"
        disabled={requesting || !selectedDomain}
        onPress={request}
        style={[styles.primaryButton, (requesting || !selectedDomain) && styles.disabled]}
      >
        {requesting ? (
          <ActivityIndicator color="#111827" />
        ) : (
          <Text style={styles.primaryButtonText}>Ask for a warm introduction</Text>
        )}
      </Pressable>

      <Text style={styles.boundary}>
        No connection is created automatically. The connector and target each make an independent decision, and every participant can still block or decline.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingCard: {
    marginTop: 14,
    padding: 12,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(245,158,11,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.16)',
  },
  loadingText: { flex: 1, color: '#94A3B8', fontSize: 10, lineHeight: 15 },
  card: {
    marginTop: 14,
    padding: 14,
    borderRadius: 15,
    backgroundColor: 'rgba(120,53,15,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.36)',
  },
  eyebrow: { color: '#FBBF24', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  title: { marginTop: 7, color: '#FFFBEB', fontSize: 15, lineHeight: 20, fontWeight: '800' },
  body: { marginTop: 6, color: '#D6C7A1', fontSize: 10, lineHeight: 16 },
  reasonLine: { marginTop: 10, color: '#FDE68A', fontSize: 10, fontWeight: '800' },
  domainRow: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  domainChip: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.24)',
    backgroundColor: 'rgba(15,23,42,0.42)',
  },
  domainChipActive: { borderColor: '#FBBF24', backgroundColor: 'rgba(245,158,11,0.14)' },
  domainText: { color: '#94A3B8', fontSize: 9, fontWeight: '800' },
  domainTextActive: { color: '#FDE68A' },
  primaryButton: {
    marginTop: 12,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: '#FBBF24',
  },
  primaryButtonText: { color: '#111827', fontSize: 12, fontWeight: '900' },
  secondaryButton: {
    marginTop: 12,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#FBBF24',
    backgroundColor: 'rgba(245,158,11,0.08)',
  },
  secondaryButtonText: { color: '#FDE68A', fontSize: 11, fontWeight: '900' },
  boundary: { marginTop: 9, color: '#8B7B5E', fontSize: 9, lineHeight: 14 },
  error: { marginTop: 8, color: '#FCA5A5', fontSize: 10, lineHeight: 15 },
  disabled: { opacity: 0.42 },
  unavailableCard: {
    marginTop: 14,
    padding: 12,
    borderRadius: 13,
    backgroundColor: 'rgba(100,116,139,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.14)',
  },
  unavailableEyebrow: { color: '#A3A3A3', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  unavailableText: { marginTop: 5, color: '#94A3B8', fontSize: 10, lineHeight: 15 },
});
