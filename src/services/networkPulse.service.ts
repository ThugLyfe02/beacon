import { supabase } from '../lib/supabase';

export interface NetworkPulse {
  generatedAt: string;
  eventId: string | null;
  eventCount: number;
  mutualCount: number;
  officeHoursCompleted: number;
  outcomesCompleted: number;
  secondDegreeReach: number;
  momentum: number;
  shape: 'warming_up' | 'forming' | 'bridging';
  reachBand: 'direct_only' | 'local' | 'expanding' | 'broad';
  privacyNote: string;
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getMyNetworkPulse(eventId?: string | null): Promise<NetworkPulse> {
  const { data, error } = await supabase.rpc('get_my_network_pulse', {
    p_event_id: eventId ?? null,
  });
  if (error || !data || typeof data !== 'object') {
    console.error('[networkPulse.service] pulse:', error);
    throw new Error(error?.message ?? 'Unable to load Network Pulse.');
  }

  const raw = data as Record<string, unknown>;
  const shape = ['warming_up', 'forming', 'bridging'].includes(String(raw.shape))
    ? raw.shape as NetworkPulse['shape']
    : 'warming_up';
  const reachBand = ['direct_only', 'local', 'expanding', 'broad'].includes(String(raw.reachBand))
    ? raw.reachBand as NetworkPulse['reachBand']
    : 'direct_only';

  return {
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : new Date().toISOString(),
    eventId: typeof raw.eventId === 'string' ? raw.eventId : null,
    eventCount: numberValue(raw.eventCount),
    mutualCount: numberValue(raw.mutualCount),
    officeHoursCompleted: numberValue(raw.officeHoursCompleted),
    outcomesCompleted: numberValue(raw.outcomesCompleted),
    secondDegreeReach: numberValue(raw.secondDegreeReach),
    momentum: Math.max(0, Math.min(100, numberValue(raw.momentum))),
    shape,
    reachBand,
    privacyNote: typeof raw.privacyNote === 'string'
      ? raw.privacyNote
      : 'Network Pulse is self-scoped and aggregate.',
  };
}
