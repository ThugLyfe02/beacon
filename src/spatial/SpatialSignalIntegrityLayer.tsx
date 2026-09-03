import React, { useMemo } from 'react';
import { DoubleSide } from 'three';
import type { SpatialLayoutNode } from './SpatialLayoutEngine';
import type {
  SpatialSignalIntegrityBand,
  SpatialSignalIntegrityState,
} from './SpatialSignalIntegrity';

interface Props {
  layout: SpatialLayoutNode[];
  integrity: SpatialSignalIntegrityState;
  selectedTargetId?: string | null;
}

const BAND_COLOR: Record<SpatialSignalIntegrityBand, string> = {
  fresh: '#38BDF8',
  aging: '#FBBF24',
  weak: '#64748B',
  unknown: '#475569',
};

/**
 * Embeds confidence into the world instead of adding another dashboard card.
 * Every visible attendee keeps their avatar; only the floor marker changes from
 * crisp to restrained as the latest spatial evidence ages or loses bearing.
 */
export default function SpatialSignalIntegrityLayer({
  layout,
  integrity,
  selectedTargetId,
}: Readonly<Props>) {
  const integrityByTarget = useMemo(
    () => new Map(integrity.nodes.map((node) => [node.targetId, node] as const)),
    [integrity.nodes],
  );

  return (
    <group>
      {layout.map((node) => {
        const signal = integrityByTarget.get(node.target.targetId);
        if (!signal) return null;
        const selected = node.target.targetId === selectedTargetId;
        const radius = selected ? 0.82 : 0.58;
        const thickness = selected ? 0.055 : 0.035;
        const opacity = Math.max(0.1, Math.min(0.52, 0.12 + signal.confidence * 0.34 + (selected ? 0.08 : 0)));
        const color = node.target.mutual ? '#FBBF24' : BAND_COLOR[signal.band];

        return (
          <group key={node.target.targetId} position={[node.position[0], -2.965, node.position[2]]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[radius - thickness, radius, 48]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={opacity}
                side={DoubleSide}
                depthWrite={false}
              />
            </mesh>
            {selected ? (
              <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[radius + 0.12, radius + 0.145, 48]} />
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={Math.max(0.16, signal.confidence * 0.32)}
                  side={DoubleSide}
                  depthWrite={false}
                />
              </mesh>
            ) : null}
          </group>
        );
      })}
    </group>
  );
}
