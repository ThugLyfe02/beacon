import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { AdditiveBlending, DoubleSide, Group, Mesh, MeshBasicMaterial } from 'three';
import type { SpatialDirectorState } from './SpatialDirectorEngine';

interface SpatialDirectorLayerProps {
  director: SpatialDirectorState;
}

const ARC_COUNT = 5;

export default function SpatialDirectorLayer({ director }: Readonly<SpatialDirectorLayerProps>) {
  const rootRef = useRef<Group | null>(null);
  const horizonRef = useRef<Mesh | null>(null);
  const arcRefs = useRef<Array<Mesh | null>>([]);

  const arcMaterial = useMemo(
    () => new MeshBasicMaterial({
      color: director.accent,
      transparent: true,
      opacity: 0.18 + director.worldIntensity * 0.22,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
    [director.accent, director.worldIntensity],
  );

  useFrame((state, delta) => {
    const elapsed = state.clock.elapsedTime;
    if (rootRef.current) {
      rootRef.current.rotation.y += delta * (0.018 + director.worldIntensity * 0.035);
    }

    arcRefs.current.forEach((mesh, index) => {
      if (!mesh) return;
      const phase = elapsed * director.pulseRate * 0.18 + index * 0.7;
      const breathe = 1 + Math.sin(phase) * (0.025 + director.worldIntensity * 0.04);
      mesh.scale.setScalar(breathe);
      const material = mesh.material as MeshBasicMaterial;
      material.opacity = (0.1 + director.worldIntensity * 0.2) * (0.72 + Math.sin(phase) * 0.28);
    });

    if (horizonRef.current) {
      const material = horizonRef.current.material as MeshBasicMaterial;
      material.opacity = 0.04 + director.worldIntensity * 0.12 + Math.sin(elapsed * 0.35) * 0.015;
    }
  });

  return (
    <group ref={rootRef} position={[0, -2.82, 0]}>
      <mesh ref={horizonRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[director.revealRadius * 0.9, director.revealRadius, 128]} />
        <meshBasicMaterial
          color={director.accent}
          transparent
          opacity={0.1}
          side={DoubleSide}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>

      {Array.from({ length: ARC_COUNT }).map((_, index) => {
        const radius = 3.8 + index * 2.6;
        const arcLength = director.act === 'closing' ? Math.PI * 1.45 : Math.PI * 1.1;
        return (
          <mesh
            key={`director-arc-${index}`}
            ref={(mesh) => { arcRefs.current[index] = mesh; }}
            rotation={[-Math.PI / 2, 0, index * 0.78]}
            material={arcMaterial}
          >
            <torusGeometry args={[radius, 0.018 + director.worldIntensity * 0.012, 8, 72, arcLength]} />
          </mesh>
        );
      })}

      {director.act === 'convergence' && (
        <group position={[0, 0.45, 0]}>
          {[0, 1, 2].map((index) => (
            <mesh key={`convergence-spire-${index}`} rotation={[0, (Math.PI * 2 * index) / 3, 0]}>
              <coneGeometry args={[0.08, 1.6 + index * 0.28, 10, 1, true]} />
              <meshBasicMaterial
                color={director.accent}
                transparent
                opacity={0.16 + director.worldIntensity * 0.16}
                side={DoubleSide}
                depthWrite={false}
                blending={AdditiveBlending}
              />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}
