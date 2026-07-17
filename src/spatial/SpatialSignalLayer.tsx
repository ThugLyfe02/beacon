import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  AdditiveBlending,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { SpatialFocusTarget } from './SpatialExperienceEngine';
import { positionForSpatialTarget } from './SpatialExperienceEngine';

interface SpatialSignalLayerProps {
  focusTargets: SpatialFocusTarget[];
  accent: string;
}

function RouteBeam({ focus, accent, index }: Readonly<{
  focus: SpatialFocusTarget;
  accent: string;
  index: number;
}>) {
  const meshRef = useRef<Mesh | null>(null);
  const targetPosition = useMemo(
    () => new Vector3(...positionForSpatialTarget(focus.target)),
    [focus.target.targetId, focus.target.distanceFeet],
  );
  const start = useMemo(() => new Vector3(0, -2.86, 0), []);
  const midpoint = useMemo(
    () => start.clone().add(targetPosition).multiplyScalar(0.5),
    [start, targetPosition],
  );
  const length = useMemo(() => start.distanceTo(targetPosition), [start, targetPosition]);
  const rotation = useMemo(() => {
    const direction = targetPosition.clone().sub(start).normalize();
    return new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction);
  }, [start, targetPosition]);
  const routeColor = focus.reason === 'mutual'
    ? '#fbbf24'
    : focus.reason === 'premium-nearby'
      ? '#f59e0b'
      : accent;

  useFrame((state) => {
    if (!meshRef.current) return;
    const material = meshRef.current.material as MeshBasicMaterial;
    const wave = 0.5 + Math.sin(state.clock.elapsedTime * 1.5 + index * 0.8) * 0.2;
    material.opacity = (0.12 + Math.min(focus.score / 100, 0.5)) * wave;
  });

  return (
    <group>
      <mesh
        ref={meshRef}
        position={midpoint}
        quaternion={rotation}
      >
        <cylinderGeometry args={[0.018, 0.075, length, 10, 1, true]} />
        <meshBasicMaterial
          color={routeColor}
          transparent
          opacity={0.2}
          depthWrite={false}
          side={DoubleSide}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh position={[targetPosition.x, -2.9, targetPosition.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.38 + index * 0.05, 0.46 + index * 0.05, 48]} />
        <meshBasicMaterial
          color={routeColor}
          transparent
          opacity={focus.reason === 'mutual' ? 0.72 : 0.42}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

/**
 * Shows up to three honest routes based only on targets already visible in the
 * Presence Engine. These are visual priorities, not recommendations fabricated
 * from private data or inferred intent.
 */
export default function SpatialSignalLayer({
  focusTargets,
  accent,
}: Readonly<SpatialSignalLayerProps>) {
  const groupRef = useRef<Group | null>(null);

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.008;
  });

  return (
    <group ref={groupRef}>
      {focusTargets.map((focus, index) => (
        <RouteBeam
          key={focus.target.targetId}
          focus={focus}
          accent={accent}
          index={index}
        />
      ))}
    </group>
  );
}
