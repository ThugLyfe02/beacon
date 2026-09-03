import type { VenueTwinSnapshot } from './SpatialVenueTwinEngine';

export interface VenueCapacityReserveZone {
  zoneId: string;
  label: string;
  spareCapacity: number;
  reserveRatio: number;
  confidence: number;
  suitableAsRelief: boolean;
}

export interface VenueCapacityReserveState {
  totalSpareCapacity: number;
  protectedReserve: number;
  usableReserve: number;
  reliefZones: VenueCapacityReserveZone[];
  concentrationRisk: number;
  narrative: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Treats spare venue capacity as an operational reserve rather than empty space.
 * Reserve protects the operator from consuming every available zone during a
 * healthy period and having nowhere to decompress into when conditions change.
 */
export function buildVenueCapacityReserve(
  twin: VenueTwinSnapshot,
  protectedReserveRatio = 0.18,
): VenueCapacityReserveState {
  const zones = twin.zones.map<VenueCapacityReserveZone>((zone) => {
    const spareCapacity = Math.max(0, zone.capacity - zone.visibleOccupancy);
    const reserveRatio = zone.capacity <= 0 ? 0 : spareCapacity / zone.capacity;
    return {
      zoneId: zone.id,
      label: zone.label,
      spareCapacity,
      reserveRatio,
      confidence: zone.confidence,
      suitableAsRelief:
        spareCapacity >= Math.max(4, zone.capacity * 0.18)
        && zone.confidence >= 0.6
        && zone.state !== 'recovering',
    };
  });

  const totalSpareCapacity = zones.reduce((sum, zone) => sum + zone.spareCapacity, 0);
  const protectedReserve = Math.ceil(totalSpareCapacity * clamp01(protectedReserveRatio));
  const usableReserve = Math.max(0, totalSpareCapacity - protectedReserve);
  const reliefZones = zones
    .filter((zone) => zone.suitableAsRelief)
    .sort((a, b) => b.spareCapacity - a.spareCapacity || b.confidence - a.confidence || a.zoneId.localeCompare(b.zoneId));

  const largestReserve = reliefZones[0]?.spareCapacity ?? 0;
  const concentrationRisk = totalSpareCapacity === 0 ? 1 : clamp01(largestReserve / Math.max(1, totalSpareCapacity));

  return {
    totalSpareCapacity,
    protectedReserve,
    usableReserve,
    reliefZones,
    concentrationRisk,
    narrative: reliefZones.length === 0
      ? 'No zone currently has enough trustworthy spare capacity to serve as a reliable relief destination.'
      : concentrationRisk >= 0.7
        ? 'Most spare capacity is concentrated in one zone; operators should avoid treating reserve as broadly interchangeable.'
        : `${reliefZones.length} zones can act as distributed relief capacity while preserving a protected venue reserve.`,
  };
}
