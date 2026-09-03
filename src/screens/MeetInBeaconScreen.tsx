import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import {
  buildHandshakeAckPayload,
  buildHandshakeOfferPayload,
  formatManualCode,
  normalizeManualCode,
  offerLooksLocallyUsable,
  parseHandshakeAckPayload,
  parseHandshakeOfferPayload,
  type HandshakeOfferEnvelope,
  type OfflineHandshakePendingRecord,
  type PreparedHandshakeCapability,
} from '../handshake/OfflineHandshakeProtocol';
import {
  isHandshakePersistenceDurable,
  listPendingHandshakes,
} from '../handshake/OfflineHandshakeLocalStore';
import {
  createInitiatorPendingFromAck,
  createInitiatorPendingFromManualAck,
  createResponderPendingFromManual,
  createResponderPendingFromOffer,
  getMyVerifiedEventHandshakes,
  getUsableHandshakeCapability,
  markHandshakePresented,
  prepareHandshakeContinuity,
  reconcilePendingHandshakes,
  type VerifiedEventHandshake,
} from '../services/offline-handshake.service';

interface Params {
  MeetInBeacon: { eventId: string };
}

type FlowMode =
  | 'home'
  | 'present'
  | 'scan-offer'
  | 'confirm-offer'
  | 'respond'
  | 'scan-ack'
  | 'manual-offer'
  | 'manual-ack';

function evidenceLabel(value: VerifiedEventHandshake['evidenceClass']): string {
  return value === 'server-live-handshake' ? 'LIVE SERVER CONFIRMATION' : 'OFFLINE-RECONCILED CONFIRMATION';
}

function shortTime(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 'time unavailable';
  return new Date(parsed).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function MeetInBeaconScreen() {
  const route = useRoute<RouteProp<Params, 'MeetInBeacon'>>();
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const { eventId } = route.params;
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mode, setMode] = useState<FlowMode>('home');
  const [capability, setCapability] = useState<PreparedHandshakeCapability | null>(null);
  const [scannedOffer, setScannedOffer] = useState<HandshakeOfferEnvelope | null>(null);
  const [responsePending, setResponsePending] = useState<OfflineHandshakePendingRecord | null>(null);
  const [manualOfferCode, setManualOfferCode] = useState('');
  const [manualAckCode, setManualAckCode] = useState('');
  const [scanLocked, setScanLocked] = useState(false);
  const [working, setWorking] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [verified, setVerified] = useState<VerifiedEventHandshake[]>([]);
  const [durable, setDurable] = useState(true);
  const [networkDegraded, setNetworkDegraded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (force = false) => {
    if (!userId) return;
    const persistence = await isHandshakePersistenceDurable();
    setDurable(persistence);
    const prepared = await prepareHandshakeContinuity({ eventId, userId });
    const sync = await reconcilePendingHandshakes({ eventId, userId, force });
    const [usable, pending, history] = await Promise.all([
      getUsableHandshakeCapability(eventId, userId),
      listPendingHandshakes(eventId, userId),
      getMyVerifiedEventHandshakes(eventId),
    ]);
    if (usable) setCapability(usable);
    setPendingCount(pending.filter((item) => ['pending-reconciliation', 'needs-attention'].includes(item.state)).length);
    if (!history.error) setVerified(history.data);
    setNetworkDegraded(Boolean(prepared.error) || sync.networkUnavailable);
    if (sync.verified.length > 0) {
      const latest = sync.verified[0];
      setNotice(latest.otherName
        ? `Verified meeting with ${latest.otherName}. Relationship actions remain separate and consensual.`
        : 'Meeting verified. Relationship actions remain separate and consensual.');
    } else if (sync.terminal.length > 0) {
      const reason = sync.terminal[0].reasonCode ?? sync.terminal[0].handshakeState;
      setNotice(`A pending meeting could not be verified: ${reason.replace(/-/g, ' ')}.`);
    }
  }, [eventId, userId]);

  useEffect(() => {
    void refresh(false);
    const timer = setInterval(() => void refresh(false), 20_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh(false);
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [refresh]);

  const activeOfferPayload = useMemo(
    () => capability ? buildHandshakeOfferPayload(capability) : null,
    [capability],
  );

  const responsePayload = useMemo(() => {
    if (!responsePending) return null;
    return buildHandshakeAckPayload({
      eventId,
      capabilityId: responsePending.capabilityId,
      manualCode: responsePending.manualCode,
      ackNonce: responsePending.ackNonce,
    });
  }, [eventId, responsePending]);

  const startPresent = useCallback(async () => {
    if (!userId) return;
    setWorking(true);
    setNotice(null);
    await prepareHandshakeContinuity({ eventId, userId });
    const usable = await getUsableHandshakeCapability(eventId, userId);
    if (!usable) {
      setWorking(false);
      Alert.alert(
        'Brief connection required',
        'Beacon has no fresh one-time meeting capability cached on this device. Reconnect briefly so Beacon can prepare the next offline window.',
      );
      return;
    }
    const presented = await markHandshakePresented(eventId, userId, usable.capabilityId);
    setCapability(presented ?? usable);
    setMode('present');
    setWorking(false);
  }, [eventId, userId]);

  const ensureCamera = useCallback(async (): Promise<boolean> => {
    if (cameraPermission?.granted) return true;
    const result = await requestCameraPermission();
    if (!result.granted) {
      Alert.alert('Camera unavailable', 'Use the one-time manual code instead. The protocol does not require camera access.');
      return false;
    }
    return true;
  }, [cameraPermission?.granted, requestCameraPermission]);

  const startScanOffer = useCallback(async () => {
    if (await ensureCamera()) {
      setScanLocked(false);
      setMode('scan-offer');
    }
  }, [ensureCamera]);

  const startScanAck = useCallback(async () => {
    if (!capability) {
      Alert.alert('No active meeting code', 'Present your one-time code first.');
      return;
    }
    if (await ensureCamera()) {
      setScanLocked(false);
      setMode('scan-ack');
    }
  }, [capability, ensureCamera]);

  const handleScanned = useCallback(async ({ data }: BarcodeScanningResult) => {
    if (scanLocked || !userId) return;
    setScanLocked(true);

    if (mode === 'scan-offer') {
      const offer = parseHandshakeOfferPayload(data);
      if (!offer) {
        setNotice('That QR is not a Beacon meeting offer.');
        setTimeout(() => setScanLocked(false), 900);
        return;
      }
      const usability = offerLooksLocallyUsable(offer, eventId);
      if (!usability.usable) {
        setNotice(usability.reason);
        setTimeout(() => setScanLocked(false), 900);
        return;
      }
      setScannedOffer(offer);
      setMode('confirm-offer');
      return;
    }

    if (mode === 'scan-ack') {
      if (!capability) {
        setMode('home');
        return;
      }
      const ack = parseHandshakeAckPayload(data);
      if (!ack) {
        setNotice('That QR is not a Beacon acknowledgement.');
        setTimeout(() => setScanLocked(false), 900);
        return;
      }
      try {
        setWorking(true);
        await createInitiatorPendingFromAck({
          userId,
          eventId,
          capability,
          ack,
          transport: 'qr',
        });
        const sync = await reconcilePendingHandshakes({ eventId, userId, force: true });
        setNotice(sync.verified.length > 0
          ? 'Meeting verified. Connection and follow-through remain separate choices.'
          : sync.networkUnavailable
            ? 'Saved locally — Beacon will verify when connectivity returns.'
            : 'Your confirmation is saved. Beacon is waiting for the other phone to reconcile.');
        setMode('home');
        await refresh(false);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Could not save this acknowledgement.');
        setScanLocked(false);
      } finally {
        setWorking(false);
      }
    }
  }, [capability, eventId, mode, refresh, scanLocked, userId]);

  const confirmScannedOffer = useCallback(async () => {
    if (!scannedOffer || !userId) return;
    setWorking(true);
    try {
      const pending = await createResponderPendingFromOffer({
        userId,
        eventId,
        offer: scannedOffer,
        transport: 'qr',
      });
      setResponsePending(pending);
      setMode('respond');
      const sync = await reconcilePendingHandshakes({ eventId, userId, force: true });
      setNetworkDegraded(sync.networkUnavailable);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save your confirmation.');
    } finally {
      setWorking(false);
    }
  }, [eventId, scannedOffer, userId]);

  const confirmManualOffer = useCallback(async () => {
    if (!userId) return;
    const normalized = normalizeManualCode(manualOfferCode);
    if (normalized.length < 16) {
      Alert.alert('Incomplete code', 'Enter the entire one-time meeting code shown on the other phone.');
      return;
    }
    setWorking(true);
    try {
      const pending = await createResponderPendingFromManual({ userId, eventId, manualCode: normalized });
      setResponsePending(pending);
      setMode('respond');
      const sync = await reconcilePendingHandshakes({ eventId, userId, force: true });
      setNetworkDegraded(sync.networkUnavailable);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save your confirmation.');
    } finally {
      setWorking(false);
    }
  }, [eventId, manualOfferCode, userId]);

  const confirmManualAck = useCallback(async () => {
    if (!userId || !capability) return;
    setWorking(true);
    try {
      await createInitiatorPendingFromManualAck({
        userId,
        eventId,
        capability,
        ackNonce: manualAckCode,
      });
      const sync = await reconcilePendingHandshakes({ eventId, userId, force: true });
      setNotice(sync.verified.length > 0
        ? 'Meeting verified. Connection and follow-through remain separate choices.'
        : sync.networkUnavailable
          ? 'Saved locally — Beacon will verify when connectivity returns.'
          : 'Your confirmation is saved. Beacon is waiting for the other phone to reconcile.');
      setManualAckCode('');
      setMode('home');
      await refresh(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save this acknowledgement.');
    } finally {
      setWorking(false);
    }
  }, [capability, eventId, manualAckCode, refresh, userId]);

  const finishResponder = useCallback(async () => {
    setMode('home');
    setResponsePending(null);
    setScannedOffer(null);
    setManualOfferCode('');
    await refresh(false);
  }, [refresh]);

  if (!userId) {
    return <View style={styles.center}><Text style={styles.error}>Sign in to use an event handshake.</Text></View>;
  }

  if (mode === 'scan-offer' || mode === 'scan-ack') {
    return (
      <View style={styles.cameraPage}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanLocked ? undefined : handleScanned}
        />
        <View style={styles.cameraOverlay}>
          <View style={styles.scanFrame} />
          <Text style={styles.cameraTitle}>{mode === 'scan-offer' ? 'Scan their meeting code' : 'Scan their confirmation'}</Text>
          <Text style={styles.cameraCopy}>Scanning transfers a short-lived envelope. It does not create a meeting until you explicitly confirm.</Text>
          {notice ? <Text style={styles.cameraNotice}>{notice}</Text> : null}
          <Pressable style={styles.secondaryButton} onPress={() => setMode('home')}>
            <Text style={styles.secondaryButtonText}>CANCEL SCAN</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>OFFLINE EVENT CONTINUITY</Text>
      <Text style={styles.hero}>Meet intentionally—even when the venue network disappears.</Text>
      <Text style={styles.heroCopy}>
        Beacon uses a short-lived one-time capability and a second-device acknowledgement. Both people act explicitly. Passive Bluetooth detection, background encounter logging, and GPS alone never create this evidence.
      </Text>

      <View style={[styles.statusCard, networkDegraded && styles.statusCardOffline]}>
        <Text style={styles.statusTitle}>{networkDegraded ? 'NETWORK DEGRADED · LOCAL FLOW AVAILABLE' : 'CONTINUITY READY'}</Text>
        <Text style={styles.statusCopy}>
          {pendingCount > 0
            ? `${pendingCount} ${pendingCount === 1 ? 'meeting is' : 'meetings are'} stored locally and awaiting deterministic server reconciliation.`
            : 'No pending meetings on this device.'}
        </Text>
        {!durable ? (
          <Text style={styles.warning}>Secure durable storage is unavailable on this platform. Offline continuity is session-local until you reconnect.</Text>
        ) : null}
      </View>

      {notice ? <View style={styles.noticeCard}><Text style={styles.notice}>{notice}</Text></View> : null}

      {mode === 'home' ? (
        <>
          <View style={styles.actionGrid}>
            <Pressable style={styles.primaryButton} onPress={startPresent} disabled={working}>
              <Text style={styles.primaryButtonText}>{working ? 'PREPARING…' : 'CONFIRM & SHOW MY CODE'}</Text>
              <Text style={styles.buttonSubcopy}>I am meeting the person physically in front of me.</Text>
            </Pressable>
            <Pressable style={styles.primaryButtonAlt} onPress={startScanOffer} disabled={working}>
              <Text style={styles.primaryButtonAltText}>SCAN THEIR CODE</Text>
              <Text style={styles.buttonSubcopy}>I am confirming someone else’s short-lived offer.</Text>
            </Pressable>
          </View>

          <Pressable style={styles.manualButton} onPress={() => setMode('manual-offer')}>
            <Text style={styles.manualButtonText}>CAN’T SCAN? ENTER ONE-TIME CODE</Text>
          </Pressable>

          <View style={styles.boundaryCard}>
            <Text style={styles.boundaryEyebrow}>TRUST BOUNDARY</Text>
            <Text style={styles.boundaryText}>
              An offline-reconciled handshake means both authenticated participants later submitted matching explicit confirmations under the same short-lived event capability. It is not cryptographic distance-bounding and does not automatically create a connection, match, deal, or successful outcome.
            </Text>
          </View>
        </>
      ) : null}

      {mode === 'present' && capability && activeOfferPayload ? (
        <View style={styles.flowCard}>
          <Text style={styles.flowEyebrow}>STEP 1 · YOUR OFFER</Text>
          <Text style={styles.flowTitle}>Have the person in front of you scan this.</Text>
          <View style={styles.qrWrap}>
            <QRCode value={activeOfferPayload} size={220} ecl="M" quietZone={10} />
          </View>
          <Text style={styles.expiry}>ONE-TIME · EXPIRES {shortTime(capability.expiresAt)}</Text>
          <Text style={styles.manualLabel}>Manual fallback</Text>
          <Text selectable style={styles.manualCode}>{formatManualCode(capability.manualCode)}</Text>
          <Text style={styles.flowCopy}>
            After they tap Confirm, their phone will show an acknowledgement. Scan that acknowledgement back here. This two-way exchange prevents a single scanned screenshot from becoming verified evidence by itself.
          </Text>
          <Pressable style={styles.primaryButtonAlt} onPress={startScanAck}>
            <Text style={styles.primaryButtonAltText}>SCAN THEIR CONFIRMATION</Text>
          </Pressable>
          <Pressable style={styles.manualButton} onPress={() => setMode('manual-ack')}>
            <Text style={styles.manualButtonText}>ENTER THEIR ACKNOWLEDGEMENT</Text>
          </Pressable>
          <Pressable style={styles.textButton} onPress={() => setMode('home')}>
            <Text style={styles.textButtonText}>BACK</Text>
          </Pressable>
        </View>
      ) : null}

      {mode === 'confirm-offer' && scannedOffer ? (
        <View style={styles.flowCard}>
          <Text style={styles.flowEyebrow}>EXPLICIT CONFIRMATION</Text>
          <Text style={styles.flowTitle}>Confirm the person showing you this code.</Text>
          <Text style={styles.flowCopy}>
            Beacon intentionally does not place reusable identity data in the QR. You are confirming the real person physically presenting it to you, not a profile inferred from passive proximity.
          </Text>
          <Pressable style={styles.primaryButton} onPress={confirmScannedOffer} disabled={working}>
            <Text style={styles.primaryButtonText}>{working ? 'SAVING…' : 'I CONFIRM THIS MEETING'}</Text>
          </Pressable>
          <Pressable style={styles.textButton} onPress={() => { setScannedOffer(null); setMode('home'); }}>
            <Text style={styles.textButtonText}>CANCEL</Text>
          </Pressable>
        </View>
      ) : null}

      {mode === 'respond' && responsePending && responsePayload ? (
        <View style={styles.flowCard}>
          <Text style={styles.flowEyebrow}>STEP 2 · RETURN CONFIRMATION</Text>
          <Text style={styles.flowTitle}>Show this back to the person you just confirmed.</Text>
          <View style={styles.qrWrap}>
            <QRCode value={responsePayload} size={220} ecl="M" quietZone={10} />
          </View>
          <Text style={styles.manualLabel}>Accessible manual acknowledgement</Text>
          <Text selectable style={styles.manualCode}>{formatManualCode(responsePending.ackNonce)}</Text>
          <Text style={styles.flowCopy}>
            Your confirmation is already stored locally. If the network is unavailable, Beacon will reconcile it later; the other phone must still return the same acknowledgement before the server can verify the meeting.
          </Text>
          <Pressable style={styles.primaryButton} onPress={finishResponder}>
            <Text style={styles.primaryButtonText}>DONE</Text>
          </Pressable>
        </View>
      ) : null}

      {mode === 'manual-offer' ? (
        <View style={styles.flowCard}>
          <Text style={styles.flowEyebrow}>MANUAL FALLBACK</Text>
          <Text style={styles.flowTitle}>Enter the one-time code shown on the other phone.</Text>
          <TextInput
            value={manualOfferCode}
            onChangeText={setManualOfferCode}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="One-time meeting code"
            placeholder="ABCD-EF12-3456-7890"
            placeholderTextColor="#64748B"
            style={styles.input}
          />
          <Pressable style={styles.primaryButton} onPress={confirmManualOffer} disabled={working}>
            <Text style={styles.primaryButtonText}>{working ? 'SAVING…' : 'I CONFIRM THIS MEETING'}</Text>
          </Pressable>
          <Pressable style={styles.textButton} onPress={() => setMode('home')}>
            <Text style={styles.textButtonText}>BACK</Text>
          </Pressable>
        </View>
      ) : null}

      {mode === 'manual-ack' && capability ? (
        <View style={styles.flowCard}>
          <Text style={styles.flowEyebrow}>MANUAL ACKNOWLEDGEMENT</Text>
          <Text style={styles.flowTitle}>Enter the acknowledgement shown on their phone.</Text>
          <TextInput
            value={manualAckCode}
            onChangeText={setManualAckCode}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Meeting acknowledgement code"
            placeholder="12AB-34CD-56EF-7890-ABCD"
            placeholderTextColor="#64748B"
            style={styles.input}
          />
          <Pressable style={styles.primaryButton} onPress={confirmManualAck} disabled={working}>
            <Text style={styles.primaryButtonText}>{working ? 'SAVING…' : 'SAVE ACKNOWLEDGEMENT'}</Text>
          </Pressable>
          <Pressable style={styles.textButton} onPress={() => setMode('present')}>
            <Text style={styles.textButtonText}>BACK</Text>
          </Pressable>
        </View>
      ) : null}

      {working && mode === 'home' ? <ActivityIndicator color="#6EE7B7" style={{ marginTop: 14 }} /> : null}

      {verified.length > 0 ? (
        <View style={styles.historySection}>
          <Text style={styles.eyebrow}>VERIFIED MEETINGS</Text>
          {verified.slice(0, 8).map((item) => (
            <Pressable
              key={item.verificationId}
              style={styles.historyCard}
              onPress={() => navigation.navigate('Profile', { userId: item.otherUserId })}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.historyName}>{item.otherName ?? 'Verified participant'}</Text>
                {item.otherRole ? <Text style={styles.historyRole}>{item.otherRole}</Text> : null}
                <Text style={styles.historyEvidence}>{evidenceLabel(item.evidenceClass)}</Text>
              </View>
              <Text style={styles.historyTime}>{shortTime(item.verifiedAt)}</Text>
            </Pressable>
          ))}
          <Text style={styles.historyBoundary}>
            These records prove a reconciled explicit handshake under Beacon’s protocol. They do not automatically make either person a mutual connection.
          </Text>
        </View>
      ) : null}

      <View style={styles.transportCard}>
        <Text style={styles.boundaryEyebrow}>TRANSPORT ≠ TRUST</Text>
        <Text style={styles.boundaryText}>
          QR and manual code are active now. NFC and Bluetooth are reserved transport adapters for the same protocol: they may move an offer or acknowledgement after user action, but detecting a nearby device will never create meeting evidence or a background encounter history.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#050A09' },
  content: { padding: 18, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#050A09', padding: 24 },
  error: { color: '#FCA5A5', fontSize: 14 },
  eyebrow: { color: '#6EE7B7', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  hero: { marginTop: 7, color: '#F0FDF4', fontSize: 26, lineHeight: 32, fontWeight: '900' },
  heroCopy: { marginTop: 10, color: '#9FBDB2', fontSize: 12, lineHeight: 19 },
  statusCard: { marginTop: 16, borderRadius: 18, padding: 14, backgroundColor: 'rgba(6,78,59,0.22)', borderWidth: 1, borderColor: 'rgba(52,211,153,0.25)' },
  statusCardOffline: { borderColor: 'rgba(251,191,36,0.38)', backgroundColor: 'rgba(120,53,15,0.15)' },
  statusTitle: { color: '#6EE7B7', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  statusCopy: { marginTop: 5, color: '#D1FAE5', fontSize: 11, lineHeight: 16 },
  warning: { marginTop: 7, color: '#FCD34D', fontSize: 10, lineHeight: 15 },
  noticeCard: { marginTop: 12, borderRadius: 14, padding: 12, backgroundColor: '#10231E', borderWidth: 1, borderColor: 'rgba(110,231,183,0.18)' },
  notice: { color: '#D1FAE5', fontSize: 11, lineHeight: 16 },
  actionGrid: { marginTop: 18, gap: 10 },
  primaryButton: { borderRadius: 16, padding: 15, backgroundColor: '#10B981', borderWidth: 1, borderColor: '#6EE7B7' },
  primaryButtonText: { color: '#022C22', fontSize: 12, fontWeight: '900', letterSpacing: 0.7, textAlign: 'center' },
  primaryButtonAlt: { marginTop: 10, borderRadius: 16, padding: 15, backgroundColor: '#0C4A3E', borderWidth: 1, borderColor: '#34D399' },
  primaryButtonAltText: { color: '#D1FAE5', fontSize: 12, fontWeight: '900', letterSpacing: 0.7, textAlign: 'center' },
  buttonSubcopy: { marginTop: 4, color: '#A7F3D0', fontSize: 9, lineHeight: 13, textAlign: 'center' },
  manualButton: { marginTop: 10, padding: 12, alignItems: 'center' },
  manualButtonText: { color: '#6EE7B7', fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
  textButton: { marginTop: 8, padding: 10, alignItems: 'center' },
  textButtonText: { color: '#94A3B8', fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  boundaryCard: { marginTop: 18, borderRadius: 16, padding: 14, backgroundColor: '#0B1512', borderWidth: 1, borderColor: 'rgba(148,163,184,0.12)' },
  transportCard: { marginTop: 22, borderRadius: 16, padding: 14, backgroundColor: '#0B1512', borderWidth: 1, borderColor: 'rgba(148,163,184,0.12)' },
  boundaryEyebrow: { color: '#94A3B8', fontSize: 9, fontWeight: '900', letterSpacing: 0.9 },
  boundaryText: { marginTop: 6, color: '#82998F', fontSize: 10, lineHeight: 16 },
  flowCard: { marginTop: 18, borderRadius: 20, padding: 16, backgroundColor: '#081712', borderWidth: 1, borderColor: 'rgba(52,211,153,0.28)' },
  flowEyebrow: { color: '#6EE7B7', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  flowTitle: { marginTop: 7, color: '#F0FDF4', fontSize: 19, lineHeight: 25, fontWeight: '800' },
  flowCopy: { marginTop: 10, color: '#9FBDB2', fontSize: 11, lineHeight: 17 },
  qrWrap: { marginTop: 16, padding: 14, alignSelf: 'center', borderRadius: 18, backgroundColor: '#FFFFFF' },
  expiry: { marginTop: 10, color: '#6EE7B7', fontSize: 9, fontWeight: '900', letterSpacing: 0.8, textAlign: 'center' },
  manualLabel: { marginTop: 15, color: '#94A3B8', fontSize: 9, fontWeight: '800', letterSpacing: 0.7, textAlign: 'center' },
  manualCode: { marginTop: 5, color: '#F0FDF4', fontSize: 17, fontWeight: '900', letterSpacing: 1.4, textAlign: 'center', fontVariant: ['tabular-nums'] },
  input: { marginTop: 14, minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(52,211,153,0.28)', backgroundColor: '#0B1512', paddingHorizontal: 14, color: '#F0FDF4', fontSize: 16, letterSpacing: 1.1 },
  historySection: { marginTop: 24, gap: 9 },
  historyCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 15, padding: 13, backgroundColor: '#0B1512', borderWidth: 1, borderColor: 'rgba(52,211,153,0.14)' },
  historyName: { color: '#F0FDF4', fontSize: 14, fontWeight: '800' },
  historyRole: { marginTop: 2, color: '#94A3B8', fontSize: 10 },
  historyEvidence: { marginTop: 6, color: '#6EE7B7', fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  historyTime: { color: '#64748B', fontSize: 9, fontVariant: ['tabular-nums'] },
  historyBoundary: { color: '#64748B', fontSize: 9, lineHeight: 14 },
  cameraPage: { flex: 1, backgroundColor: '#000' },
  cameraOverlay: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', padding: 24, paddingBottom: 42, backgroundColor: 'rgba(0,0,0,0.28)' },
  scanFrame: { position: 'absolute', top: '24%', width: 250, height: 250, borderRadius: 24, borderWidth: 2, borderColor: '#6EE7B7', backgroundColor: 'transparent' },
  cameraTitle: { color: '#F0FDF4', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  cameraCopy: { marginTop: 7, color: '#D1FAE5', fontSize: 11, lineHeight: 17, textAlign: 'center' },
  cameraNotice: { marginTop: 8, color: '#FCD34D', fontSize: 10, textAlign: 'center' },
  secondaryButton: { marginTop: 14, borderRadius: 999, borderWidth: 1, borderColor: '#6EE7B7', paddingHorizontal: 18, paddingVertical: 10, backgroundColor: 'rgba(0,0,0,0.46)' },
  secondaryButtonText: { color: '#D1FAE5', fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
});
