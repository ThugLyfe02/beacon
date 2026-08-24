import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import { getApprovedParticipants } from '../services/participant.service';
import {
  listVenueEventOperators,
  updateVenueEventOperator,
} from '../services/venue-operator.service';
import type { VenueEventOperatorRow, VenueOperatorRole } from '../services/venue-operations.service';
import { GridBackground, Loader, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type VenueOperatorsParams = { VenueOperators: { eventId: string } };
type AssignableRole = 'organizer' | 'venue-ops' | 'security';

type Participant = Awaited<ReturnType<typeof getApprovedParticipants>>[number];

const ROLE_COPY: Record<AssignableRole, { title: string; detail: string }> = {
  organizer: {
    title: 'Organizer',
    detail: 'Programming, sponsor, and follow-up decisions.',
  },
  'venue-ops': {
    title: 'Venue ops',
    detail: 'Normal flow and capacity decisions.',
  },
  security: {
    title: 'Security',
    detail: 'Safety-class decisions. Application still requires a second qualified approval.',
  },
};

function roleTone(role: VenueOperatorRole | null): 'accent' | 'premium' | 'danger' | 'neutral' {
  if (role === 'organizer') return 'accent';
  if (role === 'venue-ops') return 'premium';
  if (role === 'security') return 'danger';
  return 'neutral';
}

export default function VenueOperatorsScreen() {
  const route = useRoute<RouteProp<VenueOperatorsParams, 'VenueOperators'>>();
  const { eventId } = route.params;
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [operators, setOperators] = useState<VenueEventOperatorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingUserId, setWorkingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [approved, roster] = await Promise.all([
        getApprovedParticipants(eventId),
        listVenueEventOperators(eventId),
      ]);
      if (roster.error) throw new Error(roster.error.message);
      setParticipants(approved);
      setOperators(roster.data);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Could not load venue operator roster.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const operatorByUserId = useMemo(
    () => new Map(operators.map((operator) => [operator.user_id, operator])),
    [operators],
  );

  const assign = useCallback(async (participant: Participant, role: AssignableRole) => {
    setWorkingUserId(participant.user_id);
    try {
      const result = await updateVenueEventOperator({
        eventId,
        userId: participant.user_id,
        role,
        active: true,
      });
      if (result.error) throw new Error(result.error.message);
      if (result.data) {
        setOperators((current) => [
          result.data!,
          ...current.filter((operator) => operator.user_id !== participant.user_id),
        ]);
      }
    } catch (assignError) {
      const message = assignError instanceof Error ? assignError.message : 'Could not update operator role.';
      Alert.alert('Role update failed', message);
    } finally {
      setWorkingUserId(null);
    }
  }, [eventId]);

  const remove = useCallback(async (participant: Participant) => {
    const current = operatorByUserId.get(participant.user_id);
    if (!current) return;
    setWorkingUserId(participant.user_id);
    try {
      const result = await updateVenueEventOperator({
        eventId,
        userId: participant.user_id,
        role: current.role === 'viewer' ? 'organizer' : current.role,
        active: false,
      });
      if (result.error) throw new Error(result.error.message);
      setOperators((rows) => rows.map((row) =>
        row.user_id === participant.user_id ? { ...row, active: false } : row,
      ));
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : 'Could not remove operator access.';
      Alert.alert('Access update failed', message);
    } finally {
      setWorkingUserId(null);
    }
  }, [eventId, operatorByUserId]);

  if (loading && participants.length === 0) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Loader size={56} />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.lg }}>
          Loading operator roster
        </NeonText>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <GridBackground intensity={0.35} />

      <View style={styles.hero}>
        <Pill label="Host controlled" tone="accent" dot />
        <NeonText variant="display" glow style={{ marginTop: spacing.sm }}>
          Venue operators
        </NeonText>
        <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
          Delegate only the authority someone needs. Roles are event-scoped and server enforced; removing access takes that operator out of the active venue roster.
        </NeonText>
      </View>

      <View style={styles.roleGuide}>
        {(Object.keys(ROLE_COPY) as AssignableRole[]).map((role) => (
          <Surface key={role} padded style={styles.roleCard}>
            <NeonText variant="label" tone={roleTone(role)}>{ROLE_COPY[role].title.toUpperCase()}</NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{ROLE_COPY[role].detail}</NeonText>
          </Surface>
        ))}
      </View>

      {error ? (
        <Surface padded style={styles.errorCard}>
          <NeonText variant="label" tone="danger">ROSTER UNAVAILABLE</NeonText>
          <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{error}</NeonText>
          <Pressable onPress={load} style={styles.retryButton}>
            <NeonText variant="label" tone="accent">RETRY</NeonText>
          </Pressable>
        </Surface>
      ) : null}

      <View style={styles.section}>
        <View style={styles.headerRow}>
          <NeonText variant="label" tone="accent">APPROVED PARTICIPANTS</NeonText>
          <Pill label={`${participants.length}`} tone="neutral" />
        </View>

        {participants.length === 0 ? (
          <Surface padded>
            <NeonText variant="bodyMuted">
              No approved participants are available for venue-role assignment yet.
            </NeonText>
          </Surface>
        ) : participants.map((participant) => {
          const row = operatorByUserId.get(participant.user_id);
          const activeRole = row?.active ? row.role : null;
          const working = workingUserId === participant.user_id;

          return (
            <Surface key={participant.user_id} padded style={styles.personCard}>
              <View style={styles.headerRow}>
                <View style={styles.personCopy}>
                  <NeonText variant="h2">{participant.name ?? participant.email ?? 'Approved participant'}</NeonText>
                  <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>
                    {participant.role ?? participant.one_liner ?? 'No profile role provided'}
                  </NeonText>
                </View>
                <Pill
                  label={activeRole ? activeRole.toUpperCase() : 'NO ACCESS'}
                  tone={roleTone(activeRole)}
                />
              </View>

              <View style={styles.roleButtons}>
                {(Object.keys(ROLE_COPY) as AssignableRole[]).map((role) => {
                  const selected = activeRole === role;
                  return (
                    <Pressable
                      key={role}
                      disabled={working}
                      onPress={() => assign(participant, role)}
                      style={[styles.roleButton, selected && styles.roleButtonSelected, working && styles.disabled]}
                    >
                      <NeonText variant="label" tone={selected ? 'accent' : 'muted'}>
                        {ROLE_COPY[role].title.toUpperCase()}
                      </NeonText>
                    </Pressable>
                  );
                })}
                {activeRole ? (
                  <Pressable
                    disabled={working}
                    onPress={() => remove(participant)}
                    style={[styles.roleButton, styles.removeButton, working && styles.disabled]}
                  >
                    <NeonText variant="label" tone="danger">REMOVE</NeonText>
                  </Pressable>
                ) : null}
              </View>
            </Surface>
          );
        })}
      </View>

      <Surface padded style={styles.boundaryCard}>
        <NeonText variant="label" tone="muted">AUTHORITY BOUNDARY</NeonText>
        <NeonText variant="bodyMuted" style={{ marginTop: 5 }}>
          This roster does not bypass control admission, command expiry, telemetry holds, or measured deployment maturity. Role permission and analytical permission are separate checks.
        </NeonText>
      </Surface>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.void },
  content: { paddingBottom: spacing.xxxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.void },
  hero: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.md },
  roleGuide: { paddingHorizontal: spacing.xl, gap: spacing.sm },
  roleCard: { borderRadius: radii.lg },
  section: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, gap: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  personCard: { borderRadius: radii.lg },
  personCopy: { flex: 1 },
  roleButtons: { marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  roleButton: {
    minHeight: 34,
    paddingHorizontal: 11,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
  },
  roleButtonSelected: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
  removeButton: { borderColor: palette.danger },
  disabled: { opacity: 0.45 },
  errorCard: { marginHorizontal: spacing.xl, marginTop: spacing.sm, borderColor: palette.danger },
  retryButton: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  boundaryCard: { marginHorizontal: spacing.xl, marginTop: spacing.xl, borderRadius: radii.lg },
});
