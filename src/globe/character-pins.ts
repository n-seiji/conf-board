import {
  AnimationMixer,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshStandardMaterial,
  SkinnedMesh,
  Quaternion,
  Vector3,
  type Material,
  type Skeleton,
  type Object3D,
} from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { createPinObject, PIN_HEIGHT } from "./pin-mesh";
import { fnv1a32 } from "./pins";

const MODEL_HEIGHT = 2.844;
const CLIPS = ["Dance", "Wave", "Hop"] as const;
const EXPRESSIONS = ["Neutral", "Smile", "Wink", "Surprised"] as const;
/** Stable pseudo-random variety, independent of the user's chosen body color. */
export const gopherVariation = (id: string) => ({
  clip: CLIPS[fnv1a32(`motion:${id}`) % CLIPS.length]!,
  expression: EXPRESSIONS[fnv1a32(`expression:${id}`) % EXPRESSIONS.length]!,
  phase: fnv1a32(`phase:${id}`) / 0x100000000,
});
type Pin = {
  object: Group;
  color: string;
  model?: Object3D;
  mixer?: AnimationMixer;
  materials: Set<Material>;
  skeletons: Set<Skeleton>;
  remaining: number;
  pendingReaction: boolean;
  variation: { clip: string; expression: string; phase: number };
  body?: Object3D;
  bodyBase: Quaternion;
  lean: number;
  looking: boolean;
  leanOnLook: boolean;
  leanApplied: boolean;
};

export type CharacterOptions = {
  name?: string;
  height?: number;
  clips?: readonly string[];
  sizeMultiplier?: number;
  recolor?: boolean;
  headBone?: string;
  bodyBone?: string;
};

/** One asset load per globe; instances own bones and color, but share geometry. */
export const createGopherPins = (
  load: () => Promise<GLTF> = () =>
    new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/gopher.glb`),
  options: CharacterOptions = {},
) => {
  const pins = new Map<string, Pin>();
  let asset: GLTF | undefined;
  let disposed = false;
  let loadError: unknown;
  const leanRotation = new Quaternion();
  const waistAxis = new Vector3(1, 0, 0);

  const removeLean = (pin: Pin): void => {
    if (pin.body && pin.leanApplied) pin.body.quaternion.copy(pin.bodyBase);
    pin.leanApplied = false;
  };

  const releaseAsset = (gltf: GLTF): void => {
    const geometries = new Set<Mesh["geometry"]>();
    const materials = new Set<Material>();
    gltf.scene.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
  };

  const setExpression = (pin: Pin, expression: string): void => {
    pin.model?.traverse((o) => {
      if (!(o instanceof Mesh) || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
      for (const name of EXPRESSIONS) {
        const index = o.morphTargetDictionary[name];
        if (index !== undefined) o.morphTargetInfluences[index] = name === expression ? 1 : 0;
      }
    });
  };

  const startLoop = (pin: Pin): void => {
    if (!pin.mixer || !asset) return;
    removeLean(pin);
    const clip =
      asset.animations.find((a) => a.name === (pin.looking ? "Wave" : pin.variation.clip)) ??
      asset.animations[0];
    pin.mixer.stopAllAction();
    if (clip) {
      const action = pin.mixer.clipAction(clip).reset().setLoop(LoopRepeat, Infinity).play();
      action.time = pin.variation.phase * clip.duration;
      pin.mixer.update(0);
    }
    setExpression(pin, pin.looking ? "Smile" : pin.variation.expression);
  };

  const react = (id: string): void => {
    const pin = pins.get(id);
    if (!pin) return;
    if (!pin.mixer || !asset) {
      pin.pendingReaction = true;
      return;
    }
    const clip = asset.animations.find((a) => a.name === "Wave");
    if (!clip) return;
    removeLean(pin);
    pin.mixer.stopAllAction();
    pin.mixer.clipAction(clip).reset().setLoop(LoopOnce, 1).play();
    pin.remaining = clip.duration;
    pin.pendingReaction = false;
    setExpression(pin, "Smile");
  };

  const attach = (id: string, pin: Pin): void => {
    if (!asset) return;
    const model = clone(asset.scene);
    model.scale.setScalar(
      (PIN_HEIGHT * (options.sizeMultiplier ?? 1)) / (options.height ?? MODEL_HEIGHT),
    );
    const owned = new Map<Material, Material>();
    model.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const colorize = (m: Material): Material => {
        if (
          options.recolor === false ||
          m.name !== "BodyColor" ||
          !(m instanceof MeshStandardMaterial)
        )
          return m;
        let copy = owned.get(m);
        if (!copy) {
          copy = m.clone();
          (copy as MeshStandardMaterial).color.set(pin.color);
          owned.set(m, copy);
          pin.materials.add(copy);
        }
        return copy;
      };
      o.material = Array.isArray(o.material) ? o.material.map(colorize) : colorize(o.material);
      if (o instanceof SkinnedMesh) {
        o.frustumCulled = false;
        pin.skeletons.add(o.skeleton);
      }
    });
    pin.object.clear();
    pin.object.add(model);
    pin.model = model;
    const body = model.getObjectByName(options.bodyBone ?? "Body");
    if (body?.type === "Bone") pin.body = body;
    pin.mixer = new AnimationMixer(model);
    startLoop(pin);
    if (pin.pendingReaction) react(id);
  };

  const ready = load()
    .then((gltf) => {
      if (disposed) {
        releaseAsset(gltf);
        return;
      }
      asset = gltf;
      for (const [id, pin] of pins) attach(id, pin);
    })
    .catch((error: unknown) => {
      loadError = error;
    });

  const remove = (id: string): void => {
    const pin = pins.get(id);
    if (!pin) return;
    pin.mixer?.stopAllAction();
    if (pin.model) pin.mixer?.uncacheRoot(pin.model);
    pin.materials.forEach((m) => m.dispose());
    pin.skeletons.forEach((s) => s.dispose());
    pin.object.removeFromParent();
    pin.object.clear();
    pins.delete(id);
  };

  return {
    ready,
    get error() {
      return loadError;
    },
    create(id: string, colorId: Parameters<typeof createPinObject>[0], color: string): Group {
      if (disposed) throw new Error("Gopher pins already disposed");
      const existing = pins.get(id);
      if (existing) return existing.object;
      const object = new Group();
      object.name = options.name ?? "gopher-pin";
      object.add(createPinObject(colorId, color));
      const pin: Pin = {
        object,
        color,
        materials: new Set(),
        skeletons: new Set(),
        remaining: 0,
        pendingReaction: false,
        variation: {
          ...gopherVariation(id),
          ...(options.clips
            ? { clip: options.clips[fnv1a32(`motion:${id}`) % options.clips.length]! }
            : {}),
        },
        bodyBase: new Quaternion(),
        lean: 0,
        looking: false,
        leanOnLook: true,
        leanApplied: false,
      };
      pins.set(id, pin);
      if (asset) attach(id, pin);
      return object;
    },
    react,
    lookUp(id: string | null, lean = true): void {
      for (const [pinId, pin] of pins) {
        const looking = pinId === id;
        if (pin.looking === looking && pin.leanOnLook === lean) continue;
        pin.looking = looking;
        pin.leanOnLook = lean;
        pin.remaining = 0;
        startLoop(pin);
      }
    },
    headPosition(id: string, target = new Vector3()): Vector3 | null {
      const pin = pins.get(id);
      if (!pin) return null;
      const head = options.headBone ? pin.model?.getObjectByName(options.headBone) : undefined;
      if (head) return head.localToWorld(target.set(0, 1.25, 0.2));
      // Forehead anchor follows the Body bone, including Hop, Dance and the waist lean.
      if (pin.body) return pin.body.localToWorld(target.set(0, 2.45, 0.25));
      return pin.object.localToWorld(target.set(0, PIN_HEIGHT * 0.94, 0));
    },
    update(dt: number): void {
      for (const pin of pins.values()) {
        if (!pin.mixer) continue;
        const step = Math.min(Math.max(dt, 0), 0.1);
        removeLean(pin);
        pin.mixer.update(step);
        if (pin.remaining > 0) {
          pin.remaining -= step;
          if (pin.remaining <= 0) startLoop(pin);
        }
        pin.lean +=
          ((pin.looking && pin.leanOnLook ? 1 : 0) - pin.lean) * (1 - Math.exp(-step * 7));
        if (pin.body) {
          pin.bodyBase.copy(pin.body.quaternion);
          leanRotation.setFromAxisAngle(waistAxis, (-Math.PI / 3) * pin.lean);
          pin.body.quaternion.premultiply(leanRotation);
          pin.leanApplied = true;
        }
      }
    },
    remove,
    dispose(): void {
      disposed = true;
      for (const id of pins.keys()) remove(id);
      if (asset) {
        releaseAsset(asset);
        asset = undefined;
      }
    },
  };
};
