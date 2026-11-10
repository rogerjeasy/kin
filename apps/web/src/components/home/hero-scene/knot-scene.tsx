"use client";

import { Environment, Lightformer, Sparkles, useTexture } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, type RefObject } from "react";
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Curve,
  Float32BufferAttribute,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
  type Group,
  type Points,
  type Texture,
} from "three";

import { lobeMix, trefoil3d } from "./knot-curve";

/*
 * The scene always sits on the ink band, so it takes the dark theme's colours
 * (globals.css): one share colour per sibling's lobe, and gold for light.
 */
const SHARE_COLOURS: readonly [Color, Color, Color] = [new Color("#5b93f0"), new Color("#e08a3a"), new Color("#c05cab")];
const GOLD = "#f0c27b";
const KNOT_SCALE = 0.86;
const TUBE_RADIUS = 0.12;
const SPARKS = 140;
const SPARK_SPEED = 0.035;

class KnotCurve extends Curve<Vector3> {
  // three declares Curve's constructor protected; this one is public.
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor() {
    super();
  }

  override getPoint(t: number, target = new Vector3()): Vector3 {
    const [x, y, z] = trefoil3d(t);
    return target.set(x * KNOT_SCALE, y * KNOT_SCALE, z * KNOT_SCALE);
  }
}

/** A soft round light, drawn once, for sparks and halos. */
function glowTexture(): Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.25, "rgba(255,236,200,0.75)");
    gradient.addColorStop(1, "rgba(255,220,160,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(canvas);
}

/** The tube, coloured lobe by lobe in the siblings' share colours. */
function knotGeometry(curve: KnotCurve): BufferGeometry {
  const tubular = 360;
  const radial = 20;
  const geometry = new TubeGeometry(curve, tubular, TUBE_RADIUS, radial, true);
  const colours: number[] = [];
  const colour = new Color();
  for (let i = 0; i <= tubular; i++) {
    const { from, to, mix } = lobeMix(i / tubular);
    colour.copy(SHARE_COLOURS[from]).lerp(SHARE_COLOURS[to], mix);
    for (let j = 0; j <= radial; j++) colours.push(colour.r, colour.g, colour.b);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  return geometry;
}

type Pointer = { x: number; y: number };

/** Gold sparks that travel along the line: the family's money moving through the circle. */
function Sparks({ curve, glow }: { curve: KnotCurve; glow: Texture }) {
  const points = useRef<Points>(null);
  const seeds = useMemo(
    () => Array.from({ length: SPARKS }, (_, index) => ({ offset: index / SPARKS + Math.random() * 0.01, drift: (Math.random() - 0.5) * 0.18, lift: (Math.random() - 0.5) * 0.18 })),
    [],
  );
  const positions = useMemo(() => new Float32Array(SPARKS * 3), []);
  const point = useMemo(() => new Vector3(), []);

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    seeds.forEach((seed, index) => {
      curve.getPointAt((seed.offset + time * SPARK_SPEED) % 1, point);
      positions[index * 3] = point.x + seed.drift;
      positions[index * 3 + 1] = point.y + seed.lift;
      positions[index * 3 + 2] = point.z + seed.drift * 0.5;
    });
    const attribute = points.current?.geometry.getAttribute("position");
    if (attribute) attribute.needsUpdate = true;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial map={glow} color={GOLD} size={0.2} sizeAttenuation transparent depthWrite={false} blending={AdditiveBlending} />
    </points>
  );
}

/** Rose at the centre, in a ring of gold, facing whoever looks. */
function Parent({ portrait, glow }: { portrait: string; glow: Texture }) {
  const texture = useTexture(portrait);
  texture.colorSpace = SRGBColorSpace;

  // A little in front of the knot's middle, so the strands pass behind her more than across her.
  return (
    <group position={[0, 0, 0.55]}>
      <sprite scale={3.4}>
        <spriteMaterial map={glow} color={GOLD} transparent opacity={0.45} depthWrite={false} blending={AdditiveBlending} />
      </sprite>
      <mesh>
        <circleGeometry args={[0.74, 64]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      <mesh>
        <torusGeometry args={[0.79, 0.035, 24, 128]} />
        <meshStandardMaterial color={GOLD} metalness={0.9} roughness={0.2} emissive={GOLD} emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

function Knot({ portrait, pointer }: { portrait: string; pointer: RefObject<Pointer> }) {
  const curve = useMemo(() => new KnotCurve(), []);
  const geometry = useMemo(() => knotGeometry(curve), [curve]);
  const halo = useMemo(() => new TubeGeometry(curve, 260, TUBE_RADIUS * 3.2, 12, true), [curve]);
  const glow = useMemo(() => glowTexture(), []);
  const knot = useRef<Group>(null);
  const tilt = useRef<Group>(null);

  useEffect(() => () => [geometry, halo, glow].forEach((item) => item.dispose()), [geometry, halo, glow]);

  useFrame(({ clock }, delta) => {
    const time = clock.elapsedTime;
    const knotGroup = knot.current;
    const tiltGroup = tilt.current;
    if (!knotGroup || !tiltGroup) return;
    knotGroup.rotation.z = -time * 0.12;
    // Opens out of the centre over the first moments.
    const grow = Math.min(1, 0.55 + time * 0.35);
    knotGroup.scale.setScalar(knotGroup.scale.x + (grow - knotGroup.scale.x) * Math.min(1, delta * 4));
    const target = pointer.current;
    tiltGroup.rotation.y += (target.x * 0.22 + Math.sin(time * 0.3) * 0.05 - tiltGroup.rotation.y) * Math.min(1, delta * 2.5);
    tiltGroup.rotation.x += (-target.y * 0.16 + Math.cos(time * 0.25) * 0.04 - tiltGroup.rotation.x) * Math.min(1, delta * 2.5);
    tiltGroup.position.y = Math.sin(time * 0.6) * 0.06;
  });

  return (
    <group ref={tilt}>
      <group ref={knot} scale={0.55}>
        <mesh geometry={geometry}>
          <meshStandardMaterial vertexColors metalness={0.5} roughness={0.18} emissive={GOLD} emissiveIntensity={0.06} />
        </mesh>
        <mesh geometry={halo}>
          <meshBasicMaterial color={GOLD} transparent opacity={0.05} depthWrite={false} blending={AdditiveBlending} />
        </mesh>
        <Sparks curve={curve} glow={glow} />
      </group>
      <Suspense fallback={null}>
        <Parent portrait={portrait} glow={glow} />
      </Suspense>
    </group>
  );
}

export type KnotSceneProps = {
  /** The parent's portrait, a square image URL. */
  portrait: string;
  /** False while the scene is scrolled out of view, so it costs nothing. */
  running: boolean;
  onReady: () => void;
};

/**
 * Mounted only when the reader allows motion (HeroVisual keeps the still
 * poster otherwise), so everything here moves.
 *
 * The Kin knot as light: three siblings' shares woven into one line around
 * their parent, with the family's money travelling along it as sparks.
 */
export default function KnotScene({ portrait, running, onReady }: KnotSceneProps) {
  const pointer = useRef<Pointer>({ x: 0, y: 0 });

  useEffect(() => {
    const move = (event: PointerEvent) => {
      pointer.current = { x: (event.clientX / window.innerWidth) * 2 - 1, y: (event.clientY / window.innerHeight) * 2 - 1 };
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  return (
    <Canvas
      aria-hidden="true"
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 8.4], fov: 38 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      frameloop={running ? "always" : "never"}
      onCreated={() => requestAnimationFrame(onReady)}
      className="absolute! inset-0"
    >
      <ambientLight intensity={0.35} />
      <pointLight position={[0, 0, 0.6]} color={GOLD} intensity={9} distance={7} />
      <directionalLight position={[3, 4, 5]} intensity={1.1} />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2.2} color="#fff3dd" position={[0, 4, -1]} scale={[10, 2, 1]} />
        <Lightformer form="rect" intensity={1.6} color={GOLD} position={[-5, 0, 2]} scale={[2, 8, 1]} />
        <Lightformer form="rect" intensity={1.3} color="#5b93f0" position={[5, -1, 2]} scale={[2, 8, 1]} />
      </Environment>
      <Knot portrait={portrait} pointer={pointer} />
      <Sparkles count={46} scale={[7.5, 7.5, 3]} size={2.4} speed={0.3} opacity={0.55} color={GOLD} />
    </Canvas>
  );
}
