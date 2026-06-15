import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber/native';
import * as FileSystem from 'expo-file-system/legacy';
import UPNG from 'upng-js';
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  LinearFilter,
  Material,
  Mesh,
  MeshBasicMaterial,
  RGBAFormat,
  Texture,
  UVMapping,
  Uint16BufferAttribute,
  Uint32BufferAttribute,
} from 'three';
import type { ProximitySignal } from '../presence/PresenceEngine';
import { colorForBucket, sizeForBucket } from './fieldConstants';

type AvatarTarget = ProximitySignal & { bucket?: number };

function positionForSignal(signal: AvatarTarget): [number, number, number] {
  const seed = signal.targetId
    .split('')
    .reduce((acc, ch) => acc + ch.codePointAt(0)!, 0);
  const angle = (seed % 360) * (Math.PI / 180);
  const radius = Math.max(1, signal.distanceFeet / 4);
  return [Math.cos(angle) * radius, Math.sin(angle * 0.7) * 1.5, Math.sin(angle) * radius];
}

// ---------------------------------------------------------------------------
// glTF (binary) parser — three's GLTFLoader on React Native can't decode
// embedded textures because there's no DOM Image. We crack the glb ourselves,
// pull POSITION/UV/INDEX/NORMAL from the BIN chunk, drop the embedded image
// to disk so expo-asset can hand it to expo-gl as a native texture, and
// hand back ready-to-render geometry + material.
// ---------------------------------------------------------------------------

const GLB_MAGIC = 0x46546c67; // 'glTF'
const COMP_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

interface GltfAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  type: keyof typeof TYPE_COUNT;
  count: number;
}
interface GltfBufferView { buffer: number; byteOffset: number; byteLength: number }
interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
}
interface GltfImage { bufferView?: number; mimeType?: string; uri?: string }
interface GltfTexture { source: number }
interface GltfMaterial {
  pbrMetallicRoughness?: { baseColorTexture?: { index: number } };
}
interface GltfDoc {
  accessors: GltfAccessor[];
  bufferViews: GltfBufferView[];
  meshes: { primitives: GltfPrimitive[] }[];
  images?: GltfImage[];
  textures?: GltfTexture[];
  materials?: GltfMaterial[];
}

// Persistent cache for downsampled RGBA so we don't re-decode the 4096²
// PNG (~24 s on-device) on every cold start.
const TEX_SIZE = 256;
const TEX_BYTES = TEX_SIZE * TEX_SIZE * 4;

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function texCachePath(url: string): string {
  return `${FileSystem.cacheDirectory}avatar_tex_${djb2(url)}.bin`;
}

function base64ToBytes(b64: string): Uint8Array {
  // eslint-disable-next-line no-undef
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  // eslint-disable-next-line no-undef
  return btoa(s);
}

async function readCachedTexture(url: string): Promise<Uint8Array | null> {
  try {
    const path = texCachePath(url);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const b64 = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = base64ToBytes(b64);
    return bytes.length === TEX_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

async function writeCachedTexture(url: string, bytes: Uint8Array): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(texCachePath(url), bytesToBase64(bytes), {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch {
    // Best-effort; cache failures shouldn't break the render.
  }
}

// Cheap nearest-neighbour downsample of an RGBA pixel grid. Hunyuan ships
// 4096² textures (67 MB resident). Even at 512² that's a 64× memory cut and
// quite enough mesh detail at the size we render at.
function downsampleRGBA(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8Array {
  const out = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.floor((y * srcH) / dstH);
    for (let x = 0; x < dstW; x++) {
      const sx = Math.floor((x * srcW) / dstW);
      const sIdx = (sy * srcW + sx) * 4;
      const dIdx = (y * dstW + x) * 4;
      out[dIdx + 0] = src[sIdx + 0];
      out[dIdx + 1] = src[sIdx + 1];
      out[dIdx + 2] = src[sIdx + 2];
      out[dIdx + 3] = src[sIdx + 3];
    }
  }
  return out;
}

async function loadTexturedGlb(url: string): Promise<{
  geometry: BufferGeometry;
  material: Material;
}> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a glb');
  const jsonLen = dv.getUint32(12, true);
  const jsonStr = new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen));
  const gltf = JSON.parse(jsonStr) as GltfDoc;
  // [12-byte header][8-byte JSON chunk header][jsonLen JSON][8-byte BIN chunk header][BIN]
  const binStart = 20 + jsonLen + 8;

  const accessor = (idx: number): ArrayBufferView & { length: number } => {
    const acc = gltf.accessors[idx];
    const bv = gltf.bufferViews[acc.bufferView];
    const off = binStart + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const total = acc.count * TYPE_COUNT[acc.type];
    switch (acc.componentType) {
      case 5126: return new Float32Array(buf, off, total);
      case 5123: return new Uint16Array(buf, off, total);
      case 5125: return new Uint32Array(buf, off, total);
      case 5121: return new Uint8Array(buf, off, total);
      default: throw new Error(`unsupported componentType ${acc.componentType}`);
    }
  };

  const prim = gltf.meshes[0].primitives[0];
  const positions = accessor(prim.attributes.POSITION) as Float32Array;
  const normals = prim.attributes.NORMAL != null
    ? (accessor(prim.attributes.NORMAL) as Float32Array)
    : null;
  const uvs = prim.attributes.TEXCOORD_0 != null
    ? (accessor(prim.attributes.TEXCOORD_0) as Float32Array)
    : null;
  const colors = prim.attributes.COLOR_0 != null
    ? accessor(prim.attributes.COLOR_0)
    : null;
  const indices = prim.indices != null ? accessor(prim.indices) : null;

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  if (normals) geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  if (uvs) geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  if (colors) {
    // COLOR_0 ships as uint8 normalized (VEC3/4) or float. Three reads it raw
    // from a BufferAttribute, so float-ify uint8 ourselves.
    const itemSize = gltf.accessors[prim.attributes.COLOR_0].type === 'VEC4' ? 4 : 3;
    if (colors instanceof Uint8Array) {
      const f = new Float32Array(colors.length);
      for (let i = 0; i < colors.length; i++) f[i] = colors[i] / 255;
      geometry.setAttribute('color', new Float32BufferAttribute(f, itemSize));
    } else {
      geometry.setAttribute(
        'color',
        new BufferAttribute(colors as Float32Array, itemSize)
      );
    }
  }
  if (indices) {
    if (indices instanceof Uint32Array) {
      geometry.setIndex(new Uint32BufferAttribute(indices, 1));
    } else {
      geometry.setIndex(new Uint16BufferAttribute(indices as Uint16Array, 1));
    }
  }
  if (!normals) geometry.computeVertexNormals();

  // Texture extraction — decode the embedded PNG in pure JS, downsample, and
  // hand the raw RGBA bytes to DataTexture. DataTexture's native expo-gl path
  // doesn't need a DOM Image, which is what blocked the GLTFLoader route.
  // The decode step takes ~24 s on-device, so check the on-disk cache first.
  let texture: Texture | null = null;
  const matInfo = prim.material != null ? gltf.materials?.[prim.material] : undefined;
  const baseColor = matInfo?.pbrMetallicRoughness?.baseColorTexture;
  if (baseColor && gltf.textures && gltf.images) {
    let rgba = await readCachedTexture(url);
    if (!rgba) {
      const img = gltf.images[gltf.textures[baseColor.index].source];
      if (img.bufferView != null && img.mimeType === 'image/png') {
        const bv = gltf.bufferViews[img.bufferView];
        const imgBytes = new Uint8Array(buf, binStart + bv.byteOffset, bv.byteLength);
        const decoded = UPNG.decode(
          imgBytes.buffer.slice(
            imgBytes.byteOffset,
            imgBytes.byteOffset + imgBytes.byteLength
          )
        );
        const rgbaList = UPNG.toRGBA8(decoded);
        const fullRgba = new Uint8Array(rgbaList[0]);
        rgba = downsampleRGBA(
          fullRgba,
          decoded.width,
          decoded.height,
          TEX_SIZE,
          TEX_SIZE
        );
        // Fire-and-forget — next cold start reads back instead of decoding.
        writeCachedTexture(url, rgba);
      }
    }
    if (rgba) {
      texture = new DataTexture(rgba, TEX_SIZE, TEX_SIZE, RGBAFormat);
      texture.magFilter = LinearFilter;
      texture.minFilter = LinearFilter;
      // DataTexture's default origin is bottom-left in WebGL; glb UVs flip Y.
      texture.flipY = false;
      texture.needsUpdate = true;
    }
  }

  let material: Material;
  if (texture) {
    material = new MeshBasicMaterial({ map: texture, side: DoubleSide });
  } else if (colors) {
    material = new MeshBasicMaterial({
      color: '#ffffff',
      vertexColors: true,
      side: DoubleSide,
    });
  } else {
    material = new MeshBasicMaterial({ color: '#888888', side: DoubleSide });
  }

  return { geometry, material };
}

// Cache compiled geometry+material by URL so a remount or upstream re-render
// doesn't re-decode the same 14 MB glb every poll cycle.
const glbCache = new Map<
  string,
  Promise<{ geometry: BufferGeometry; material: Material }>
>();

function useTexturedGlb(url: string | null | undefined): {
  data: { geometry: BufferGeometry; material: Material } | null;
  error: string | null;
} {
  const [data, setData] = useState<{ geometry: BufferGeometry; material: Material } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    // Don't clear data — leave the last good render up until the new one
    // completes, so polling doesn't flash the fallback sphere every 5s.
    setError(null);
    let promise = glbCache.get(url);
    if (!promise) {
      promise = loadTexturedGlb(url);
      glbCache.set(url, promise);
    }
    promise.then(
      (out) => { if (!cancelled) setData(out); },
      (e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[AvatarRenderer] glb load failed', url, msg);
        glbCache.delete(url);
        if (!cancelled) setError(msg);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { data, error };
}

interface Props {
  avatar: AvatarTarget;
  onTap?: (avatar: AvatarTarget) => void;
}

export default function AvatarRenderer({ avatar, onTap }: Readonly<Props>) {
  const position = useMemo(
    () => positionForSignal(avatar),
    [avatar.targetId, avatar.distanceFeet]
  );
  const color = useMemo(
    () => colorForBucket(avatar.bucket ?? 0, avatar.targetPremium),
    [avatar.bucket, avatar.targetPremium]
  );
  const size = useMemo(() => sizeForBucket(avatar.bucket ?? 0), [avatar.bucket]);
  const { data } = useTexturedGlb(avatar.targetAvatarUrl3d ?? null);

  const handleClick = (e: any) => {
    e.stopPropagation();
    onTap?.(avatar);
  };

  // Idle motion — each avatar bobs at its own offset phase (seeded by targetId)
  // and slowly rotates around Y so we see depth even when GPS isn't ticking.
  const groupRef = useRef<{ position: { y: number }; rotation: { y: number } } | null>(null);
  const phase = useMemo(
    () =>
      avatar.targetId
        .split('')
        .reduce((acc, ch) => acc + ch.codePointAt(0)!, 0) % 100,
    [avatar.targetId]
  );
  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    g.position.y = position[1] + Math.sin(t * 0.9 + phase) * 0.18;
    g.rotation.y = Math.sin(t * 0.3 + phase) * 0.4;
  });

  // Stick body sized off the head so heads stay visually anchored to a body
  // regardless of bucket. All cylinders use the avatar's bucket colour so the
  // figure reads as one creature, not a head wearing a coathanger.
  const bodyScale = size * 1.8;
  const limbColor = color;

  return (
    <group ref={groupRef as any} position={position} onClick={handleClick}>
      {data ? (
        <mesh
          geometry={data.geometry}
          material={data.material}
          scale={[size * 1.8, size * 1.8, size * 1.8]}
          // Hunyuan-3D-3.1 outputs Y-up with face pointing +Y. Tilt the head
          // forward 90° so the face points at the camera (toward +Z).
          rotation={[Math.PI / 2, 0, 0]}
        />
      ) : (
        <mesh>
          <sphereGeometry args={[size, 24, 24]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={avatar.targetPremium ? 1.0 : 0.5}
          />
        </mesh>
      )}
      <StickBody scale={bodyScale} color={limbColor} />
    </group>
  );
}

interface StickBodyProps {
  scale: number;
  color: string;
}

function StickBody({ scale, color }: Readonly<StickBodyProps>) {
  // Coordinates are pre-scaled here so we can describe the figure in head-units
  // (head is ~1 unit tall), then scale the whole group at the end.
  const torsoLen = 0.9;
  const armLen = 0.8;
  const legLen = 1.0;
  const limbRadius = 0.045;
  // Hunyuan's head spans y ∈ [0, 1.08] in glb space (chin at 0, crown at top).
  // After the head's X-rotation, the chin sits at world y=0 — that's where the
  // torso top wants to be so the figure reads as one continuous body.
  const torsoTop = 0;
  const torsoBottom = torsoTop - torsoLen;

  return (
    <group scale={[scale, scale, scale]}>
      {/* Torso */}
      <mesh position={[0, torsoTop - torsoLen / 2, 0]}>
        <cylinderGeometry args={[limbRadius, limbRadius, torsoLen, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
      </mesh>
      {/* Arms — splayed slightly outward from a shoulder near torso top. */}
      {([-1, 1] as const).map((sign) => (
        <mesh
          key={`arm-${sign}`}
          position={[sign * 0.35, torsoTop - 0.05, 0]}
          rotation={[0, 0, sign * Math.PI / 2.6]}
        >
          <cylinderGeometry args={[limbRadius, limbRadius, armLen, 8]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
        </mesh>
      ))}
      {/* Legs — fork from torso bottom. */}
      {([-1, 1] as const).map((sign) => (
        <mesh
          key={`leg-${sign}`}
          position={[sign * 0.18, torsoBottom - legLen / 2, 0]}
          rotation={[0, 0, sign * 0.12]}
        >
          <cylinderGeometry args={[limbRadius, limbRadius, legLen, 8]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
        </mesh>
      ))}
    </group>
  );
}
