import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { AdditiveBlending, Group } from 'three';
import type { SpatialProgressionState } from './SpatialProgressionEngine';

interface SpatialDistrictLayerProps {
  progression: SpatialProgressionState;
  accent: string;
  premium: boolean;
}

/**
 * Lightweight open-world atmosphere around the field perimeter. The skyline
 * grows with verified event progression; premium adds a second intelligence
 * ring, not stronger access or synthetic visibility.
 */
export default function SpatialDistrictLayer({
  progression,
  accent,
  premium,
}: Readonly<SpatialDistrictLayerProps>) {
  const groupRef = useRef<Group | null>(null);
  const towerCount = Math.min(18, 6 + progression.level);
  const towers = useMemo(
    () => Array.from({ length: towerCount }, (_, index) => {
      const angle = (index / towerCount) * Math.PI * 2;
      const radius = 18 + (index % 3) * 1.8;
      const height = 1.2 + ((index * 7 + progression.level) % 6) * 0.55;
      return {
        key: `district-${index}`,
        position: [Math.cos(angle) * radius, -3 + height / 2, Math.sin(angle) * radius] as [number, number, number],
        rotation: [0, -angle, 0] as [number, number, number],
        height,
      };
    }),
    [progression.level, towerCount],
  );

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const direction = premium ? 1 : -1;
    groupRef.current.rotation.y += delta * 0.008 * direction;
    groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.22) * 0.04;
  });

  return (
    <group ref={groupRef}>
      {towers.map((tower, index) => (
        <group key={tower.key} position={tower.position} rotation={tower.rotation}>
          <mesh>
            <boxGeometry args={[0.38, tower.height, 0.38]} />
            <meshBasicMaterial
              color={index % 4 === 0 ? accent : '#27334d'}
              transparent
              opacity={0.16 + progression.heat * 0.025}
              depthWrite={false}
              blending={AdditiveBlending}
            />
          </mesh>
          <mesh position={[0, tower.height / 2 + 0.08, 0]}>
            <sphereGeometry args={[0.055, 8, 8]} />
            <meshBasicMaterial
              color={accent}
              transparent
              opacity={0.3 + progression.progress * 0.5}
              depthWrite={false}
              blending={AdditiveBlending}
            />
          </mesh>
        </group>
      ))}

      {premium && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.96, 0]}>
          <ringGeometry args={[20.4, 20.46, 128]} />
          <meshBasicMaterial
            color="#fbbf24"
            transparent
            opacity={0.22 + progression.progress * 0.18}
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>
      )}
    </group>
  );
}
