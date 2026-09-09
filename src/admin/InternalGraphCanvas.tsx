import React, { useMemo, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas, useFrame, useThree } from '@react-three/fiber/native';
import {
  Color,
  MathUtils,
  Quaternion,
  Vector3,
  type Mesh,
} from 'three';
import type {
  InternalGraphAnalysis,
  InternalGraphEdge,
  InternalGraphNode,
  InternalGraphPayload,
} from './InternalGraphEngine';

interface Props {
  payload: InternalGraphPayload;
  analysis: InternalGraphAnalysis;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

const KIND_COLOR: Record<string, string> = {
  person: '#38BDF8',
  event: '#F59E0B',
  venue: '#A78BFA',
  room: '#FB7185',
  role: '#34D399',
  outcome: '#FACC15',
  organization: '#22D3EE',
  domain: '#818CF8',
  project: '#2DD4BF',
  topic: '#C084FC',
};

function colorForNode(node: InternalGraphNode): string {
  return KIND_COLOR[node.kind] ?? '#94A3B8';
}

function edgeColor(edge: InternalGraphEdge): string {
  if (edge.sensitivity === 'restricted') return '#FB7185';
  if (edge.confidence === 'AMBIGUOUS') return '#64748B';
  if (edge.confidence === 'DERIVED') return '#A78BFA';
  if (edge.relation === 'outcome_completed') return '#FACC15';
  if (edge.relation === 'mutual_with' || edge.relation === 'office_hours_with') return '#34D399';
  return '#334155';
}

function GraphCameraRig({
  selected,
  extent,
}: Readonly<{
  selected: { x: number; y: number; z: number } | null;
  extent: number;
}>) {
  const { camera } = useThree();
  const lookRef = useRef(new Vector3());

  useFrame((_, delta) => {
    const targetLook = selected
      ? new Vector3(selected.x, selected.y, selected.z)
      : new Vector3(0, 0, 0);
    const targetPosition = selected
      ? new Vector3(selected.x, selected.y - 0.15, Math.max(8, extent * 0.36))
      : new Vector3(0, 0, Math.max(16, extent * 1.35));

    const damping = 1 - Math.exp(-delta * 4.2);
    camera.position.lerp(targetPosition, damping);
    lookRef.current.lerp(targetLook, damping);
    camera.lookAt(lookRef.current);
  });

  return null;
}

function EdgeMesh({
  edge,
  left,
  right,
}: Readonly<{
  edge: InternalGraphEdge;
  left: { x: number; y: number; z: number };
  right: { x: number; y: number; z: number };
}>) {
  const geometry = useMemo(() => {
    const start = new Vector3(left.x, left.y, left.z);
    const end = new Vector3(right.x, right.y, right.z);
    const direction = end.clone().sub(start);
    const length = Math.max(0.001, direction.length());
    const midpoint = start.clone().add(end).multiplyScalar(0.5);
    const quaternion = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      direction.clone().normalize(),
    );
    return { length, midpoint, quaternion };
  }, [left.x, left.y, left.z, right.x, right.y, right.z]);

  const thickness = MathUtils.clamp(0.012 + Math.log2(1 + edge.strength) * 0.007, 0.012, 0.055);
  const opacity = edge.sensitivity === 'restricted' ? 0.78 : edge.confidence === 'AMBIGUOUS' ? 0.28 : 0.5;

  return (
    <mesh position={geometry.midpoint} quaternion={geometry.quaternion}>
      <cylinderGeometry args={[thickness, thickness, geometry.length, 5]} />
      <meshBasicMaterial color={edgeColor(edge)} transparent opacity={opacity} />
    </mesh>
  );
}

function NodeMesh({
  node,
  point,
  selected,
  broker,
  onSelect,
}: Readonly<{
  node: InternalGraphNode;
  point: { x: number; y: number; z: number; radius: number };
  selected: boolean;
  broker: boolean;
  onSelect: () => void;
}>) {
  const mesh = useRef<Mesh>(null);
  const baseColor = colorForNode(node);

  useFrame(({ clock }) => {
    if (!mesh.current) return;
    const pulse = broker ? Math.sin(clock.elapsedTime * 1.8) * 0.025 : 0;
    const scale = (selected ? 1.38 : 1) + pulse;
    mesh.current.scale.setScalar(scale);
  });

  return (
    <mesh
      ref={mesh}
      position={[point.x, point.y, point.z]}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <sphereGeometry args={[Math.max(0.11, point.radius), 18, 18]} />
      <meshStandardMaterial
        color={baseColor}
        emissive={selected || broker ? new Color(baseColor) : new Color('#000000')}
        emissiveIntensity={selected ? 0.72 : broker ? 0.24 : 0}
        roughness={0.38}
        metalness={node.kind === 'person' ? 0.32 : 0.12}
      />
    </mesh>
  );
}

export default function InternalGraphCanvas({
  payload,
  analysis,
  selectedNodeId,
  onSelectNode,
}: Readonly<Props>) {
  const pointByNode = useMemo(
    () => new Map(analysis.layout.map((point) => [point.nodeId, point] as const)),
    [analysis.layout],
  );
  const nodeById = useMemo(
    () => new Map(payload.nodes.map((node) => [node.id, node] as const)),
    [payload.nodes],
  );
  const brokerSet = useMemo(() => new Set(analysis.brokerNodeIds), [analysis.brokerNodeIds]);
  const selected = selectedNodeId ? pointByNode.get(selectedNodeId) ?? null : null;
  const extent = useMemo(() => {
    let maximum = 8;
    for (const point of analysis.layout) {
      maximum = Math.max(maximum, Math.abs(point.x), Math.abs(point.y));
    }
    return maximum;
  }, [analysis.layout]);

  return (
    <View style={styles.shell}>
      <Canvas
        camera={{ position: [0, 0, Math.max(16, extent * 1.35)], fov: 48 }}
        style={styles.canvas}
        onPointerMissed={() => selectedNodeId && onSelectNode(selectedNodeId)}
      >
        <color attach="background" args={['#050812']} />
        <fog attach="fog" args={['#050812', 16, Math.max(35, extent * 4)]} />
        <ambientLight intensity={0.5} />
        <pointLight position={[0, 0, 18]} intensity={1.1} />
        <GraphCameraRig selected={selected} extent={extent} />

        {payload.edges.map((edge) => {
          const left = pointByNode.get(edge.source);
          const right = pointByNode.get(edge.target);
          if (!left || !right) return null;
          return <EdgeMesh key={edge.id} edge={edge} left={left} right={right} />;
        })}

        {analysis.layout.map((point) => {
          const node = nodeById.get(point.nodeId);
          if (!node) return null;
          return (
            <NodeMesh
              key={node.id}
              node={node}
              point={point}
              selected={node.id === selectedNodeId}
              broker={brokerSet.has(node.id)}
              onSelect={() => onSelectNode(node.id)}
            />
          );
        })}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    height: 410,
    overflow: 'hidden',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.18)',
    backgroundColor: '#050812',
  },
  canvas: { flex: 1 },
});
