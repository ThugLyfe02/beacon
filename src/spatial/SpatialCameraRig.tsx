import React, { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/native';
import { PerspectiveCamera, Vector3 } from 'three';
import type { SpatialNavigationState } from './SpatialNavigationEngine';

interface Props {
  navigation: SpatialNavigationState;
}

function dampingAlpha(delta: number, durationSeconds: number): number {
  if (durationSeconds <= 0.05) return 1;
  return 1 - Math.exp((-6 * delta) / durationSeconds);
}

/**
 * Smoothly moves the existing R3F perspective camera toward an engine-authored
 * pose. Position, look target and FOV are damped independently so transitions
 * feel deliberate rather than like a generic orbit control or abrupt teleport.
 */
export default function SpatialCameraRig({ navigation }: Readonly<Props>) {
  const { camera } = useThree();
  const perspectiveCamera = camera as PerspectiveCamera;
  const desiredPosition = useMemo(
    () => new Vector3(...navigation.pose.position),
    [navigation.pose.position],
  );
  const desiredLookAt = useMemo(
    () => new Vector3(...navigation.pose.lookAt),
    [navigation.pose.lookAt],
  );
  const currentLookAt = useRef(desiredLookAt.clone());

  useFrame((_, delta) => {
    const alpha = dampingAlpha(delta, navigation.pose.transitionSeconds);
    perspectiveCamera.position.lerp(desiredPosition, alpha);
    currentLookAt.current.lerp(desiredLookAt, alpha);
    perspectiveCamera.lookAt(currentLookAt.current);

    const nextFov = perspectiveCamera.fov
      + (navigation.pose.fov - perspectiveCamera.fov) * alpha;
    if (Math.abs(nextFov - perspectiveCamera.fov) > 0.01) {
      perspectiveCamera.fov = nextFov;
      perspectiveCamera.updateProjectionMatrix();
    }
  });

  return null;
}
