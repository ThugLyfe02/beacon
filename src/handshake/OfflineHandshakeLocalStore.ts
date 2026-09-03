import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type {
  OfflineHandshakePendingRecord,
  PreparedHandshakeCapability,
} from './OfflineHandshakeProtocol';

const PREFIX = 'beacon.handshake.v1';
const volatile = new Map<string, string>();
const writeChains = new Map<string, Promise<void>>();

interface EventIndex {
  ownerUserId: string;
  capabilityIds: string[];
  pendingIds: string[];
}

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function indexKey(eventId: string): string {
  return `${PREFIX}.index.${eventId}`;
}

function capabilityKey(eventId: string, capabilityId: string): string {
  return `${PREFIX}.cap.${eventId}.${capabilityId}`;
}

function pendingKey(eventId: string, localId: string): string {
  return `${PREFIX}.pending.${eventId}.${localId}`;
}

async function durableAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

async function getItem(key: string): Promise<string | null> {
  if (await durableAvailable()) {
    return SecureStore.getItemAsync(key, secureOptions);
  }
  return volatile.get(key) ?? null;
}

async function setItem(key: string, value: string): Promise<void> {
  if (await durableAvailable()) {
    await SecureStore.setItemAsync(key, value, secureOptions);
    return;
  }
  volatile.set(key, value);
}

async function deleteItem(key: string): Promise<void> {
  if (await durableAvailable()) {
    await SecureStore.deleteItemAsync(key, secureOptions);
    return;
  }
  volatile.delete(key);
}

async function withEventWriteLock<T>(eventId: string, operation: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(eventId) ?? Promise.resolve();
  let release: (() => void) | null = null;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  writeChains.set(eventId, previous.then(() => current));
  await previous;
  try {
    return await operation();
  } finally {
    release?.();
    if (writeChains.get(eventId) === current) writeChains.delete(eventId);
  }
}

async function readIndex(eventId: string): Promise<EventIndex | null> {
  const raw = await getItem(indexKey(eventId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<EventIndex>;
    if (
      typeof parsed.ownerUserId !== 'string'
      || !Array.isArray(parsed.capabilityIds)
      || !Array.isArray(parsed.pendingIds)
    ) return null;
    return {
      ownerUserId: parsed.ownerUserId,
      capabilityIds: parsed.capabilityIds.filter((value): value is string => typeof value === 'string').slice(-16),
      pendingIds: parsed.pendingIds.filter((value): value is string => typeof value === 'string').slice(-40),
    };
  } catch {
    return null;
  }
}

async function writeIndex(eventId: string, index: EventIndex): Promise<void> {
  await setItem(indexKey(eventId), JSON.stringify({
    ownerUserId: index.ownerUserId,
    capabilityIds: [...new Set(index.capabilityIds)].slice(-16),
    pendingIds: [...new Set(index.pendingIds)].slice(-40),
  }));
}

async function clearIndexContents(eventId: string, index: EventIndex): Promise<void> {
  await Promise.all([
    ...index.capabilityIds.map((id) => deleteItem(capabilityKey(eventId, id))),
    ...index.pendingIds.map((id) => deleteItem(pendingKey(eventId, id))),
  ]);
  await deleteItem(indexKey(eventId));
}

async function ensureOwnedIndex(eventId: string, ownerUserId: string): Promise<EventIndex> {
  const existing = await readIndex(eventId);
  if (existing && existing.ownerUserId !== ownerUserId) {
    // A different authenticated account must never inherit another account's
    // pending one-time material after logout/login on the same device.
    await clearIndexContents(eventId, existing);
  }
  return existing?.ownerUserId === ownerUserId
    ? existing
    : { ownerUserId, capabilityIds: [], pendingIds: [] };
}

export async function isHandshakePersistenceDurable(): Promise<boolean> {
  return durableAvailable();
}

export async function savePreparedHandshakeCapabilities(
  eventId: string,
  ownerUserId: string,
  capabilities: PreparedHandshakeCapability[],
): Promise<void> {
  await withEventWriteLock(eventId, async () => {
    const index = await ensureOwnedIndex(eventId, ownerUserId);
    for (const capability of capabilities) {
      if (capability.ownerUserId !== ownerUserId || capability.eventId !== eventId) continue;
      await setItem(capabilityKey(eventId, capability.capabilityId), JSON.stringify(capability));
      index.capabilityIds.push(capability.capabilityId);
    }
    await writeIndex(eventId, index);
  });
}

export async function listPreparedHandshakeCapabilities(
  eventId: string,
  ownerUserId: string,
): Promise<PreparedHandshakeCapability[]> {
  const index = await ensureOwnedIndex(eventId, ownerUserId);
  const now = Date.now();
  const kept: string[] = [];
  const result: PreparedHandshakeCapability[] = [];
  for (const id of index.capabilityIds) {
    const raw = await getItem(capabilityKey(eventId, id));
    if (!raw) continue;
    try {
      const capability = JSON.parse(raw) as PreparedHandshakeCapability;
      if (capability.ownerUserId !== ownerUserId || capability.eventId !== eventId) {
        await deleteItem(capabilityKey(eventId, id));
        continue;
      }
      if (Date.parse(capability.reconcileUntil) < now) {
        await deleteItem(capabilityKey(eventId, id));
        continue;
      }
      kept.push(id);
      result.push(capability);
    } catch {
      await deleteItem(capabilityKey(eventId, id));
    }
  }
  if (kept.length !== index.capabilityIds.length) {
    index.capabilityIds = kept;
    await writeIndex(eventId, index);
  }
  return result.sort((a, b) => Date.parse(a.validFrom) - Date.parse(b.validFrom));
}

export async function markLocalCapabilityPresented(
  eventId: string,
  ownerUserId: string,
  capabilityId: string,
): Promise<PreparedHandshakeCapability | null> {
  return withEventWriteLock(eventId, async () => {
    const capabilities = await listPreparedHandshakeCapabilities(eventId, ownerUserId);
    const target = capabilities.find((item) => item.capabilityId === capabilityId);
    if (!target) return null;
    const updated: PreparedHandshakeCapability = {
      ...target,
      state: 'presented',
      presentedAt: target.presentedAt ?? new Date().toISOString(),
    };
    await setItem(capabilityKey(eventId, capabilityId), JSON.stringify(updated));
    return updated;
  });
}

export async function getBestLocalCapability(
  eventId: string,
  ownerUserId: string,
  nowMs = Date.now(),
): Promise<PreparedHandshakeCapability | null> {
  const capabilities = await listPreparedHandshakeCapabilities(eventId, ownerUserId);
  const active = capabilities.filter((item) => (
    Date.parse(item.validFrom) - 2 * 60_000 <= nowMs
    && Date.parse(item.expiresAt) >= nowMs
  ));
  return active.find((item) => item.state === 'presented')
    ?? active.find((item) => item.state === 'prepared')
    ?? null;
}

export async function savePendingHandshake(record: OfflineHandshakePendingRecord): Promise<void> {
  await withEventWriteLock(record.eventId, async () => {
    const index = await ensureOwnedIndex(record.eventId, record.ownerUserId);
    await setItem(pendingKey(record.eventId, record.localId), JSON.stringify(record));
    index.pendingIds.push(record.localId);
    await writeIndex(record.eventId, index);
  });
}

export async function listPendingHandshakes(
  eventId: string,
  ownerUserId: string,
): Promise<OfflineHandshakePendingRecord[]> {
  const index = await ensureOwnedIndex(eventId, ownerUserId);
  const kept: string[] = [];
  const result: OfflineHandshakePendingRecord[] = [];
  for (const id of index.pendingIds) {
    const raw = await getItem(pendingKey(eventId, id));
    if (!raw) continue;
    try {
      const pending = JSON.parse(raw) as OfflineHandshakePendingRecord;
      if (pending.ownerUserId !== ownerUserId || pending.eventId !== eventId) {
        await deleteItem(pendingKey(eventId, id));
        continue;
      }
      kept.push(id);
      result.push(pending);
    } catch {
      await deleteItem(pendingKey(eventId, id));
    }
  }
  if (kept.length !== index.pendingIds.length) {
    index.pendingIds = kept;
    await writeIndex(eventId, index);
  }
  return result.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export async function updatePendingHandshake(
  eventId: string,
  ownerUserId: string,
  localId: string,
  patch: Partial<OfflineHandshakePendingRecord>,
): Promise<OfflineHandshakePendingRecord | null> {
  return withEventWriteLock(eventId, async () => {
    const pending = await listPendingHandshakes(eventId, ownerUserId);
    const current = pending.find((item) => item.localId === localId);
    if (!current) return null;
    const updated: OfflineHandshakePendingRecord = {
      ...current,
      ...patch,
      localId: current.localId,
      eventId: current.eventId,
      ownerUserId: current.ownerUserId,
      updatedAt: new Date().toISOString(),
    };
    await setItem(pendingKey(eventId, localId), JSON.stringify(updated));
    return updated;
  });
}

export async function removePendingHandshake(
  eventId: string,
  ownerUserId: string,
  localId: string,
): Promise<void> {
  await withEventWriteLock(eventId, async () => {
    const index = await ensureOwnedIndex(eventId, ownerUserId);
    await deleteItem(pendingKey(eventId, localId));
    index.pendingIds = index.pendingIds.filter((id) => id !== localId);
    await writeIndex(eventId, index);
  });
}

export async function clearEventHandshakeState(eventId: string, ownerUserId: string): Promise<void> {
  await withEventWriteLock(eventId, async () => {
    const index = await readIndex(eventId);
    if (!index || index.ownerUserId !== ownerUserId) return;
    await clearIndexContents(eventId, index);
  });
}
