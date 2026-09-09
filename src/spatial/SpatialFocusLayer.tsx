import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { AdditiveBlending, DoubleSide, Group, Mesh, MeshBasicMaterial } from 'three';
import type { ProximitySignal } from '../presence/PresenceEngine';
import { positionForSpatialTarget } from './SpatialExperienceEngine';

interface Props {
  target: ProximitySignal | null;
  position?: [number, number, number] | null;
  accent: string;
  intensity: number;
}

/**
 * Adds a restrained cinematic focus language around an explicitly selected,
 * already-visible attendee. The halo contains no hidden recommendation or
 * inferred intent; it is purely a reversible camera/attention affordance.
 *
 * When crowded-field layout moves an avatar, the resolved render position is
 * supplied here so focus geometry and camera framing remain perfectly aligned.
 */
export default function SpatialFocusLayer({
  target,
  position,
  accent,
  intensity,
}: Readonly<Props>) {
  const rootRef = useRef<Group | null>(null);
  const ringRef = useRef<Mesh | null>(null);

  useFrame((state, delta) => {
    if (rootRef.current) rootRef.current.rotation.y += delta * (0.15 + intensity * 0.2);
    if (ringRef.current) {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 1.4) * (0.04 + intensity * 0.03);
      ringRef.current.scale.setScalar(pulse);
      const material = ringRef.current.material as MeshBasicMaterial;
      material.opacity = 0.22 + intensity * 0.22;
    }
  });

  if (!target) return null;
  const [x, y, z] = position ?? positionForSpatialTarget(target);
  const color = target.mutual ? '#fbbf24' : accent;

  return (
    <group ref={rootRef} position={[x, y - 2.6, z]}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.72, 0.88, 64]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.3}
          side={DoubleSide}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh position={[0, 1.2, 0]}>
        <cylinderGeometry args={[0.018, 0.07, 2.4, 10, 1, true]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.12 + intensity * 0.16}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      {[0, 1, 2].map((index) => (
        <mesh key={`focus-orbit-${index}`} rotation={[-Math.PI / 2, 0, index * 1.9]}>
          <torusGeometry args={[1.05 + index * 0.18, 0.012, 6, 48, Math.PI * 0.8]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.1 + intensity * 0.08}
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
}
