/**
 * Single source of truth for visual constants shared between the spatial
 * Field view and individual avatar renderers. Designer-tweakable values
 * (ring sizes, bucket colours, sizes) live here so a future palette pass
 * touches one file, not five.
 */

/** Concentric distance rings drawn on the floor (scene units). */
export const RING_RADII = [4, 9, 16] as const;

/** Bucket → ring index mapping the PresenceEngine produces. Bucket 0 is
 *  outside the field entirely; 1/2/3 grow closer. */
export type FieldBucket = 0 | 1 | 2 | 3;

/** Premium gold takes precedence regardless of bucket. */
export const PREMIUM_COLOR = '#f59e0b';

/** Bucket → glow colour for the fallback sphere + stick body limbs. */
export function colorForBucket(bucket: number, premium?: boolean): string {
  if (premium) return PREMIUM_COLOR;
  if (bucket >= 3) return '#22c55e'; // green — closest
  if (bucket === 2) return '#3b82f6'; // blue
  return '#64748b'; // slate — farthest
}

/** Bucket → marker size (scene units). Closer = bigger. */
export function sizeForBucket(bucket: number): number {
  if (bucket >= 3) return 1.1;
  if (bucket === 2) return 0.85;
  return 0.6;
}
