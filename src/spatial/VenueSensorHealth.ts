import type { VenueSourceVote } from './VenueSourceQuorum';

export type VenueSensorState = 'healthy' | 'watch' | 'quarantined' | 'offline';

export interface VenueSensorHealthInput extends VenueSourceVote {
  receivedAt: number;
  expectedPackets?: number;
  receivedPackets?: number;
  lastCalibrationAt?: number;
  calibrationIntervalMs?: number;
  driftEstimate?: number;
  driftTolerance?: number;
  consecutiveFailures?: number;
}

export interface VenueSensorHealthRecord {
  sourceId: string;
  sourceKind: VenueSourceVote['sourceKind'];
  state: VenueSensorState;
  authorityWeight: number;
  stalenessMs: number;
  transportDelayMs: number;
  packetDeliveryRatio: number;
  calibrationAgeRatio: number | null;
  driftRatio: number | null;
  zoneCoverage: number;
  confidence: number;
  reasons: string[];
}

export interface VenueSensorHealthState {
  sensors: VenueSensorHealthRecord[];
  healthySourceCount: number;
  quarantinedSourceIds: string[];
  offlineSourceIds: string[];
  effectiveSourceWeight: number;
  coverage: number;
  reasons: string[];
}

const OFFLINE_AFTER_MS = 120_000;
const QUARANTINE_AFTER_MS = 45_000;
const WATCH_AFTER_MS = 20_000;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function ratioOrDefault(received?: number, expected?: number): number {
  if (expected === undefined || expected <= 0 || received === undefined) return 1;
  return clamp01(received / expected);
}

/**
 * Evaluates sensing sources before they participate in venue truth. A source can
 * be temporally fresh yet still deserve less authority because calibration is
 * overdue, packet delivery has collapsed, or measured drift exceeds tolerance.
 * Quarantining a source removes its decision authority; it does not delete the
 * diagnostic record operators need to understand why sensing degraded.
 */
export function assessVenueSensorHealth(
  sources: VenueSensorHealthInput[],
  now = Date.now(),
): VenueSensorHealthState {
  const sensors = sources.map<VenueSensorHealthRecord>((source) => {
    const stalenessMs = Math.max(0, now - source.observedAt);
    const transportDelayMs = Math.max(0, source.receivedAt - source.observedAt);
    const packetDeliveryRatio = ratioOrDefault(source.receivedPackets, source.expectedPackets);
    const calibrationAgeRatio = source.lastCalibrationAt !== undefined && source.calibrationIntervalMs !== undefined && source.calibrationIntervalMs > 0
      ? Math.max(0, now - source.lastCalibrationAt) / source.calibrationIntervalMs
      : null;
    const driftRatio = source.driftEstimate !== undefined && source.driftTolerance !== undefined && source.driftTolerance > 0
      ? Math.abs(source.driftEstimate) / source.driftTolerance
      : null;
    const failures = Math.max(0, source.consecutiveFailures ?? 0);
    const reasons: string[] = [];

    let state: VenueSensorState = 'healthy';
    if (stalenessMs >= OFFLINE_AFTER_MS) {
      state = 'offline';
      reasons.push('source has stopped reporting within the operational freshness window');
    } else if (
      !source.healthy
      || stalenessMs >= QUARANTINE_AFTER_MS
      || failures >= 3
      || packetDeliveryRatio < 0.45
      || (driftRatio !== null && driftRatio > 1.5)
      || (calibrationAgeRatio !== null && calibrationAgeRatio > 2)
    ) {
      state = 'quarantined';
      if (!source.healthy) reasons.push('source self-reported unhealthy state');
      if (stalenessMs >= QUARANTINE_AFTER_MS) reasons.push('source observations are too stale for decision authority');
      if (failures >= 3) reasons.push(`${failures} consecutive source failures`);
      if (packetDeliveryRatio < 0.45) reasons.push('packet delivery is below the quarantine threshold');
      if (driftRatio !== null && driftRatio > 1.5) reasons.push('observed drift materially exceeds configured tolerance');
      if (calibrationAgeRatio !== null && calibrationAgeRatio > 2) reasons.push('calibration is more than two intervals overdue');
    } else if (
      stalenessMs >= WATCH_AFTER_MS
      || source.confidence < 0.65
      || packetDeliveryRatio < 0.8
      || failures > 0
      || (driftRatio !== null && driftRatio > 0.75)
      || (calibrationAgeRatio !== null && calibrationAgeRatio > 1)
    ) {
      state = 'watch';
      if (stalenessMs >= WATCH_AFTER_MS) reasons.push('source freshness is approaching the operational limit');
      if (source.confidence < 0.65) reasons.push('source confidence is below the preferred operating band');
      if (packetDeliveryRatio < 0.8) reasons.push('packet delivery is degraded');
      if (failures > 0) reasons.push('recent source failures require observation');
      if (driftRatio !== null && driftRatio > 0.75) reasons.push('drift is consuming most of the configured tolerance');
      if (calibrationAgeRatio !== null && calibrationAgeRatio > 1) reasons.push('source calibration is overdue');
    }

    if (reasons.length === 0) reasons.push('source freshness, delivery, confidence, and calibration posture are within the operating band');

    const stateWeight: Record<VenueSensorState, number> = {
      healthy: 1,
      watch: 0.55,
      quarantined: 0,
      offline: 0,
    };
    const authorityWeight = clamp01(
      stateWeight[state]
      * clamp01(source.confidence)
      * clamp01(source.zoneCoverage)
      * packetDeliveryRatio,
    );

    return {
      sourceId: source.sourceId,
      sourceKind: source.sourceKind,
      state,
      authorityWeight,
      stalenessMs,
      transportDelayMs,
      packetDeliveryRatio,
      calibrationAgeRatio,
      driftRatio,
      zoneCoverage: clamp01(source.zoneCoverage),
      confidence: clamp01(source.confidence),
      reasons,
    };
  });

  const healthySourceCount = sensors.filter((sensor) => sensor.state === 'healthy').length;
  const quarantinedSourceIds = sensors.filter((sensor) => sensor.state === 'quarantined').map((sensor) => sensor.sourceId).sort();
  const offlineSourceIds = sensors.filter((sensor) => sensor.state === 'offline').map((sensor) => sensor.sourceId).sort();
  const effectiveSourceWeight = sensors.reduce((sum, sensor) => sum + sensor.authorityWeight, 0);
  const coverage = sensors.length === 0
    ? 0
    : sensors.reduce((sum, sensor) => sum + sensor.zoneCoverage * (sensor.state === 'offline' ? 0 : 1), 0) / sensors.length;

  const reasons: string[] = [];
  if (sources.length === 0) reasons.push('no sensing sources are registered');
  if (quarantinedSourceIds.length > 0) reasons.push(`${quarantinedSourceIds.length} source${quarantinedSourceIds.length === 1 ? '' : 's'} quarantined from decision authority`);
  if (offlineSourceIds.length > 0) reasons.push(`${offlineSourceIds.length} source${offlineSourceIds.length === 1 ? '' : 's'} offline`);
  if (sources.length > 0 && effectiveSourceWeight < 1) reasons.push('effective sensing authority is below one healthy full-coverage source equivalent');
  if (reasons.length === 0) reasons.push('sensor estate is healthy enough to support normal quorum evaluation');

  return {
    sensors,
    healthySourceCount,
    quarantinedSourceIds,
    offlineSourceIds,
    effectiveSourceWeight,
    coverage: clamp01(coverage),
    reasons,
  };
}
