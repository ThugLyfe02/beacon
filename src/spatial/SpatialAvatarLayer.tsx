import React, { useMemo } from 'react';
import AvatarRenderer from './AvatarRenderer';
import { buildSpatialLayout } from './SpatialLayoutEngine';
import type { ProximitySignal } from '../presence/PresenceEngine';

interface SpatialAvatarLayerProps {
  targets: Array<ProximitySignal & { bucket?: number }>;
  onTap: (target: ProximitySignal & { bucket?: number }) => void;
}

/**
 * Preserves every visible attendee while separating collisions at the scene
 * level. AvatarRenderer remains the source of truth for models, fallback
 * geometry and animation; this layer only adds a stable parent displacement.
 */
export default function SpatialAvatarLayer({
  targets,
  onTap,
}: Readonly<SpatialAvatarLayerProps>) {
  const layout = useMemo(() => buildSpatialLayout(targets), [targets]);

  return (
    <group>
      {layout.map((node) => (
        <group key={node.target.targetId} position={node.displacement}>
          <AvatarRenderer avatar={node.target} onTap={onTap} />
        </group>
      ))}
    </group>
  );
}
