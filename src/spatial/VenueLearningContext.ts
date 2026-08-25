export const VENUE_LEARNING_CONTEXT_VERSION = '1.0' as const;

export type AttendanceBand = 'small' | 'medium' | 'large' | 'very-large';
export type DurationBand = 'short' | 'standard' | 'long';
export type LearningTransferClass = 'exact' | 'compatible' | 'weak-prior' | 'incompatible';

export interface VenueLearningContextInput {
  venueKey: string;
  layoutVersion: string;
  geometryHash: string;
  zoneKinds: string[];
  totalCapacity: number;
  topologyRedundancy: number;
  accessibleCoverage: number;
  servicePointKinds: string[];
  expectedAttendance: number;
  eventDurationMinutes: number;
  programFingerprint?: string | null;
}

export interface VenueLearningContext {
  version: typeof VENUE_LEARNING_CONTEXT_VERSION;
  key: string;
  venueKey: string;
  layoutVersion: string;
  geometryHash: string;
  zoneKinds: string[];
  totalCapacity: number;
  topologyRedundancy: number;
  accessibleCoverage: number;
  servicePointKinds: string[];
  attendanceBand: AttendanceBand;
  durationBand: DurationBand;
  programFingerprint: string | null;
}

export interface VenueLearningCompatibility {
  transferClass: LearningTransferClass;
  transferWeight: number;
  mayInformRanking: boolean;
  mayGrantOperationalAuthority: boolean;
  sameVenue: boolean;
  sameGeometry: boolean;
  reasons: string[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function stableToken(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizedList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();
}

function attendanceBand(value: number): AttendanceBand {
  if (value < 75) return 'small';
  if (value < 250) return 'medium';
  if (value < 800) return 'large';
  return 'very-large';
}

function durationBand(minutes: number): DurationBand {
  if (minutes < 90) return 'short';
  if (minutes <= 300) return 'standard';
  return 'long';
}

function jaccard(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / union.size;
}

function ratioSimilarity(left: number, right: number): number {
  const a = Math.max(0, left);
  const b = Math.max(0, right);
  if (a === 0 && b === 0) return 1;
  return Math.min(a, b) / Math.max(1, Math.max(a, b));
}

/**
 * Builds an aggregate context key for repeat-event learning. The context contains
 * no attendee identity or movement history. Its purpose is the opposite of blind
 * personalization: prevent evidence gathered under one physical/event regime
 * from being treated as equally valid under a materially different regime.
 */
export function buildVenueLearningContext(input: VenueLearningContextInput): VenueLearningContext {
  const zoneKinds = normalizedList(input.zoneKinds);
  const servicePointKinds = normalizedList(input.servicePointKinds);
  const context: Omit<VenueLearningContext, 'key'> = {
    version: VENUE_LEARNING_CONTEXT_VERSION,
    venueKey: input.venueKey.trim().slice(0, 160),
    layoutVersion: input.layoutVersion.trim().slice(0, 120),
    geometryHash: input.geometryHash.trim().slice(0, 200),
    zoneKinds,
    totalCapacity: Math.max(0, Math.round(input.totalCapacity)),
    topologyRedundancy: clamp01(input.topologyRedundancy),
    accessibleCoverage: clamp01(input.accessibleCoverage),
    servicePointKinds,
    attendanceBand: attendanceBand(input.expectedAttendance),
    durationBand: durationBand(input.eventDurationMinutes),
    programFingerprint: input.programFingerprint?.trim().slice(0, 160) || null,
  };

  const material = [
    context.version,
    context.venueKey,
    context.layoutVersion,
    context.geometryHash,
    context.zoneKinds.join(','),
    context.totalCapacity,
    context.topologyRedundancy.toFixed(2),
    context.accessibleCoverage.toFixed(2),
    context.servicePointKinds.join(','),
    context.attendanceBand,
    context.durationBand,
    context.programFingerprint ?? 'none',
  ].join('|');

  return { ...context, key: `venue-context:${stableToken(material)}` };
}

/**
 * Evaluates whether measured outcomes from one event are transferable to another.
 * Cross-venue evidence can be a weak prior for ranking, but it can never grant
 * operational authority. Same-venue evidence still loses weight when geometry,
 * topology, scale, service mix, or program shape materially changes.
 */
export function compareVenueLearningContexts(
  source: VenueLearningContext,
  target: VenueLearningContext,
): VenueLearningCompatibility {
  if (source.key === target.key) {
    return {
      transferClass: 'exact',
      transferWeight: 1,
      mayInformRanking: true,
      mayGrantOperationalAuthority: true,
      sameVenue: true,
      sameGeometry: true,
      reasons: ['learning context is an exact match'],
    };
  }

  const sameVenue = source.venueKey === target.venueKey;
  const sameGeometry = source.geometryHash === target.geometryHash;
  const zoneSimilarity = jaccard(source.zoneKinds, target.zoneKinds);
  const serviceSimilarity = jaccard(source.servicePointKinds, target.servicePointKinds);
  const capacitySimilarity = ratioSimilarity(source.totalCapacity, target.totalCapacity);
  const topologySimilarity = 1 - Math.min(1, Math.abs(source.topologyRedundancy - target.topologyRedundancy));
  const accessibilitySimilarity = 1 - Math.min(1, Math.abs(source.accessibleCoverage - target.accessibleCoverage));
  const attendanceSimilarity = source.attendanceBand === target.attendanceBand ? 1 : 0.55;
  const durationSimilarity = source.durationBand === target.durationBand ? 1 : 0.65;
  const programSimilarity = source.programFingerprint && target.programFingerprint
    ? (source.programFingerprint === target.programFingerprint ? 1 : 0.55)
    : 0.75;

  const structural = (
    zoneSimilarity * 0.2
    + serviceSimilarity * 0.12
    + capacitySimilarity * 0.16
    + topologySimilarity * 0.15
    + accessibilitySimilarity * 0.1
    + attendanceSimilarity * 0.12
    + durationSimilarity * 0.08
    + programSimilarity * 0.07
  );

  let transferWeight = clamp01(structural);
  const reasons: string[] = [];
  if (!sameGeometry) reasons.push('geometry differs from the source learning context');
  if (capacitySimilarity < 0.7) reasons.push('venue capacity differs materially');
  if (zoneSimilarity < 0.7) reasons.push('semantic zone mix differs materially');
  if (serviceSimilarity < 0.65) reasons.push('service-point mix differs materially');
  if (topologySimilarity < 0.7) reasons.push('route redundancy differs materially');
  if (source.attendanceBand !== target.attendanceBand) reasons.push('expected attendance scale moved to a different band');
  if (source.durationBand !== target.durationBand) reasons.push('event duration moved to a different band');

  if (!sameVenue) {
    transferWeight = Math.min(0.35, transferWeight * 0.45);
    reasons.push('cross-venue evidence is capped as a weak prior and cannot grant operational authority');
  } else if (!sameGeometry) {
    transferWeight = Math.min(0.72, transferWeight * 0.82);
  }

  let transferClass: LearningTransferClass = 'incompatible';
  if (sameVenue && transferWeight >= 0.72) transferClass = 'compatible';
  else if (transferWeight >= 0.2) transferClass = 'weak-prior';

  return {
    transferClass,
    transferWeight,
    mayInformRanking: transferClass !== 'incompatible',
    mayGrantOperationalAuthority: sameVenue && transferClass === 'compatible' && transferWeight >= 0.8,
    sameVenue,
    sameGeometry,
    reasons: reasons.length > 0 ? reasons : ['context similarity is too weak for trustworthy transfer'],
  };
}
