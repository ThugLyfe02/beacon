import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { AdditiveBlending, DoubleSide, Group, Mesh, MeshBasicMaterial } from 'three';
import type { CardinalSector, SpatialWorldIntelligence } from './SpatialWorldIntelligenceEngine';

interface Props {
  intelligence: SpatialWorldIntelligence;
}

function angleForSector(sector: CardinalSector): number {
  switch (sector) {
    case 'north': return 0;
    case 'east': return -Math.PI / 2;
    case 'south': return Math.PI;
    case 'west': return Math.PI / 2;
    default: return 0;
  }
}

function ClusterBeacon({
  sector,
  momentum,
  confidence,
  memberCount,
}: Readonly<{
  sector: CardinalSector;
  momentum: number;
  confidence: number;
  memberCount: number;
}>) {
  const ref = useRef<Mesh | null>(null);
  const angle = angleForSector(sector);
  const radius = 8.2;
  const position: [number, number, number] = [Math.sin(angle) * radius, -2.75, -Math.cos(angle) * radius];

  useFrame((state) => {
    if (!ref.current) return;
    const pulse = 1 + Math.sin(state.clock.elapsedTime * (0.55 + momentum) + angle) * 0.08;
    ref.current.scale.setScalar(pulse);
    const material = ref.current.material as MeshBasicMaterial;
    material.opacity = (0.12 + momentum * 0.25) * confidence;
  });

  return (
    <group position={position}>
      <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.65 + memberCount * 0.08, 0.85 + memberCount * 0.1, 64]} />
        <meshBasicMaterial
          color="#8b5cf6"
          transparent
          opacity={0.2}
          depthWrite={false}
          side={DoubleSide}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh position={[0, 0.32 + momentum * 0.45, 0]}>
        <cylinderGeometry args={[0.025, 0.09, 0.65 + momentum * 1.3, 10, 1, true]} />
        <meshBasicMaterial
          color="#c4b5fd"
          transparent
          opacity={0.18 + confidence * 0.22}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

export default function SpatialWorldIntelligenceLayer({ intelligence }: Readonly<Props>) {
  const rootRef = useRef<Group | null>(null);
  const forecast = intelligence.forecast;
  const forecastAngle = forecast ? angleForSector(forecast.sector) : 0;
  const trustMaterial = useMemo(() => new MeshBasicMaterial({
    color: intelligence.trust.band === 'verified'
      ? '#34d399'
      : intelligence.trust.band === 'stable'
        ? '#60a5fa'
        : intelligence.trust.band === 'uncertain'
          ? '#f59e0b'
          : '#fb7185',
    transparent: true,
    opacity: 0.06 + intelligence.trust.confidence * 0.12,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  }), [intelligence.trust.band, intelligence.trust.confidence]);

  useFrame((state, delta) => {
    if (rootRef.current) {
      const calm = intelligence.story.ambientCalm;
      rootRef.current.rotation.y += delta * (0.002 + (1 - calm) * 0.006);
    }
    trustMaterial.opacity = (0.04 + intelligence.trust.confidence * 0.1)
      * (0.92 + Math.sin(state.clock.elapsedTime * 0.3) * 0.08);
  });

  return (
    <group ref={rootRef}>
      <mesh position={[0, -2.94, 0]} rotation={[-Math.PI / 2, 0, 0]} material={trustMaterial}>
        <ringGeometry args={[10.5, 12.4, 128]} />
      </mesh>

      {intelligence.clusters.map((cluster) => (
        <ClusterBeacon
          key={cluster.id}
          sector={cluster.sector}
          momentum={cluster.momentum}
          confidence={cluster.confidence * intelligence.trust.geometryClarity}
          memberCount={cluster.memberCount}
        />
      ))}

      {forecast && (
        <group rotation={[0, forecastAngle, 0]}>
          {[0, 1, 2].map((index) => (
            <mesh
              key={`forecast-chevron-${index}`}
              position={[0, -2.72 + index * 0.04, -4.8 - index * 1.35]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <ringGeometry args={[0.2 + index * 0.12, 0.32 + index * 0.14, 32, 1, 0.35, Math.PI * 1.3]} />
              <meshBasicMaterial
                color="#fbbf24"
                transparent
                opacity={(0.18 + forecast.confidence * 0.25) * intelligence.trust.routeBrightness}
                depthWrite={false}
                side={DoubleSide}
                blending={AdditiveBlending}
              />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}
