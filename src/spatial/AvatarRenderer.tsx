import React, { useMemo } from 'react';
import type { ProximitySignal } from '../presence/PresenceEngine';

type AvatarTarget = ProximitySignal & { bucket?: number };

function colorForBucket(bucket: number, premium?: boolean): string {
  if (premium) return '#f59e0b';
  if (bucket >= 3) return '#22c55e';
  if (bucket === 2) return '#3b82f6';
  return '#475569';
}

function positionForSignal(signal: AvatarTarget): [number, number, number] {
  const seed = signal.targetId
    .split('')
    .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const angle = (seed % 360) * (Math.PI / 180);
  const radius = Math.max(1, signal.distanceFeet / 4);
  return [Math.cos(angle) * radius, Math.sin(angle * 0.7) * 1.5, Math.sin(angle) * radius];
}

interface Props {
  avatar: AvatarTarget;
}

export default function AvatarRenderer({ avatar }: Props) {
  const position = useMemo(() => positionForSignal(avatar), [avatar.targetId, avatar.distanceFeet]);
  const color = useMemo(
    () => colorForBucket(avatar.bucket ?? 0, avatar.targetPremium),
    [avatar.bucket, avatar.targetPremium]
  );

  return (
    <mesh position={position}>
      <sphereGeometry args={[0.6, 16, 16]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
    </mesh>
  );
}
