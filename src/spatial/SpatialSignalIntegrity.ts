import type { ProximitySignal } from '../presence/PresenceEngine';
import type { RuntimeHealth } from '../reliability/RuntimeReliabilityEngine';

export type SpatialSignalIntegrityBand = 'fresh' | 'aging' | 'weak' | 'unknown';

export interface SpatialSignalIntegrityNode {
  targetId: string;
  band: SpatialSignalIntegrityBand;
  confidence: number;
  signalAgeMs: number | null;
  hasBearing: boolean;
  reason: string;
}

export interface SpatialSignalIntegrityState {
  nodes: SpatialSignalIntegrityNode[];
  freshCount: number;
  agingCount: number;
  weakCount: number;
  unknownCount: number;
  meanConfidence: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function freshnessConfidence(ageMs: number | null): number {
  if (ageMs == null) return 0.5;
  if (ageMs <= 10_000) return 1;
  if (ageMs <= 30_000) return 1 - ((ageMs - 10_000) / 20_000) * 0.24;
  if (ageMs <= 60_000) return 0.76 - ((ageMs - 30_000) / 30_000) * 0.31;
  if (ageMs <= 90_000) return 0.45 - ((ageMs - 60_000) / 30_000) * 0.2;
  return 0.15;
}

function runtimeMultiplier(health: RuntimeHealth): number {
  if (health === 'healthy') return 1;
  if (health === 'degraded') return 0.78;
  return 0.5;
}

function bandFor(confidence: number, ageMs: number | null): SpatialSignalIntegrityBand {
  if (ageMs == null) return 'unknown';
  if (confidence >= 0.78 && ageMs <= 20_000) return 'fresh';
  if (confidence >= 0.52 && ageMs <= 50_000) return 'aging';
  return 'weak';
}

/**
 * Gives the spatial renderer an explicit notion of how much authority a live
 * position deserves without deleting the attendee. Freshness, presence of a
 * measured compass bearing, and runtime health affect the visual confidence
 * language; they never change whether an otherwise-visible person exists.
 *
 * This is deliberately not movement prediction. It evaluates only the latest
 * signal already supplied by the presence feed and keeps no trajectory history.
 */
export function buildSpatialSignalIntegrity(
  targets: ProximitySignal[],
  runtimeHealth: RuntimeHealth,
  now = Date.now(),
): SpatialSignalIntegrityState {
  const nodes = targets.map<SpatialSignalIntegrityNode>((target) => {
    const signalAgeMs = target.timestamp == null || !Number.isFinite(target.timestamp)
      ? null
      : Math.max(0, now - target.timestamp);
    const hasBearing = target.bearingFromObserverDeg != null && Number.isFinite(target.bearingFromObserverDeg);
    const confidence = clamp01(
      freshnessConfidence(signalAgeMs)
      * (hasBearing ? 1 : 0.72)
      * runtimeMultiplier(runtimeHealth),
    );
    const band = bandFor(confidence, signalAgeMs);

    let reason = 'The latest proximity fix is fresh and carries a measured bearing.';
    if (signalAgeMs == null) reason = 'Peer position freshness is unavailable, so Beacon reduces spatial confidence.';
    else if (signalAgeMs > 50_000) reason = 'The latest peer position is aging and should not be treated as precise live direction.';
    else if (!hasBearing) reason = 'Distance is available but a measured observer-to-target bearing is not.';
    else if (runtimeHealth !== 'healthy') reason = 'The live presence runtime is degraded, so spatial confidence is reduced.';

    return {
      targetId: target.targetId,
      band,
      confidence,
      signalAgeMs,
      hasBearing,
      reason,
    };
  }).sort((left, right) => left.targetId.localeCompare(right.targetId));

  const meanConfidence = nodes.length === 0
    ? 0
    : nodes.reduce((sum, node) => sum + node.confidence, 0) / nodes.length;

  return {
    nodes,
    freshCount: nodes.filter((node) => node.band === 'fresh').length,
    agingCount: nodes.filter((node) => node.band === 'aging').length,
    weakCount: nodes.filter((node) => node.band === 'weak').length,
    unknownCount: nodes.filter((node) => node.band === 'unknown').length,
    meanConfidence,
  };
}
