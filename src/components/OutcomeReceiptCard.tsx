import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  OUTCOME_RECEIPT_DEFINITIONS,
  getOutcomeReceiptDefinition,
  getOutcomeReceiptEvidenceLabel,
  getOutcomeReceiptOriginLabel,
  type OutcomeReceiptType,
} from '../outcomes/OutcomeReceiptModel';
import {
  getMyOutcomeReceipt,
  submitMyOutcomeReceipt,
  withdrawMyOutcomeReceipt,
  type ParticipantOutcomeReceipt,
} from '../services/outcome-receipt.service';

interface Props {
  matchId: string;
  counterpartyName: string;
}

const REFRESH_MS = 30_000;

function formatDate(value: string | null): string {
  if (!value) return '';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function OutcomeReceiptCard({ matchId, counterpartyName }: Readonly<Props>) {
  const [receipt, setReceipt] = useState<ParticipantOutcomeReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [workingType, setWorkingType] = useState<OutcomeReceiptType | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const result = await getMyOutcomeReceipt(matchId);
    if (result.error) {
      setError(result.error.message);
    } else {
      setError(null);
      setReceipt(result.data);
    }
    if (!quiet) setLoading(false);
  }, [matchId]);

  useEffect(() => {
    void load(false);
    const timer = setInterval(() => void load(true), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const currentDefinition = useMemo(
    () => receipt?.receiptType ? getOutcomeReceiptDefinition(receipt.receiptType) : null,
    [receipt?.receiptType],
  );

  const counterpartDefinition = useMemo(
    () => receipt?.counterpartReceiptType ? getOutcomeReceiptDefinition(receipt.counterpartReceiptType) : null,
    [receipt?.counterpartReceiptType],
  );

  const submit = useCallback(async (type: OutcomeReceiptType) => {
    setWorkingType(type);
    setError(null);
    const result = await submitMyOutcomeReceipt({ matchId, receiptType: type });
    if (result.error || !result.data) {
      setError(result.error?.message ?? 'Could not record this outcome receipt.');
    } else {
      setReceipt(result.data);
      setExpanded(false);
    }
    setWorkingType(null);
  }, [matchId]);

  const withdraw = useCallback(() => {
    Alert.alert(
      'Withdraw your outcome receipt?',
      'Beacon will append a withdrawal rather than rewrite the earlier attestation. It will stop contributing as your current receipt.',
      [
        { text: 'Keep receipt', style: 'cancel' },
        {
          text: 'Withdraw',
          style: 'destructive',
          onPress: async () => {
            setWithdrawing(true);
            const result = await withdrawMyOutcomeReceipt(matchId);
            if (result.error || !result.data) {
              setError(result.error?.message ?? 'Could not withdraw this receipt.');
            } else {
              setReceipt(result.data);
              setExpanded(false);
            }
            setWithdrawing(false);
          },
        },
      ],
    );
  }, [matchId]);

  if (loading) {
    return (
      <View style={styles.shell}>
        <View style={styles.topRow}>
          <Text style={styles.eyebrow}>PARTICIPANT-OWNED OUTCOME</Text>
          <ActivityIndicator color="#67E8F9" />
        </View>
      </View>
    );
  }

  if (!receipt && error) {
    return (
      <View style={styles.shell}>
        <Text style={styles.eyebrow}>PARTICIPANT-OWNED OUTCOME</Text>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (!receipt) return null;

  const hasSubmitted = receipt.lifecycleState === 'submitted' && currentDefinition != null;
  const canEdit = receipt.canSubmit && !withdrawing && workingType == null;

  return (
    <View style={styles.shell}>
      <View style={styles.topRow}>
        <View style={styles.privateBadge}>
          <Text style={styles.privateBadgeText}>YOUR RECEIPT</Text>
        </View>
        {receipt.revision > 0 ? <Text style={styles.revision}>REV {receipt.revision}</Text> : null}
      </View>

      {!hasSubmitted ? (
        <>
          <Text style={styles.headline}>What actually happened next?</Text>
          <Text style={styles.explanation}>
            Record one bounded fact about your relationship with {counterpartyName}. Beacon does not inspect messages, email, calendars, response speed, or sentiment to fill this in for you.
          </Text>
          {receipt.lifecycleState === 'withdrawn' ? (
            <View style={styles.neutralPanel}>
              <Text style={styles.neutralTitle}>Your previous receipt is withdrawn</Text>
              <Text style={styles.neutralText}>The historical revision remains append-only, but it no longer contributes as your current attestation.</Text>
            </View>
          ) : null}
        </>
      ) : (
        <>
          <Text style={styles.headline}>You recorded: {currentDefinition.label}</Text>
          <Text style={styles.explanation}>{currentDefinition.description}</Text>
          {receipt.submittedAt ? (
            <Text style={styles.timestamp}>Recorded {formatDate(receipt.submittedAt)}</Text>
          ) : null}

          {receipt.alignmentState === 'bilaterally-confirmed' ? (
            <View style={styles.confirmedPanel}>
              <Text style={styles.confirmedTitle}>Both of you independently confirmed this next step.</Text>
              <Text style={styles.confirmedText}>
                This means both participants separately attested to “{currentDefinition.label}.” It is not proof of a deal, hire, investment, or commercial result.
              </Text>
            </View>
          ) : null}

          {receipt.alignmentState === 'counterpart-compatible' && counterpartDefinition ? (
            <View style={styles.compatiblePanel}>
              <Text style={styles.compatibleTitle}>Both of you recorded compatible evidence.</Text>
              <Text style={styles.compatibleText}>
                Your receipt is “{currentDefinition.label}.” {counterpartyName} independently recorded “{counterpartDefinition.label}.” Beacon reveals this only because the reviewed compatibility map considers the two facts compatible.
              </Text>
            </View>
          ) : null}

          {receipt.alignmentState === 'participant-attested' ? (
            <View style={styles.neutralPanel}>
              <Text style={styles.neutralTitle}>Participant-attested</Text>
              <Text style={styles.neutralText}>
                Beacon is recording your statement exactly at that level. It will not reveal or infer a private counterpart state unless compatible independent evidence exists.
              </Text>
            </View>
          ) : null}
        </>
      )}

      {receipt.systemEvidence.length > 0 && hasSubmitted ? (
        <View style={styles.evidenceBlock}>
          <Text style={styles.sectionLabel}>SYSTEM CONTEXT · NOT THE CLAIM ITSELF</Text>
          <Text style={styles.originText}>{getOutcomeReceiptOriginLabel(receipt.originContext)}</Text>
          <View style={styles.chips}>
            {receipt.systemEvidence.map((evidence) => (
              <View key={evidence} style={styles.chip}>
                <Text style={styles.chipText}>{getOutcomeReceiptEvidenceLabel(evidence)}</Text>
              </View>
            ))}
          </View>
          {receipt.domains.length > 0 ? (
            <Text style={styles.domainText}>Captured context: {receipt.domains.join(' · ')}</Text>
          ) : null}
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {receipt.canSubmit ? (
        <>
          <Pressable
            disabled={!canEdit}
            onPress={() => setExpanded((current) => !current)}
            style={[styles.primaryButton, !canEdit && styles.disabled]}
          >
            <Text style={styles.primaryButtonText}>
              {expanded ? 'CLOSE RECEIPT CHOICES' : hasSubmitted ? 'CHANGE MY RECEIPT' : 'RECORD WHAT HAPPENED'}
            </Text>
          </Pressable>

          {expanded ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRail}>
              {OUTCOME_RECEIPT_DEFINITIONS.map((definition) => {
                const busy = workingType === definition.type;
                return (
                  <Pressable
                    key={definition.type}
                    disabled={!canEdit}
                    onPress={() => void submit(definition.type)}
                    style={[styles.optionCard, receipt.receiptType === definition.type && styles.optionSelected]}
                  >
                    <Text style={styles.optionLabel}>{definition.label}</Text>
                    <Text style={styles.optionDescription}>{definition.description}</Text>
                    {busy ? <ActivityIndicator color="#67E8F9" style={styles.optionLoader} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {hasSubmitted ? (
            <Pressable disabled={!canEdit} onPress={withdraw} style={styles.withdrawButton}>
              <Text style={styles.withdrawText}>{withdrawing ? 'WITHDRAWING…' : 'WITHDRAW MY CURRENT RECEIPT'}</Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <View style={styles.closedPanel}>
          <Text style={styles.closedTitle}>Receipt window closed</Text>
          <Text style={styles.closedText}>
            New attestations are unavailable after the bounded observation window or while a safety boundary is active. Existing participant-owned history is not promoted into a hidden relationship score.
          </Text>
        </View>
      )}

      <Text style={styles.boundaryCopy}>
        A receipt is an explicit participant attestation. “Both confirmed” means two independent compatible attestations—not Beacon independently verified a business result.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    marginTop: 14,
    borderRadius: 18,
    padding: 15,
    backgroundColor: '#0B1820',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.24)',
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  eyebrow: { color: '#67E8F9', fontSize: 10, fontWeight: '900', letterSpacing: 0.9 },
  privateBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: 'rgba(34, 211, 238, 0.10)' },
  privateBadgeText: { color: '#67E8F9', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  revision: { color: '#64748B', fontSize: 10, fontWeight: '800' },
  headline: { marginTop: 12, color: '#ECFEFF', fontSize: 17, fontWeight: '800' },
  explanation: { marginTop: 6, color: '#A5B4C4', fontSize: 12, lineHeight: 18 },
  timestamp: { marginTop: 7, color: '#64748B', fontSize: 10 },
  confirmedPanel: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: 'rgba(16,185,129,0.09)', borderWidth: 1, borderColor: 'rgba(52,211,153,0.22)' },
  confirmedTitle: { color: '#6EE7B7', fontSize: 13, fontWeight: '900' },
  confirmedText: { marginTop: 5, color: '#B8C5D7', fontSize: 11, lineHeight: 17 },
  compatiblePanel: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: 'rgba(59,130,246,0.09)', borderWidth: 1, borderColor: 'rgba(96,165,250,0.20)' },
  compatibleTitle: { color: '#93C5FD', fontSize: 13, fontWeight: '900' },
  compatibleText: { marginTop: 5, color: '#B8C5D7', fontSize: 11, lineHeight: 17 },
  neutralPanel: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: 'rgba(148,163,184,0.07)' },
  neutralTitle: { color: '#CBD5E1', fontSize: 12, fontWeight: '800' },
  neutralText: { marginTop: 5, color: '#94A3B8', fontSize: 11, lineHeight: 17 },
  evidenceBlock: { marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(148,163,184,0.18)' },
  sectionLabel: { color: '#64748B', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  originText: { marginTop: 6, color: '#A5F3FC', fontSize: 11, lineHeight: 16 },
  chips: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: 'rgba(8,145,178,0.12)', borderWidth: 1, borderColor: 'rgba(34,211,238,0.15)' },
  chipText: { color: '#A5F3FC', fontSize: 9, fontWeight: '700' },
  domainText: { marginTop: 7, color: '#64748B', fontSize: 10 },
  primaryButton: { marginTop: 14, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: 'rgba(34,211,238,0.12)', borderWidth: 1, borderColor: '#22D3EE' },
  primaryButtonText: { color: '#67E8F9', textAlign: 'center', fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  optionRail: { paddingTop: 12, paddingBottom: 2, gap: 9 },
  optionCard: { width: 220, minHeight: 118, borderRadius: 13, padding: 12, backgroundColor: '#10202A', borderWidth: 1, borderColor: 'rgba(148,163,184,0.15)' },
  optionSelected: { borderColor: '#22D3EE' },
  optionLabel: { color: '#ECFEFF', fontSize: 13, fontWeight: '800' },
  optionDescription: { marginTop: 6, color: '#94A3B8', fontSize: 11, lineHeight: 16 },
  optionLoader: { marginTop: 9, alignSelf: 'flex-start' },
  withdrawButton: { marginTop: 10, paddingVertical: 9, alignItems: 'center' },
  withdrawText: { color: '#94A3B8', fontSize: 10, fontWeight: '800' },
  closedPanel: { marginTop: 13, borderRadius: 12, padding: 11, backgroundColor: 'rgba(148,163,184,0.06)' },
  closedTitle: { color: '#CBD5E1', fontSize: 12, fontWeight: '800' },
  closedText: { marginTop: 5, color: '#94A3B8', fontSize: 11, lineHeight: 17 },
  boundaryCopy: { marginTop: 12, color: '#64748B', fontSize: 9, lineHeight: 14 },
  errorText: { marginTop: 10, color: '#FCA5A5', fontSize: 11, lineHeight: 16 },
  disabled: { opacity: 0.45 },
});
