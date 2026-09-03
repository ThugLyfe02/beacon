import * as Crypto from 'expo-crypto';

export const OFFLINE_HANDSHAKE_PROTOCOL_VERSION = 1 as const;
export const OFFLINE_HANDSHAKE_QR_PREFIX = 'bhs1';
export const OFFLINE_HANDSHAKE_ACK_HEX_LENGTH = 20;

export type HandshakeTransportKind = 'qr' | 'manual' | 'nfc' | 'ble';
export type PhysicalInteractionEvidenceClass =
  | 'location-supported'
  | 'multi-source-presence'
  | 'explicit-local-handshake'
  | 'server-live-handshake'
  | 'verified-session-attendance';

export type OfflineHandshakeServerState =
  | 'prepared'
  | 'presented'
  | 'pending-reconciliation'
  | 'counterparty-confirmed'
  | 'server-verified'
  | 'expired'
  | 'replay-rejected'
  | 'authorization-invalidated'
  | 'blocked'
  | 'conflict'
  | 'cancelled';

export type OfflineHandshakeLocalState =
  | 'prepared'
  | 'presented'
  | 'pending-reconciliation'
  | 'needs-attention'
  | 'server-verified'
  | 'expired'
  | 'replay-rejected'
  | 'authorization-invalidated'
  | 'blocked'
  | 'conflict'
  | 'cancelled';

export interface PreparedHandshakeCapability {
  capabilityId: string;
  eventId: string;
  ownerUserId: string;
  offerToken: string;
  manualCode: string;
  protocolVersion: 1;
  validFrom: string;
  expiresAt: string;
  reconcileUntil: string;
  state: 'prepared' | 'presented';
  presentedAt?: string;
}

export interface OfflineHandshakePendingRecord {
  localId: string;
  eventId: string;
  ownerUserId: string;
  capabilityId: string | null;
  role: 'initiator' | 'responder';
  offerToken: string | null;
  manualCode: string | null;
  ackNonce: string;
  transport: HandshakeTransportKind;
  claimedConfirmedAt: string;
  state: OfflineHandshakeLocalState;
  attempts: number;
  nextAttemptAt: string | null;
  lastReasonCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HandshakeOfferEnvelope {
  kind: 'offer';
  protocolVersion: 1;
  eventId: string;
  capabilityId: string;
  offerToken: string;
  expiresAtEpochSeconds: number;
}

export interface HandshakeAckEnvelope {
  kind: 'ack';
  protocolVersion: 1;
  eventId: string;
  capabilityId: string | null;
  manualCode: string | null;
  ackNonce: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_RE = /^[0-9a-f]+$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function isHex(value: string, min: number, max: number): boolean {
  return value.length >= min && value.length <= max && HEX_RE.test(value);
}

export function normalizeManualCode(value: string): string {
  return value.replace(/[^0-9a-f]/gi, '').toUpperCase();
}

export function formatManualCode(value: string): string {
  const normalized = normalizeManualCode(value);
  return normalized.match(/.{1,4}/g)?.join('-') ?? normalized;
}

export function buildHandshakeOfferPayload(capability: PreparedHandshakeCapability): string {
  const expires = Math.floor(Date.parse(capability.expiresAt) / 1000);
  return [
    OFFLINE_HANDSHAKE_QR_PREFIX,
    'o',
    capability.eventId,
    capability.capabilityId,
    capability.offerToken,
    String(expires),
  ].join('|');
}

export function parseHandshakeOfferPayload(raw: string): HandshakeOfferEnvelope | null {
  const parts = raw.trim().split('|');
  if (parts.length !== 6 || parts[0] !== OFFLINE_HANDSHAKE_QR_PREFIX || parts[1] !== 'o') return null;
  const [, , eventId, capabilityId, offerToken, expiresRaw] = parts;
  const expiresAtEpochSeconds = Number(expiresRaw);
  if (!isUuid(eventId) || !isUuid(capabilityId)) return null;
  if (!isHex(offerToken, 40, 64)) return null;
  if (!Number.isFinite(expiresAtEpochSeconds) || expiresAtEpochSeconds <= 0) return null;
  return {
    kind: 'offer',
    protocolVersion: OFFLINE_HANDSHAKE_PROTOCOL_VERSION,
    eventId,
    capabilityId,
    offerToken: offerToken.toLowerCase(),
    expiresAtEpochSeconds,
  };
}

export function buildHandshakeAckPayload(input: {
  eventId: string;
  capabilityId?: string | null;
  manualCode?: string | null;
  ackNonce: string;
}): string {
  const normalizedAck = normalizeManualCode(input.ackNonce).toLowerCase();
  if (input.capabilityId) {
    return [
      OFFLINE_HANDSHAKE_QR_PREFIX,
      'a',
      input.eventId,
      input.capabilityId,
      normalizedAck,
    ].join('|');
  }
  return [
    OFFLINE_HANDSHAKE_QR_PREFIX,
    'm',
    input.eventId,
    normalizeManualCode(input.manualCode ?? ''),
    normalizedAck,
  ].join('|');
}

export function parseHandshakeAckPayload(raw: string): HandshakeAckEnvelope | null {
  const parts = raw.trim().split('|');
  if (parts.length !== 5 || parts[0] !== OFFLINE_HANDSHAKE_QR_PREFIX) return null;
  const [, kind, eventId, identity, ackRaw] = parts;
  const ackNonce = normalizeManualCode(ackRaw).toLowerCase();
  if (!isUuid(eventId) || !isHex(ackNonce, OFFLINE_HANDSHAKE_ACK_HEX_LENGTH, 64)) return null;

  if (kind === 'a' && isUuid(identity)) {
    return {
      kind: 'ack',
      protocolVersion: OFFLINE_HANDSHAKE_PROTOCOL_VERSION,
      eventId,
      capabilityId: identity,
      manualCode: null,
      ackNonce,
    };
  }

  const manualCode = normalizeManualCode(identity);
  if (kind === 'm' && isHex(manualCode, 16, 32)) {
    return {
      kind: 'ack',
      protocolVersion: OFFLINE_HANDSHAKE_PROTOCOL_VERSION,
      eventId,
      capabilityId: null,
      manualCode,
      ackNonce,
    };
  }

  return null;
}

export function offerLooksLocallyUsable(
  offer: HandshakeOfferEnvelope,
  eventId: string,
  nowMs = Date.now(),
): { usable: boolean; reason: string | null } {
  if (offer.eventId !== eventId) return { usable: false, reason: 'This code belongs to another event.' };
  // Device time is UX guidance only. The server remains authoritative at
  // reconciliation and tolerates bounded clock drift.
  if (nowMs > offer.expiresAtEpochSeconds * 1000 + 5 * 60_000) {
    return { usable: false, reason: 'This code appears expired. Ask them to generate a fresh one.' };
  }
  return { usable: true, reason: null };
}

export async function createHandshakeAckNonce(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(10);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function createLocalHandshakeId(): Promise<string> {
  return Crypto.randomUUID();
}

export function isTerminalHandshakeState(state: OfflineHandshakeLocalState): boolean {
  return [
    'server-verified',
    'expired',
    'replay-rejected',
    'authorization-invalidated',
    'blocked',
    'conflict',
    'cancelled',
  ].includes(state);
}

export function retryDelayMs(attempt: number): number {
  const boundedAttempt = Math.max(0, Math.min(attempt, 6));
  return Math.min(5 * 60_000, 2_000 * 2 ** boundedAttempt);
}
