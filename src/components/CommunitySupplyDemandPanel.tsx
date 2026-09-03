import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { CommunityEventPartnership } from '../services/community-exchange.service';
import {
  getCommunityPairSupplyDemand,
  type CommunitySupplyDemandRow,
} from '../services/community-supply-demand.service';
import { EVENT_INTENT_LABELS } from '../services/event-intent.service';
import { NeonText, Pill, Surface } from './ui';
import { palette, radii, spacing } from '../theme';

interface Props {
  eventId: string;
  activePartnerships: CommunityEventPartnership[];
  visibleToOperator: boolean;
}

function postureLabel(posture: CommunitySupplyDemandRow['exchange_posture']): string {
  if (posture === 'two-way') return 'TWO-WAY SUPPORT';
  if (posture === 'a-can-support-b') return 'A → B';
  if (posture === 'b-can-support-a') return 'B → A';
  return 'OBSERVE';
}

function postureTone(posture: CommunitySupplyDemandRow['exchange_posture']): 'success' | 'premium' | 'warning' | 'neutral' {
  if (posture === 'two-way') return 'success';
  if (posture === 'a-can-support-b' || posture === 'b-can-support-a') return 'premium';
  return 'neutral';
}

/**
 * Operator planning surface for two active partner communities.
 * It deliberately presents aggregate complementary supply rather than people.
 * A visible row has already crossed the database's bilateral cohort threshold.
 */
export default function CommunitySupplyDemandPanel({
  eventId,
  activePartnerships,
  visibleToOperator,
}: Readonly<Props>) {
  const [communityA, setCommunityA] = useState<string | null>(null);
  const [communityB, setCommunityB] = useState<string | null>(null);
  const [rows, setRows] = useState<CommunitySupplyDemandRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choices = useMemo(
    () => activePartnerships
      .map((partnership) => ({ id: partnership.community_id, name: partnership.community_name }))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
    [activePartnerships],
  );

  useEffect(() => {
    if (choices.length >= 2) {
      setCommunityA((current) => current && choices.some((choice) => choice.id === current) ? current : choices[0].id);
      setCommunityB((current) => current && choices.some((choice) => choice.id === current) && current !== choices[0].id
        ? current
        : choices[1].id);
    } else {
      setCommunityA(null);
      setCommunityB(null);
      setRows([]);
    }
  }, [choices]);

  const refresh = useCallback(async () => {
    if (!visibleToOperator || !communityA || !communityB || communityA === communityB) {
      setRows([]);
      return;
    }
    setLoading(true);
    const result = await getCommunityPairSupplyDemand({
      eventId,
      communityOneId: communityA,
      communityTwoId: communityB,
    });
    if (result.error) {
      setError(result.error.message);
      setRows([]);
    } else {
      setError(null);
      setRows(result.data);
    }
    setLoading(false);
  }, [communityA, communityB, eventId, visibleToOperator]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!visibleToOperator || choices.length < 2) return null;

  return (
    <View style={styles.wrap}>
      <NeonText variant="label" tone="premium">PARTNER SUPPLY / DEMAND</NeonText>
      <NeonText variant="bodyMuted">
        Compare what two communities explicitly say they need and can provide before deciding whether a partnership deserves structure. Beacon releases a domain only when at least five exchange-enabled declaring participants from each community support that row.
      </NeonText>

      <Surface elevated padded style={styles.card}>
        <NeonText variant="label" tone="muted">COMMUNITY A</NeonText>
        <View style={styles.chips}>
          {choices.map((choice) => (
            <Pressable
              key={`a-${choice.id}`}
              onPress={() => {
                setCommunityA(choice.id);
                if (choice.id === communityB) {
                  const alternative = choices.find((item) => item.id !== choice.id);
                  setCommunityB(alternative?.id ?? null);
                }
              }}
              style={[styles.chip, communityA === choice.id && styles.chipActive]}
            >
              <NeonText variant="label" tone={communityA === choice.id ? 'accent' : 'muted'}>{choice.name}</NeonText>
            </Pressable>
          ))}
        </View>

        <NeonText variant="label" tone="muted" style={styles.fieldLabel}>COMMUNITY B</NeonText>
        <View style={styles.chips}>
          {choices.map((choice) => (
            <Pressable
              key={`b-${choice.id}`}
              onPress={() => {
                setCommunityB(choice.id);
                if (choice.id === communityA) {
                  const alternative = choices.find((item) => item.id !== choice.id);
                  setCommunityA(alternative?.id ?? null);
                }
              }}
              style={[styles.chip, communityB === choice.id && styles.chipActive]}
            >
              <NeonText variant="label" tone={communityB === choice.id ? 'premium' : 'muted'}>{choice.name}</NeonText>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <NeonText variant="bodyMuted" style={styles.status}>Reading cohort-gated partner mix…</NeonText>
        ) : error ? (
          <NeonText variant="bodyMuted" tone="danger" style={styles.status}>{error}</NeonText>
        ) : rows.length === 0 ? (
          <NeonText variant="bodyMuted" style={styles.status}>
            No domain currently clears the bilateral release threshold. Beacon will not convert a small community cohort into operator intelligence.
          </NeonText>
        ) : (
          <View style={styles.list}>
            {rows.slice(0, 8).map((row) => (
              <View key={row.intent_key} style={styles.domainRow}>
                <View style={styles.rowHeader}>
                  <View style={{ flex: 1 }}>
                    <NeonText variant="h2">{EVENT_INTENT_LABELS[row.intent_key]}</NeonText>
                    <NeonText variant="bodyMuted" style={styles.smallTop}>
                      {row.community_a_contributors} supported contributors in {row.community_a_name} · {row.community_b_contributors} in {row.community_b_name}
                    </NeonText>
                  </View>
                  <Pill label={postureLabel(row.exchange_posture)} tone={postureTone(row.exchange_posture)} />
                </View>

                <View style={styles.metricGrid}>
                  <View style={styles.metric}>
                    <NeonText variant="label" tone="muted">{row.community_a_name.toUpperCase()} CAN SUPPORT</NeonText>
                    <NeonText variant="h1" tone="accent">{row.a_supply_for_b_need}</NeonText>
                    <NeonText variant="bodyMuted" style={styles.micro}>bounded by explicit B need</NeonText>
                  </View>
                  <View style={styles.metric}>
                    <NeonText variant="label" tone="muted">{row.community_b_name.toUpperCase()} CAN SUPPORT</NeonText>
                    <NeonText variant="h1" tone="premium">{row.b_supply_for_a_need}</NeonText>
                    <NeonText variant="bodyMuted" style={styles.micro}>bounded by explicit A need</NeonText>
                  </View>
                </View>

                <NeonText variant="bodyMuted" style={styles.smallTop}>
                  Raw mix: {row.community_a_name} {row.community_a_seeking} seeking / {row.community_a_offering} offering · {row.community_b_name} {row.community_b_seeking} seeking / {row.community_b_offering} offering.
                </NeonText>
              </View>
            ))}
          </View>
        )}
      </Surface>

      <NeonText variant="bodyMuted" style={styles.boundary}>
        “Can support” is the smaller of explicit supply on one side and explicit need on the other. It is not a predicted number of matches and grants no exchange or participant-targeting authority.
      </NeonText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  card: { borderRadius: radii.lg, borderColor: palette.premiumSoft },
  chips: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: 1, borderColor: palette.hairlineStrong, backgroundColor: palette.surface },
  chipActive: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
  fieldLabel: { marginTop: spacing.lg },
  status: { marginTop: spacing.lg },
  list: { marginTop: spacing.lg, gap: spacing.md },
  domainRow: { paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.hairline },
  rowHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  smallTop: { marginTop: 4 },
  metricGrid: { marginTop: spacing.sm, flexDirection: 'row', gap: spacing.sm },
  metric: { flex: 1, padding: spacing.sm, borderRadius: radii.md, backgroundColor: palette.surface },
  micro: { marginTop: 2, fontSize: 9 },
  boundary: { fontSize: 10, lineHeight: 15 },
});
