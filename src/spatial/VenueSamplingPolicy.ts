import type { VenueTwinSnapshot } from './SpatialVenueTwinEngine';
import type { VenueSensorHealthState } from './VenueSensorHealth';
import type { VenueServicePointSummary } from './VenueServicePoint';

export interface VenueZoneSamplingPlan {
  zoneId: string;
  intervalMs: number;
  priority: number;
  reason: string;
}

export interface VenueSamplingPolicyState {
  zones: VenueZoneSamplingPlan[];
  fastestIntervalMs: number;
  slowestIntervalMs: number;
  estimatedRelativeLoad: number;
  degraded: boolean;
  reasons: string[];
}

interface VenueSamplingPolicyInput {
  twin: VenueTwinSnapshot;
  sensorHealth: VenueSensorHealthState;
  servicePoints?: VenueServicePointSummary;
  changedZoneIds?: string[];
  activeInterventionZoneIds?: string[];
  minimumIntervalMs?: number;
  maximumIntervalMs?: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Allocates sensing effort where the venue is changing fastest without dropping
 * stable zones from observation. Saturated zones, detected change points,
 * congested service points, and active interventions are sampled more often;
 * cold stable zones can back off to reduce radio, edge, and transport load.
 *
 * This policy changes cadence, not truth. Every enabled venue zone retains a
 * bounded sampling floor and unhealthy sensors do not earn higher authority by
 * reporting more frequently.
 */
export function buildVenueSamplingPolicy(
  input: VenueSamplingPolicyInput,
): VenueSamplingPolicyState {
  const minimumIntervalMs = Math.max(500, input.minimumIntervalMs ?? 1_500);
  const maximumIntervalMs = Math.max(minimumIntervalMs, input.maximumIntervalMs ?? 15_000);
  const changedZoneIds = new Set(input.changedZoneIds ?? []);
  const activeInterventionZoneIds = new Set(input.activeInterventionZoneIds ?? []);
  const congestedServiceZoneIds = new Set(
    (input.servicePoints?.points ?? [])
      .filter((point) => point.state === 'congested' || point.state === 'building')
      .map((point) => point.zoneId),
  );
  const sensingDegraded = input.sensorHealth.effectiveSourceWeight < 1
    || input.sensorHealth.quarantinedSourceIds.length > 0
    || input.sensorHealth.offlineSourceIds.length > 0;

  const zones = input.twin.zones.map<VenueZoneSamplingPlan>((zone) => {
    const pressure = clamp01(
      zone.occupancyRatio * 0.34
      + zone.ingressPressure * 0.26
      + zone.egressPressure * 0.12
      + zone.dwellPressure * 0.18
      + (zone.state === 'saturated' ? 0.1 : zone.state === 'active' ? 0.05 : 0),
    );
    const changeBoost = changedZoneIds.has(zone.id) ? 0.2 : 0;
    const interventionBoost = activeInterventionZoneIds.has(zone.id) ? 0.22 : 0;
    const serviceBoost = congestedServiceZoneIds.has(zone.id) ? 0.15 : 0;
    const confidenceNeed = clamp01(1 - zone.confidence) * 0.1;
    const priority = clamp01(pressure + changeBoost + interventionBoost + serviceBoost + confidenceNeed);
    const healthPenalty = sensingDegraded ? 1.12 : 1;
    const intervalSpan = maximumIntervalMs - minimumIntervalMs;
    const intervalMs = Math.round(
      Math.min(
        maximumIntervalMs,
        Math.max(minimumIntervalMs, (maximumIntervalMs - intervalSpan * priority) * healthPenalty),
      ),
    );

    const reasons: string[] = [];
    if (zone.state === 'saturated') reasons.push('zone is saturated');
    if (changedZoneIds.has(zone.id)) reasons.push('recent change point detected');
    if (activeInterventionZoneIds.has(zone.id)) reasons.push('active intervention requires a tighter observation window');
    if (congestedServiceZoneIds.has(zone.id)) reasons.push('service-point pressure is building in this zone');
    if (zone.confidence < 0.6) reasons.push('zone confidence needs additional observations');
    if (reasons.length === 0) reasons.push(zone.state === 'cold' ? 'stable cold zone can use the bounded low-frequency cadence' : 'normal venue cadence');

    return {
      zoneId: zone.id,
      intervalMs,
      priority,
      reason: reasons.join('; '),
    };
  }).sort((a, b) => a.intervalMs - b.intervalMs || b.priority - a.priority || a.zoneId.localeCompare(b.zoneId));

  const fastestIntervalMs = zones.length === 0 ? maximumIntervalMs : Math.min(...zones.map((zone) => zone.intervalMs));
  const slowestIntervalMs = zones.length === 0 ? maximumIntervalMs : Math.max(...zones.map((zone) => zone.intervalMs));
  const baselineRequests = Math.max(1, zones.length * (60_000 / minimumIntervalMs));
  const plannedRequests = zones.reduce((sum, zone) => sum + 60_000 / Math.max(1, zone.intervalMs), 0);
  const estimatedRelativeLoad = clamp01(plannedRequests / baselineRequests);

  const reasons: string[] = [];
  if (sensingDegraded) reasons.push('sensor health is degraded, so cadence increases are bounded instead of amplifying an unhealthy source estate');
  if (changedZoneIds.size > 0) reasons.push(`${changedZoneIds.size} changed zone${changedZoneIds.size === 1 ? ' receives' : 's receive'} higher observation priority`);
  if (activeInterventionZoneIds.size > 0) reasons.push(`${activeInterventionZoneIds.size} intervention zone${activeInterventionZoneIds.size === 1 ? ' is' : 's are'} held to a tighter measurement cadence`);
  if (reasons.length === 0) reasons.push('sampling load is distributed according to current venue pressure while retaining a floor for every zone');

  return {
    zones,
    fastestIntervalMs,
    slowestIntervalMs,
    estimatedRelativeLoad,
    degraded: sensingDegraded,
    reasons,
  };
}
