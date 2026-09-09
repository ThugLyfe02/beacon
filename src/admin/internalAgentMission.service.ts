import { supabase } from '../lib/supabase';
import type { InternalAgentMission } from './InternalGraphStrategyEngine';

export type InternalAgentMissionStatus = 'open' | 'acknowledged' | 'dismissed' | 'resolved';

export interface InternalAgentMissionSyncResult {
  syncedAt: string;
  objectiveDigest: string;
  createdCount: number;
  reopenedCount: number;
  revisedCount: number;
  resolvedCandidateCount: number;
  activeCount: number;
  totalCount: number;
}

export interface InternalAgentMissionLedgerEntry {
  id: string;
  eventId: string | null;
  missionKey: string;
  agent: InternalAgentMission['agent'];
  title: string;
  thesis: string;
  priority: number;
  evidence: string[];
  nodeKeys: string[];
  recommendedAction: string;
  status: InternalAgentMissionStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
  revisionCount: number;
  reopenedCount: number;
  missCount: number;
  resolvedAt: string | null;
  objectiveDigest: string;
}

export interface InternalAgentMissionLedger {
  generatedAt: string;
  missions: InternalAgentMissionLedgerEntry[];
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function persistenceSafeMission(mission: InternalAgentMission) {
  // Pathfinder's UI title contains the operator's raw target query. The Mission
  // Ledger stores only an objective digest, so canonicalize that title before
  // persistence. The explainable path remains available via graph-validated
  // node ids and evidence text.
  return {
    id: mission.id,
    agent: mission.agent,
    priority: mission.priority,
    title: mission.agent === 'Pathfinder' ? 'Explainable target-ecosystem route' : mission.title,
    thesis: mission.thesis,
    evidence: mission.evidence,
    nodeIds: mission.nodeIds,
    recommendedAction: mission.recommendedAction,
    autonomy: mission.autonomy,
    requiresHumanApproval: mission.requiresHumanApproval,
  };
}

export async function syncInternalAgentMissions(input: {
  eventId?: string | null;
  objective?: string | null;
  graphVersion: string;
  missions: InternalAgentMission[];
}): Promise<InternalAgentMissionSyncResult> {
  const { data, error } = await supabase.rpc('sync_internal_agent_missions', {
    p_event_id: input.eventId ?? null,
    p_objective: input.objective?.trim() || null,
    p_graph_version: input.graphVersion,
    p_missions: input.missions.map(persistenceSafeMission),
  });

  if (error || !data || typeof data !== 'object') {
    console.error('[internalAgentMission.service] sync:', error);
    throw new Error(error?.message ?? 'Unable to sync Constellation agent missions.');
  }

  const raw = data as Record<string, unknown>;
  return {
    syncedAt: typeof raw.syncedAt === 'string' ? raw.syncedAt : new Date().toISOString(),
    objectiveDigest: typeof raw.objectiveDigest === 'string' ? raw.objectiveDigest : '',
    createdCount: finiteNumber(raw.createdCount),
    reopenedCount: finiteNumber(raw.reopenedCount),
    revisedCount: finiteNumber(raw.revisedCount),
    resolvedCandidateCount: finiteNumber(raw.resolvedCandidateCount),
    activeCount: finiteNumber(raw.activeCount),
    totalCount: finiteNumber(raw.totalCount),
  };
}

export async function loadInternalAgentMissionLedger(
  eventId?: string | null,
  limit = 120,
): Promise<InternalAgentMissionLedger> {
  const { data, error } = await supabase.rpc('get_internal_agent_mission_ledger', {
    p_event_id: eventId ?? null,
    p_limit: Math.max(1, Math.min(limit, 250)),
  });

  if (error || !data || typeof data !== 'object') {
    console.error('[internalAgentMission.service] load:', error);
    throw new Error(error?.message ?? 'Unable to load Constellation mission memory.');
  }

  const raw = data as Record<string, unknown>;
  const rows = Array.isArray(raw.missions) ? raw.missions : [];
  return {
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : new Date().toISOString(),
    missions: rows.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      const id = typeof row.id === 'string' ? row.id : null;
      const missionKey = typeof row.missionKey === 'string' ? row.missionKey : null;
      const agent = typeof row.agent === 'string' ? row.agent as InternalAgentMission['agent'] : null;
      if (!id || !missionKey || !agent) return [];
      const status = ['open', 'acknowledged', 'dismissed', 'resolved'].includes(String(row.status))
        ? row.status as InternalAgentMissionStatus
        : 'open';
      return [{
        id,
        eventId: typeof row.eventId === 'string' ? row.eventId : null,
        missionKey,
        agent,
        title: typeof row.title === 'string' ? row.title : missionKey,
        thesis: typeof row.thesis === 'string' ? row.thesis : '',
        priority: finiteNumber(row.priority),
        evidence: stringArray(row.evidence),
        nodeKeys: stringArray(row.nodeKeys),
        recommendedAction: typeof row.recommendedAction === 'string' ? row.recommendedAction : '',
        status,
        firstSeenAt: typeof row.firstSeenAt === 'string' ? row.firstSeenAt : new Date().toISOString(),
        lastSeenAt: typeof row.lastSeenAt === 'string' ? row.lastSeenAt : new Date().toISOString(),
        seenCount: finiteNumber(row.seenCount),
        revisionCount: finiteNumber(row.revisionCount),
        reopenedCount: finiteNumber(row.reopenedCount),
        missCount: finiteNumber(row.missCount),
        resolvedAt: typeof row.resolvedAt === 'string' ? row.resolvedAt : null,
        objectiveDigest: typeof row.objectiveDigest === 'string' ? row.objectiveDigest : '',
      }];
    }),
  };
}

export async function setInternalAgentMissionStatus(
  missionId: string,
  status: Exclude<InternalAgentMissionStatus, 'resolved'>,
): Promise<void> {
  const { error } = await supabase.rpc('set_internal_agent_mission_status', {
    p_mission_id: missionId,
    p_status: status,
  });
  if (error) {
    console.error('[internalAgentMission.service] disposition:', error);
    throw new Error(error.message ?? 'Unable to update agent mission state.');
  }
}
