import React, { useMemo } from 'react';
import AvatarRenderer from './AvatarRenderer';
import type { ProximitySignal } from '../presence/PresenceEngine';

type AvatarTarget = ProximitySignal & { bucket?: number };

interface Props {
  avatar: AvatarTarget;
  position: [number, number, number];
  onTap?: (avatar: AvatarTarget) => void;
}

/**
 * AvatarRenderer predates the shared spatial-layout contract and still computes
 * its own deterministic base position internally. This adapter preserves all of
 * that renderer's model loading, texture cache, fallback mesh, idle animation,
 * and tap behavior while translating the renderer so its final world position
 * exactly matches the coordinate chosen by the spatial/AR layer.
 *
 * Keeping this compensation in one place prevents camera focus, collision layout,
 * AR projection, and rendered geometry from drifting into separate coordinate
 * systems while avoiding a risky rewrite of the mature GLB rendering pipeline.
 */
export default function SpatialPositionedAvatar({ avatar, position, onTap }: Readonly<Props>) {
  const displacement = useMemo<[number, number, number]>(() => {
    const seed = avatar.targetId
      .split('')
      .reduce((accumulator, character) => accumulator + character.codePointAt(0)!, 0);
    const angle = (seed % 360) * (Math.PI / 180);
    const radius = Math.max(1, avatar.distanceFeet / 4);
    const legacyBase: [number, number, number] = [
      Math.cos(angle) * radius,
      Math.sin(angle * 0.7) * 1.5,
      Math.sin(angle) * radius,
    ];

    return [
      position[0] - legacyBase[0],
      position[1] - legacyBase[1],
      position[2] - legacyBase[2],
    ];
  }, [avatar.distanceFeet, avatar.targetId, position]);

  return (
    <group position={displacement}>
      <AvatarRenderer avatar={avatar} onTap={onTap} />
    </group>
  );
}
