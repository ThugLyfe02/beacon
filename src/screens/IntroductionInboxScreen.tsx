import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type NavigationProp,
  type RouteProp,
} from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { sendConnectionRequest } from '../services/match.service';
import { EVENT_INTENT_LABELS } from '../services/event-intent.service';
import {
  cancelWarmIntroduction,
  listMyWarmIntroductions,
  respondToWarmIntroduction,
  type WarmIntroductionInboxItem,
  type WarmIntroductionStatus,
} from '../services/warm-introduction.service';
import { GridBackground, Loader, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type Params = { IntroductionInbox: { eventId: string } };
type PillTone = 'success' | 'warning' | 'premium' | 'neutral' | 'danger' | 'accent';
type LoadMode = 'initial' | 'refresh' | 'quiet';

function statusTone(status: WarmIntroductionStatus): PillTone {
  if (status === 'accepted') return 'premium';
  if (status === 'matched') return 'success';
  if (status === 'connector-pending' || status === 'target-pending') return 'warning';
  if (status === 'declined' || status === 'cancelled' || status === 'expired') return 'neutral';
  return 'neutral';
}

function statusLabel(status: WarmIntroductionStatus): string {
  if (status === 'connector-pending') return 'CONNECTOR DECIDING';
  if (status === 'target-pending') return 'TARGET DECIDING';
  if (status === 'accepted') return 'INTRODUCTION OPEN';
  if (status === 'matched') return 'MUTUAL CREATED';
  if (status === 'declined') return 'NOT OPENED';
  if (status === 'cancelled') return 'CANCELLED';
  return 'EXPIRED';
}

function name(value: string | null, fallback: string): string {
  return value?.trim() || fallback;
}

function cardCopy(item: WarmIntroductionInboxItem): {
  eyebrow: string;
  title: string;
  body: string;
} {
  const requester = name(item.requester_name, 'The requester');
  const target = name(item.target_name, 'The target participant');
  const connector = name(item.connector_name, 'A verified mutual connector');
  const domain = EVENT_INTENT_LABELS[item.intent_key];

  if (item.participant_role === 'connector') {
    if (item.request_status === 'connector-pending') {
      return {
        eyebrow: 'YOUR DECISION',
        title: `Can you introduce ${requester} to ${target}?`,
        body: `You already have a verified mutual with both people. The requester and target also share an explicit ${domain} fit. Accepting reveals your role to them and gives the target the final decision.`,
      };
    }
    if (item.request_status === 'target-pending') {
      return {
        eyebrow: 'TARGET DECIDING',
        title: `You agreed to connect ${requester} and ${target}.`,
        body: `The target now controls whether the ${domain} introduction opens. Beacon will not create a connection automatically.`,
      };
    }
    if (item.request_status === 'accepted') {
      return {
        eyebrow: 'INTRODUCTION OPEN',
        title: `${requester} and ${target} both accepted the bridge.`,
        body: `Your role is complete. They now control whether the ${domain} introduction becomes a connection, Office Hours request, or no further action.`,
      };
    }
    if (item.request_status === 'matched') {
      return {
        eyebrow: 'MUTUAL CREATED',
        title: `${requester} and ${target} became a verified mutual.`,
        body: 'Beacon records the introduction outcome without turning you into a public connector score or leaderboard.',
      };
    }
  }

  if (item.participant_role === 'target') {
    if (item.request_status === 'target-pending') {
      return {
        eyebrow: 'YOUR DECISION',
        title: `${connector} is willing to introduce you to ${requester}.`,
        body: `${requester} selected a warm introduction around ${domain}. The connector already has a verified mutual with both of you. You still decide whether anything opens.`,
      };
    }
    if (item.request_status === 'accepted') {
      return {
        eyebrow: 'INTRODUCTION OPEN',
        title: `${connector} opened a warm introduction with ${requester}.`,
        body: `You accepted a ${domain} introduction. A normal Beacon connection still requires an explicit signal; this bridge does not exchange identity or schedule time by itself.`,
      };
    }
    if (item.request_status === 'matched') {
      return {
        eyebrow: 'MUTUAL CREATED',
        title: `You and ${requester} became a verified mutual.`,
        body: `${connector} provided the trusted bridge. The connection can now move through Beacon's ordinary mutual and outcome flows.`,
      };
    }
  }

  if (item.participant_role === 'requester') {
    if (item.request_status === 'connector-pending') {
      return {
        eyebrow: 'CONNECTOR DECIDING',
        title: `One opted-in mutual connector has your request for ${target}.`,
        body: `Their identity stays private until they accept. The request is bounded to your explicit ${domain} fit and cannot become an automatic connection.`,
      };
    }
    if (item.request_status === 'target-pending') {
      return {
        eyebrow: 'TARGET DECIDING',
        title: `${connector} agreed to introduce you to ${target}.`,
        body: `${target} now controls whether the ${domain} introduction opens. No additional request is sent until they choose.`,
      };
    }
    if (item.request_status === 'accepted') {
      return {
        eyebrow: 'INTRODUCTION OPEN',
        title: `${connector} opened a warm introduction with ${target}.`,
        body: `The three-party consent path is complete. You and ${target} can now choose a normal connection signal or Office Hours request.`,
      };
    }
    if (item.request_status === 'matched') {
      return {
        eyebrow: 'MUTUAL CREATED',
        title: `You and ${target} became a verified mutual.`,
        body: `${connector} provided the trusted bridge. The introduction is now preserved as a measured event outcome, not a public social score.`,
      };
    }
  }

  return {
    eyebrow: 'INTRODUCTION CLOSED',
    title: `The ${domain} introduction did not open.`,
    body: 'Beacon does not reveal private decline reasons or pressure anyone to reconsider. You can continue using the event normally.',
  };
}

function counterpartId(item: WarmIntroductionInboxItem): string | null {
  if (item.participant_role === 'requester') return item.target_id;
  if (item.participant_role === 'target') return item.requester_id;
  return null;
}

export default function IntroductionInboxScreen() {
  const route = useRoute<RouteProp<Params, 'IntroductionInbox'>>();
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const { eventId } = route.params;
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const [items, setItems] = useState<WarmIntroductionInboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (mode: LoadMode = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);

    const result = await listMyWarmIntroductions(eventId);
    if (result.error) {
      setError(result.error.message);
    } else {
      setError(null);
      setItems(result.data);
    }

    if (mode === 'initial') setLoading(false);
    if (mode === 'refresh') setRefreshing(false);
  }, [eventId]);

  useFocusEffect(useCallback(() => {
    load('initial');
    // Quiet reconciliation keeps role/state transitions current without showing
    // a pull-to-refresh spinner every thirty seconds.
    const timer = setInterval(() => load('quiet'), 30_000);
    return () => clearInterval(timer);
  }, [load]));

  const grouped = useMemo(() => {
    const decision = items.filter((item) => item.can_accept);
    const open = items.filter((item) => item.request_status === 'accepted');
    const waiting = items.filter((item) => (
      !item.can_accept
      && (item.request_status === 'connector-pending' || item.request_status === 'target-pending')
    ));
    const history = items.filter((item) => (
      item.request_status === 'matched'
      || item.request_status === 'declined'
      || item.request_status === 'cancelled'
      || item.request_status === 'expired'
    ));
    return { decision, open, waiting, history };
  }, [items]);

  const respond = useCallback(async (item: WarmIntroductionInboxItem, accept: boolean) => {
    setWorkingId(item.request_id);
    const result = await respondToWarmIntroduction(item.request_id, accept);
    if (result.error || !result.data) {
      Alert.alert('Could not update introduction', result.error?.message ?? 'Try again after refreshing.');
    } else {
      if (accept) {
        Alert.alert(
          item.participant_role === 'connector' ? 'Connector consent recorded' : 'Introduction accepted',
          item.participant_role === 'connector'
            ? 'The target now controls whether the introduction opens.'
            : 'The introduction is open. No connection was created automatically.',
        );
      }
      await load('quiet');
    }
    setWorkingId(null);
  }, [load]);

  const cancel = useCallback(async (item: WarmIntroductionInboxItem) => {
    setWorkingId(item.request_id);
    const result = await cancelWarmIntroduction(item.request_id);
    if (result.error || !result.changed) {
      Alert.alert('Could not cancel', result.error?.message ?? 'The request may have already changed state.');
    } else {
      await load('quiet');
    }
    setWorkingId(null);
  }, [load]);

  const sendSignal = useCallback(async (item: WarmIntroductionInboxItem) => {
    const recipientId = counterpartId(item);
    if (!recipientId || !userId || item.request_status !== 'accepted') return;
    setWorkingId(item.request_id);
    const result = await sendConnectionRequest(item.event_id, userId, recipientId);
    if (result.error) {
      Alert.alert('Connection signal not sent', result.error.message);
    } else if (result.match) {
      Alert.alert('Mutual created', 'Both sides independently chose the connection.');
    } else {
      Alert.alert('Connection signal sent', 'The other participant still controls whether this becomes a mutual.');
    }
    await load('quiet');
    setWorkingId(null);
  }, [load, userId]);

  const openOfficeHours = useCallback((item: WarmIntroductionInboxItem) => {
    const recipientId = counterpartId(item);
    if (!recipientId || item.request_status !== 'accepted') return;
    navigation.navigate('OfficeHoursRequest', {
      eventId: item.event_id,
      recipientId,
    });
  }, [navigation]);

  const renderCard = (item: WarmIntroductionInboxItem) => {
    const copy = cardCopy(item);
    const busy = workingId === item.request_id;
    const otherId = counterpartId(item);
    return (
      <Surface key={item.request_id} elevated padded style={styles.card}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <NeonText variant="label" tone="premium">{copy.eyebrow}</NeonText>
            <NeonText variant="h2" style={styles.smallTop}>{copy.title}</NeonText>
          </View>
          <Pill label={statusLabel(item.request_status)} tone={statusTone(item.request_status)} />
        </View>

        <NeonText variant="bodyMuted" style={styles.bodyCopy}>{copy.body}</NeonText>

        <View style={styles.evidenceRow}>
          <View style={styles.evidenceCell}>
            <NeonText variant="label" tone="muted">DECLARED REASON</NeonText>
            <NeonText variant="body" style={styles.smallTop}>{EVENT_INTENT_LABELS[item.intent_key]}</NeonText>
          </View>
          <View style={styles.evidenceCell}>
            <NeonText variant="label" tone="muted">YOUR ROLE</NeonText>
            <NeonText variant="body" style={styles.smallTop}>
              {item.participant_role === 'connector' ? 'Connector' : item.participant_role === 'target' ? 'Target' : 'Requester'}
            </NeonText>
          </View>
        </View>

        {item.connector_name && item.participant_role !== 'connector' ? (
          <NeonText variant="bodyMuted" style={styles.connectorCopy}>
            Connector: {item.connector_name}{item.connector_role ? ` · ${item.connector_role}` : ''}
          </NeonText>
        ) : null}

        {item.can_accept ? (
          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => respond(item, true)}
              style={[styles.primaryButton, busy && styles.disabled]}
            >
              <NeonText variant="label" tone="premium">{busy ? 'SAVING…' : 'ACCEPT INTRODUCTION'}</NeonText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => respond(item, false)}
              style={[styles.declineButton, busy && styles.disabled]}
            >
              <NeonText variant="label" tone="muted">DECLINE</NeonText>
            </Pressable>
          </View>
        ) : null}

        {item.can_cancel ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => cancel(item)}
            style={[styles.cancelButton, busy && styles.disabled]}
          >
            <NeonText variant="label" tone="muted">CANCEL REQUEST</NeonText>
          </Pressable>
        ) : null}

        {item.request_status === 'accepted' && otherId ? (
          <View style={styles.openActionStack}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => sendSignal(item)}
              style={[styles.primaryButton, busy && styles.disabled]}
            >
              <NeonText variant="label" tone="premium">{busy ? 'SENDING…' : 'SEND CONNECTION SIGNAL'}</NeonText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => openOfficeHours(item)}
              style={[styles.officeHoursButton, busy && styles.disabled]}
            >
              <NeonText variant="label" tone="accent">REQUEST OFFICE HOURS</NeonText>
            </Pressable>
          </View>
        ) : null}

        <NeonText variant="bodyMuted" style={styles.boundaryCopy}>
          Beacon never exposes a connector list, private decline reason, or public connector score. A warm introduction is a consent path—not an endorsement or guarantee of outcome.
        </NeonText>
      </Surface>
    );
  };

  if (loading && items.length === 0) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Loader size={58} />
        <NeonText variant="label" tone="premium" style={{ marginTop: spacing.lg }}>
          Loading introduction inbox
        </NeonText>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={(
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load('refresh')}
          tintColor={palette.premium}
        />
      )}
    >
      <GridBackground intensity={0.34} />

      <View style={styles.hero}>
        <Pill label={`${items.length} PRIVATE`} tone="premium" dot />
        <NeonText variant="display" glow style={{ marginTop: spacing.sm }}>
          Warm introductions with three real decisions.
        </NeonText>
        <NeonText variant="bodyMuted" style={styles.heroCopy}>
          A requester chooses a relevant person, an opted-in verified mutual decides whether to connect them, and the target makes the final decision. No event-wide graph is exposed.
        </NeonText>
      </View>

      {error ? (
        <Surface padded style={styles.errorCard}>
          <NeonText variant="label" tone="danger">INTRODUCTION INBOX DEGRADED</NeonText>
          <NeonText variant="bodyMuted" style={styles.smallTop}>{error}</NeonText>
        </Surface>
      ) : null}

      {items.length === 0 ? (
        <Surface elevated padded style={styles.emptyCard}>
          <NeonText variant="h2">No warm introductions yet.</NeonText>
          <NeonText variant="bodyMuted" style={styles.smallTop}>
            When Beacon finds an opted-in participant with verified mutuals to both sides of an explicit fit, the requester can ask that person to open a private introduction.
          </NeonText>
        </Surface>
      ) : null}

      {grouped.decision.length > 0 ? (
        <View style={styles.section}>
          <NeonText variant="label" tone="premium">NEEDS YOUR DECISION</NeonText>
          {grouped.decision.map(renderCard)}
        </View>
      ) : null}

      {grouped.open.length > 0 ? (
        <View style={styles.section}>
          <NeonText variant="label" tone="premium">OPEN INTRODUCTIONS</NeonText>
          {grouped.open.map(renderCard)}
        </View>
      ) : null}

      {grouped.waiting.length > 0 ? (
        <View style={styles.section}>
          <NeonText variant="label" tone="accent">WAITING ON CONSENT</NeonText>
          {grouped.waiting.map(renderCard)}
        </View>
      ) : null}

      {grouped.history.length > 0 ? (
        <View style={styles.section}>
          <NeonText variant="label" tone="muted">RECENT HISTORY</NeonText>
          {grouped.history.map(renderCard)}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.void },
  content: { paddingBottom: spacing.xxxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.void },
  hero: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.md },
  heroCopy: { marginTop: spacing.sm, lineHeight: 20 },
  section: { paddingHorizontal: spacing.xl, marginTop: spacing.xl, gap: spacing.sm },
  card: { borderRadius: radii.xl, borderColor: palette.premiumSoft },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  smallTop: { marginTop: 4 },
  bodyCopy: { marginTop: spacing.sm, lineHeight: 20 },
  evidenceRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  evidenceCell: { flex: 1, padding: spacing.sm, borderRadius: radii.md, backgroundColor: palette.surface },
  connectorCopy: { marginTop: spacing.md, color: palette.premium },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  openActionStack: { gap: spacing.sm, marginTop: spacing.md },
  primaryButton: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.premium,
    backgroundColor: palette.premiumSoft,
  },
  declineButton: {
    minWidth: 92,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.hairlineStrong,
    backgroundColor: palette.surface,
  },
  cancelButton: {
    minHeight: 40,
    marginTop: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.hairlineStrong,
  },
  officeHoursButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  disabled: { opacity: 0.4 },
  boundaryCopy: { marginTop: spacing.md, fontSize: 10, lineHeight: 15 },
  errorCard: { marginHorizontal: spacing.xl, marginTop: spacing.md, borderRadius: radii.lg, borderColor: palette.danger },
  emptyCard: { marginHorizontal: spacing.xl, marginTop: spacing.md, borderRadius: radii.xl },
});
