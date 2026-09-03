import React, { useMemo } from 'react';
import SpatialPositionedAvatar from './SpatialPositionedAvatar';
import { buildSpatialLayout, type SpatialLayoutNode } from './SpatialLayoutEngine';
import type { ProximitySignal } from '../presence/PresenceEngine';

interface SpatialAvatarLayerProps {
  targets: Array<ProximitySignal & { bucket?: number }>;
  onTap: (target: ProximitySignal & { bucket?: number }) => void;
  layout?: SpatialLayoutNode[];
}

/**
 * Preserves every visible attendee while separating collisions at the scene
 * level. A precomputed layout is the shared coordinate truth for rendering,
 * camera focus, landmarks, and interaction hit targets.
 *
 * SpatialPositionedAvatar adapts the mature AvatarRenderer to an explicit world
 * position without changing its model/cache/animation pipeline. This matters now
 * that the field honors real compass bearings: renderer placement can no longer
 * fall back to an unrelated id-derived angle after the layout has resolved.
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
        <SpatialPositionedAvatar
          key={node.target.targetId}
          avatar={node.target}
          position={node.position}
          onTap={onTap}
        />
      ))}
    </group>
  );
}
