import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import {
  getEventAvailablePartnerPrograms,
  getMyCommunityPartnerPrograms,
  proposeCommunityPartnerProgram,
  respondToCommunityPartnerProgram,
  setCommunityPartnerProgramState,
  useCommunityPartnerProgram,
  type AvailableCommunityPartnerProgram,
  type CommunityPartnerProgram,
} from '../services/community-partner-program.service';
import type { CommunityEventPartnership, CommunityPartner } from '../services/community-exchange.service';
import { EVENT_INTENT_KEYS, EVENT_INTENT_LABELS, type EventIntentKey } from '../services/event-intent.service';
import { NeonText, Pill, Surface } from './ui';
import { palette, radii, spacing } from '../theme';

interface Props {
  eventId: string;
  isHost: boolean;
  ownedCommunities: CommunityPartner[];
  activePartnerships: CommunityEventPartnership[];
  onInstantiated: () => Promise<void> | void;
}

function toggle(current: EventIntentKey[], key: EventIntentKey): EventIntentKey[] {
  if (current.includes(key)) return current.filter((item) => item !== key);
  if (current.length >= 6) return current;
  return [...current, key].sort();
}

export default function CommunityPartnerProgramsPanel({
  eventId,
  isHost,
  ownedCommunities,
  activePartnerships,
  onInstantiated,
}: Readonly<Props>) {
  const [programs, setPrograms] = useState<CommunityPartnerProgram[]>([]);
  const [available, setAvailable] = useState<AvailableCommunityPartnerProgram[]>([]);
  const [name, setName] = useState('');
  const [communityOne, setCommunityOne] = useState<string | null>(null);
  const [communityTwo, setCommunityTwo] = useState<string | null>(null);
  const [domains, setDomains] = useState<EventIntentKey[]>(['community']);
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async () => {
    const [mine, forEvent] = await Promise.all([
      getMyCommunityPartnerPrograms(),
      isHost ? getEventAvailablePartnerPrograms(eventId) : Promise.resolve({ data: [] as AvailableCommunityPartnerProgram[], error: null }),
    ]);
    if (!mine.error) setPrograms(mine.data);
    if (!forEvent.error) setAvailable(forEvent.data);
  }, [eventId, isHost]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const partnerChoices = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const community of ownedCommunities) map.set(community.community_id, { id: community.community_id, name: community.name });
    for (const partnership of activePartnerships) map.set(partnership.community_id, { id: partnership.community_id, name: partnership.community_name });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }, [activePartnerships, ownedCommunities]);

  useEffect(() => {
    if (partnerChoices.length >= 2) {
      setCommunityOne((current) => current ?? partnerChoices[0].id);
      setCommunityTwo((current) => current ?? partnerChoices[1].id);
    }
  }, [partnerChoices]);

  const createProgram = useCallback(async () => {
    if (!communityOne || !communityTwo || communityOne === communityTwo) {
      Alert.alert('Two communities required', 'Choose two different community identities.');
      return;
    }
    if (!name.trim() || domains.length === 0) {
      Alert.alert('Program details required', 'Name the repeatable partnership and choose at least one domain.');
      return;
    }
    setWorking(true);
    const result = await proposeCommunityPartnerProgram({
      communityOneId: communityOne,
      communityTwoId: communityTwo,
      name,
      domains,
    });
    if (result.error || !result.programId) {
      Alert.alert('Could not propose program', result.error?.message ?? 'Try again.');
    } else {
      setName('');
      await refresh();
    }
    setWorking(false);
  }, [communityOne, communityTwo, domains, name, refresh]);

  const respond = useCallback(async (program: CommunityPartnerProgram, accept: boolean) => {
    setWorking(true);
    const result = await respondToCommunityPartnerProgram(program.program_id, accept);
    if (result.error || !result.state) Alert.alert('Could not update program', result.error?.message ?? 'Try again.');
    await refresh();
    setWorking(false);
  }, [refresh]);

  const changeState = useCallback(async (program: CommunityPartnerProgram, state: 'active' | 'paused' | 'retired') => {
    setWorking(true);
    const result = await setCommunityPartnerProgramState(program.program_id, state);
    if (result.error || !result.changed) Alert.alert('Could not update program', result.error?.message ?? 'Try again.');
    await refresh();
    setWorking(false);
  }, [refresh]);

  const instantiate = useCallback(async (program: AvailableCommunityPartnerProgram) => {
    setWorking(true);
    const result = await useCommunityPartnerProgram(eventId, program.program_id);
    if (result.error || !result.exchangeId) {
      Alert.alert('Could not use partner program', result.error?.message ?? 'Try again.');
    } else {
      Alert.alert(
        'Event exchange proposed',
        'The repeatable program prefilled the partner pair and domains, but both community owners still have to approve this event-specific exchange.',
      );
      await onInstantiated();
      await refresh();
    }
    setWorking(false);
  }, [eventId, onInstantiated, refresh]);

  if (ownedCommunities.length === 0 && available.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <NeonText variant="label" tone="premium">PARTNER PROGRAMS</NeonText>
      <NeonText variant="bodyMuted">
        Preserve a strong community-to-community operating pattern without carrying old event consent forward. Programs remember the pair and domains; every future event still resets exchange approval and participant opt-in.
      </NeonText>

      {isHost && available.length > 0 ? (
        <Surface elevated padded style={styles.card}>
          <NeonText variant="h2">Available for this event</NeonText>
          <NeonText variant="bodyMuted" style={styles.smallTop}>
            Both communities are active event partners and already maintain a reusable program. Using one creates a proposed event exchange—not an automatic activation.
          </NeonText>
          <View style={styles.list}>
            {available.map((program) => (
              <View key={program.program_id} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <NeonText variant="h2">{program.name}</NeonText>
                  <NeonText variant="bodyMuted" style={styles.smallTop}>
                    {program.community_a_name} ↔ {program.community_b_name} · {program.domains.map((domain) => EVENT_INTENT_LABELS[domain]).join(' · ')}
                  </NeonText>
                </View>
                <Pressable disabled={working} onPress={() => instantiate(program)} style={styles.useButton}>
                  <NeonText variant="label" tone="accent">USE</NeonText>
                </Pressable>
              </View>
            ))}
          </View>
        </Surface>
      ) : null}

      {programs.length > 0 ? (
        <Surface padded style={styles.card}>
          <NeonText variant="h2">Your community programs</NeonText>
          <View style={styles.list}>
            {programs.map((program) => {
              const callerApproved = (program.caller_owns_a && program.community_a_approved)
                || (program.caller_owns_b && program.community_b_approved);
              const needsCallerDecision = program.state === 'proposed' && !callerApproved;
              return (
                <View key={program.program_id} style={styles.programRow}>
                  <View style={styles.headerRow}>
                    <View style={{ flex: 1 }}>
                      <NeonText variant="h2">{program.name}</NeonText>
                      <NeonText variant="bodyMuted" style={styles.smallTop}>{program.community_a_name} ↔ {program.community_b_name}</NeonText>
                    </View>
                    <Pill label={program.state.toUpperCase()} tone={program.state === 'active' ? 'success' : program.state === 'proposed' ? 'warning' : 'neutral'} />
                  </View>
                  <NeonText variant="bodyMuted" style={styles.smallTop}>{program.domains.map((domain) => EVENT_INTENT_LABELS[domain]).join(' · ')}</NeonText>

                  {needsCallerDecision ? (
                    <View style={styles.buttonRow}>
                      <Pressable disabled={working} onPress={() => respond(program, true)} style={styles.primaryFlex}><NeonText variant="label" tone="accent">APPROVE PROGRAM</NeonText></Pressable>
                      <Pressable disabled={working} onPress={() => respond(program, false)} style={styles.ghostFlex}><NeonText variant="label" tone="muted">DECLINE</NeonText></Pressable>
                    </View>
                  ) : null}

                  {program.state === 'active' ? (
                    <Pressable disabled={working} onPress={() => changeState(program, 'paused')} style={styles.stateButton}>
                      <NeonText variant="label" tone="muted">PAUSE FUTURE USE</NeonText>
                    </Pressable>
                  ) : null}
                  {program.state === 'paused' ? (
                    <View style={styles.buttonRow}>
                      <Pressable disabled={working} onPress={() => changeState(program, 'active')} style={styles.primaryFlex}><NeonText variant="label" tone="accent">REACTIVATE</NeonText></Pressable>
                      <Pressable disabled={working} onPress={() => changeState(program, 'retired')} style={styles.ghostFlex}><NeonText variant="label" tone="muted">RETIRE</NeonText></Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </Surface>
      ) : null}

      {partnerChoices.length >= 2 && ownedCommunities.length > 0 ? (
        <Surface elevated padded style={styles.card}>
          <NeonText variant="h2">Propose a reusable program</NeonText>
          <NeonText variant="bodyMuted" style={styles.smallTop}>
            A community owner can propose a durable partnership pattern. The other owner must approve before it becomes reusable.
          </NeonText>

          <NeonText variant="label" tone="muted" style={styles.fieldLabel}>COMMUNITY A</NeonText>
          <View style={styles.chips}>
            {partnerChoices.map((community) => (
              <Pressable key={`a-${community.id}`} onPress={() => setCommunityOne(community.id)} style={[styles.chip, communityOne === community.id && styles.chipActive]}>
                <NeonText variant="label" tone={communityOne === community.id ? 'accent' : 'muted'}>{community.name}</NeonText>
              </Pressable>
            ))}
          </View>

          <NeonText variant="label" tone="muted" style={styles.fieldLabel}>COMMUNITY B</NeonText>
          <View style={styles.chips}>
            {partnerChoices.map((community) => (
              <Pressable key={`b-${community.id}`} onPress={() => setCommunityTwo(community.id)} style={[styles.chip, communityTwo === community.id && styles.chipActive]}>
                <NeonText variant="label" tone={communityTwo === community.id ? 'accent' : 'muted'}>{community.name}</NeonText>
              </Pressable>
            ))}
          </View>

          <NeonText variant="label" tone="muted" style={styles.fieldLabel}>PROGRAM NAME</NeonText>
          <TextInput value={name} onChangeText={setName} placeholder="Founders ↔ operators" placeholderTextColor={palette.textDim} style={styles.input} />

          <NeonText variant="label" tone="muted" style={styles.fieldLabel}>DOMAINS</NeonText>
          <View style={styles.chips}>
            {EVENT_INTENT_KEYS.map((key) => (
              <Pressable key={key} onPress={() => setDomains((current) => toggle(current, key))} style={[styles.chip, domains.includes(key) && styles.chipActive]}>
                <NeonText variant="label" tone={domains.includes(key) ? 'premium' : 'muted'}>{EVENT_INTENT_LABELS[key]}</NeonText>
              </Pressable>
            ))}
          </View>

          <Pressable disabled={working} onPress={createProgram} style={[styles.createButton, working && styles.disabled]}>
            <NeonText variant="label" tone="accent">PROPOSE PARTNER PROGRAM</NeonText>
          </Pressable>
        </Surface>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  card: { borderRadius: radii.lg },
  smallTop: { marginTop: 4 },
  list: { marginTop: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.hairline },
  programRow: { paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.hairline },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  useButton: { minHeight: 38, minWidth: 64, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.accent, backgroundColor: palette.accentSoft },
  buttonRow: { marginTop: spacing.md, flexDirection: 'row', gap: spacing.sm },
  primaryFlex: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.accent, backgroundColor: palette.accentSoft },
  ghostFlex: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairlineStrong },
  stateButton: { marginTop: spacing.md, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairlineStrong },
  fieldLabel: { marginTop: spacing.lg },
  chips: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: 1, borderColor: palette.hairlineStrong, backgroundColor: palette.surface },
  chipActive: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
  input: { marginTop: spacing.sm, minHeight: 46, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairlineStrong, backgroundColor: palette.surface, color: palette.text, paddingHorizontal: spacing.md, fontSize: 14 },
  createButton: { marginTop: spacing.lg, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radii.lg, borderWidth: 1, borderColor: palette.accent, backgroundColor: palette.accentSoft },
  disabled: { opacity: 0.45 },
});
