import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import {
  createHandshakeAckNonce,
  createLocalHandshakeId,
  normalizeManualCode,
  retryDelayMs,
  type HandshakeAckEnvelope,
  type HandshakeOfferEnvelope,
  type HandshakeTransportKind,
  type OfflineHandshakePendingRecord,
  type OfflineHandshakeServerState,
  type PhysicalInteractionEvidenceClass,
  type PreparedHandshakeCapability,
} from '../handshake/OfflineHandshakeProtocol';
import {
  getBestLocalCapability,
  listPendingHandshakes,
  listPreparedHandshakeCapabilities,
  markLocalCapabilityPresented,
  removePendingHandshake,
  removePreparedHandshakeCapability,
  savePendingHandshake,
  savePreparedHandshakeCapabilities,
  updatePendingHandshake,
} from '../handshake/OfflineHandshakeLocalStore';

export interface HandshakeReconciliationResult {
  handshakeState: OfflineHandshakeServerState;
  verificationId: string | null;
  evidenceClass: PhysicalInteractionEvidenceClass | null;
  otherUserId: string | null;
  otherName: string | null;
  otherRole: string | null;
  reasonCode: string | null;
}

export interface VerifiedEventHandshake {
  verificationId: string;
  capabilityId: string;
  eventId: string;
  otherUserId: string;
  otherName: string | null;
  otherRole: string | null;
  evidenceClass: 'explicit-local-handshake' | 'server-live-handshake';
  interactionWindowStart: string;
  interactionWindowEnd: string;
  verifiedAt: string;
}

export interface EventHandshakeHealth {
  supported: boolean;
  capabilityCount: number | null;
  verifiedCount: number | null;
  pendingCount: number | null;
  expiredCount: number | null;
  conflictCount: number | null;
  safetyBlockCount: number | null;
  offlineVerifiedCount: number | null;
  serverLiveVerifiedCount: number | null;
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const first = data[0];
    return first && typeof first === 'object' ? first as Record<string, unknown> : null;
  }
  return data && typeof data === 'object' ? data as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeReconciliation(data: unknown): HandshakeReconciliationResult | null {
  const row = firstRow(data);
  const state = text(row?.handshake_state) as OfflineHandshakeServerState | null;
  if (!row || !state) return null;
  return {
    handshakeState: state,
    verificationId: text(row.verification_id),
    evidenceClass: text(row.evidence_class) as PhysicalInteractionEvidenceClass | null,
    otherUserId: text(row.other_user_id),
    otherName: text(row.other_name),
    otherRole: text(row.other_role),
    reasonCode: text(row.reason_code),
  };
}

function probablyNetworkFailure(error: PostgrestError | Error | null): boolean {
  if (!error) return false;
  const message = error.message.toLowerCase();
  return message.includes('network')
    || message.includes('fetch')
    || message.includes('socket')
    || message.includes('timeout')
    || message.includes('connection');
}

export async function prepareHandshakeContinuity(input: {
  eventId: string;
  userId: string;
  count?: number;
}): Promise<{
  capabilities: PreparedHandshakeCapability[];
  preparedOnline: boolean;
  error: PostgrestError | null;
}> {
  const cached = await listPreparedHandshakeCapabilities(input.eventId, input.userId);
  const futureCoverage = cached.filter((item) => Date.parse(item.expiresAt) > Date.now() + 5 * 60_000);
  if (futureCoverage.length >= 4) {
    return { capabilities: cached, preparedOnline: false, error: null };
  }

  const { data, error } = await supabase.rpc('prepare_event_handshake_capabilities', {
    p_event_id: input.eventId,
    p_count: Math.max(1, Math.min(input.count ?? 8, 8)),
  });

  if (error) {
    return { capabilities: cached, preparedOnline: false, error };
  }

  const prepared: PreparedHandshakeCapability[] = (Array.isArray(data) ? data : []).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const capabilityId = text(row.capability_id);
    const eventId = text(row.event_id);
    const offerToken = text(row.offer_token);
    const manualCode = text(row.manual_code);
    const validFrom = text(row.valid_from);
    const expiresAt = text(row.expires_at);
    const reconcileUntil = text(row.reconcile_until);
    if (!capabilityId || !eventId || !offerToken || !manualCode || !validFrom || !expiresAt || !reconcileUntil) return [];
    return [{
      capabilityId,
      eventId,
      ownerUserId: input.userId,
      offerToken,
      manualCode,
      protocolVersion: 1 as const,
      validFrom,
      expiresAt,
      reconcileUntil,
      state: 'prepared' as const,
    }];
  });

  await savePreparedHandshakeCapabilities(input.eventId, input.userId, prepared);
  return {
    capabilities: await listPreparedHandshakeCapabilities(input.eventId, input.userId),
    preparedOnline: prepared.length > 0,
    error: null,
  };
}

export async function getUsableHandshakeCapability(
  eventId: string,
  userId: string,
): Promise<PreparedHandshakeCapability | null> {
  return getBestLocalCapability(eventId, userId);
}

export async function markHandshakePresented(
  eventId: string,
  userId: string,
  capabilityId: string,
): Promise<PreparedHandshakeCapability | null> {
  const local = await markLocalCapabilityPresented(eventId, userId, capabilityId);
  if (!local) return null;
  // Presentation remains useful offline. Server acknowledgement is opportunistic
  // and never required for the local transport to continue.
  void supabase.rpc('mark_my_handshake_presented', { p_capability_id: capabilityId });
  return local;
}

export async function createResponderPendingFromOffer(input: {
  userId: string;
  eventId: string;
  offer: HandshakeOfferEnvelope;
  transport: HandshakeTransportKind;
}): Promise<OfflineHandshakePendingRecord> {
  if (input.offer.eventId !== input.eventId) throw new Error('This handshake belongs to another event.');
  const [localId, ackNonce] = await Promise.all([createLocalHandshakeId(), createHandshakeAckNonce()]);
  const now = new Date().toISOString();
  const pending: OfflineHandshakePendingRecord = {
    localId,
    eventId: input.eventId,
    ownerUserId: input.userId,
    capabilityId: input.offer.capabilityId,
    role: 'responder',
    offerToken: input.offer.offerToken,
    manualCode: null,
    ackNonce,
    transport: input.transport,
    claimedConfirmedAt: now,
    state: 'pending-reconciliation',
    attempts: 0,
    nextAttemptAt: null,
    lastReasonCode: null,
    createdAt: now,
    updatedAt: now,
  };
  await savePendingHandshake(pending);
  return pending;
}

export async function createResponderPendingFromManual(input: {
  userId: string;
  eventId: string;
  manualCode: string;
}): Promise<OfflineHandshakePendingRecord> {
  const manualCode = normalizeManualCode(input.manualCode);
  if (manualCode.length < 16) throw new Error('Enter the complete one-time meeting code.');
  const [localId, ackNonce] = await Promise.all([createLocalHandshakeId(), createHandshakeAckNonce()]);
  const now = new Date().toISOString();
  const pending: OfflineHandshakePendingRecord = {
    localId,
    eventId: input.eventId,
    ownerUserId: input.userId,
    capabilityId: null,
    role: 'responder',
    offerToken: null,
    manualCode,
    ackNonce,
    transport: 'manual',
    claimedConfirmedAt: now,
    state: 'pending-reconciliation',
    attempts: 0,
    nextAttemptAt: null,
    lastReasonCode: null,
    createdAt: now,
    updatedAt: now,
  };
  await savePendingHandshake(pending);
  return pending;
}

export async function createInitiatorPendingFromAck(input: {
  userId: string;
  eventId: string;
  capability: PreparedHandshakeCapability;
  ack: HandshakeAckEnvelope;
  transport: HandshakeTransportKind;
}): Promise<OfflineHandshakePendingRecord> {
  if (input.ack.eventId !== input.eventId) throw new Error('This acknowledgement belongs to another event.');
  const matchesCapability = input.ack.capabilityId === input.capability.capabilityId;
  const matchesManual = input.ack.manualCode != null
    && normalizeManualCode(input.ack.manualCode) === normalizeManualCode(input.capability.manualCode);
  if (!matchesCapability && !matchesManual) {
    throw new Error('This acknowledgement does not match the meeting code you presented.');
  }
  const localId = await createLocalHandshakeId();
  const now = new Date().toISOString();
  const pending: OfflineHandshakePendingRecord = {
    localId,
    eventId: input.eventId,
    ownerUserId: input.userId,
    capabilityId: input.capability.capabilityId,
    role: 'initiator',
    offerToken: input.capability.offerToken,
    manualCode: input.capability.manualCode,
    ackNonce: input.ack.ackNonce,
    transport: input.transport,
    claimedConfirmedAt: now,
    state: 'pending-reconciliation',
    attempts: 0,
    nextAttemptAt: null,
    lastReasonCode: null,
    createdAt: now,
    updatedAt: now,
  };
  await savePendingHandshake(pending);
  return pending;
}

export async function createInitiatorPendingFromManualAck(input: {
  userId: string;
  eventId: string;
  capability: PreparedHandshakeCapability;
  ackNonce: string;
}): Promise<OfflineHandshakePendingRecord> {
  const normalized = normalizeManualCode(input.ackNonce).toLowerCase();
  if (normalized.length < 20) throw new Error('Enter the complete acknowledgement code.');
  return createInitiatorPendingFromAck({
    userId: input.userId,
    eventId: input.eventId,
    capability: input.capability,
    transport: 'manual',
    ack: {
      kind: 'ack',
      protocolVersion: 1,
      eventId: input.eventId,
      capabilityId: input.capability.capabilityId,
      manualCode: null,
      ackNonce: normalized,
    },
  });
}

async function submitPending(record: OfflineHandshakePendingRecord): Promise<{
  result: HandshakeReconciliationResult | null;
  error: PostgrestError | null;
}> {
  const args = {
    p_event_id: record.eventId,
    p_capability_id: record.capabilityId,
    p_offer_token: record.offerToken,
    p_manual_code: record.manualCode,
    p_ack_nonce: record.ackNonce,
    p_transport: record.transport,
    p_claimed_confirmed_at: record.claimedConfirmedAt,
  };
  const response = record.role === 'initiator'
    ? await supabase.rpc('submit_handshake_initiator_confirmation', args)
    : await supabase.rpc('submit_handshake_responder_confirmation', args);
  return { result: normalizeReconciliation(response.data), error: response.error };
}

async function destroyResolvedLocalMaterial(
  eventId: string,
  userId: string,
  record: OfflineHandshakePendingRecord,
): Promise<void> {
  // The initiator's prepared capability contains the plaintext offer token and
  // manual fallback code. Once the server reports a verified or terminal state,
  // that material has no legitimate future use and must be scrubbed immediately
  // rather than waiting for ordinary reconcile-window expiry cleanup.
  if (record.role === 'initiator' && record.capabilityId) {
    await removePreparedHandshakeCapability(eventId, userId, record.capabilityId);
  }
  await removePendingHandshake(eventId, userId, record.localId);
}

export async function reconcilePendingHandshakes(input: {
  eventId: string;
  userId: string;
  force?: boolean;
}): Promise<{
  attempted: number;
  verified: HandshakeReconciliationResult[];
  terminal: HandshakeReconciliationResult[];
  waiting: number;
  networkUnavailable: boolean;
}> {
  const pending = await listPendingHandshakes(input.eventId, input.userId);
  const now = Date.now();
  const verified: HandshakeReconciliationResult[] = [];
  const terminal: HandshakeReconciliationResult[] = [];
  let attempted = 0;
  let networkUnavailable = false;

  for (const record of pending) {
    if (!['pending-reconciliation', 'needs-attention'].includes(record.state)) continue;
    if (!input.force && record.nextAttemptAt && Date.parse(record.nextAttemptAt) > now) continue;
    attempted += 1;
    const response = await submitPending(record);
    if (response.error) {
      const attempts = record.attempts + 1;
      const network = probablyNetworkFailure(response.error);
      networkUnavailable ||= network;
      await updatePendingHandshake(input.eventId, input.userId, record.localId, {
        attempts,
        state: attempts >= 5 ? 'needs-attention' : 'pending-reconciliation',
        lastReasonCode: network ? 'network-unavailable' : 'server-rejected',
        nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)).toISOString(),
      });
      continue;
    }

    if (!response.result) {
      const attempts = record.attempts + 1;
      await updatePendingHandshake(input.eventId, input.userId, record.localId, {
        attempts,
        state: attempts >= 5 ? 'needs-attention' : 'pending-reconciliation',
        lastReasonCode: 'malformed-server-result',
        nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)).toISOString(),
      });
      continue;
    }

    if (response.result.handshakeState === 'server-verified') {
      verified.push(response.result);
      await destroyResolvedLocalMaterial(input.eventId, input.userId, record);
      continue;
    }

    if ([
      'expired',
      'replay-rejected',
      'authorization-invalidated',
      'blocked',
      'conflict',
      'cancelled',
    ].includes(response.result.handshakeState)) {
      terminal.push(response.result);
      await destroyResolvedLocalMaterial(input.eventId, input.userId, record);
      continue;
    }

    await updatePendingHandshake(input.eventId, input.userId, record.localId, {
      attempts: 0,
      state: 'pending-reconciliation',
      lastReasonCode: null,
      nextAttemptAt: new Date(Date.now() + 15_000).toISOString(),
    });
  }

  const after = await listPendingHandshakes(input.eventId, input.userId);
  return {
    attempted,
    verified,
    terminal,
    waiting: after.filter((item) => ['pending-reconciliation', 'needs-attention'].includes(item.state)).length,
    networkUnavailable,
  };
}

export async function cancelHandshakeCapability(capabilityId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('cancel_my_handshake_capability', {
    p_capability_id: capabilityId,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function getMyVerifiedEventHandshakes(
  eventId: string,
): Promise<{ data: VerifiedEventHandshake[]; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_my_verified_event_handshakes', {
    p_event_id: eventId,
  });
  const rows: VerifiedEventHandshake[] = (Array.isArray(data) ? data : []).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const verificationId = text(row.verification_id);
    const capabilityId = text(row.capability_id);
    const returnedEventId = text(row.event_id);
    const otherUserId = text(row.other_user_id);
    const evidenceClass = text(row.evidence_class);
    const start = text(row.interaction_window_start);
    const end = text(row.interaction_window_end);
    const verifiedAt = text(row.verified_at);
    if (!verificationId || !capabilityId || !returnedEventId || !otherUserId || !start || !end || !verifiedAt) return [];
    if (evidenceClass !== 'explicit-local-handshake' && evidenceClass !== 'server-live-handshake') return [];
    return [{
      verificationId,
      capabilityId,
      eventId: returnedEventId,
      otherUserId,
      otherName: text(row.other_name),
      otherRole: text(row.other_role),
      evidenceClass,
      interactionWindowStart: start,
      interactionWindowEnd: end,
      verifiedAt,
    }];
  });
  return { data: rows, error };
}

export async function getEventHandshakeHealth(
  eventId: string,
): Promise<{ data: EventHandshakeHealth | null; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_event_handshake_health', { p_event_id: eventId });
  const row = firstRow(data);
  if (!row || typeof row.supported !== 'boolean') return { data: null, error };
  return {
    data: {
      supported: row.supported,
      capabilityCount: numberOrNull(row.capability_count),
      verifiedCount: numberOrNull(row.verified_count),
      pendingCount: numberOrNull(row.pending_count),
      expiredCount: numberOrNull(row.expired_count),
      conflictCount: numberOrNull(row.conflict_count),
      safetyBlockCount: numberOrNull(row.safety_block_count),
      offlineVerifiedCount: numberOrNull(row.offline_verified_count),
      serverLiveVerifiedCount: numberOrNull(row.server_live_verified_count),
    },
    error,
  };
}
