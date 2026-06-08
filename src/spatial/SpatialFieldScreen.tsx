import React from "react";
import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import AvatarRenderer from "./AvatarRenderer";
import { usePresenceEngine } from "../presence/usePresenceEngine";
import TensionBar from "../components/TensionBar";

export default function SpatialFieldScreen(props: any) {
  const presence = usePresenceEngine(props);

  if (!presence) return null;

  return (
    <>
      <Canvas camera={{ position: [0, 0, 12], fov: 60 }}>
        <fog attach="fog" args={["#0a0a0a", 10, 60]} />
        <ambientLight intensity={0.6} />
        <Suspense fallback={null}>
          {presence.visibleTargets.map((target: any) => (
            <AvatarRenderer key={target.targetId} avatar={target} />
          ))}
        </Suspense>
      </Canvas>
      <TensionBar
        tensionScore={presence.tensionScore}
        urgencyLevel={presence.urgencyLevel}
      />
    </>
  );
}
