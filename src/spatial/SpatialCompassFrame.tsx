import React from 'react';
import { DoubleSide } from 'three';

/**
 * Makes the now-bearing-correct field legible as a physical frame. North is the
 * only emphasized cardinal; the remaining ticks provide orientation without
 * turning the world into another dashboard. This layer is decorative/semantic
 * only and never changes attendee positions or visibility.
 */
export default function SpatialCompassFrame() {
  const radius = 10.5;
  return (
    <group>
      <mesh position={[0, -2.972, -radius / 2]}>
        <boxGeometry args={[0.028, 0.012, radius]} />
        <meshBasicMaterial color="#38BDF8" transparent opacity={0.16} />
      </mesh>

      <mesh position={[0, -2.958, -radius]} rotation={[-Math.PI / 2, 0, 0.52]}>
        <circleGeometry args={[0.48, 3]} />
        <meshBasicMaterial color="#7DD3FC" transparent opacity={0.82} side={DoubleSide} />
      </mesh>
      <mesh position={[0, -2.956, -radius + 0.58]}>
        <boxGeometry args={[0.08, 0.018, 0.72]} />
        <meshBasicMaterial color="#7DD3FC" transparent opacity={0.72} />
      </mesh>

      {[
        [radius, 0],
        [0, radius],
        [-radius, 0],
      ].map(([x, z], index) => (
        <mesh key={`${x}:${z}`} position={[x, -2.96, z]}>
          <boxGeometry args={index === 1 ? [0.34, 0.025, 0.08] : [0.08, 0.025, 0.34]} />
          <meshBasicMaterial color="#64748B" transparent opacity={0.5} />
        </mesh>
      ))}
    </group>
  );
}
