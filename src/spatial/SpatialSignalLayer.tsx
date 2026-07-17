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
  detailBudget: number;
}

function colorForFocus(focus: SpatialFocusTarget, accent: string): string {
  if (focus.reason === 'mutual') return '#fbbf24';
  if (focus.reason === 'premium-nearby') return '#f59e0b';
  return accent;
}

function AmbientMarker({ focus, accent, index }: Readonly<{
  focus: SpatialFocusTarget;
  accent: string;
  index: number;
}>) {
  const markerRef = useRef<Mesh | null>(null);
  const position = useMemo(
    () => positionForSpatialTarget(focus.target),
    [focus.target.targetId, focus.target.distanceFeet],
  );
  const color = colorForFocus(focus, accent);

  useFrame((state) => {
    if (!markerRef.current) return;
    const material = markerRef.current.material as MeshBasicMaterial;
    const pulse = 0.55 + Math.sin(state.clock.elapsedTime * 0.7 + index * 0.41) * 0.18;
    material.opacity = 0.08 + pulse * 0.1;
  });

  return (
    <mesh
      ref={markerRef}
      position={[position[0], -2.89, position[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <ringGeometry args={[0.16, 0.22, 32]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.14}
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </mesh>
  );
}

function RouteBeam({ focus, accent, index, hero }: Readonly<{
  focus: SpatialFocusTarget;
  accent: string;
  index: number;
  hero: boolean;
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
  const routeColor = colorForFocus(focus, accent);

  useFrame((state) => {
    if (!meshRef.current) return;
    const material = meshRef.current.material as MeshBasicMaterial;
    const wave = 0.5 + Math.sin(state.clock.elapsedTime * (hero ? 1.7 : 1.15) + index * 0.8) * 0.2;
    const salience = Math.min(focus.score / 100, 0.55);
    material.opacity = (hero ? 0.18 : 0.08) + salience * wave;
  });

  return (
    <group>
      <mesh ref={meshRef} position={midpoint} quaternion={rotation}>
        <cylinderGeometry
          args={hero ? [0.022, 0.095, length, 10, 1, true] : [0.01, 0.035, length, 8, 1, true]}
        />
        <meshBasicMaterial
          color={routeColor}
          transparent
          opacity={hero ? 0.28 : 0.12}
          depthWrite={false}
          side={DoubleSide}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh position={[targetPosition.x, -2.9, targetPosition.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={hero ? [0.42, 0.53, 56] : [0.26, 0.33, 40]} />
        <meshBasicMaterial
          color={routeColor}
          transparent
          opacity={focus.reason === 'mutual' ? 0.72 : hero ? 0.46 : 0.24}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

/**
 * Represents every visible attendee without giving every path the same visual
 * weight. The Director allocates a detail budget for full route geometry; all
 * remaining people stay visible as ambient live markers instead of disappearing.
 */
export default function SpatialSignalLayer({
  focusTargets,
  accent,
  detailBudget,
}: Readonly<SpatialSignalLayerProps>) {
  const groupRef = useRef<Group | null>(null);

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.008;
  });

  return (
    <group ref={groupRef}>
      {focusTargets.map((focus, index) => {
        const receivesRoute = index < detailBudget;
        if (!receivesRoute) {
          return (
            <AmbientMarker
              key={focus.target.targetId}
              focus={focus}
              accent={accent}
              index={index}
            />
          );
        }

        return (
          <RouteBeam
            key={focus.target.targetId}
            focus={focus}
            accent={accent}
            index={index}
            hero={focus.tier === 'hero' || index < 2}
          />
        );
      })}
    </group>
  );
}
