import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import type { PartnerCommitmentScope } from '../services/partner-commitment.service';
import {
  capturePartnerCommitmentCloseout,
  decidePartnerCommitmentCloseout,
  getPartnerCommitmentCloseout,
  getPartnerCommitmentExecutionPreflight,
  getPartnerCommitmentIntegrity,
  getPartnerProgramSettlementSummary,
  type PartnerCommitmentCloseout,
  type PartnerCommitmentIntegrity,
  type PartnerCommitmentPreflightIssue,
  type PartnerProgramSettlementSummary,
} from '../services/partner-commitment-governance.service';
import { NeonText, Pill, Surface } from './ui';
import { palette, radii, spacing } from '../theme';

interface Props {
  scope: PartnerCommitmentScope;
}

function preflightPosture(issues: PartnerCommitmentPreflightIssue[]): 'ready' | 'attention' | 'blocked' {
  if (issues.some((issue) => issue.severity === 'block')) return 'blocked';
  if (issues.some((issue) => issue.severity === 'review')) return 'attention';
  return 'ready';
}

function toneForPosture(posture: 'ready' | 'attention' | 'blocked'): 'success' | 'warning' | 'danger' {
  if (posture === 'blocked') return 'danger';
  if (posture === 'attention') return 'warning';
  return 'success';
}

function toneForIssue(severity: PartnerCommitmentPreflightIssue['severity']): 'danger' | 'warning' | 'neutral' {
  if (severity === 'block') return 'danger';
  if (severity === 'review') return 'warning';
  return 'neutral';
}

function shortHash(value: string | null): string {
  if (!value) return '—';
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

export default function PartnerCommitmentGovernanceCard({ scope }: Readonly<Props>) {
  const [integrity, setIntegrity] = useState<PartnerCommitmentIntegrity | null>(null);
  const [issues, setIssues] = useState<PartnerCommitmentPreflightIssue[]>([]);
  const [closeout, setCloseout] = useState<PartnerCommitmentCloseout | null>(null);
  const [programSettlement, setProgramSettlement] = useState<PartnerProgramSettlementSummary | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [integrityResult, preflightResult, closeoutResult, settlementResult] = await Promise.all([
      getPartnerCommitmentIntegrity(scope.scopeId),
      getPartnerCommitmentExecutionPreflight(scope.scopeId),
      scope.scopeKind === 'event-exchange'
        ? getPartnerCommitmentCloseout(scope.scopeId)
        : Promise.resolve({ data: null as PartnerCommitmentCloseout | null, error: null }),
      scope.scopeKind === 'program-template' && scope.programId
        ? getPartnerProgramSettlementSummary(scope.programId)
        : Promise.resolve({ data: null as PartnerProgramSettlementSummary | null, error: null }),
    ]);

    const firstError = integrityResult.error ?? preflightResult.error ?? closeoutResult.error ?? settlementResult.error;
    if (firstError) setError(firstError.message);
    if (!integrityResult.error) setIntegrity(integrityResult.data);
    if (!preflightResult.error) setIssues(preflightResult.data);
    if (!closeoutResult.error) setCloseout(closeoutResult.data);
    if (!settlementResult.error) setProgramSettlement(settlementResult.data);
  }, [scope.programId, scope.scopeId, scope.scopeKind]);

  useEffect(() => {
    load();
  }, [load]);

  const posture = useMemo(() => preflightPosture(issues), [issues]);
  const blockingCount = issues.filter((issue) => issue.severity === 'block').length;
  const reviewCount = issues.filter((issue) => issue.severity === 'review').length;
  const infoCount = issues.filter((issue) => issue.severity === 'info').length;

  const captureCloseout = useCallback(async () => {
    setWorking(true);
    const result = await capturePartnerCommitmentCloseout(scope.scopeId);
    setWorking(false);
    if (result.error || !result.snapshotId) {
      Alert.alert('Closeout snapshot not captured', result.error?.message ?? 'The server did not confirm a new evidence snapshot.');
      return;
    }
    await load();
  }, [load, scope.scopeId]);

  const decideCloseout = useCallback(async (decision: 'acknowledged' | 'disputed') => {
    if (!closeout) return;
    setWorking(true);
    const result = await decidePartnerCommitmentCloseout(closeout.snapshotId, decision);
    setWorking(false);
    if (result.error || !result.state) {
      Alert.alert('Closeout decision not recorded', result.error?.message ?? 'The server did not confirm your evidence review.');
      return;
    }
    await load();
  }, [closeout, load]);

  return (
    <View style={styles.wrap}>
      <Surface elevated padded style={styles.card}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <NeonText variant="label" tone="accent">COMMITMENT CONTROL PLANE</NeonText>
            <NeonText variant="h2" style={styles.smallTop}>Know what is unresolved before it becomes a partnership dispute.</NeonText>
          </View>
          <Pill label={posture.toUpperCase()} tone={toneForPosture(posture)} />
        </View>
        <NeonText variant="bodyMuted" style={styles.smallTop}>
          This preflight is deterministic operating hygiene, not a prediction or partner-quality score. It surfaces missing acceptance, unresolved amendments, scheduling gaps, manual-evidence dependencies, and disputed measurement state.
        </NeonText>

        <View style={styles.metricRow}>
          <View style={styles.metric}>
            <NeonText variant="label" tone="muted">BLOCK</NeonText>
            <NeonText variant="h1" tone={blockingCount > 0 ? 'danger' : 'text'}>{blockingCount}</NeonText>
          </View>
          <View style={styles.metric}>
            <NeonText variant="label" tone="muted">REVIEW</NeonText>
            <NeonText variant="h1" tone={reviewCount > 0 ? 'warning' : 'text'}>{reviewCount}</NeonText>
          </View>
          <View style={styles.metric}>
            <NeonText variant="label" tone="muted">INFO</NeonText>
            <NeonText variant="h1">{infoCount}</NeonText>
          </View>
        </View>

        {issues.length > 0 ? (
          <View style={styles.issueList}>
            {issues.slice(0, 6).map((issue, index) => (
              <View key={`${issue.issueCode}:${issue.commitmentId ?? 'scope'}:${index}`} style={styles.issueRow}>
                <Pill label={issue.severity.toUpperCase()} tone={toneForIssue(issue.severity)} />
                <View style={{ flex: 1 }}>
                  <NeonText variant="label" tone="muted">
                    {issue.partyLabel ? `${issue.partyLabel.toUpperCase()} · ` : ''}{issue.issueCode.replaceAll('-', ' ').toUpperCase()}
                  </NeonText>
                  <NeonText variant="bodyMuted" style={styles.smallTop}>{issue.detail}</NeonText>
                  <NeonText variant="bodyMuted" style={styles.actionCopy}>{issue.suggestedAction}</NeonText>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <NeonText variant="bodyMuted" style={styles.noIssues}>
            No blocking or review-level execution exceptions are currently visible in this shared scope.
          </NeonText>
        )}
      </Surface>

      <Surface padded style={styles.card}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <NeonText variant="label" tone="premium">CONTRACT INTEGRITY</NeonText>
            <NeonText variant="bodyMuted" style={styles.smallTop}>
              Accepted immutable revisions receive a server-side SHA-256 seal chained within each obligation.
            </NeonText>
          </View>
          <Pill
            label={integrity?.valid ? 'CHAIN VALID' : integrity ? 'CHECK FAILED' : 'CHECKING'}
            tone={integrity?.valid ? 'success' : integrity ? 'danger' : 'neutral'}
          />
        </View>
        <View style={styles.metricRow}>
          <View style={styles.metricWide}>
            <NeonText variant="label" tone="muted">SEALED / ACCEPTED REVISIONS</NeonText>
            <NeonText variant="h2">{integrity ? `${integrity.sealedRevisionCount} / ${integrity.acceptedRevisionCount}` : '—'}</NeonText>
          </View>
          <View style={styles.metricWide}>
            <NeonText variant="label" tone="muted">SCOPE FINGERPRINT</NeonText>
            <NeonText variant="mono" tone="accent">{shortHash(integrity?.scopeFingerprint ?? null)}</NeonText>
          </View>
        </View>
        <NeonText variant="bodyMuted" style={styles.boundaryCopy}>
          This detects internal mutation or missing accepted seals. It is not an external signature, blockchain notarization, legal opinion, or proof that a real-world obligation was performed.
        </NeonText>
      </Surface>

      {scope.scopeKind === 'event-exchange' && scope.eventEndedAt ? (
        <Surface elevated padded style={styles.closeoutCard}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <NeonText variant="label" tone="premium">BILATERAL CLOSEOUT</NeonText>
              <NeonText variant="h2" style={styles.smallTop}>Both communities review the same evidence version.</NeonText>
            </View>
            <Pill
              label={(closeout?.settlementState ?? 'pending').toUpperCase()}
              tone={closeout?.settlementState === 'settled' ? 'success'
                : closeout?.settlementState === 'disputed' || closeout?.settlementState === 'stale' ? 'warning'
                  : 'neutral'}
            />
          </View>
          <NeonText variant="bodyMuted" style={styles.smallTop}>
            Event closeout is versioned. If later supported evidence changes the ledger, the prior snapshot becomes stale rather than silently rewriting what both partners previously reviewed.
          </NeonText>

          {closeout ? (
            <>
              <View style={styles.metricRow}>
                <View style={styles.metric}>
                  <NeonText variant="label" tone="muted">COMMITMENTS</NeonText>
                  <NeonText variant="h1">{closeout.commitmentCount}</NeonText>
                </View>
                <View style={styles.metric}>
                  <NeonText variant="label" tone="muted">TERMINAL</NeonText>
                  <NeonText variant="h1">{closeout.terminalCommitmentCount}</NeonText>
                </View>
                <View style={styles.metric}>
                  <NeonText variant="label" tone="muted">MEASURED</NeonText>
                  <NeonText variant="h1">{closeout.measuredCommitmentCount}</NeonText>
                </View>
              </View>
              <NeonText variant="label" tone="muted" style={styles.hashCopy}>
                SNAPSHOT V{closeout.snapshotNo} · {shortHash(closeout.snapshotHash)}
              </NeonText>
              {closeout.manualDisputeCount > 0 || closeout.manualPendingCount > 0 ? (
                <NeonText variant="bodyMuted" style={styles.warningCopy}>
                  {closeout.manualDisputeCount} disputed and {closeout.manualPendingCount} pending manual evidence review item(s) are preserved in this snapshot.
                </NeonText>
              ) : null}
              {closeout.settlementState === 'stale' ? (
                <NeonText variant="bodyMuted" style={styles.warningCopy}>
                  Current evidence no longer matches this snapshot. Capture a new version before either community settles the closeout.
                </NeonText>
              ) : null}
            </>
          ) : (
            <NeonText variant="bodyMuted" style={styles.noIssues}>
              No closeout snapshot exists yet. Capture the current ledger state before bilateral evidence review.
            </NeonText>
          )}

          <View style={styles.buttonRow}>
            <Pressable disabled={working} onPress={captureCloseout} style={[styles.primaryButton, working && styles.disabled]}>
              <NeonText variant="label" tone="accent">{closeout?.settlementState === 'stale' ? 'CAPTURE NEW VERSION' : 'CAPTURE CURRENT EVIDENCE'}</NeonText>
            </Pressable>
          </View>

          {closeout?.callerCanDecide && closeout.isCurrent ? (
            <View style={styles.buttonRow}>
              <Pressable disabled={working} onPress={() => decideCloseout('acknowledged')} style={[styles.primaryFlex, working && styles.disabled]}>
                <NeonText variant="label" tone="success">ACKNOWLEDGE</NeonText>
              </Pressable>
              <Pressable disabled={working} onPress={() => decideCloseout('disputed')} style={[styles.ghostFlex, working && styles.disabled]}>
                <NeonText variant="label" tone="warning">DISPUTE EVIDENCE</NeonText>
              </Pressable>
            </View>
          ) : null}

          <NeonText variant="bodyMuted" style={styles.boundaryCopy}>
            “Settled” means both community owners acknowledged the same current evidence snapshot. It does not prove causality, partner fairness, a deal, a hire, or commercial success.
          </NeonText>
        </Surface>
      ) : null}

      {scope.scopeKind === 'program-template' && programSettlement ? (
        <Surface padded style={styles.card}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <NeonText variant="label" tone="premium">REPEAT-EVENT EVIDENCE MATURITY</NeonText>
              <NeonText variant="bodyMuted" style={styles.smallTop}>
                Reusable configuration and settled evidence are different assets. Historical templates can reduce setup cost; only reviewed closeouts strengthen institutional confidence.
              </NeonText>
            </View>
            <Pill label={`${percent(programSettlement.settlementCoverage)} SETTLED`} tone="premium" />
          </View>
          <View style={styles.metricRow}>
            <View style={styles.metric}><NeonText variant="label" tone="muted">ENDED</NeonText><NeonText variant="h1">{programSettlement.endedEventCount}</NeonText></View>
            <View style={styles.metric}><NeonText variant="label" tone="muted">SETTLED</NeonText><NeonText variant="h1" tone="success">{programSettlement.settledScopeCount}</NeonText></View>
            <View style={styles.metric}><NeonText variant="label" tone="muted">STALE</NeonText><NeonText variant="h1" tone={programSettlement.staleScopeCount > 0 ? 'warning' : 'text'}>{programSettlement.staleScopeCount}</NeonText></View>
          </View>
          <NeonText variant="bodyMuted" style={styles.boundaryCopy}>
            Pending, disputed, and stale histories remain visible as uncertainty. They are not silently converted into strong reusable evidence.
          </NeonText>
        </Surface>
      ) : null}

      {error ? (
        <Surface padded style={styles.errorCard}>
          <NeonText variant="label" tone="danger">GOVERNANCE EVIDENCE DEGRADED</NeonText>
          <NeonText variant="bodyMuted" style={styles.smallTop}>{error}</NeonText>
          <Pressable disabled={working} onPress={load} style={styles.retryButton}>
            <NeonText variant="label" tone="accent">RETRY</NeonText>
          </Pressable>
        </Surface>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  card: { borderRadius: radii.lg },
  closeoutCard: { borderRadius: radii.lg, borderColor: palette.premiumSoft },
  errorCard: { borderRadius: radii.lg, borderColor: palette.danger },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  smallTop: { marginTop: 4 },
  metricRow: { marginTop: spacing.md, flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  metric: { minWidth: 84, flex: 1, padding: spacing.sm, borderRadius: radii.md, backgroundColor: palette.surface },
  metricWide: { minWidth: 150, flex: 1, padding: spacing.sm, borderRadius: radii.md, backgroundColor: palette.surface },
  issueList: { marginTop: spacing.md, gap: spacing.sm },
  issueRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.hairline },
  actionCopy: { marginTop: 3, color: palette.textDim },
  noIssues: { marginTop: spacing.md },
  boundaryCopy: { marginTop: spacing.sm, fontSize: 10, lineHeight: 15 },
  hashCopy: { marginTop: spacing.md },
  warningCopy: { marginTop: spacing.sm, color: palette.warning },
  buttonRow: { marginTop: spacing.md, flexDirection: 'row', gap: spacing.sm },
  primaryButton: { minHeight: 42, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.accent, backgroundColor: palette.accentSoft },
  primaryFlex: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.success, backgroundColor: palette.successSoft },
  ghostFlex: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.warning },
  retryButton: { marginTop: spacing.md, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.accent },
  disabled: { opacity: 0.45 },
});
