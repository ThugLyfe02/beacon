import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  AdditiveBlending,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';

interface OpportunityFieldProps {
  tensionScore: number;
  density: number;
  mutualMatches: number;
  urgencyLevel: string;
}

interface PulseSpec {
  delay: number;
  speed: number;
  maxScale: number;
}

const PULSES: PulseSpec[] = [
  { delay: 0, speed: 0.18, maxScale: 7 },
  { delay: 0.34, speed: 0.18, maxScale: 7 },
  { delay: 0.68, speed: 0.18, maxScale: 7 },
];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * A privacy-safe spatial visualization of the event's live state.
 *
 * It never invents people or reveals movement trails. The geometry is driven
 * only by aggregate values the PresenceEngine already calculates:
 * - pulse cadence comes from tension;
 * - field brightness comes from visible density;
 * - the central gold beacon appears only after a real mutual exists.
 */
export default function OpportunityField({
  tensionScore,
  density,
  mutualMatches,
  urgencyLevel,
}: Readonly<OpportunityFieldProps>) {
  const pulseRefs = useRef<Array<Mesh | null>>([]);
  const coreRef = useRef<Group | null>(null);
  const beaconRef = useRef<Mesh | null>(null);

  const normalizedTension = clamp01(tensionScore / 100);
  const normalizedDensity = clamp01(density / 12);
  const fieldColor = urgencyLevel === 'critical'
    ? '#fb7185'
    : urgencyLevel === 'high'
      ? '#f59e0b'
      : '#60a5fa';

  const pulseOpacity = 0.08 + normalizedDensity * 0.22;
  const cadenceMultiplier = 0.7 + normalizedTension * 1.8;
  const beaconStrength = clamp01(mutualMatches / 3);

  const pulseMaterials = useMemo(
    () => PULSES.map(() => new MeshBasicMaterial({
      color: fieldColor,
      transparent: true,
      opacity: pulseOpacity,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
    })),
    [fieldColor, pulseOpacity],
  );

  useFrame((state, delta) => {
    const elapsed = state.clock.elapsedTime;

    pulseRefs.current.forEach((mesh, index) => {
      if (!mesh) return;
      const spec = PULSES[index];
      const cycle = (elapsed * spec.speed * cadenceMultiplier + spec.delay) % 1;
      const scale = 0.8 + cycle * spec.maxScale;
      mesh.scale.set(scale, scale, scale);
      const material = mesh.material as MeshBasicMaterial;
      material.opacity = pulseOpacity * Math.sin(Math.PI * cycle) ** 2;
    });

    if (coreRef.current) {
      coreRef.current.rotation.z += delta * (0.08 + normalizedTension * 0.16);
    }

    if (beaconRef.current) {
      const pulse = 0.55 + Math.sin(elapsed * 1.7) * 0.15;
      const material = beaconRef.current.material as MeshBasicMaterial;
      material.opacity = pulse * beaconStrength;
      beaconRef.current.scale.y = 0.8 + beaconStrength * 1.4 + Math.sin(elapsed * 1.2) * 0.08;
    }
  });

  return (
    <group position={[0, -2.94, 0]}>
      {PULSES.map((_, index) => (
        <mesh
          key={`opportunity-pulse-${index}`}
          ref={(mesh) => { pulseRefs.current[index] = mesh; }}
          rotation={[-Math.PI / 2, 0, 0]}
          material={pulseMaterials[index]}
        >
          <ringGeometry args={[0.92, 1, 72]} />
        </mesh>
      ))}

      <group ref={coreRef} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh>
          <torusGeometry args={[0.72, 0.025 + normalizedTension * 0.02, 8, 64]} />
          <meshBasicMaterial
            color={fieldColor}
            transparent
            opacity={0.38 + normalizedTension * 0.35}
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 3]}>
          <torusGeometry args={[0.52, 0.016, 8, 48, Math.PI * 1.45]} />
          <meshBasicMaterial
            color="#c4b5fd"
            transparent
            opacity={0.3 + normalizedDensity * 0.25}
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>
      </group>

      {mutualMatches > 0 && (
        <mesh ref={beaconRef} position={[0, 1.2, 0]}>
          <cylinderGeometry args={[0.035, 0.16, 2.4, 16, 1, true]} />
          <meshBasicMaterial
            color="#fbbf24"
            transparent
            opacity={0.5}
            side={DoubleSide}
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>
      )}
    </group>
  );
}
