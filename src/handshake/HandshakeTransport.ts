import type { HandshakeTransportKind } from './OfflineHandshakeProtocol';

export interface HandshakeTransportDescriptor {
  kind: HandshakeTransportKind;
  label: string;
  implemented: boolean;
  requiresExplicitConfirmation: true;
  passiveDiscoveryCreatesEvidence: false;
  notes: string;
}

/**
 * Transport is deliberately separated from trust. QR, manual entry, future NFC,
 * and future BLE move the same short-lived challenge/ack envelopes. None of them
 * may create interaction evidence merely because another device was detected.
 */
export const HANDSHAKE_TRANSPORTS: readonly HandshakeTransportDescriptor[] = [
  {
    kind: 'qr',
    label: 'QR',
    implemented: true,
    requiresExplicitConfirmation: true,
    passiveDiscoveryCreatesEvidence: false,
    notes: 'Camera scan transfers the short-lived offer or acknowledgement envelope.',
  },
  {
    kind: 'manual',
    label: 'Manual code',
    implemented: true,
    requiresExplicitConfirmation: true,
    passiveDiscoveryCreatesEvidence: false,
    notes: 'Accessibility and older-device fallback using bounded one-time codes.',
  },
  {
    kind: 'nfc',
    label: 'NFC tap',
    implemented: false,
    requiresExplicitConfirmation: true,
    passiveDiscoveryCreatesEvidence: false,
    notes: 'Future adapter must exchange the same versioned envelope and preserve the same two-party confirmation state machine.',
  },
  {
    kind: 'ble',
    label: 'Bluetooth nearby transfer',
    implemented: false,
    requiresExplicitConfirmation: true,
    passiveDiscoveryCreatesEvidence: false,
    notes: 'Future adapter may move envelopes only after user action. Background detection must never become encounter history.',
  },
] as const;

export function getHandshakeTransport(kind: HandshakeTransportKind): HandshakeTransportDescriptor {
  return HANDSHAKE_TRANSPORTS.find((item) => item.kind === kind) ?? HANDSHAKE_TRANSPORTS[0];
}
