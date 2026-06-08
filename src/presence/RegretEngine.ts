import { DistanceBucket } from './ProximityEngine';

export function shouldRecordMissedOpportunity(
  bucket: DistanceBucket,
  mutual: boolean
): boolean {
  return bucket >= 2 && !mutual;
}
