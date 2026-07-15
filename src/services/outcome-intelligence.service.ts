import { supabase } from '../lib/supabase';
import type {
  EventHealthState,
  EventOutcomeSnapshot,
} from '../organizer/OutcomeIntelligenceEngine';

interface EventOutcomeSnapshotRow {
  id: string;
  event_id: string;
  host_id: string;
  captured_at: string;
  approved_participants: number;
  discoverable_participants: number;
  verified_role_participants: number;
  protected_access_participants: number;
  signals_sent: number;
  mutuals_formed: number;
  office_hours_requested: number;
  office_hours_completed: number;
  drops_claimed: number;
  drops_waitlisted: number;
  vault_actions_open: number;
  vault_actions_completed: number;
  missed_opportunities_recorded: number;
  activation_rate: number | string;
  signal_to_mutual_rate: number | string;
  office_hours_completion_rate: number | string;
  vault_follow_through_rate: number | string;
  verified_supply_rate: number | string;
  beacon_index: number;
  health_state: EventHealthState;
  confidence: number | string;
  diagnostics: unknown;
  methodology_version: string;
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDiagnostics(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function mapSnapshot(row: EventOutcomeSnapshotRow): EventOutcomeSnapshot {
  return {
    eventId: row.event_id,
    capturedAt: row.captured_at,
    approvedParticipants: row.approved_participants,
    discoverableParticipants: row.discoverable_participants,
    verifiedRoleParticipants: row.verified_role_participants,
    protectedAccessParticipants: row.protected_access_participants,
    signalsSent: row.signals_sent,
    mutualsFormed: row.mutuals_formed,
    officeHoursRequested: row.office_hours_requested,
    officeHoursCompleted: row.office_hours_completed,
    dropsClaimed: row.drops_claimed,
    dropsWaitlisted: row.drops_waitlisted,
    vaultActionsOpen: row.vault_actions_open,
    vaultActionsCompleted: row.vault_actions_completed,
    missedOpportunitiesRecorded: row.missed_opportunities_recorded,
    activationRate: toNumber(row.activation_rate),
    signalToMutualRate: toNumber(row.signal_to_mutual_rate),
    officeHoursCompletionRate: toNumber(row.office_hours_completion_rate),
    vaultFollowThroughRate: toNumber(row.vault_follow_through_rate),
    verifiedSupplyRate: toNumber(row.verified_supply_rate),
    beaconIndex: row.beacon_index,
    healthState: row.health_state,
    confidence: toNumber(row.confidence),
    diagnostics: parseDiagnostics(row.diagnostics),
    methodologyVersion: row.methodology_version,
  };
}

export async function captureEventOutcomeSnapshot(
  eventId: string,
): Promise<EventOutcomeSnapshot> {
  const { data, error } = await supabase
    .rpc('capture_event_outcome_snapshot', { p_event_id: eventId })
    .single();

  if (error || !data) {
    console.error('[outcome-intelligence.service] snapshot capture failed:', error);
    throw new Error('Unable to capture private event outcome intelligence.');
  }

  return mapSnapshot(data as EventOutcomeSnapshotRow);
}

export async function listEventOutcomeSnapshots(
  eventId: string,
  limit = 12,
): Promise<EventOutcomeSnapshot[]> {
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const { data, error } = await supabase
    .from('event_outcome_snapshots')
    .select('*')
    .eq('event_id', eventId)
    .order('captured_at', { ascending: false })
    .limit(safeLimit);

  if (error) {
    console.error('[outcome-intelligence.service] snapshot query failed:', error);
    throw new Error('Unable to load event outcome intelligence.');
  }

  return (data ?? []).map((row) => mapSnapshot(row as EventOutcomeSnapshotRow));
}

export async function getLatestEventOutcomeSnapshot(
  eventId: string,
): Promise<EventOutcomeSnapshot | null> {
  const snapshots = await listEventOutcomeSnapshots(eventId, 1);
  return snapshots[0] ?? null;
}

export async function listOrganizerOutcomeSnapshots(
  limit = 30,
): Promise<EventOutcomeSnapshot[]> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const { data, error } = await supabase
    .from('event_outcome_snapshots')
    .select('*')
    .order('captured_at', { ascending: false })
    .limit(safeLimit);

  if (error) {
    console.error('[outcome-intelligence.service] organizer history query failed:', error);
    throw new Error('Unable to load organizer outcome history.');
  }

  return (data ?? []).map((row) => mapSnapshot(row as EventOutcomeSnapshotRow));
}
