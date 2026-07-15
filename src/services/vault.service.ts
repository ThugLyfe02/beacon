import { supabase } from "../lib/supabase";
import type { VaultEntry, VaultEntryKind, VaultEntryStatus } from "../vault/VaultEngine";

interface VaultRow {
  id: string;
  event_id: string;
  user_id: string;
  kind: VaultEntryKind;
  status: VaultEntryStatus;
  source_id: string | null;
  subject_user_id: string | null;
  identity_revealed: boolean;
  title: string;
  detail: string | null;
  next_action: string | null;
  metadata: Record<string, unknown> | null;
  visible_until: string | null;
  created_at: string;
}

function mapVaultRow(row: VaultRow): VaultEntry {
  return {
    id: row.id,
    eventId: row.event_id,
    userId: row.user_id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    detail: row.detail,
    nextAction: row.next_action,
    identityRevealed: row.identity_revealed,
    subjectUserId: row.identity_revealed ? row.subject_user_id : null,
    visibleUntil: row.visible_until,
    createdAt: row.created_at,
    metadata: row.metadata ?? {},
  };
}

export async function listVaultEntries(eventId: string, userId: string): Promise<VaultEntry[]> {
  if (!eventId || !userId) return [];

  const { data, error } = await supabase
    .from("vault_entries")
    .select("id, event_id, user_id, kind, status, source_id, subject_user_id, identity_revealed, title, detail, next_action, metadata, visible_until, created_at")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[vault.service] listVaultEntries error:", error);
    return [];
  }

  return ((data ?? []) as VaultRow[]).map(mapVaultRow);
}

export async function saveVaultEntry(input: {
  eventId: string;
  userId: string;
  kind: VaultEntryKind;
  title: string;
  detail?: string | null;
  nextAction?: string | null;
  sourceId?: string | null;
  subjectUserId?: string | null;
  identityRevealed?: boolean;
  metadata?: Record<string, unknown>;
  visibleUntil?: string | null;
}): Promise<VaultEntry | null> {
  const identityRevealed = input.identityRevealed === true;
  const payload = {
    event_id: input.eventId,
    user_id: input.userId,
    kind: input.kind,
    title: input.title.trim(),
    detail: input.detail?.trim() || null,
    next_action: input.nextAction?.trim() || null,
    source_id: input.sourceId ?? null,
    subject_user_id: identityRevealed ? input.subjectUserId ?? null : null,
    identity_revealed: identityRevealed,
    metadata: input.metadata ?? {},
    visible_until: input.visibleUntil ?? null,
  };

  const query = supabase.from("vault_entries").upsert(payload, {
    onConflict: "user_id,event_id,kind,source_id",
    ignoreDuplicates: false,
  });

  const { data, error } = await query
    .select("id, event_id, user_id, kind, status, source_id, subject_user_id, identity_revealed, title, detail, next_action, metadata, visible_until, created_at")
    .single();

  if (error) {
    console.error("[vault.service] saveVaultEntry error:", error);
    return null;
  }

  return mapVaultRow(data as VaultRow);
}

export async function updateVaultEntryStatus(
  entryId: string,
  userId: string,
  status: VaultEntryStatus
): Promise<boolean> {
  const { error } = await supabase
    .from("vault_entries")
    .update({ status })
    .eq("id", entryId)
    .eq("user_id", userId);

  if (error) {
    console.error("[vault.service] updateVaultEntryStatus error:", error);
    return false;
  }
  return true;
}

export async function seedMutualIntoVault(input: {
  eventId: string;
  userId: string;
  matchId: string;
  matchedUserId: string;
  matchedName: string | null;
  matchedRole: string | null;
  visibleUntil?: string | null;
}): Promise<VaultEntry | null> {
  const name = input.matchedName?.trim() || "Mutual connection";
  const role = input.matchedRole?.trim();
  return saveVaultEntry({
    eventId: input.eventId,
    userId: input.userId,
    kind: "mutual",
    sourceId: input.matchId,
    subjectUserId: input.matchedUserId,
    identityRevealed: true,
    title: role ? `${name} · ${role}` : name,
    detail: "Both participants independently signaled interest during this event.",
    nextAction: "Follow up while the event context is still fresh.",
    visibleUntil: input.visibleUntil ?? null,
    metadata: { matchId: input.matchId, matchedRole: input.matchedRole },
  });
}

export async function seedMissedCategoryIntoVault(input: {
  eventId: string;
  userId: string;
  sourceId: string;
  category: string;
  closestBucket: number;
  highSignal: boolean;
  visibleUntil?: string | null;
}): Promise<VaultEntry | null> {
  return saveVaultEntry({
    eventId: input.eventId,
    userId: input.userId,
    kind: "missed_category",
    sourceId: input.sourceId,
    identityRevealed: false,
    title: `${input.category} opportunity missed`,
    detail: "Beacon preserved the opportunity category without revealing private identity.",
    nextAction: "Act earlier when this category enters activation range at your next event.",
    visibleUntil: input.visibleUntil ?? null,
    metadata: {
      category: input.category,
      closestBucket: input.closestBucket,
      highSignal: input.highSignal,
    },
  });
}
