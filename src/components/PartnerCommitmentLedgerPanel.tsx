import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import {
  PARTNER_COMMITMENT_OPTIONS,
  formatPartnerCommitmentQuantity,
  getPartnerCommitmentOption,
  type PartnerCommitmentPartyKind,
  type PartnerCommitmentType,
} from '../partners/PartnerCommitmentModel';
import {
  advancePartnerCommitment,
  decidePartnerCommitment,
  ensurePartnerCommitmentScope,
  getPartnerCommitmentHistory,
  getPartnerCommitmentLedger,
  getPartnerProgramCommitmentMemory,
  prefillPartnerProgramCommitments,
  proposePartnerCommitment,
  recordManualPartnerCommitmentMeasurement,
  refreshPartnerCommitmentMeasurement,
  reviewPartnerCommitmentMeasurement,
  revisePartnerCommitment,
  type PartnerCommitmentHistoryRow,
  type PartnerCommitmentRow,
  type PartnerCommitmentScope,
  type PartnerProgramCommitmentMemoryRow,
} from '../services/partner-commitment.service';
import { EVENT_INTENT_KEYS, EVENT_INTENT_LABELS, type EventIntentKey } from '../services/event-intent.service';
import { NeonText, Pill, Surface } from './ui';
import { palette, radii, spacing } from '../theme';
import PartnerCommitmentGovernanceCard from './PartnerCommitmentGovernanceCard';

type Props =
  | { scopeKind: 'program-template'; programId: string; compact?: boolean }
  | { scopeKind: 'event-exchange'; exchangeId: string; compact?: boolean };

type PartyChoice = {
  key: string;
  kind: PartnerCommitmentPartyKind;
  communityId: string | null;
  label: string;
};

function statusTone(status: PartnerCommitmentRow['lifecycleStatus']): 'success' | 'warning' | 'neutral' {
  if (status === 'fulfilled') return 'success';
  if (status === 'delivering' || status === 'scheduled' || status === 'partially_fulfilled') return 'warning';
  return 'neutral';
}

function evidenceLabel(row: PartnerCommitmentRow): string {
  switch (row.evidenceQuality) {
    case 'server-recorded': return 'SERVER-RECORDED';
    case 'participant-attested-aggregate': return 'PARTICIPANT-ATTESTED AGGREGATE';
    case 'manual-operator': return 'MANUAL OPERATOR';
    case 'mixed': return 'MIXED EVIDENCE';
    default: return 'EVIDENCE NOT YET SUFFICIENT';
  }
}

function formatDomain(domain: string | null): string {
  if (!domain) return 'General';
  return EVENT_INTENT_LABELS[domain as EventIntentKey] ?? domain.replaceAll('_', ' ');
}

function numericInput(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export default function PartnerCommitmentLedgerPanel(props: Readonly<Props>) {
  const [scope, setScope] = useState<PartnerCommitmentScope | null>(null);
  const [rows, setRows] = useState<PartnerCommitmentRow[]>([]);
  const [memory, setMemory] = useState<PartnerProgramCommitmentMemoryRow[]>([]);
  const [expanded, setExpanded] = useState(!props.compact);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPartyKey, setSelectedPartyKey] = useState<string | null>(null);
  const [commitmentType, setCommitmentType] = useState<PartnerCommitmentType>('mentor_slots');
  const [domain, setDomain] = useState<EventIntentKey | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [editing, setEditing] = useState<PartnerCommitmentRow | null>(null);
  const [manualRevisionId, setManualRevisionId] = useState<string | null>(null);
  const [manualDelivered, setManualDelivered] = useState('0');
  const [manualUsed, setManualUsed] = useState('0');
  const [historyCommitmentId, setHistoryCommitmentId] = useState<string | null>(null);
  const [history, setHistory] = useState<PartnerCommitmentHistoryRow[]>([]);

  const load = useCallback(async () => {
    setError(null);
    const ensured = props.scopeKind === 'program-template'
      ? await ensurePartnerCommitmentScope({ scopeKind: 'program-template', programId: props.programId })
      : await ensurePartnerCommitmentScope({ scopeKind: 'event-exchange', exchangeId: props.exchangeId });
    if (ensured.error || !ensured.data) {
      setScope(null);
      setRows([]);
      setError(ensured.error?.message ?? 'Commitment ledger is unavailable for this partnership.');
      return;
    }
    setScope(ensured.data);
    const [ledger, memoryResult] = await Promise.all([
      getPartnerCommitmentLedger(ensured.data.scopeId),
      props.scopeKind === 'program-template'
        ? getPartnerProgramCommitmentMemory(props.programId)
        : Promise.resolve({ data: [] as PartnerProgramCommitmentMemoryRow[], error: null }),
    ]);
    if (ledger.error) setError(ledger.error.message);
    setRows(ledger.data);
    setMemory(memoryResult.error ? [] : memoryResult.data);
  }, [props]);

  useEffect(() => {
    load();
  }, [load]);

  const partyChoices = useMemo<PartyChoice[]>(() => {
    if (!scope) return [];
    const choices: PartyChoice[] = [];
    if (scope.callerRoles.includes('community-a')) {
      choices.push({ key: 'community-a', kind: 'community', communityId: scope.communityAId, label: scope.communityAName });
    }
    if (scope.callerRoles.includes('community-b')) {
      choices.push({ key: 'community-b', kind: 'community', communityId: scope.communityBId, label: scope.communityBName });
    }
    if (scope.scopeKind === 'event-exchange' && scope.callerRoles.includes('event-host')) {
      choices.push({ key: 'event-host', kind: 'event-host', communityId: null, label: 'Event host' });
    }
    return choices;
  }, [scope]);

  useEffect(() => {
    if (partyChoices.length > 0 && !partyChoices.some((choice) => choice.key === selectedPartyKey)) {
      setSelectedPartyKey(partyChoices[0].key);
    }
  }, [partyChoices, selectedPartyKey]);

  const selectedParty = partyChoices.find((choice) => choice.key === selectedPartyKey) ?? null;
  const selectedOption = getPartnerCommitmentOption(commitmentType);

  const resetEditor = useCallback(() => {
    setEditing(null);
    setCommitmentType('mentor_slots');
    setDomain(null);
    setQuantity('1');
  }, []);

  const saveCommitment = useCallback(async () => {
    if (!scope) return;
    const parsed = numericInput(quantity);
    if (parsed == null || parsed <= 0) {
      Alert.alert('Quantity required', 'Use a positive bounded quantity for the resource being committed.');
      return;
    }
    if (commitmentType === 'domain_support_capacity' && !domain) {
      Alert.alert('Domain required', 'Domain-specific support capacity must name one reviewed Beacon domain.');
      return;
    }
    if (!editing && !selectedParty) {
      Alert.alert('Committed party required', 'A party can propose only its own commitment.');
      return;
    }

    setWorking(true);
    const result = editing
      ? await revisePartnerCommitment({
          commitmentId: editing.commitmentId,
          commitmentType,
          domain,
          committedQuantity: parsed,
          windowStart: scope.scopeKind === 'event-exchange' ? scope.eventStartsAt : null,
          windowEnd: scope.scopeKind === 'event-exchange' ? scope.eventEndsAt : null,
        })
      : await proposePartnerCommitment({
          scopeId: scope.scopeId,
          partyKind: selectedParty!.kind,
          communityId: selectedParty!.communityId,
          commitmentType,
          domain,
          committedQuantity: parsed,
          windowStart: scope.scopeKind === 'event-exchange' ? scope.eventStartsAt : null,
          windowEnd: scope.scopeKind === 'event-exchange' ? scope.eventEndsAt : null,
        });
    setWorking(false);
    const failed = result.error || (editing ? !('revisionId' in result) || !result.revisionId : !('commitmentId' in result) || !result.commitmentId);
    if (failed) {
      Alert.alert('Commitment not saved', result.error?.message ?? 'The server did not confirm the new commitment revision.');
      return;
    }
    resetEditor();
    await load();
  }, [commitmentType, domain, editing, load, quantity, resetEditor, scope, selectedParty]);

  const beginRevision = useCallback((row: PartnerCommitmentRow) => {
    setEditing(row);
    setCommitmentType(row.commitmentType);
    setDomain(row.domain as EventIntentKey | null);
    setQuantity(String(row.committedQuantity));
  }, []);

  const decideRevision = useCallback(async (revisionId: string, decision: 'accepted' | 'rejected' | 'withdrawn') => {
    setWorking(true);
    const result = await decidePartnerCommitment(revisionId, decision);
    setWorking(false);
    if (result.error || !result.state) {
      Alert.alert('Decision not recorded', result.error?.message ?? 'The server did not confirm the commitment decision.');
      return;
    }
    await load();
  }, [load]);

  const reviewManualEvidence = useCallback(async (row: PartnerCommitmentRow, decision: 'acknowledged' | 'disputed') => {
    if (!row.latestMeasurementId) return;
    setWorking(true);
    const result = await reviewPartnerCommitmentMeasurement(row.latestMeasurementId, decision);
    setWorking(false);
    if (result.error || !result.state) {
      Alert.alert('Manual evidence review not recorded', result.error?.message ?? 'The server did not confirm your review.');
      return;
    }
    await load();
  }, [load]);

  const advance = useCallback(async (
    row: PartnerCommitmentRow,
    state: 'scheduled' | 'delivering' | 'fulfilled' | 'partially_fulfilled' | 'cancelled' | 'not_fulfilled',
  ) => {
    setWorking(true);
    const result = await advancePartnerCommitment(row.revisionId, state);
    setWorking(false);
    if (result.error || !result.changed) {
      Alert.alert('Lifecycle update rejected', result.error?.message ?? 'The server did not confirm the lifecycle change.');
      return;
    }
    await load();
  }, [load]);

  const refreshEvidence = useCallback(async (row: PartnerCommitmentRow) => {
    setWorking(true);
    const result = await refreshPartnerCommitmentMeasurement(row.revisionId);
    setWorking(false);
    if (result.error || !result.measurementId) {
      Alert.alert('Evidence refresh failed', result.error?.message ?? 'Beacon could not produce a new evidence snapshot.');
      return;
    }
    await load();
  }, [load]);

  const saveManual = useCallback(async (row: PartnerCommitmentRow) => {
    const delivered = numericInput(manualDelivered);
    const used = numericInput(manualUsed);
    if (delivered == null || used == null || used > delivered) {
      Alert.alert('Invalid manual evidence', 'Utilized quantity cannot exceed the manually acknowledged delivered quantity.');
      return;
    }
    setWorking(true);
    const result = await recordManualPartnerCommitmentMeasurement({
      revisionId: row.revisionId,
      deliveredQuantity: delivered,
      utilizedQuantity: used,
    });
    setWorking(false);
    if (result.error || !result.measurementId) {
      Alert.alert('Manual evidence not recorded', result.error?.message ?? 'The server did not confirm this operator acknowledgement.');
      return;
    }
    setManualRevisionId(null);
    await load();
  }, [load, manualDelivered, manualUsed]);

  const prefill = useCallback(async () => {
    if (props.scopeKind !== 'event-exchange') return;
    setWorking(true);
    const result = await prefillPartnerProgramCommitments(props.exchangeId);
    setWorking(false);
    if (result.error) {
      Alert.alert('Program prefill failed', result.error.message);
      return;
    }
    Alert.alert(
      result.createdCount > 0 ? 'Commitment templates copied' : 'No new templates to copy',
      result.createdCount > 0
        ? `${result.createdCount} historical template${result.createdCount === 1 ? '' : 's'} were copied as proposed event commitments. Every required party must accept again for this event.`
        : 'Existing event commitments were left unchanged. Historical configuration never auto-binds a future event.',
    );
    await load();
  }, [load, props]);

  const toggleHistory = useCallback(async (row: PartnerCommitmentRow) => {
    if (historyCommitmentId === row.commitmentId) {
      setHistoryCommitmentId(null);
      setHistory([]);
      return;
    }
    const result = await getPartnerCommitmentHistory(row.commitmentId);
    if (result.error) {
      Alert.alert('History unavailable', result.error.message);
      return;
    }
    setHistoryCommitmentId(row.commitmentId);
    setHistory(result.data);
  }, [historyCommitmentId]);

  if (!scope && !error) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <NeonText variant="label" tone="premium">PARTNERSHIP COMMITMENTS</NeonText>
          <NeonText variant="bodyMuted" style={styles.smallTop}>
            {scope?.scopeKind === 'program-template'
              ? 'Reusable operating templates. They can reduce future setup work, but they cannot bind a future event without fresh acceptance.'
              : 'A shared operating contract: what each party promised, what was delivered, what was used, and which supported outcomes followed.'}
          </NeonText>
        </View>
        {props.compact ? (
          <Pressable onPress={() => setExpanded((current) => !current)} style={styles.compactButton}>
            <NeonText variant="label" tone="accent">{expanded ? 'CLOSE' : 'OPEN'}</NeonText>
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Surface padded style={styles.errorCard}>
          <NeonText variant="label" tone="danger">LEDGER UNAVAILABLE</NeonText>
          <NeonText variant="bodyMuted" style={styles.smallTop}>{error}</NeonText>
        </Surface>
      ) : null}

      {expanded && scope ? (
        <>
          <Surface padded style={styles.boundaryCard}>
            <NeonText variant="label" tone="muted">OPERATING BOUNDARY</NeonText>
            <NeonText variant="bodyMuted" style={styles.smallTop}>
              Different resources are not converted into a fairness score. Beacon shows promised, delivered, utilized and unused quantities within each resource's own semantics. No public leaderboard is created.
            </NeonText>
          </Surface>

          <PartnerCommitmentGovernanceCard scope={scope} />

          {scope.scopeKind === 'event-exchange' && scope.canPrefillProgram ? (
            <Pressable disabled={working} onPress={prefill} style={styles.prefillButton}>
              <NeonText variant="label" tone="premium">PREFILL FROM PARTNER PROGRAM</NeonText>
              <NeonText variant="bodyMuted" style={styles.smallTop}>Copies accepted templates as proposed commitments. Event acceptance resets to zero.</NeonText>
            </Pressable>
          ) : null}

          {rows.length === 0 ? (
            <Surface padded style={styles.card}>
              <NeonText variant="bodyMuted">No structured commitments have been proposed in this shared ledger yet.</NeonText>
            </Surface>
          ) : rows.map((row) => {
            const delivered = row.deliveredQuantity ?? 0;
            const used = row.utilizedQuantity ?? 0;
            const unused = Math.max(0, delivered - used);
            const canMeasure = scope.scopeKind === 'event-exchange' && row.acceptanceState === 'accepted';
            const manualOpen = manualRevisionId === row.revisionId;
            const manualFinalizationBlocked = row.measurementReviewState === 'pending' || row.measurementReviewState === 'disputed';
            return (
              <Surface key={row.commitmentId} elevated padded style={styles.card}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <NeonText variant="label" tone="accent">{row.committedPartyLabel.toUpperCase()}</NeonText>
                    <NeonText variant="h2" style={styles.smallTop}>{getPartnerCommitmentOption(row.commitmentType).label}</NeonText>
                    <NeonText variant="bodyMuted" style={styles.smallTop}>{formatDomain(row.domain)}</NeonText>
                  </View>
                  <Pill label={row.lifecycleStatus.replaceAll('_', ' ').toUpperCase()} tone={statusTone(row.lifecycleStatus)} />
                </View>

                <View style={styles.metrics}>
                  <View style={styles.metric}><NeonText variant="label" tone="muted">PROMISED</NeonText><NeonText variant="h2">{formatPartnerCommitmentQuantity(row.committedQuantity, row.commitmentType)}</NeonText></View>
                  {scope.scopeKind === 'event-exchange' ? (
                    <>
                      <View style={styles.metric}><NeonText variant="label" tone="muted">DELIVERED</NeonText><NeonText variant="h2">{formatPartnerCommitmentQuantity(row.deliveredQuantity, row.commitmentType)}</NeonText></View>
                      <View style={styles.metric}><NeonText variant="label" tone="muted">USED</NeonText><NeonText variant="h2">{formatPartnerCommitmentQuantity(row.utilizedQuantity, row.commitmentType)}</NeonText></View>
                      <View style={styles.metric}><NeonText variant="label" tone="muted">UNUSED</NeonText><NeonText variant="h2">{formatPartnerCommitmentQuantity(row.deliveredQuantity == null ? null : unused, row.commitmentType)}</NeonText></View>
                    </>
                  ) : null}
                </View>

                <View style={styles.metaRow}>
                  <Pill label={row.acceptanceState.replaceAll('-', ' ').toUpperCase()} tone={row.acceptanceState === 'accepted' ? 'success' : 'warning'} />
                  {scope.scopeKind === 'event-exchange' ? <Pill label={evidenceLabel(row)} tone="neutral" /> : null}
                  {row.revisionNo > 1 ? <Pill label={`REV ${row.revisionNo}`} tone="neutral" /> : null}
                  {row.sourceTemplateRevisionId ? <Pill label="PROGRAM PREFILL" tone="premium" /> : null}
                </View>

                {scope.scopeKind === 'event-exchange' ? (
                  <>
                    <NeonText variant="bodyMuted" style={styles.smallTop}>
                      Evidence: {row.evidenceSources.length > 0 ? row.evidenceSources.map((source) => source.replaceAll('-', ' ')).join(' · ') : 'none recorded yet'}.
                    </NeonText>
                    {row.supportedBilateralOutcomes != null ? (
                      <NeonText variant="bodyMuted" style={styles.smallTop}>{row.supportedBilateralOutcomes} supported bilateral next-step receipt{row.supportedBilateralOutcomes === 1 ? '' : 's'} followed this exchange context. This is observational result evidence, not proof the commitment caused the outcome.</NeonText>
                    ) : null}
                    {row.supportedWarmIntroductions != null ? (
                      <NeonText variant="bodyMuted" style={styles.smallTop}>{row.supportedWarmIntroductions} supported warm introductions are attributable to this committed community context.</NeonText>
                    ) : null}
                    {row.measurementState === 'suppressed' ? (
                      <NeonText variant="bodyMuted" style={styles.smallTop}>Participant-derived result evidence exists below Beacon's cohort release threshold and remains withheld.</NeonText>
                    ) : null}
                  </>
                ) : (
                  <NeonText variant="bodyMuted" style={styles.smallTop}>Template only. Delivery and utilization are measured independently in each event that explicitly re-accepts this structure.</NeonText>
                )}

                {row.pendingRevisionId ? (
                  <View style={styles.amendmentBox}>
                    <NeonText variant="label" tone="premium">AMENDMENT PROPOSED · CURRENT CONTRACT REMAINS EFFECTIVE</NeonText>
                    <NeonText variant="bodyMuted" style={styles.smallTop}>
                      Proposed replacement: {row.pendingCommitmentType ? getPartnerCommitmentOption(row.pendingCommitmentType).label : 'commitment'} · {row.pendingCommittedQuantity != null && row.pendingCommitmentType ? formatPartnerCommitmentQuantity(row.pendingCommittedQuantity, row.pendingCommitmentType) : 'quantity pending'} · {formatDomain(row.pendingDomain)}. The accepted terms above continue to govern until every required party accepts this revision.
                    </NeonText>
                    {row.callerPendingAmendmentDecision ? (
                      <View style={styles.buttonRow}>
                        <Pressable disabled={working} onPress={() => decideRevision(row.pendingRevisionId!, 'accepted')} style={styles.primaryFlex}><NeonText variant="label" tone="accent">ACCEPT AMENDMENT</NeonText></Pressable>
                        <Pressable disabled={working} onPress={() => decideRevision(row.pendingRevisionId!, 'rejected')} style={styles.ghostFlex}><NeonText variant="label" tone="muted">DECLINE AMENDMENT</NeonText></Pressable>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {scope.scopeKind === 'event-exchange' && row.manualMeasurementId ? (
                  <View style={styles.reviewBox}>
                    <NeonText variant="label" tone={row.measurementReviewState === 'disputed' ? 'warning' : 'muted'}>MANUAL EVIDENCE · {row.measurementReviewState.replaceAll('-', ' ').toUpperCase()}</NeonText>
                    <NeonText variant="bodyMuted" style={styles.smallTop}>A manual delivery assertion remains attributable to the committed party. It cannot finalize the contract until every required counterparty acknowledges it; a dispute records disagreement without scoring or shaming either organization.</NeonText>
                    {row.callerCanReviewMeasurement && row.latestMeasurementId ? (
                      <View style={styles.buttonRow}>
                        <Pressable disabled={working} onPress={() => reviewManualEvidence(row, 'acknowledged')} style={styles.primaryFlex}><NeonText variant="label" tone="accent">ACKNOWLEDGE</NeonText></Pressable>
                        <Pressable disabled={working} onPress={() => reviewManualEvidence(row, 'disputed')} style={styles.ghostFlex}><NeonText variant="label" tone="muted">DISPUTE</NeonText></Pressable>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {row.callerPendingDecision ? (
                  <View style={styles.buttonRow}>
                    <Pressable disabled={working} onPress={() => decideRevision(row.revisionId, 'accepted')} style={styles.primaryFlex}><NeonText variant="label" tone="accent">ACCEPT</NeonText></Pressable>
                    <Pressable disabled={working} onPress={() => decideRevision(row.revisionId, 'rejected')} style={styles.ghostFlex}><NeonText variant="label" tone="muted">DECLINE</NeonText></Pressable>
                  </View>
                ) : null}

                {row.callerCanManage ? (
                  <View style={styles.actionWrap}>
                    {scope.scopeKind === 'event-exchange' && row.acceptanceState === 'accepted' && row.lifecycleStatus === 'accepted' ? (
                      <Pressable disabled={working} onPress={() => advance(row, 'scheduled')} style={styles.actionButton}><NeonText variant="label" tone="accent">SCHEDULE</NeonText></Pressable>
                    ) : null}
                    {scope.scopeKind === 'event-exchange' && row.acceptanceState === 'accepted' && ['accepted','scheduled'].includes(row.lifecycleStatus) ? (
                      <Pressable disabled={working} onPress={() => advance(row, 'delivering')} style={styles.actionButton}><NeonText variant="label" tone="accent">START DELIVERY</NeonText></Pressable>
                    ) : null}
                    <Pressable disabled={working} onPress={() => beginRevision(row)} style={styles.actionButton}><NeonText variant="label" tone="muted">REVISE</NeonText></Pressable>
                    {!['fulfilled','partially_fulfilled','not_fulfilled','cancelled'].includes(row.lifecycleStatus) ? (
                      <Pressable disabled={working} onPress={() => advance(row, 'cancelled')} style={styles.actionButton}><NeonText variant="label" tone="muted">CANCEL</NeonText></Pressable>
                    ) : null}
                  </View>
                ) : null}

                {canMeasure ? (
                  <View style={styles.actionWrap}>
                    <Pressable disabled={working} onPress={() => refreshEvidence(row)} style={styles.actionButton}><NeonText variant="label" tone="premium">REFRESH BEACON EVIDENCE</NeonText></Pressable>
                    {row.callerCanManage ? <Pressable
                      disabled={working}
                      onPress={() => {
                        setManualRevisionId(manualOpen ? null : row.revisionId);
                        setManualDelivered(String(row.deliveredQuantity ?? 0));
                        setManualUsed(String(row.utilizedQuantity ?? 0));
                      }}
                      style={styles.actionButton}
                    >
                      <NeonText variant="label" tone="muted">MANUAL ACKNOWLEDGEMENT</NeonText>
                    </Pressable> : null}
                  </View>
                ) : null}

                {manualOpen ? (
                  <View style={styles.manualBox}>
                    <NeonText variant="label" tone="warning">MANUAL OPERATOR EVIDENCE · PARTY ASSERTION</NeonText>
                    <NeonText variant="bodyMuted" style={styles.smallTop}>Manual quantities can be entered only by the party that owns this commitment. They remain explicitly lower-quality than server-recorded delivery and require counterpart acknowledgement before they can finalize fulfillment.</NeonText>
                    <View style={styles.inputRow}>
                      <TextInput value={manualDelivered} onChangeText={setManualDelivered} keyboardType="decimal-pad" placeholder="Delivered" placeholderTextColor={palette.textDim} style={styles.numberInput} />
                      <TextInput value={manualUsed} onChangeText={setManualUsed} keyboardType="decimal-pad" placeholder="Used" placeholderTextColor={palette.textDim} style={styles.numberInput} />
                    </View>
                    <Pressable disabled={working} onPress={() => saveManual(row)} style={styles.primaryButton}><NeonText variant="label" tone="accent">RECORD MANUAL EVIDENCE</NeonText></Pressable>
                  </View>
                ) : null}

                {scope.scopeKind === 'event-exchange' && row.callerCanManage && row.deliveredQuantity != null && !manualFinalizationBlocked ? (
                  <View style={styles.actionWrap}>
                    {row.deliveredQuantity >= row.committedQuantity && !['fulfilled','cancelled'].includes(row.lifecycleStatus) ? (
                      <Pressable disabled={working} onPress={() => advance(row, 'fulfilled')} style={styles.actionButton}><NeonText variant="label" tone="success">FINALIZE FULFILLED</NeonText></Pressable>
                    ) : null}
                    {row.deliveredQuantity > 0 && row.deliveredQuantity < row.committedQuantity && !['partially_fulfilled','cancelled'].includes(row.lifecycleStatus) ? (
                      <Pressable disabled={working} onPress={() => advance(row, 'partially_fulfilled')} style={styles.actionButton}><NeonText variant="label" tone="warning">FINALIZE PARTIAL</NeonText></Pressable>
                    ) : null}
                    {row.deliveredQuantity === 0 && (scope.eventEndedAt != null || (row.windowEnd != null && new Date(row.windowEnd).getTime() <= Date.now())) && !['not_fulfilled','cancelled'].includes(row.lifecycleStatus) ? (
                      <Pressable disabled={working} onPress={() => advance(row, 'not_fulfilled')} style={styles.actionButton}><NeonText variant="label" tone="muted">ACKNOWLEDGE NOT FULFILLED</NeonText></Pressable>
                    ) : null}
                  </View>
                ) : null}

                <Pressable onPress={() => toggleHistory(row)} style={styles.historyButton}>
                  <NeonText variant="label" tone="dim">{historyCommitmentId === row.commitmentId ? 'HIDE REVISION HISTORY' : 'REVISION HISTORY'}</NeonText>
                </Pressable>
                {historyCommitmentId === row.commitmentId ? (
                  <View style={styles.historyList}>
                    {history.map((item) => (
                      <View key={item.revisionId} style={styles.historyRow}>
                        <NeonText variant="label" tone="muted">REV {item.revisionNo} · {item.lifecycleStatus.replaceAll('_', ' ').toUpperCase()}</NeonText>
                        <NeonText variant="bodyMuted" style={styles.smallTop}>{getPartnerCommitmentOption(item.commitmentType).label} · {formatPartnerCommitmentQuantity(item.committedQuantity, item.commitmentType)} · {formatDomain(item.domain)}</NeonText>
                      </View>
                    ))}
                  </View>
                ) : null}
              </Surface>
            );
          })}

          {partyChoices.length > 0 ? (
            <Surface elevated padded style={styles.editorCard}>
              <NeonText variant="h2">{editing ? `Revise ${editing.committedPartyLabel}'s commitment` : 'Propose your own commitment'}</NeonText>
              <NeonText variant="bodyMuted" style={styles.smallTop}>
                {editing
                  ? 'The accepted record is not edited. Beacon creates a new immutable revision and resets required acceptance.'
                  : 'A host cannot fabricate a community obligation. Each committed party can propose only what it controls.'}
              </NeonText>

              {!editing ? (
                <>
                  <NeonText variant="label" tone="muted" style={styles.fieldLabel}>COMMITTED PARTY</NeonText>
                  <View style={styles.chips}>
                    {partyChoices.map((choice) => (
                      <Pressable key={choice.key} onPress={() => setSelectedPartyKey(choice.key)} style={[styles.chip, selectedPartyKey === choice.key && styles.chipActive]}>
                        <NeonText variant="label" tone={selectedPartyKey === choice.key ? 'accent' : 'muted'}>{choice.label}</NeonText>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}

              <NeonText variant="label" tone="muted" style={styles.fieldLabel}>COMMITMENT TYPE</NeonText>
              <View style={styles.chips}>
                {PARTNER_COMMITMENT_OPTIONS.map((option) => (
                  <Pressable key={option.type} onPress={() => setCommitmentType(option.type)} style={[styles.chip, commitmentType === option.type && styles.chipActive]}>
                    <NeonText variant="label" tone={commitmentType === option.type ? 'premium' : 'muted'}>{option.label}</NeonText>
                  </Pressable>
                ))}
              </View>
              <NeonText variant="bodyMuted" style={styles.smallTop}>{selectedOption.description}</NeonText>

              <NeonText variant="label" tone="muted" style={styles.fieldLabel}>DOMAIN {selectedOption.domainRecommended ? '· RECOMMENDED' : '· OPTIONAL'}</NeonText>
              <View style={styles.chips}>
                <Pressable onPress={() => setDomain(null)} style={[styles.chip, domain == null && styles.chipActive]}><NeonText variant="label" tone={domain == null ? 'accent' : 'muted'}>GENERAL</NeonText></Pressable>
                {EVENT_INTENT_KEYS.map((key) => (
                  <Pressable key={key} onPress={() => setDomain(key)} style={[styles.chip, domain === key && styles.chipActive]}>
                    <NeonText variant="label" tone={domain === key ? 'accent' : 'muted'}>{EVENT_INTENT_LABELS[key]}</NeonText>
                  </Pressable>
                ))}
              </View>

              <NeonText variant="label" tone="muted" style={styles.fieldLabel}>COMMITTED QUANTITY · {selectedOption.unitLabel.toUpperCase()}</NeonText>
              <TextInput value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="1" placeholderTextColor={palette.textDim} style={styles.quantityInput} />
              {scope.scopeKind === 'event-exchange' ? (
                <NeonText variant="bodyMuted" style={styles.smallTop}>This interface uses the event-wide observation window. The server retains explicit start/end timestamps on the commitment revision.</NeonText>
              ) : null}

              <View style={styles.buttonRow}>
                <Pressable disabled={working} onPress={saveCommitment} style={styles.primaryFlex}><NeonText variant="label" tone="accent">{editing ? 'CREATE REVISION' : 'PROPOSE COMMITMENT'}</NeonText></Pressable>
                {editing ? <Pressable onPress={resetEditor} style={styles.ghostFlex}><NeonText variant="label" tone="muted">CANCEL EDIT</NeonText></Pressable> : null}
              </View>
            </Surface>
          ) : null}

          {scope.scopeKind === 'program-template' && memory.length > 0 ? (
            <Surface padded style={styles.memoryCard}>
              <NeonText variant="label" tone="premium">INSTITUTIONAL MEMORY · NON-BINDING</NeonText>
              <NeonText variant="bodyMuted" style={styles.smallTop}>Historical quantities are grouped only within the same resource type and domain. Beacon does not convert unlike contributions into a fairness score. A suggested starting quantity appears only after at least two ended events.</NeonText>
              {memory.map((item) => (
                <View key={`${item.partyKind}-${item.partyCommunityId ?? 'host'}-${item.commitmentType}-${item.domain ?? 'general'}`} style={styles.memoryRow}>
                  <NeonText variant="label" tone="muted">{item.partyLabel.toUpperCase()} · {getPartnerCommitmentOption(item.commitmentType).label.toUpperCase()}</NeonText>
                  <NeonText variant="bodyMuted" style={styles.smallTop}>{item.sampleEventCount} ended event{item.sampleEventCount === 1 ? '' : 's'} · {item.measuredEventCount} with admissible measurement ({Math.round(item.measurementCoverage * 100)}% coverage) · average promised {formatPartnerCommitmentQuantity(item.averageCommittedQuantity, item.commitmentType)} · average delivered {formatPartnerCommitmentQuantity(item.averageDeliveredQuantity, item.commitmentType)} · average used {formatPartnerCommitmentQuantity(item.averageUtilizedQuantity, item.commitmentType)}</NeonText>
                  {item.measuredEventCount > 0 ? <NeonText variant="bodyMuted" style={styles.smallTop}>{item.unusedMeasuredEventCount} measured event{item.unusedMeasuredEventCount === 1 ? '' : 's'} left delivered capacity unused; {item.zeroUtilizationMeasuredEventCount} had delivered capacity with zero recorded use. Unknown measurements are excluded rather than treated as zero.</NeonText> : null}
                  {item.suggestedQuantity != null ? <NeonText variant="bodyMuted" style={styles.smallTop}>Historical starting point: {formatPartnerCommitmentQuantity(item.suggestedQuantity, item.commitmentType)}. This does not create or accept a future commitment.</NeonText> : null}
                </View>
              ))}
            </Surface>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.md, gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  smallTop: { marginTop: 4 },
  compactButton: { minHeight: 36, minWidth: 62, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.accent },
  boundaryCard: { borderRadius: radii.lg, borderColor: palette.hairlineStrong },
  errorCard: { borderRadius: radii.lg, borderColor: palette.danger },
  card: { borderRadius: radii.lg },
  editorCard: { borderRadius: radii.lg, borderColor: palette.premiumSoft },
  memoryCard: { borderRadius: radii.lg, borderColor: palette.premiumSoft },
  prefillButton: { borderRadius: radii.lg, borderWidth: 1, borderColor: palette.premiumSoft, padding: spacing.md, backgroundColor: 'rgba(124,58,237,0.08)' },
  rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  metrics: { marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { width: '47%', borderRadius: radii.md, padding: spacing.sm, backgroundColor: palette.surface },
  metaRow: { marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  buttonRow: { marginTop: spacing.md, flexDirection: 'row', gap: spacing.sm },
  actionWrap: { marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actionButton: { minHeight: 38, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairlineStrong },
  primaryFlex: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.accent, backgroundColor: palette.accentSoft },
  ghostFlex: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairlineStrong },
  primaryButton: { marginTop: spacing.md, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.accent, backgroundColor: palette.accentSoft },
  manualBox: { marginTop: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairlineStrong, padding: spacing.md, backgroundColor: palette.surface },
  amendmentBox: { marginTop: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: palette.premiumSoft, padding: spacing.md, backgroundColor: 'rgba(124,58,237,0.08)' },
  reviewBox: { marginTop: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairlineStrong, padding: spacing.md, backgroundColor: palette.surface },
  inputRow: { marginTop: spacing.md, flexDirection: 'row', gap: spacing.sm },
  numberInput: { flex: 1, minHeight: 44, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairlineStrong, color: palette.text, paddingHorizontal: spacing.md },
  fieldLabel: { marginTop: spacing.lg },
  chips: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: 1, borderColor: palette.hairlineStrong, backgroundColor: palette.surface },
  chipActive: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
  quantityInput: { marginTop: spacing.sm, minHeight: 46, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairlineStrong, color: palette.text, backgroundColor: palette.surface, paddingHorizontal: spacing.md, fontSize: 14 },
  historyButton: { marginTop: spacing.md, minHeight: 34, justifyContent: 'center' },
  historyList: { marginTop: spacing.sm, gap: spacing.sm },
  historyRow: { paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.hairline },
  memoryRow: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.hairline },
});
