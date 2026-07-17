import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { AdditiveBlending, DoubleSide, Group, Mesh, MeshBasicMaterial } from 'three';
import type { ProximitySignal } from '../presence/PresenceEngine';
import { positionForSpatialTarget } from './SpatialExperienceEngine';
import type { AlmostDiscoveredMoment, SpatialInteractionPulse } from './SpatialInteractionEngine';

interface SpatialInteractionLayerProps {
  pulses: SpatialInteractionPulse[];
  almostDiscovered: AlmostDiscoveredMoment[];
  targets: ProximitySignal[];
  accent: string;
  now?: number;
}

function positionFromBearing(distanceFeet: number, bearingDeg?: number): [number, number, number] {
  if (bearingDeg == null || !Number.isFinite(bearingDeg)) return [0, -2.88, -Math.max(1, distanceFeet / 4)];
  const angle = (bearingDeg - 90) * Math.PI / 180;
  const radius = Math.max(1, distanceFeet / 4);
  return [Math.cos(angle) * radius, -2.88, Math.sin(angle) * radius];
}

function PulseNode({ pulse, target, accent }: Readonly<{
  pulse: SpatialInteractionPulse;
  target?: ProximitySignal;
  accent: string;
}>) {
  const groupRef = useRef<Group | null>(null);
  const ringRef = useRef<Mesh | null>(null);
  const position = useMemo<[number, number, number]>(
    () => target ? positionForSpatialTarget(target) : [0, -2.88, 0],
    [target?.targetId, target?.distanceFeet],
  );

  useFrame(() => {
    const now = Date.now();
    const life = Math.max(0, Math.min(1, (now - pulse.createdAt) / Math.max(1, pulse.expiresAt - pulse.createdAt)));
    if (groupRef.current) groupRef.current.scale.setScalar(0.72 + life * pulse.ringExpansion);
    if (ringRef.current) {
      const material = ringRef.current.material as MeshBasicMaterial;
      material.opacity = (1 - life) * (0.28 + pulse.intensity * 0.44);
    }
  });

  const color = pulse.kind === 'mutual' ? '#fbbf24' : pulse.kind === 'office-hours' ? '#34d399' : accent;
  return (
    <group ref={groupRef} position={[position[0], -2.86, position[2]]}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.28, 0.4, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} depthWrite={false} side={DoubleSide} blending={AdditiveBlending} />
      </mesh>
      <mesh position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.025, 0.12, 1.4, 12, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.18 + pulse.environmentResponse * 0.3} depthWrite={false} side={DoubleSide} blending={AdditiveBlending} />
      </mesh>
    </group>
  );
}

function AlmostNode({ moment }: Readonly<{ moment: AlmostDiscoveredMoment }>) {
  const groupRef = useRef<Group | null>(null);
  const ringRef = useRef<Mesh | null>(null);
  const position = useMemo(
    () => positionFromBearing(moment.previousDistanceFeet, moment.previousBearingDeg),
    [moment.previousDistanceFeet, moment.previousBearingDeg],
  );

  useFrame((state) => {
    const life = Math.max(0, Math.min(1, (Date.now() - moment.createdAt) / Math.max(1, moment.expiresAt - moment.createdAt)));
    if (groupRef.current) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.08;
      groupRef.current.scale.setScalar(1 + life * 0.75);
    }
    if (ringRef.current) {
      const material = ringRef.current.material as MeshBasicMaterial;
      material.opacity = (1 - life) * (0.14 + moment.strength * 0.24);
    }
  });

  return (
    <group ref={groupRef} position={position}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.52, 0.025, 8, 72, Math.PI * 1.55]} />
        <meshBasicMaterial color="#94a3b8" transparent opacity={0.28} depthWrite={false} blending={AdditiveBlending} />
      </mesh>
    </group>
  );
}

/**
 * Physical acknowledgement layer. Taps, signals and mutuals briefly energize
 * nearby geometry; verified departures leave a restrained fading echo. Effects
 * are temporary, deterministic and never imply rejection or hidden intent.
 */
export default function SpatialInteractionLayer({
  pulses,
  almostDiscovered,
  targets,
  accent,
}: Readonly<SpatialInteractionLayerProps>) {
  const targetMap = useMemo(() => new Map(targets.map((target) => [target.targetId, target])), [targets]);
  return (
    <group>
      {pulses.map((pulse) => (
        <PulseNode key={pulse.id} pulse={pulse} target={targetMap.get(pulse.targetId)} accent={accent} />
      ))}
      {almostDiscovered.map((moment) => <AlmostNode key={moment.id} moment={moment} />)}
    </group>
  );
}
