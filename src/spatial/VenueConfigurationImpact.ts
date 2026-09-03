import type { VenueLayoutVersion } from './VenueLayoutVersioning';
import type { ZoneOperatingEnvelope } from './VenueOperatingEnvelope';
import type { VenueTopologyState } from './VenueTopology';

export type VenueConfigurationImpactLevel = 'none' | 'minor' | 'material' | 'breaking';

export interface VenueConfigurationChange {
  category: 'layout' | 'zone' | 'capacity' | 'topology' | 'accessibility' | 'operating-envelope';
  level: VenueConfigurationImpactLevel;
  description: string;
  affectedZoneIds: string[];
  invalidatesBaseline: boolean;
}

export interface VenueConfigurationImpactState {
  level: VenueConfigurationImpactLevel;
  riskScore: number;
  changes: VenueConfigurationChange[];
  affectedZoneIds: string[];
  requiresNewBaseline: boolean;
  requiresShadowRevalidation: boolean;
  invalidatesCommandLeases: boolean;
  blocksActiveMeasurementWindows: boolean;
  reasons: string[];
}

interface VenueConfigurationImpactInput {
  previousLayout: VenueLayoutVersion;
  nextLayout: VenueLayoutVersion;
  previousTopology: VenueTopologyState;
  nextTopology: VenueTopologyState;
  previousEnvelopes: ZoneOperatingEnvelope[];
  nextEnvelopes: ZoneOperatingEnvelope[];
}

const LEVEL_RANK: Record<VenueConfigurationImpactLevel, number> = {
  none: 0,
  minor: 1,
  material: 2,
  breaking: 3,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function pushChange(changes: VenueConfigurationChange[], change: VenueConfigurationChange): void {
  changes.push({ ...change, affectedZoneIds: sorted(change.affectedZoneIds) });
}

function strongestLevel(changes: VenueConfigurationChange[]): VenueConfigurationImpactLevel {
  return changes.reduce<VenueConfigurationImpactLevel>(
    (level, change) => LEVEL_RANK[change.level] > LEVEL_RANK[level] ? change.level : level,
    'none',
  );
}

/**
 * Evaluates the blast radius of venue configuration changes before the new
 * configuration inherits operational authority. Geometry, zone membership,
 * route redundancy, accessibility, capacity, and operating thresholds can all
 * invalidate a previously valid baseline even when the application code did not
 * change.
 *
 * Material changes require a new baseline. Breaking changes additionally return
 * the venue to shadow revalidation so historical recommendation authority is not
 * silently carried across a materially different physical environment.
 */
export function assessVenueConfigurationImpact(
  input: VenueConfigurationImpactInput,
): VenueConfigurationImpactState {
  const changes: VenueConfigurationChange[] = [];
  const previousZoneIds = new Set(input.previousLayout.zoneIds);
  const nextZoneIds = new Set(input.nextLayout.zoneIds);
  const removedZoneIds = sorted([...previousZoneIds].filter((id) => !nextZoneIds.has(id)));
  const addedZoneIds = sorted([...nextZoneIds].filter((id) => !previousZoneIds.has(id)));

  if (input.previousLayout.venueId !== input.nextLayout.venueId) {
    pushChange(changes, {
      category: 'layout',
      level: 'breaking',
      description: 'venue identity changed; historical baselines and intervention evidence are not transferable',
      affectedZoneIds: sorted([...previousZoneIds, ...nextZoneIds]),
      invalidatesBaseline: true,
    });
  }

  if (input.previousLayout.geometryHash !== input.nextLayout.geometryHash) {
    pushChange(changes, {
      category: 'layout',
      level: 'material',
      description: 'venue geometry hash changed',
      affectedZoneIds: sorted([...previousZoneIds, ...nextZoneIds]),
      invalidatesBaseline: true,
    });
  }

  if (removedZoneIds.length > 0 || addedZoneIds.length > 0) {
    pushChange(changes, {
      category: 'zone',
      level: removedZoneIds.length > 0 ? 'breaking' : 'material',
      description: `${addedZoneIds.length} semantic zone${addedZoneIds.length === 1 ? '' : 's'} added and ${removedZoneIds.length} removed`,
      affectedZoneIds: [...addedZoneIds, ...removedZoneIds],
      invalidatesBaseline: true,
    });
  }

  const previousTopologyZones = new Map(input.previousTopology.zones.map((zone) => [zone.id, zone]));
  const nextTopologyZones = new Map(input.nextTopology.zones.map((zone) => [zone.id, zone]));
  for (const [zoneId, previousZone] of previousTopologyZones) {
    const nextZone = nextTopologyZones.get(zoneId);
    if (!nextZone) continue;
    const previousCapacity = Math.max(1, previousZone.operationalCapacity);
    const delta = (nextZone.operationalCapacity - previousZone.operationalCapacity) / previousCapacity;
    if (Math.abs(delta) >= 0.1) {
      pushChange(changes, {
        category: 'capacity',
        level: Math.abs(delta) >= 0.25 ? 'material' : 'minor',
        description: `${zoneId} operational capacity changed by ${Math.round(delta * 100)}%`,
        affectedZoneIds: [zoneId],
        invalidatesBaseline: Math.abs(delta) >= 0.25,
      });
    }
    if (previousZone.enabled !== nextZone.enabled) {
      pushChange(changes, {
        category: 'zone',
        level: 'material',
        description: `${zoneId} changed enabled state`,
        affectedZoneIds: [zoneId],
        invalidatesBaseline: true,
      });
    }
  }

  const previousLinks = new Map(input.previousTopology.links.map((link) => [link.id, link]));
  const nextLinks = new Map(input.nextTopology.links.map((link) => [link.id, link]));
  const removedLinks = sorted([...previousLinks.keys()].filter((id) => !nextLinks.has(id)));
  const addedLinks = sorted([...nextLinks.keys()].filter((id) => !previousLinks.has(id)));
  if (removedLinks.length > 0 || addedLinks.length > 0) {
    const affected = new Set<string>();
    for (const id of [...removedLinks, ...addedLinks]) {
      const link = previousLinks.get(id) ?? nextLinks.get(id);
      if (link) {
        affected.add(link.fromZoneId);
        affected.add(link.toZoneId);
      }
    }
    pushChange(changes, {
      category: 'topology',
      level: removedLinks.length > 0 ? 'material' : 'minor',
      description: `${addedLinks.length} topology link${addedLinks.length === 1 ? '' : 's'} added and ${removedLinks.length} removed`,
      affectedZoneIds: [...affected],
      invalidatesBaseline: removedLinks.length > 0,
    });
  }

  for (const [linkId, previousLink] of previousLinks) {
    const nextLink = nextLinks.get(linkId);
    if (!nextLink) continue;
    if (previousLink.accessible && !nextLink.accessible) {
      pushChange(changes, {
        category: 'accessibility',
        level: 'breaking',
        description: `${linkId} lost its configured accessible-route status`,
        affectedZoneIds: [previousLink.fromZoneId, previousLink.toZoneId],
        invalidatesBaseline: true,
      });
    } else if (!previousLink.accessible && nextLink.accessible) {
      pushChange(changes, {
        category: 'accessibility',
        level: 'minor',
        description: `${linkId} gained configured accessible-route status`,
        affectedZoneIds: [previousLink.fromZoneId, previousLink.toZoneId],
        invalidatesBaseline: false,
      });
    }
    if (previousLink.enabled !== nextLink.enabled) {
      pushChange(changes, {
        category: 'topology',
        level: previousLink.enabled && !nextLink.enabled ? 'material' : 'minor',
        description: `${linkId} changed enabled state`,
        affectedZoneIds: [previousLink.fromZoneId, previousLink.toZoneId],
        invalidatesBaseline: previousLink.enabled && !nextLink.enabled,
      });
    }
    const previousCapacity = Math.max(1, previousLink.capacityPerMinute);
    const capacityDelta = (nextLink.capacityPerMinute - previousLink.capacityPerMinute) / previousCapacity;
    if (Math.abs(capacityDelta) >= 0.2) {
      pushChange(changes, {
        category: 'topology',
        level: capacityDelta < -0.35 ? 'material' : 'minor',
        description: `${linkId} configured flow capacity changed by ${Math.round(capacityDelta * 100)}%`,
        affectedZoneIds: [previousLink.fromZoneId, previousLink.toZoneId],
        invalidatesBaseline: Math.abs(capacityDelta) >= 0.35,
      });
    }
  }

  if (input.nextTopology.accessibleCoverage < input.previousTopology.accessibleCoverage - 0.1) {
    pushChange(changes, {
      category: 'accessibility',
      level: 'breaking',
      description: `accessible topology coverage fell from ${Math.round(input.previousTopology.accessibleCoverage * 100)}% to ${Math.round(input.nextTopology.accessibleCoverage * 100)}%`,
      affectedZoneIds: input.nextTopology.zones.map((zone) => zone.id),
      invalidatesBaseline: true,
    });
  }
  if (input.nextTopology.redundancyScore < input.previousTopology.redundancyScore - 0.15) {
    pushChange(changes, {
      category: 'topology',
      level: 'material',
      description: `route redundancy fell from ${input.previousTopology.redundancyScore.toFixed(2)} to ${input.nextTopology.redundancyScore.toFixed(2)}`,
      affectedZoneIds: input.nextTopology.singleLinkDependencyZoneIds,
      invalidatesBaseline: true,
    });
  }

  const previousEnvelopes = new Map(input.previousEnvelopes.map((envelope) => [envelope.zoneId, envelope]));
  const nextEnvelopes = new Map(input.nextEnvelopes.map((envelope) => [envelope.zoneId, envelope]));
  for (const [zoneId, previous] of previousEnvelopes) {
    const next = nextEnvelopes.get(zoneId);
    if (!next) continue;
    const hardDelta = next.hardSaturationThreshold - previous.hardSaturationThreshold;
    const softDelta = next.softSaturationThreshold - previous.softSaturationThreshold;
    const confidenceDelta = next.minimumConfidence - previous.minimumConfidence;
    if (Math.abs(hardDelta) >= 0.05 || Math.abs(softDelta) >= 0.05 || Math.abs(confidenceDelta) >= 0.1) {
      const loosensGuardrail = hardDelta > 0.05 || softDelta > 0.05 || confidenceDelta < -0.1;
      pushChange(changes, {
        category: 'operating-envelope',
        level: loosensGuardrail ? 'material' : 'minor',
        description: `${zoneId} operating thresholds changed materially${loosensGuardrail ? ' and loosen at least one guardrail' : ''}`,
        affectedZoneIds: [zoneId],
        invalidatesBaseline: loosensGuardrail,
      });
    }
  }

  const level = strongestLevel(changes);
  const affectedZoneIds = sorted(changes.flatMap((change) => change.affectedZoneIds));
  const baselineInvalidators = changes.filter((change) => change.invalidatesBaseline);
  const breakingCount = changes.filter((change) => change.level === 'breaking').length;
  const materialCount = changes.filter((change) => change.level === 'material').length;
  const riskScore = clamp01(
    breakingCount * 0.38
      + materialCount * 0.18
      + changes.filter((change) => change.level === 'minor').length * 0.04
      + (input.nextTopology.accessibleCoverage < 0.8 ? 0.12 : 0)
      + (input.nextTopology.redundancyScore < 0.55 ? 0.1 : 0),
  );
  const requiresNewBaseline = baselineInvalidators.length > 0;
  const requiresShadowRevalidation = level === 'breaking' || (level === 'material' && riskScore >= 0.55);

  const reasons: string[] = [];
  if (changes.length === 0) reasons.push('no operationally material venue configuration change detected');
  if (requiresNewBaseline) reasons.push(`${baselineInvalidators.length} change${baselineInvalidators.length === 1 ? '' : 's'} invalidate the prior venue baseline`);
  if (requiresShadowRevalidation) reasons.push('configuration blast radius is large enough to require shadow revalidation before prior recommendation authority is restored');
  if (changes.some((change) => change.category === 'accessibility' && change.level === 'breaking')) reasons.push('accessibility regression prevents normal configuration promotion');
  if (input.nextTopology.singleLinkDependencyZoneIds.length > input.previousTopology.singleLinkDependencyZoneIds.length) reasons.push('new single-link dependencies increase route fragility');

  return {
    level,
    riskScore,
    changes,
    affectedZoneIds,
    requiresNewBaseline,
    requiresShadowRevalidation,
    invalidatesCommandLeases: level === 'material' || level === 'breaking',
    blocksActiveMeasurementWindows: requiresNewBaseline,
    reasons,
  };
}
