import type { VenueLayoutVersion } from './VenueLayoutVersioning';
import type { VenueTwinZoneKind } from './SpatialVenueTwinEngine';

interface GeoJsonPolygonGeometry {
  type: 'Polygon';
  coordinates: number[][][];
}

interface GeoJsonZoneProperties {
  id?: unknown;
  label?: unknown;
  kind?: unknown;
  capacity?: unknown;
}

interface GeoJsonZoneFeature {
  type: 'Feature';
  properties?: GeoJsonZoneProperties | null;
  geometry?: GeoJsonPolygonGeometry | null;
}

export interface GeoJsonVenueFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJsonZoneFeature[];
}

export interface IngestedVenueZone {
  id: string;
  label: string;
  kind: VenueTwinZoneKind;
  capacity: number;
  polygon: Array<[number, number]>;
  sourcePolygon: Array<[number, number]>;
  areaSquareMeters: number;
}

export interface VenueGeometryIngestResult {
  valid: boolean;
  zones: IngestedVenueZone[];
  layout: VenueLayoutVersion | null;
  errors: string[];
  warnings: string[];
  reference: { latitude: number; longitude: number } | null;
}

const VALID_KINDS = new Set<VenueTwinZoneKind>(['entry', 'stage', 'lounge', 'booth', 'corridor', 'open']);
const EARTH_RADIUS_M = 6_371_008.8;

function finiteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isClosed(ring: Array<[number, number]>): boolean {
  if (ring.length < 4) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

function sanitizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 96);
  return normalized || null;
}

function parseKind(value: unknown): VenueTwinZoneKind | null {
  return typeof value === 'string' && VALID_KINDS.has(value as VenueTwinZoneKind)
    ? value as VenueTwinZoneKind
    : null;
}

function segmentsIntersect(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): boolean {
  const orient = (p: [number, number], q: [number, number], r: [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  const epsilon = 1e-9;
  return ((o1 > epsilon && o2 < -epsilon) || (o1 < -epsilon && o2 > epsilon))
    && ((o3 > epsilon && o4 < -epsilon) || (o3 < -epsilon && o4 > epsilon));
}

function hasSelfIntersection(ring: Array<[number, number]>): boolean {
  const segmentCount = ring.length - 1;
  for (let i = 0; i < segmentCount; i += 1) {
    for (let j = i + 1; j < segmentCount; j += 1) {
      if (Math.abs(i - j) <= 1) continue;
      if (i === 0 && j === segmentCount - 1) continue;
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true;
    }
  }
  return false;
}

function projectToMeters(
  coordinate: [number, number],
  reference: { latitude: number; longitude: number },
): [number, number] {
  const [longitude, latitude] = coordinate;
  const lat0 = reference.latitude * Math.PI / 180;
  const x = (longitude - reference.longitude) * Math.PI / 180 * EARTH_RADIUS_M * Math.cos(lat0);
  const y = (latitude - reference.latitude) * Math.PI / 180 * EARTH_RADIUS_M;
  return [x, y];
}

function polygonArea(ring: Array<[number, number]>): number {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

function stableGeometryHash(zones: IngestedVenueZone[]): string {
  const canonical = zones
    .map((zone) => ({
      id: zone.id,
      kind: zone.kind,
      capacity: zone.capacity,
      sourcePolygon: zone.sourcePolygon.map(([lon, lat]) => [Number(lon.toFixed(7)), Number(lat.toFixed(7))]),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const input = JSON.stringify(canonical);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `geojson-${(hash >>> 0).toString(36)}`;
}

/**
 * Converts a strict GeoJSON FeatureCollection into Beacon semantic venue zones.
 * The current venue twin consumes one contiguous exterior polygon per semantic
 * zone, so holes and MultiPolygon geometry are rejected rather than silently
 * discarded. Coordinates are projected into local meter space around a stable
 * reference point for use by the spatial engine.
 */
export function ingestVenueGeoJson(input: {
  venueId: string;
  version: string;
  geojson: GeoJsonVenueFeatureCollection;
  effectiveFrom?: number;
}): VenueGeometryIngestResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!input.venueId.trim()) errors.push('venueId is required');
  if (!input.version.trim()) errors.push('layout version is required');
  if (!input.geojson || input.geojson.type !== 'FeatureCollection' || !Array.isArray(input.geojson.features)) {
    return { valid: false, zones: [], layout: null, errors: [...errors, 'GeoJSON FeatureCollection is required'], warnings, reference: null };
  }

  const parsed: Array<{
    id: string;
    label: string;
    kind: VenueTwinZoneKind;
    capacity: number;
    ring: Array<[number, number]>;
  }> = [];
  const ids = new Set<string>();

  input.geojson.features.forEach((feature, index) => {
    const prefix = `feature ${index + 1}`;
    if (!feature || feature.type !== 'Feature') {
      errors.push(`${prefix}: type must be Feature`);
      return;
    }
    if (!feature.geometry || feature.geometry.type !== 'Polygon') {
      errors.push(`${prefix}: one contiguous Polygon geometry is required`);
      return;
    }
    if (!Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length !== 1) {
      errors.push(`${prefix}: polygon holes are not supported by the current venue-zone model`);
      return;
    }

    const rawRing = feature.geometry.coordinates[0];
    const ring: Array<[number, number]> = [];
    for (const coordinate of rawRing) {
      if (!Array.isArray(coordinate) || coordinate.length < 2 || !finiteCoordinate(coordinate[0]) || !finiteCoordinate(coordinate[1])) {
        errors.push(`${prefix}: polygon contains an invalid longitude/latitude coordinate`);
        return;
      }
      const longitude = coordinate[0];
      const latitude = coordinate[1];
      if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
        errors.push(`${prefix}: coordinate lies outside valid longitude/latitude bounds`);
        return;
      }
      ring.push([longitude, latitude]);
    }

    if (ring.length < 4 || !isClosed(ring)) {
      errors.push(`${prefix}: polygon exterior ring must contain at least four coordinates and be explicitly closed`);
      return;
    }
    if (hasSelfIntersection(ring)) {
      errors.push(`${prefix}: polygon exterior ring self-intersects`);
      return;
    }

    const id = sanitizeId(feature.properties?.id);
    if (!id) {
      errors.push(`${prefix}: properties.id is required`);
      return;
    }
    if (ids.has(id)) {
      errors.push(`${prefix}: duplicate semantic zone id ${id}`);
      return;
    }
    ids.add(id);

    const kind = parseKind(feature.properties?.kind);
    if (!kind) {
      errors.push(`${prefix}: properties.kind must be one of ${[...VALID_KINDS].join(', ')}`);
      return;
    }
    const capacityRaw = feature.properties?.capacity;
    if (typeof capacityRaw !== 'number' || !Number.isFinite(capacityRaw) || capacityRaw <= 0 || capacityRaw > 100_000) {
      errors.push(`${prefix}: properties.capacity must be a positive finite number`);
      return;
    }
    const capacity = Math.floor(capacityRaw);
    const label = typeof feature.properties?.label === 'string' && feature.properties.label.trim()
      ? feature.properties.label.trim().slice(0, 120)
      : id;

    parsed.push({ id, label, kind, capacity, ring });
  });

  if (parsed.length === 0) errors.push('at least one valid semantic venue zone is required');
  if (errors.length > 0) return { valid: false, zones: [], layout: null, errors, warnings, reference: null };

  const allCoordinates = parsed.flatMap((zone) => zone.ring.slice(0, -1));
  const reference = {
    longitude: allCoordinates.reduce((sum, coordinate) => sum + coordinate[0], 0) / allCoordinates.length,
    latitude: allCoordinates.reduce((sum, coordinate) => sum + coordinate[1], 0) / allCoordinates.length,
  };

  const zones = parsed.map<IngestedVenueZone>((zone) => {
    const polygon = zone.ring.map((coordinate) => projectToMeters(coordinate, reference));
    const areaSquareMeters = polygonArea(polygon);
    if (areaSquareMeters < 2) warnings.push(`${zone.id}: zone area is below 2 m² and may be a geometry or unit error`);
    const densityAtCapacity = zone.capacity / Math.max(1, areaSquareMeters);
    if (densityAtCapacity > 8) warnings.push(`${zone.id}: configured capacity implies unusually high density; verify venue-specific capacity data before operational use`);
    return {
      id: zone.id,
      label: zone.label,
      kind: zone.kind,
      capacity: zone.capacity,
      polygon,
      sourcePolygon: zone.ring,
      areaSquareMeters,
    };
  });

  const geometryHash = stableGeometryHash(zones);
  const layout: VenueLayoutVersion = {
    venueId: input.venueId,
    version: input.version,
    effectiveFrom: input.effectiveFrom ?? Date.now(),
    geometryHash,
    zoneIds: zones.map((zone) => zone.id).sort(),
    source: 'geojson',
  };

  return {
    valid: true,
    zones,
    layout,
    errors,
    warnings,
    reference,
  };
}
