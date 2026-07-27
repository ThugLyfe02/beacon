import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/native';
import { Vector3 } from 'three';
import type { SpatialNavigationState } from './SpatialNavigationEngine';

interface Props {
  navigation: SpatialNavigationState;
}

function dampingAlpha(delta: number, durationSeconds: number): number {
  if (durationSeconds <= 0.05) return 1;
  return 1 - Math.exp((-6 * delta) / durationSeconds);
}

/**
 * Smoothly moves the existing R3F camera toward an engine-authored pose.
 * Position, look target and FOV are damped independently so transitions feel
 * deliberate rather than like a generic orbit control or abrupt teleport.
 */
export default function SpatialCameraRig({ navigation }: Readonly<Props>) {
  const { camera } = useThree();
  const desiredPosition = useMemo(() => new Vector3(...navigation.pose.position), [navigation.pose.position]);
  const desiredLookAt = useMemo(() => new Vector3(...navigation.pose.lookAt), [navigation.pose.lookAt]);
  const currentLookAt = useRef(desiredLookAt.clone());
  const lastMode = useRef(navigation.mode);

  useEffect(() => {
    if (lastMode.current !== navigation.mode) lastMode.current = navigation.mode;
  }, [navigation.mode]);

  useFrame((_, delta) => {
    const alpha = dampingAlpha(delta, navigation.pose.transitionSeconds);
    camera.position.lerp(desiredPosition, alpha);
    currentLookAt.current.lerp(desiredLookAt, alpha);
    camera.lookAt(currentLookAt.current);

    const nextFov = camera.fov + (navigation.pose.fov - camera.fov) * alpha;
    if (Math.abs(nextFov - camera.fov) > 0.01) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
