import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { revokeMyInternalOperatorCapabilityLease } from '../admin/internalOperatorSecurity.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

function remainingMinutes(expiresAt: string): number {
  const delta = Date.parse(expiresAt) - Date.now();
  return Math.max(0, Math.ceil(delta / 60_000));
}

export default function InternalPrivateAccessScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const operator = useInternalOperator();
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const activeLeases = useMemo(
    () => [...operator.activeLeases].sort((left, right) => Date.parse(left.expiresAt) - Date.parse(right.expiresAt)),
    [operator.activeLeases],
  );

  const revoke = async (leaseId: string) => {
    setRevokingId(leaseId);
    try {
      await revokeMyInternalOperatorCapabilityLease(leaseId);
      await operator.refresh();
    } catch (error) {
      Alert.alert('Lease revocation failed', error instanceof Error ? error.message : 'Unable to revoke temporary capability.');
    } finally {
      setRevokingId(null);
    }
  };

  if (!operator.allowed || !operator.has('graph_manage')) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Surface padded style={styles.lockedCard}>
          <Pill label="PRIVATE ACCESS · SEALED" tone="neutral" dot />
          <NeonText variant="h1" style={{ marginTop: spacing.md }}>Standing graph management required.</NeonText>
          <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>Temporary restricted/export elevation is visible only to the operator who owns it.</NeonText>
        </Surface>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · PRIVATE ACCESS CONTROL" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Private Access</NeonText>
              <NeonText variant="bodyMuted">Standing privileges · just-in-time capability leases · self-revocation · fail-closed server truth</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <Surface padded style={styles.card}>
            <Pill label="LEAST-PRIVILEGE CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>{operator.leastPrivilegeRule}</NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: 4, lineHeight: 19 }}>The mobile client can never issue or extend a temporary lease. Only the server/service boundary can grant one; this screen can only inspect and revoke the caller's own active lease.</NeonText>
          </Surface>

          <Section title="STANDING CAPABILITIES" subtitle="Longer-lived privileges provisioned outside the mobile client">
            <View style={styles.pillRow}>
              {operator.standingCapabilities.map((capability) => <Pill key={capability} label={capability.replaceAll('_', ' ').toUpperCase()} tone="accent" />)}
              {operator.standingCapabilities.length === 0 ? <NeonText variant="bodyMuted">No standing capabilities are active.</NeonText> : null}
            </View>
          </Section>

          <Section title="EFFECTIVE SERVER ENVELOPE" subtitle="Standing + currently active leased capabilities after server evaluation">
            <View style={styles.pillRow}>
              <Pill label={`READ ${operator.read ? 'YES' : 'NO'}`} tone={operator.read ? 'accent' : 'neutral'} />
              <Pill label={`MANAGE ${operator.manage ? 'YES' : 'NO'}`} tone={operator.manage ? 'accent' : 'neutral'} />
              <Pill label={`RESTRICTED ${operator.restricted ? 'YES' : 'NO'}`} tone={operator.restricted ? 'accent' : 'neutral'} />
              <Pill label={`EXPORT ${operator.export ? 'YES' : 'NO'}`} tone={operator.export ? 'accent' : 'neutral'} />
            </View>
          </Section>

          <Section title="ACTIVE JIT LEASES" subtitle="Service-issued only · 5–120 minute TTL · caller can revoke early">
            {activeLeases.map((lease) => (
              <Surface key={lease.id} elevated padded style={styles.leaseCard}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Pill label={lease.capability.replaceAll('_', ' ').toUpperCase()} tone="accent" dot />
                    <NeonText variant="h2" style={{ marginTop: spacing.sm }}>{remainingMinutes(lease.expiresAt)} min remaining</NeonText>
                    <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{lease.reason}</NeonText>
                  </View>
                  <Pill label={`EXPIRES ${new Date(lease.expiresAt).toLocaleTimeString()}`} tone="neutral" />
                </View>
                <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>Granted {new Date(lease.grantedAt).toLocaleString()} · lease {lease.id.slice(0, 8)}…</NeonText>
                <View style={styles.actionRow}>
                  <GlowButton
                    label={revokingId === lease.id ? 'Revoking…' : 'Revoke now'}
                    variant="ghost"
                    disabled={revokingId !== null}
                    onPress={() => revoke(lease.id)}
                  />
                </View>
              </Surface>
            ))}
            {activeLeases.length === 0 ? <NeonText variant="bodyMuted">No temporary restricted/export capability is active.</NeonText> : null}
          </Section>

          <Surface padded style={styles.card}>
            <Pill label="NO SELF-ELEVATION PATH" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>A graph manager cannot convert graph_manage into restricted or export access from this UI, from client state, or through the self-revocation RPC. Lease issuance remains service-role-only and requires an already-active standing graph_manage grant.</NeonText>
          </Surface>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Section({ title, subtitle, children }: Readonly<{ title: string; subtitle: string; children: React.ReactNode }>) {
  return <View style={styles.section}><View><NeonText variant="label" tone="accent">{title}</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{subtitle}</NeonText></View>{children}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#02050D' },
  centered: { flex: 1, backgroundColor: '#02050D', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  lockedCard: { width: '100%', maxWidth: 540, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 120, gap: spacing.lg },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, fontSize: 40 },
  card: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  section: { gap: spacing.sm },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  leaseCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  actionRow: { marginTop: spacing.md, flexDirection: 'row', gap: spacing.sm },
});
