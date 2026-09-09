import { useEffect } from 'react';
import { PixelRatio } from 'react-native';
import { useThree } from '@react-three/fiber/native';

interface Props {
  pixelRatioCap: number;
}

/**
 * Applies the quality governor's pixel-ratio ceiling from inside the native R3F
 * canvas. React Three Fiber Native does not expose the web Canvas `dpr` prop, so
 * renderer resolution is adjusted directly without changing world visibility.
 */
export default function SpatialRenderQualityController({
  pixelRatioCap,
}: Readonly<Props>) {
  const { gl } = useThree();

  useEffect(() => {
    const deviceRatio = PixelRatio.get();
    const desired = Math.max(1, Math.min(deviceRatio, pixelRatioCap));
    if (Math.abs(gl.getPixelRatio() - desired) > 0.01) gl.setPixelRatio(desired);
  }, [gl, pixelRatioCap]);

  return null;
}
