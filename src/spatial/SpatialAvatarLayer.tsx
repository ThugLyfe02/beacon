import React, { useMemo } from 'react';
import AvatarRenderer from './AvatarRenderer';
import { buildSpatialLayout, type SpatialLayoutNode } from './SpatialLayoutEngine';
import type { ProximitySignal } from '../presence/PresenceEngine';

interface SpatialAvatarLayerProps {
  targets: Array<ProximitySignal & { bucket?: number }>;
  onTap: (target: ProximitySignal & { bucket?: number }) => void;
  layout?: SpatialLayoutNode[];
}

/**
 * Preserves every visible attendee while separating collisions at the scene
 * level. AvatarRenderer remains the source of truth for models, fallback
 * geometry and animation; this layer only adds a stable parent displacement.
 *
 * A precomputed layout can be supplied so camera focus, landmarks and rendered
 * avatars all address the exact same world position.
 */
export default function SpatialAvatarLayer({
  targets,
  onTap,
  layout: suppliedLayout,
}: Readonly<SpatialAvatarLayerProps>) {
  const computedLayout = useMemo(() => buildSpatialLayout(targets), [targets]);
  const layout = suppliedLayout ?? computedLayout;

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
