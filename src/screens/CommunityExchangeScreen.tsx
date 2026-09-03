import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { getEventById } from '../services/event.service';
import {
  claimEventCommunityAffiliation,
  createCommunityEventInviteCode,
  createCommunityPartner,
  getCommunityExchangeSummary,
  getEventCommunityExchanges,
  getEventCommunityPartnerships,
  getMyCommunityExchangePortfolio,
  getMyCommunityPartners,
  getMyEventCommunityAffiliations,
  inviteCommunityPartnerToEvent,
  proposeCommunityExchange,
  respondToCommunityEventPartnership,
  respondToCommunityExchange,
  setMyEventCommunityAffiliation,
  type CommunityAffiliation,
  type CommunityEventPartnership,
  type CommunityExchange,
  type CommunityExchangePortfolio,
  type CommunityExchangeSummary,
  type CommunityPartner,
} from '../services/community-exchange.service';
import {
  EVENT_INTENT_KEYS,
  EVENT_INTENT_LABELS,
  type EventIntentKey,
} from '../services/event-intent.service';
import CommunityPartnerProgramsPanel from '../components/CommunityPartnerProgramsPanel';
import CommunitySupplyDemandPanel from '../components/CommunitySupplyDemandPanel';
import CommunityOutcomeReceiptEvidence from '../components/CommunityOutcomeReceiptEvidence';
import PartnerCommitmentLedgerPanel from '../components/PartnerCommitmentLedgerPanel';
import { GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type Params = { CommunityExchange: { eventId: string } };

type ExchangeEvidence = Record<string, CommunityExchangeSummary | null>;
type PortfolioEvidence = Record<string, CommunityExchangePortfolio | null>;

function toggleIntent(current: EventIntentKey[], key: EventIntentKey, limit = 6): EventIntentKey[] {
  if (current.includes(key)) return current.filter((item) => item !== key);
  if (current.length >= limit) return current;
  return [...current, key].sort();
}

function percent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

export default function CommunityExchangeScreen() {
  const route = useRoute<RouteProp<Params, 'CommunityExchange'>>();
  const { eventId } = route.params;
  const { user } = useAuth();

  const [hostId, setHostId] = useState<string | null>(null);
  const [partners, setPartners] = useState<CommunityPartner[]>([]);
  const [partnerships, setPartnerships] = useState<CommunityEventPartnership[]>([]);
  const [affiliations, setAffiliations] = useState<CommunityAffiliation[]>([]);
  const [exchanges, setExchanges] = useState<CommunityExchange[]>([]);
  const [exchangeEvidence, setExchangeEvidence] = useState<ExchangeEvidence>({});
  const [portfolioEvidence, setPortfolioEvidence] = useState<PortfolioEvidence>({});
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newCommunityName, setNewCommunityName] = useState('');
  const [newCommunitySlug, setNewCommunitySlug] = useState('');
  const [newCommunityDescription, setNewCommunityDescription] = useState('');

  const [partnerSlug, setPartnerSlug] = useState('');
  const [partnerGoals, setPartnerGoals] = useState<EventIntentKey[]>(['community']);
  const [claimCode, setClaimCode] = useState('');
  const [claimBadgeVisible, setClaimBadgeVisible] = useState(false);
  const [claimExchangeEnabled, setClaimExchangeEnabled] = useState(true);

  const [exchangeCommunityOne, setExchangeCommunityOne] = useState<string | null>(null);
  const [exchangeCommunityTwo, setExchangeCommunityTwo] = useState<string | null>(null);
  const [exchangeDomains, setExchangeDomains] = useState<EventIntentKey[]>(['community']);
  const [latestInviteCode, setLatestInviteCode] = useState<{ communityName: string; code: string; expiresAt: string } | null>(null);

  const isHost = hostId != null && hostId === user?.id;
  const activePartnerships = useMemo(
    () => partnerships.filter((item) => item.state === 'active'),
    [partnerships],
  );
  const ownedCommunityIds = useMemo(() => new Set(partners.map((item) => item.community_id)), [partners]);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    setError(null);
    try {
      const [event, partnerResult, partnershipResult, affiliationResult, exchangeResult] = await Promise.all([
        getEventById(eventId),
        getMyCommunityPartners(),
        getEventCommunityPartnerships(eventId),
        getMyEventCommunityAffiliations(eventId),
        getEventCommunityExchanges(eventId),
      ]);
      setHostId(event?.host_id ?? null);
      setPartners(partnerResult.error ? [] : partnerResult.data);
      setPartnerships(partnershipResult.error ? [] : partnershipResult.data);
      setAffiliations(affiliationResult.error ? [] : affiliationResult.data);
      setExchanges(exchangeResult.error ? [] : exchangeResult.data);

      const firstError = partnerResult.error ?? partnershipResult.error ?? affiliationResult.error ?? exchangeResult.error;
      if (firstError) setError(firstError.message);

      const evidenceEntries = await Promise.all(
        (exchangeResult.data ?? [])
          .filter((exchange) => exchange.state === 'active')
          .map(async (exchange) => {
            const result = await getCommunityExchangeSummary(exchange.exchange_id);
            return [exchange.exchange_id, result.error ? null : result.data] as const;
          }),
      );
      setExchangeEvidence(Object.fromEntries(evidenceEntries));

      const portfolioEntries = await Promise.all(
        (partnerResult.data ?? []).map(async (partner) => {
          const result = await getMyCommunityExchangePortfolio(partner.community_id);
          return [partner.community_id, result.error ? null : result.data] as const;
        }),
      );
      setPortfolioEvidence(Object.fromEntries(portfolioEntries));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Community exchange could not refresh.');
    } finally {
      if (manual) setRefreshing(false);
    }
  }, [eventId]);

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    if (activePartnerships.length >= 2) {
      setExchangeCommunityOne((current) => current ?? activePartnerships[0].community_id);
      setExchangeCommunityTwo((current) => current ?? activePartnerships[1].community_id);
    }
  }, [activePartnerships]);

  const createCommunity = useCallback(async () => {
    if (!newCommunityName.trim() || !newCommunitySlug.trim()) {
      Alert.alert('Community name and slug required', 'Create a stable partner identity before attaching it to an event.');
      return;
    }
    setWorking(true);
    const result = await createCommunityPartner({
      name: newCommunityName,
      slug: newCommunitySlug,
      description: newCommunityDescription,
    });
    if (result.error || !result.data) {
      Alert.alert('Could not create community', result.error?.message ?? 'Try again.');
    } else {
      setNewCommunityName('');
      setNewCommunitySlug('');
      setNewCommunityDescription('');
      await load(false);
    }
    setWorking(false);
  }, [load, newCommunityDescription, newCommunityName, newCommunitySlug]);

  const invitePartner = useCallback(async () => {
    if (!partnerSlug.trim()) return;
    setWorking(true);
    const result = await inviteCommunityPartnerToEvent({ eventId, communitySlug: partnerSlug, goals: partnerGoals });
    if (result.error || !result.data) {
      Alert.alert('Partner invitation failed', result.error?.message ?? 'Try again.');
    } else {
      setPartnerSlug('');
      await load(false);
    }
    setWorking(false);
  }, [eventId, load, partnerGoals, partnerSlug]);

  const respondPartnership = useCallback(async (partnership: CommunityEventPartnership, accept: boolean) => {
    setWorking(true);
    const result = await respondToCommunityEventPartnership({ eventId, communityId: partnership.community_id, accept });
    if (result.error || !result.changed) Alert.alert('Could not update partnership', result.error?.message ?? 'Try again.');
    await load(false);
    setWorking(false);
  }, [eventId, load]);

  const issueCode = useCallback(async (partnership: CommunityEventPartnership) => {
    setWorking(true);
    const result = await createCommunityEventInviteCode({ eventId, communityId: partnership.community_id, maxUses: 250, validMinutes: 2880 });
    if (result.error || !result.data) {
      Alert.alert('Could not issue partner code', result.error?.message ?? 'Try again.');
    } else {
      setLatestInviteCode({
        communityName: partnership.community_name,
        code: result.data.invite_code,
        expiresAt: result.data.expires_at,
      });
    }
    setWorking(false);
  }, [eventId]);

  const claimAffiliation = useCallback(async () => {
    if (!claimCode.trim()) return;
    setWorking(true);
    const result = await claimEventCommunityAffiliation({
      eventId,
      inviteCode: claimCode,
      visibility: claimBadgeVisible ? 'badge' : 'private',
      exchangeEnabled: claimExchangeEnabled,
    });
    if (result.error || !result.data) {
      Alert.alert('Could not verify community affiliation', result.error?.message ?? 'Check the event code and try again.');
    } else {
      setClaimCode('');
      await load(false);
    }
    setWorking(false);
  }, [claimBadgeVisible, claimCode, claimExchangeEnabled, eventId, load]);

  const updateAffiliation = useCallback(async (
    affiliation: CommunityAffiliation,
    changes: Partial<Pick<CommunityAffiliation, 'visibility' | 'exchange_enabled'>>,
  ) => {
    const nextVisibility = changes.visibility ?? affiliation.visibility;
    const nextExchangeEnabled = changes.exchange_enabled ?? affiliation.exchange_enabled;
    setAffiliations((current) => current.map((item) => item.community_id === affiliation.community_id
      ? { ...item, visibility: nextVisibility, exchange_enabled: nextExchangeEnabled }
      : item));
    const result = await setMyEventCommunityAffiliation({
      eventId,
      communityId: affiliation.community_id,
      visibility: nextVisibility,
      exchangeEnabled: nextExchangeEnabled,
    });
    if (result.error || !result.changed) {
      await load(false);
      Alert.alert('Preference update failed', result.error?.message ?? 'Try again.');
    }
  }, [eventId, load]);

  const proposeExchange = useCallback(async () => {
    if (!exchangeCommunityOne || !exchangeCommunityTwo || exchangeCommunityOne === exchangeCommunityTwo) {
      Alert.alert('Two communities required', 'Choose two different active event partners.');
      return;
    }
    if (exchangeDomains.length === 0) {
      Alert.alert('Exchange domain required', 'Choose at least one explicit domain the partnership is meant to make easier to discover.');
      return;
    }
    setWorking(true);
    const result = await proposeCommunityExchange({
      eventId,
      communityOneId: exchangeCommunityOne,
      communityTwoId: exchangeCommunityTwo,
      domains: exchangeDomains,
    });
    if (result.error || !result.exchangeId) {
      Alert.alert('Could not propose exchange', result.error?.message ?? 'Try again.');
    } else {
      await load(false);
    }
    setWorking(false);
  }, [eventId, exchangeCommunityOne, exchangeCommunityTwo, exchangeDomains, load]);

  const respondExchange = useCallback(async (exchange: CommunityExchange, accept: boolean) => {
    setWorking(true);
    const result = await respondToCommunityExchange(exchange.exchange_id, accept);
    if (result.error || !result.state) Alert.alert('Could not update exchange', result.error?.message ?? 'Try again.');
    await load(false);
    setWorking(false);
  }, [load]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={palette.accent} />}
    >
      <GridBackground intensity={0.32} />

      <View style={styles.hero}>
        <Pill label="Community exchange" tone="premium" dot />
        <NeonText variant="display" glow style={styles.heroTitle}>A network of communities, without a community-wide people graph.</NeonText>
        <NeonText variant="bodyMuted" style={styles.heroCopy}>
          Beacon can let two partner communities deliberately create value for each other at the same event. Participation is event-scoped, affiliation is verified with a partner-issued code, badge visibility is optional, and cross-community discovery still requires a real declared-fit intersection.
        </NeonText>
      </View>

      {error ? (
        <Surface padded style={styles.errorCard}>
          <NeonText variant="label" tone="danger">COMMUNITY EXCHANGE DEGRADED</NeonText>
          <NeonText variant="bodyMuted" style={styles.smallTop}>{error}</NeonText>
        </Surface>
      ) : null}

      <View style={styles.section}>
        <NeonText variant="label" tone="accent">YOUR EVENT AFFILIATIONS</NeonText>
        <NeonText variant="bodyMuted">A partner code verifies only that community for this event. It does not expose your community membership to every participant.</NeonText>

        <Surface elevated padded style={styles.formCard}>
          <NeonText variant="h2">Verify a partner affiliation</NeonText>
          <TextInput
            value={claimCode}
            onChangeText={(value) => setClaimCode(value.toUpperCase())}
            autoCapitalize="characters"
            placeholder="PARTNER CODE"
            placeholderTextColor={palette.textDim}
            style={styles.input}
          />
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <NeonText variant="h2">Show community badge</NeonText>
              <NeonText variant="bodyMuted" style={styles.smallTop}>Only peers in an approved exchange can use this badge as context, and only after your explicit choice.</NeonText>
            </View>
            <Switch value={claimBadgeVisible} onValueChange={setClaimBadgeVisible} />
          </View>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <NeonText variant="h2">Enable cross-community exchange</NeonText>
              <NeonText variant="bodyMuted" style={styles.smallTop}>This does not broaden your declared fit. It only lets an approved community bridge add context when a real fit already exists.</NeonText>
            </View>
            <Switch value={claimExchangeEnabled} onValueChange={setClaimExchangeEnabled} />
          </View>
          <Pressable disabled={working || !claimCode.trim()} onPress={claimAffiliation} style={[styles.primaryButton, (working || !claimCode.trim()) && styles.disabled]}>
            <NeonText variant="label" tone="accent">VERIFY AFFILIATION</NeonText>
          </Pressable>
        </Surface>

        {affiliations.map((affiliation) => (
          <Surface key={affiliation.community_id} padded style={styles.affiliationCard}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <NeonText variant="h2">{affiliation.community_name}</NeonText>
                <NeonText variant="label" tone="muted" style={styles.smallTop}>@{affiliation.community_slug}</NeonText>
              </View>
              <Pill label="VERIFIED" tone="success" />
            </View>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <NeonText variant="body">Badge visible</NeonText>
                <NeonText variant="bodyMuted" style={styles.smallTop}>Private means Beacon keeps the affiliation out of peer-facing community bridge context.</NeonText>
              </View>
              <Switch
                value={affiliation.visibility === 'badge'}
                onValueChange={(enabled) => updateAffiliation(affiliation, { visibility: enabled ? 'badge' : 'private' })}
              />
            </View>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <NeonText variant="body">Exchange enabled</NeonText>
                <NeonText variant="bodyMuted" style={styles.smallTop}>You can disable exchange without removing your verified affiliation.</NeonText>
              </View>
              <Switch
                value={affiliation.exchange_enabled}
                onValueChange={(enabled) => updateAffiliation(affiliation, { exchange_enabled: enabled })}
              />
            </View>
          </Surface>
        ))}
      </View>

      <View style={styles.section}>
        <NeonText variant="label" tone="accent">ACTIVE PARTNER COMMUNITIES</NeonText>
        {activePartnerships.length === 0 ? (
          <Surface padded style={styles.formCard}>
            <NeonText variant="bodyMuted">No active partner community has joined this event yet.</NeonText>
          </Surface>
        ) : activePartnerships.map((partnership) => (
          <Surface key={partnership.community_id} padded style={styles.partnerCard}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <NeonText variant="h2">{partnership.community_name}</NeonText>
                <NeonText variant="bodyMuted" style={styles.smallTop}>@{partnership.community_slug}</NeonText>
              </View>
              <Pill label="ACTIVE PARTNER" tone="success" />
            </View>
            {partnership.goals.length > 0 ? (
              <View style={styles.chipRow}>
                {partnership.goals.map((goal) => <Pill key={goal} label={EVENT_INTENT_LABELS[goal].toUpperCase()} tone="neutral" />)}
              </View>
            ) : null}
            {ownedCommunityIds.has(partnership.community_id) ? (
              <Pressable disabled={working} onPress={() => issueCode(partnership)} style={styles.secondaryButton}>
                <NeonText variant="label" tone="premium">ISSUE MEMBER EVENT CODE</NeonText>
              </Pressable>
            ) : null}
          </Surface>
        ))}
      </View>

      {latestInviteCode ? (
        <Surface elevated padded style={styles.codeCard}>
          <NeonText variant="label" tone="premium">COPY ONCE · {latestInviteCode.communityName.toUpperCase()}</NeonText>
          <NeonText variant="display" glow style={styles.code}>{latestInviteCode.code}</NeonText>
          <NeonText variant="bodyMuted" style={styles.smallTop}>Valid until {new Date(latestInviteCode.expiresAt).toLocaleString()}. Beacon stores only the code digest after issuance.</NeonText>
          <Pressable onPress={() => setLatestInviteCode(null)} style={styles.secondaryButton}>
            <NeonText variant="label" tone="muted">I'VE COPIED IT</NeonText>
          </Pressable>
        </Surface>
      ) : null}

      {partnerships.filter((item) => item.state === 'invited' && item.caller_is_owner).length > 0 ? (
        <View style={styles.section}>
          <NeonText variant="label" tone="premium">PARTNERSHIP INVITATIONS</NeonText>
          {partnerships.filter((item) => item.state === 'invited' && item.caller_is_owner).map((partnership) => (
            <Surface key={partnership.community_id} elevated padded style={styles.partnerCard}>
              <NeonText variant="h2">{partnership.community_name} was invited into this event</NeonText>
              <NeonText variant="bodyMuted" style={styles.smallTop}>Accepting enables your community to issue event codes and participate in bilateral exchanges. It does not enroll any member automatically.</NeonText>
              <View style={styles.buttonRow}>
                <Pressable disabled={working} onPress={() => respondPartnership(partnership, true)} style={styles.primaryButtonFlex}>
                  <NeonText variant="label" tone="accent">ACCEPT</NeonText>
                </Pressable>
                <Pressable disabled={working} onPress={() => respondPartnership(partnership, false)} style={styles.ghostButtonFlex}>
                  <NeonText variant="label" tone="muted">DECLINE</NeonText>
                </Pressable>
              </View>
            </Surface>
          ))}
        </View>
      ) : null}

      {isHost ? (
        <View style={styles.section}>
          <NeonText variant="label" tone="premium">HOST · PARTNER NETWORK</NeonText>
          <Surface elevated padded style={styles.formCard}>
            <NeonText variant="h2">Invite an existing community partner</NeonText>
            <NeonText variant="bodyMuted" style={styles.smallTop}>Use the partner's exact Beacon slug. The community owner still has to accept before member verification or exchange is available.</NeonText>
            <TextInput value={partnerSlug} onChangeText={setPartnerSlug} autoCapitalize="none" placeholder="community-slug" placeholderTextColor={palette.textDim} style={styles.input} />
            <NeonText variant="label" tone="muted" style={styles.fieldLabel}>PARTNERSHIP GOALS</NeonText>
            <View style={styles.intentGrid}>
              {EVENT_INTENT_KEYS.map((key) => (
                <Pressable key={key} onPress={() => setPartnerGoals((current) => toggleIntent(current, key))} style={[styles.intentChip, partnerGoals.includes(key) && styles.intentChipActive]}>
                  <NeonText variant="label" tone={partnerGoals.includes(key) ? 'accent' : 'muted'}>{EVENT_INTENT_LABELS[key]}</NeonText>
                </Pressable>
              ))}
            </View>
            <Pressable disabled={working || !partnerSlug.trim()} onPress={invitePartner} style={[styles.primaryButton, (working || !partnerSlug.trim()) && styles.disabled]}>
              <NeonText variant="label" tone="accent">INVITE PARTNER</NeonText>
            </Pressable>
          </Surface>

          {activePartnerships.length >= 2 ? (
            <Surface elevated padded style={styles.formCard}>
              <NeonText variant="h2">Propose a bilateral exchange</NeonText>
              <NeonText variant="bodyMuted" style={styles.smallTop}>The exchange remains inert until both community owners approve. Participant exchange remains opt-in after that.</NeonText>

              <NeonText variant="label" tone="muted" style={styles.fieldLabel}>COMMUNITY A</NeonText>
              <View style={styles.intentGrid}>
                {activePartnerships.map((partnership) => (
                  <Pressable key={`a-${partnership.community_id}`} onPress={() => setExchangeCommunityOne(partnership.community_id)} style={[styles.intentChip, exchangeCommunityOne === partnership.community_id && styles.intentChipActive]}>
                    <NeonText variant="label" tone={exchangeCommunityOne === partnership.community_id ? 'accent' : 'muted'}>{partnership.community_name}</NeonText>
                  </Pressable>
                ))}
              </View>

              <NeonText variant="label" tone="muted" style={styles.fieldLabel}>COMMUNITY B</NeonText>
              <View style={styles.intentGrid}>
                {activePartnerships.map((partnership) => (
                  <Pressable key={`b-${partnership.community_id}`} onPress={() => setExchangeCommunityTwo(partnership.community_id)} style={[styles.intentChip, exchangeCommunityTwo === partnership.community_id && styles.intentChipActive]}>
                    <NeonText variant="label" tone={exchangeCommunityTwo === partnership.community_id ? 'accent' : 'muted'}>{partnership.community_name}</NeonText>
                  </Pressable>
                ))}
              </View>

              <NeonText variant="label" tone="muted" style={styles.fieldLabel}>EXCHANGE DOMAINS</NeonText>
              <View style={styles.intentGrid}>
                {EVENT_INTENT_KEYS.map((key) => (
                  <Pressable key={`x-${key}`} onPress={() => setExchangeDomains((current) => toggleIntent(current, key))} style={[styles.intentChip, exchangeDomains.includes(key) && styles.intentChipActive]}>
                    <NeonText variant="label" tone={exchangeDomains.includes(key) ? 'premium' : 'muted'}>{EVENT_INTENT_LABELS[key]}</NeonText>
                  </Pressable>
                ))}
              </View>

              <Pressable disabled={working} onPress={proposeExchange} style={styles.primaryButton}>
                <NeonText variant="label" tone="accent">PROPOSE EXCHANGE</NeonText>
              </Pressable>
            </Surface>
          ) : null}
        </View>
      ) : null}

      <View style={styles.section}>
        <CommunitySupplyDemandPanel
          eventId={eventId}
          activePartnerships={activePartnerships}
          visibleToOperator={isHost || activePartnerships.some((item) => item.caller_is_owner)}
        />
      </View>

      <View style={styles.section}>
        <CommunityPartnerProgramsPanel
          eventId={eventId}
          isHost={isHost}
          ownedCommunities={partners}
          activePartnerships={activePartnerships}
          onInstantiated={() => load(false)}
        />
      </View>

      <View style={styles.section}>
        <NeonText variant="label" tone="accent">COMMUNITY EXCHANGES</NeonText>
        {exchanges.length === 0 ? (
          <Surface padded style={styles.formCard}><NeonText variant="bodyMuted">No bilateral exchange is active or awaiting your decision.</NeonText></Surface>
        ) : exchanges.map((exchange) => {
          const evidence = exchangeEvidence[exchange.exchange_id];
          return (
            <Surface key={exchange.exchange_id} elevated padded style={styles.exchangeCard}>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <NeonText variant="h2">{exchange.community_a_name} ↔ {exchange.community_b_name}</NeonText>
                  <NeonText variant="bodyMuted" style={styles.smallTop}>{exchange.domains.map((domain) => EVENT_INTENT_LABELS[domain]).join(' · ')}</NeonText>
                </View>
                <Pill label={exchange.state.toUpperCase()} tone={exchange.state === 'active' ? 'success' : 'warning'} />
              </View>

              {exchange.state === 'proposed' && exchange.caller_can_respond ? (
                <View style={styles.buttonRow}>
                  <Pressable disabled={working} onPress={() => respondExchange(exchange, true)} style={styles.primaryButtonFlex}><NeonText variant="label" tone="accent">APPROVE</NeonText></Pressable>
                  <Pressable disabled={working} onPress={() => respondExchange(exchange, false)} style={styles.ghostButtonFlex}><NeonText variant="label" tone="muted">DECLINE</NeonText></Pressable>
                </View>
              ) : null}

              {exchange.state === 'active' ? (
                evidence?.supported ? (
                  <View style={styles.evidenceGrid}>
                    <View style={styles.evidenceMetric}><NeonText variant="label" tone="muted">OPTED A</NeonText><NeonText variant="h1">{evidence.community_a_opted_count}</NeonText></View>
                    <View style={styles.evidenceMetric}><NeonText variant="label" tone="muted">OPTED B</NeonText><NeonText variant="h1">{evidence.community_b_opted_count}</NeonText></View>
                    <View style={styles.evidenceMetric}><NeonText variant="label" tone="muted">CROSS-COMMUNITY MUTUALS</NeonText><NeonText variant="h1" tone="accent">{evidence.cross_community_mutual_count}</NeonText></View>
                    <View style={styles.evidenceMetric}><NeonText variant="label" tone="muted">WITH DECLARED FIT</NeonText><NeonText variant="h1" tone="premium">{percent(evidence.declared_fit_share)}</NeonText></View>
                  </View>
                ) : evidence ? (
                  <NeonText variant="bodyMuted" style={styles.smallTop}>Operator evidence stays withheld until at least five participants in each community explicitly enable exchange for this event.</NeonText>
                ) : null
              ) : null}
              {exchange.state === 'active' ? (
                <CommunityOutcomeReceiptEvidence exchangeId={exchange.exchange_id} />
              ) : null}
              {exchange.state === 'active' ? (
                <PartnerCommitmentLedgerPanel scopeKind="event-exchange" exchangeId={exchange.exchange_id} />
              ) : null}
            </Surface>
          );
        })}
      </View>

      {partners.length > 0 ? (
        <View style={styles.section}>
          <NeonText variant="label" tone="premium">YOUR COMMUNITY PORTFOLIO</NeonText>
          <NeonText variant="bodyMuted">This is owner-private longitudinal evidence across ended Beacon events—not a public leaderboard or cross-customer ranking.</NeonText>
          {partners.map((partner) => {
            const portfolio = portfolioEvidence[partner.community_id];
            return (
              <Surface key={partner.community_id} padded style={styles.partnerCard}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <NeonText variant="h2">{partner.name}</NeonText>
                    <NeonText variant="bodyMuted" style={styles.smallTop}>@{partner.slug}</NeonText>
                  </View>
                  <Pill label="OWNER" tone="premium" />
                </View>
                {portfolio ? (
                  <View style={styles.evidenceGrid}>
                    <View style={styles.evidenceMetric}><NeonText variant="label" tone="muted">ENDED EVENTS</NeonText><NeonText variant="h1">{portfolio.ended_event_count}</NeonText></View>
                    <View style={styles.evidenceMetric}><NeonText variant="label" tone="muted">PARTNER COMMUNITIES</NeonText><NeonText variant="h1">{portfolio.partner_community_count}</NeonText></View>
                    <View style={styles.evidenceMetric}><NeonText variant="label" tone="muted">SUPPORTED EXCHANGES</NeonText><NeonText variant="h1">{portfolio.supported_exchange_count}</NeonText></View>
                    <View style={styles.evidenceMetric}><NeonText variant="label" tone="muted">CROSS-COMMUNITY MUTUALS</NeonText><NeonText variant="h1" tone="accent">{portfolio.cross_community_mutual_count}</NeonText></View>
                  </View>
                ) : null}
              </Surface>
            );
          })}
        </View>
      ) : null}

      <View style={styles.section}>
        <NeonText variant="label" tone="accent">CREATE A COMMUNITY PARTNER</NeonText>
        <NeonText variant="bodyMuted">This creates a durable operator identity that can be invited into future Beacon events. It does not import a member list.</NeonText>
        <Surface elevated padded style={styles.formCard}>
          <TextInput value={newCommunityName} onChangeText={setNewCommunityName} placeholder="Community name" placeholderTextColor={palette.textDim} style={styles.input} />
          <TextInput value={newCommunitySlug} onChangeText={(value) => setNewCommunitySlug(value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} autoCapitalize="none" placeholder="community-slug" placeholderTextColor={palette.textDim} style={styles.input} />
          <TextInput value={newCommunityDescription} onChangeText={setNewCommunityDescription} multiline placeholder="What this community exists to help its members do" placeholderTextColor={palette.textDim} style={[styles.input, styles.textArea]} />
          <Pressable disabled={working} onPress={createCommunity} style={[styles.primaryButton, working && styles.disabled]}>
            <NeonText variant="label" tone="accent">CREATE PARTNER IDENTITY</NeonText>
          </Pressable>
        </Surface>
      </View>

      <Surface padded style={styles.boundaryCard}>
        <NeonText variant="label" tone="warning">NETWORK-OF-NETWORKS BOUNDARY</NeonText>
        <NeonText variant="bodyMuted" style={styles.smallTop}>
          Beacon does not expose community rosters, graph degree, member popularity, hidden connector counts, or an event-wide affiliation directory. Community context can add trust and legibility only after explicit event partnership, participant verification, bilateral exchange approval, participant opt-in, and a real declared-fit intersection.
        </NeonText>
      </Surface>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.void },
  content: { paddingBottom: spacing.xxxl },
  hero: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.md },
  heroTitle: { marginTop: spacing.sm },
  heroCopy: { marginTop: spacing.sm, lineHeight: 20 },
  section: { paddingHorizontal: spacing.xl, marginTop: spacing.xl, gap: spacing.sm },
  formCard: { borderRadius: radii.lg },
  partnerCard: { borderRadius: radii.lg },
  affiliationCard: { borderRadius: radii.lg },
  exchangeCard: { borderRadius: radii.lg, borderColor: palette.premiumSoft },
  errorCard: { marginHorizontal: spacing.xl, borderRadius: radii.lg, borderColor: palette.danger },
  codeCard: { marginHorizontal: spacing.xl, marginTop: spacing.xl, borderRadius: radii.xl, borderColor: palette.premium },
  code: { marginTop: spacing.md, letterSpacing: 4 },
  boundaryCard: { marginHorizontal: spacing.xl, marginTop: spacing.xl, borderRadius: radii.lg },
  input: {
    marginTop: spacing.sm,
    minHeight: 46,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.hairlineStrong,
    backgroundColor: palette.surface,
    color: palette.text,
    paddingHorizontal: spacing.md,
    fontSize: 14,
  },
  textArea: { minHeight: 88, paddingTop: spacing.md, textAlignVertical: 'top' },
  rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  toggleRow: { marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  chipRow: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  fieldLabel: { marginTop: spacing.lg },
  intentGrid: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  intentChip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: 1, borderColor: palette.hairlineStrong, backgroundColor: palette.surface },
  intentChipActive: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
  primaryButton: { minHeight: 48, marginTop: spacing.lg, alignItems: 'center', justifyContent: 'center', borderRadius: radii.lg, borderWidth: 1, borderColor: palette.accent, backgroundColor: palette.accentSoft },
  secondaryButton: { minHeight: 42, marginTop: spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.premiumSoft, backgroundColor: 'rgba(124,58,237,0.08)' },
  buttonRow: { marginTop: spacing.md, flexDirection: 'row', gap: spacing.sm },
  primaryButtonFlex: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.accent, backgroundColor: palette.accentSoft },
  ghostButtonFlex: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairlineStrong },
  evidenceGrid: { marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  evidenceMetric: { width: '47%', padding: spacing.sm, borderRadius: radii.md, backgroundColor: palette.surface },
  smallTop: { marginTop: 4 },
  disabled: { opacity: 0.45 },
});
