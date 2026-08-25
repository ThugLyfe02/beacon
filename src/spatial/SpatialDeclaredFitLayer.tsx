import React from 'react';
import { DoubleSide } from 'three';
import type { SpatialLayoutNode } from './SpatialLayoutEngine';

interface Props {
  layout: SpatialLayoutNode[];
  reducedMotion?: boolean;
}

/**
 * Participant-private visual treatment for explicit pairwise intent overlap.
 *
 * The layer never ranks people publicly, never hides attendees, and never infers
 * intent. It simply decorates the already-resolved world position when the live
 * signal carries a server-released intersection between what both participants
 * explicitly selected for this event.
 */
export default function SpatialDeclaredFitLayer({ layout, reducedMotion = false }: Readonly<Props>) {
  const fits = layout.filter((node) => (node.target.declaredFitStrength ?? 0) > 0);
  if (fits.length === 0) return null;

  return (
    <group>
      {fits.map((node) => {
        const strength = Math.max(0, Math.min(1, node.target.declaredFitStrength ?? 0));
        const twoWay = node.target.declaredFitTwoWay === true;
        const radius = 0.58 + strength * 0.22;
        const opacity = 0.2 + strength * 0.42;
        const pulseRadius = reducedMotion ? radius + 0.14 : radius + 0.18 + strength * 0.08;
        return (
          <group key={`declared-fit-${node.target.targetId}`} position={[node.position[0], -2.955, node.position[2]]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[radius, radius + 0.055, 64]} />
              <meshBasicMaterial
                color={twoWay ? '#67e8f9' : '#22d3ee'}
                transparent
                opacity={opacity}
                side={DoubleSide}
                depthWrite={false}
              />
            </mesh>
            {twoWay ? (
              <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]}>
                <ringGeometry args={[pulseRadius, pulseRadius + 0.035, 48, 1, 0, Math.PI * 1.35]} />
                <meshBasicMaterial
                  color="#a5f3fc"
                  transparent
                  opacity={0.22 + strength * 0.3}
                  side={DoubleSide}
                  depthWrite={false}
                />
              </mesh>
            ) : null}
            <mesh position={[0, 0.055, 0]}>
              <cylinderGeometry args={[0.018, 0.018, 0.12 + strength * 0.12, 8]} />
              <meshBasicMaterial
                color={twoWay ? '#cffafe' : '#67e8f9'}
                transparent
                opacity={0.32 + strength * 0.35}
                depthWrite={false}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
