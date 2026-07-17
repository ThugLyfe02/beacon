import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { AdditiveBlending, Group } from 'three';
import type { SpatialProgressionState } from './SpatialProgressionEngine';

interface SpatialMilestoneLayerProps {
  progression: SpatialProgressionState;
  accent: string;
}

/**
 * Small visual reward for verified session progress.
 * Geometry appears only as the user performs real event actions; it is not tied
 * to purchases, random drops, or hidden engagement manipulation.
 */
export default function SpatialMilestoneLayer({
  progression,
  accent,
}: Readonly<SpatialMilestoneLayerProps>) {
  const groupRef = useRef<Group | null>(null);
  const shardCount = Math.min(8, Math.max(1, progression.level));

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += delta * (0.08 + progression.heat * 0.018);
    groupRef.current.position.y = -2.45 + Math.sin(state.clock.elapsedTime * 0.8) * 0.06;
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: shardCount }).map((_, index) => {
        const angle = (index / shardCount) * Math.PI * 2;
        const radius = 1.25 + (index % 2) * 0.18;
        return (
          <mesh
            key={`milestone-shard-${index}`}
            position={[Math.cos(angle) * radius, -2.45, Math.sin(angle) * radius]}
            rotation={[0.2, -angle, 0.45]}
          >
            <octahedronGeometry args={[0.055 + progression.level * 0.002, 0]} />
            <meshBasicMaterial
              color={accent}
              transparent
              opacity={0.22 + progression.progress * 0.42}
              depthWrite={false}
              blending={AdditiveBlending}
            />
          </mesh>
        );
      })}
    </group>
  );
}
