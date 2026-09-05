import {
  AdditiveBlending,
  Color,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { pinColorHex } from "../shared/colors";
import type { Post } from "../shared/types";
import { bindGlobeInteraction, createIdleResume, nearestPinWithin } from "./interaction";
import { createPinObject, orientPinToNormal } from "./pin-mesh";
import { pinLatLon } from "./pins";
import { DEFAULT_FOCUS_DURATION_MS, GlobeRig, TILT_DEG, latLonToVector3 } from "./rig";
import { createWorldTexture } from "./world-texture";

export { latLonToVector3, TILT_DEG, frontFacingAngle } from "./rig";

const SPHERE_RADIUS = 1;
/** 着地済みピンの先端 (テクスチャ下端) が接する球面からの距離。 */
const RIPPLE_SURFACE_OFFSET = 1.002;
/** 描画するピンの上限。display 側の snapshot スライスにも同じ値を使う (`MAX_PIN_MESHES` を import)。 */
export const MAX_PIN_MESHES = 200;
const CAMERA_FOV = 25;
const RIPPLE_DURATION_MS = 900;
const RIPPLE_INNER_START = 0.04;
const RIPPLE_OUTER_START = 0.3;
/** 外側の波紋リングを内側より遅らせて開始する時間 (ms)。同時開始だと重なって1本に見えるため。 */
const RIPPLE_OUTER_DELAY_MS = 150;
/** 着地演出: 上から落ちてくる分の追加オフセット (球面からの距離)。focusPin 完了時に 0 まで縮む。 */
const LANDING_START_EXTRA = 0.25;
const LANDING_DURATION_MS = 400;
/**
 * 法線とカメラ方向の内積がこれ未満なら裏側とみなし非表示にする (吹き出し・リーダー線用)。
 * 仕様上の裏側判定は 0.05 (ほぼ真横) だが、その値では球の縁 (limb) 付近で
 * dot が閾値をまたいで前後するフレームが生じ、吹き出し・線が高頻度でちらつく。
 * 0.15 まで早めに切ることでちらつきを抑える。ピン自体は 3D メッシュのため球の
 * depth buffer に自然に隠れ、この閾値は吹き出し・リーダー線の表示判定にのみ影響する。
 */
const BACKSIDE_DOT_THRESHOLD = 0.15;

const easeInCubic = (t: number): number => t ** 3;

type Ripple = Readonly<{
  meshes: readonly [Mesh, Mesh];
  startedAt: number;
}>;

type Landing = Readonly<{
  startedAt: number;
}>;

type PinMeta = {
  ripple: Ripple | null;
  landing: Landing | null;
};

export type GlobeOptions = Readonly<{
  /** 到着画面の画像保存用に、canvas から drawImage できるよう保持バッファを有効にする。 */
  preserveDrawingBuffer?: boolean;
  /** 自動回転するかどうか (デフォルト true)。 */
  autoRotate?: boolean;
  /**
   * ドラッグ/ホイールでの手動回転とピンのクリック選択を有効にするかどうか (デフォルト false)。
   * スマホの到着画面など、演出専用で操作させたくない画面では false のままにする。
   */
  interactive?: boolean;
}>;

export type ProjectedPin = Readonly<{
  x: number;
  y: number;
  visible: boolean;
  /** カメラ方向との内積 (1: 正面中央、0: 真横、負値: 裏側)。リフィル候補の残り表示時間の見積もりに使う。 */
  dot: number;
}>;

export type AddPinOptions = Readonly<{
  /**
   * true (既定値): 新規投稿として扱う。初期位置を球面よりわずかに浮かせて配置し、
   * `focusPin` が完了した瞬間に「上から落ちて刺さる」着地アニメーション (400ms ease-in) と
   * 波紋を再生する。
   * false: snapshot 復元用。初期位置から浮かせず、着地アニメーション無しで即座に最終位置へ
   * 静止表示する。
   */
  animate?: boolean;
}>;

export type GlobeHandle = Readonly<{
  addPin: (post: Pick<Post, "id" | "countryId" | "color">, options?: AddPinOptions) => void;
  removePin: (id: string) => void;
  clear: () => void;
  setRotationTo: (lat: number, lon: number) => void;
  /**
   * 指定したピンの経度が正面 (カメラ方向) に来るまで自転を ease-out で回し、
   * 正面に到達した時点で着地アニメーション・波紋を再生して `onArrived` を呼ぶ。
   * 以後は通常の自転に戻る。snapshot 復元済みのピンには使わない (新規投稿の着地演出専用)。
   */
  focusPin: (id: string, durationMs?: number, onArrived?: () => void) => void;
  dispose: () => void;
  onFrame: (cb: (elapsedSec: number) => void) => () => void;
  /** id のピンの画面座標 (コンテナ基準 px) と、裏側で非表示かどうか。 */
  projectPin: (id: string) => ProjectedPin | null;
  /** 地球を描画しているコンテナ要素の画面上の矩形 (吹き出しの列位置決めに使う)。 */
  getBounds: () => DOMRect;
  /**
   * 1 フレーム分を同期的にレンダリングする。スマホの到着画面で保存画像を作る際、
   * `drawImage` の直前に呼んで最新の見た目を canvas に確定させるために使う
   * (`preserveDrawingBuffer: true` と併用する)。
   */
  render: () => void;
  /** 自動回転の有効/無効を外部から切り替える (手動操作中の一時停止・アイドル復帰に使う)。 */
  setAutoRotate: (enabled: boolean) => void;
  /** ピンがクリック/タップで選ばれるたびに呼ばれる購読を登録する。解除関数を返す。 */
  onPinPicked: (cb: (id: string) => void) => () => void;
}>;

/** 手動操作が止んでから自転を再開するまでのアイドル時間 (ms)。 */
const IDLE_RESUME_MS = 5000;
/** ピンのクリック/タップ判定半径 (px)。タッチでも押しやすいよう、実サイズより広めに取る。 */
const PICK_RADIUS_PX = 18;

const createRippleMeshes = (): readonly [Mesh, Mesh] => {
  const makeRing = (opacity: number): Mesh => {
    const geometry = new RingGeometry(RIPPLE_INNER_START, RIPPLE_INNER_START + 0.02, 32);
    const material = new MeshBasicMaterial({
      color: new Color("#ffffff"),
      transparent: true,
      opacity,
      side: DoubleSide,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    return new Mesh(geometry, material);
  };
  return [makeRing(1), makeRing(0.6)];
};

/**
 * 地球モジュール。ディスプレイ画面とスマホ到着画面で共用する。
 * シーングラフと回転の数学は `GlobeRig` (WebGL 無しでテスト可能) に切り出し、ここでは
 * 実際の Three.js レンダリング (テクスチャ・ピン Mesh・波紋・カメラ) と結びつけるだけにする。
 */
export const createGlobe = (container: HTMLElement, options: GlobeOptions = {}): GlobeHandle => {
  const scene = new Scene();
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  camera.position.set(0, 0, 5);

  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  const rig = new GlobeRig(TILT_DEG);
  rig.autoRotate = options.autoRotate ?? true;
  scene.add(rig.tiltGroup);

  const sphereGeometry = new SphereGeometry(SPHERE_RADIUS, 64, 64);
  const sphereMaterial = new MeshBasicMaterial({ map: createWorldTexture() });
  const sphereMesh = new Mesh(sphereGeometry, sphereMaterial);
  rig.spinGroup.add(sphereMesh);

  // ピンを 3D メッシュ化したことで陰影が付くようにする (球自体は MeshBasicMaterial なので見た目は変わらない)。
  const hemisphereLight = new HemisphereLight("#ffffff", "#c8f0dc", 1.2);
  const directionalLight = new DirectionalLight("#ffffff", 1.0);
  directionalLight.position.set(2, 3, 4);
  scene.add(hemisphereLight, directionalLight);

  const pinMeta = new Map<string, PinMeta>();
  const pinOrder: string[] = [];
  const frameCallbacks = new Set<(elapsedSec: number) => void>();

  const resize = (): void => {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    // updateStyle (第3引数) を省略 (既定 true) して canvas.style.width/height も設定する。
    // false だと backing buffer (width/height 属性) だけ DPR 倍のサイズになり、CSS サイズが
    // 追従しないため canvas が devicePixelRatio 倍 (例: 2倍) で表示されてしまう。
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  const removePinInternal = (id: string): void => {
    const meta = pinMeta.get(id);
    // ピンのジオメトリ・マテリアルは colorId ごとに共有しているため dispose しない
    // (rig.removePin が pinsGroup から remove するだけで十分)。
    rig.removePin(id);
    if (meta?.ripple) {
      for (const m of meta.ripple.meshes) {
        rig.pinsGroup.remove(m);
        m.geometry.dispose();
        (m.material as MeshBasicMaterial).dispose();
      }
    }
    pinMeta.delete(id);
    const idx = pinOrder.indexOf(id);
    if (idx >= 0) pinOrder.splice(idx, 1);
  };

  const setPinDistance = (object: Object3D, dir: Vector3, distance: number): void => {
    object.position.copy(dir).multiplyScalar(distance);
  };

  const addPin = (
    post: Pick<Post, "id" | "countryId" | "color">,
    addOptions: AddPinOptions = {},
  ): void => {
    if (rig.getPin(post.id)) return;
    const [lat, lon] = pinLatLon(post);
    const dir = latLonToVector3(lat, lon, 1);
    const willAnimate = addOptions.animate ?? true;

    const object = createPinObject(post.color, pinColorHex(post.color));
    orientPinToNormal(object, dir);
    const restDistance = SPHERE_RADIUS;
    setPinDistance(object, dir, restDistance + (willAnimate ? LANDING_START_EXTRA : 0));

    rig.addPin(post.id, object, dir);
    pinMeta.set(post.id, { ripple: null, landing: null });
    pinOrder.push(post.id);
    while (pinOrder.length > MAX_PIN_MESHES) {
      const oldest = pinOrder[0];
      if (oldest) removePinInternal(oldest);
    }
  };

  const removePin = (id: string): void => removePinInternal(id);

  const clear = (): void => {
    for (const id of [...pinOrder]) removePinInternal(id);
  };

  const setRotationTo = (lat: number, lon: number): void => {
    rig.setRotationTo(lat, lon);
  };

  const triggerRipple = (id: string): void => {
    const pin = rig.getPin(id);
    const meta = pinMeta.get(id);
    if (!pin || !meta) return;
    const [inner, outer] = createRippleMeshes();
    const ripplePosition = pin.localDir.clone().multiplyScalar(RIPPLE_SURFACE_OFFSET);
    for (const ring of [inner, outer]) {
      ring.position.copy(ripplePosition);
      ring.lookAt(pin.localDir.clone().multiplyScalar(2));
      rig.pinsGroup.add(ring);
    }
    meta.ripple = { meshes: [inner, outer], startedAt: performance.now() };
  };

  const triggerLanding = (id: string): void => {
    const meta = pinMeta.get(id);
    if (!meta) return;
    meta.landing = { startedAt: performance.now() };
  };

  const focusPin = (
    id: string,
    durationMs = DEFAULT_FOCUS_DURATION_MS,
    onArrived?: () => void,
  ): void => {
    rig.focusPin(id, performance.now(), durationMs, () => {
      triggerLanding(id);
      triggerRipple(id);
      onArrived?.();
    });
  };

  const updateLanding = (now: number): void => {
    for (const [id, meta] of pinMeta) {
      if (!meta.landing) continue;
      const pin = rig.getPin(id);
      if (!pin) {
        meta.landing = null;
        continue;
      }
      const t = Math.min(1, (now - meta.landing.startedAt) / LANDING_DURATION_MS);
      const extra = LANDING_START_EXTRA * (1 - easeInCubic(t));
      setPinDistance(pin.object, pin.localDir, SPHERE_RADIUS + extra);
      if (t >= 1) meta.landing = null;
    }
  };

  /** 波紋 1 本の見た目 (スケール・opacity) を t (0=開始, 1=終了, 負値=開始前) に応じて適用する。 */
  const applyRippleState = (mesh: Mesh, t: number): void => {
    const material = mesh.material as MeshBasicMaterial;
    if (t < 0) {
      // まだ開始時刻に達していない (外側リングの遅延中): 見えない状態にしておく。
      material.opacity = 0;
      return;
    }
    const clamped = Math.min(1, t);
    const scale = RIPPLE_INNER_START + (RIPPLE_OUTER_START - RIPPLE_INNER_START) * clamped;
    mesh.scale.setScalar(scale / RIPPLE_INNER_START);
    material.opacity = (1 - clamped) * 0.8;
  };

  const updateRipples = (now: number): void => {
    for (const meta of pinMeta.values()) {
      if (!meta.ripple) continue;
      const [inner, outer] = meta.ripple.meshes;
      const innerT = (now - meta.ripple.startedAt) / RIPPLE_DURATION_MS;
      // 外側リングは内側より RIPPLE_OUTER_DELAY_MS 遅れて開始する (重なって1本に見えないように)。
      const outerT = (now - meta.ripple.startedAt - RIPPLE_OUTER_DELAY_MS) / RIPPLE_DURATION_MS;
      // 終了判定は、後から終わる外側リングの完了を待つ。
      if (outerT >= 1) {
        for (const m of meta.ripple.meshes) {
          rig.pinsGroup.remove(m);
          m.geometry.dispose();
          (m.material as MeshBasicMaterial).dispose();
        }
        meta.ripple = null;
        continue;
      }
      applyRippleState(inner, innerT);
      applyRippleState(outer, outerT);
    }
  };

  const clock = { last: performance.now() };
  let rafId = 0;
  const tick = (): void => {
    const now = performance.now();
    const dt = (now - clock.last) / 1000;
    clock.last = now;

    // rig.tick は内部で updateMatrixWorld まで済ませるため、この後の
    // (focus 完了時に呼ばれる) onArrived コールバック内の projectPin も常に最新の位置を読める。
    rig.tick(dt, now);
    updateLanding(now);
    updateRipples(now);
    renderer.render(scene, camera);

    for (const cb of frameCallbacks) cb(now / 1000);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  const onFrame = (cb: (elapsedSec: number) => void): (() => void) => {
    frameCallbacks.add(cb);
    return () => frameCallbacks.delete(cb);
  };

  const projectPin = (id: string): ProjectedPin | null => {
    const pin = rig.getPin(id);
    const projected = rig.projectPin(id, BACKSIDE_DOT_THRESHOLD);
    if (!pin || !projected) return null;

    const worldPos = pin.object.getWorldPosition(new Vector3());
    const ndc = worldPos.clone().project(camera);
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    const x = (ndc.x * 0.5 + 0.5) * width;
    const y = (1 - (ndc.y * 0.5 + 0.5)) * height;

    return { x, y, visible: projected.visible, dot: projected.dot };
  };

  const getBounds = (): DOMRect => container.getBoundingClientRect();

  const render = (): void => {
    renderer.render(scene, camera);
  };

  const setAutoRotate = (enabled: boolean): void => {
    rig.autoRotate = enabled;
  };

  const pinPickedCallbacks = new Set<(id: string) => void>();
  const onPinPicked = (cb: (id: string) => void): (() => void) => {
    pinPickedCallbacks.add(cb);
    return () => pinPickedCallbacks.delete(cb);
  };

  // interactive: true のときだけドラッグ/ホイール操作とピンのクリック選択を有効にする
  // (スマホの到着画面は演出専用のため既定では無効)。
  // ピックは 3D レイキャストではなく画面座標上の最近傍探索で行う。ピンの見た目
  // (現状は細いコーン、将来はキャラクター glTF に差し替え予定) に依存せず、
  // 自転中でも押しやすいタップ/クリック判定になる (`nearestPinWithin` 参照)。
  const pickPinAt = (clientX: number, clientY: number): string | null => {
    const rect = container.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const candidates = pinOrder
      .map((id) => {
        const projected = projectPin(id);
        return projected
          ? { id, x: projected.x, y: projected.y, visible: projected.visible }
          : null;
      })
      .filter((c): c is { id: string; x: number; y: number; visible: boolean } => c !== null);
    return nearestPinWithin(candidates, px, py, PICK_RADIUS_PX);
  };

  // 手動操作 (ドラッグ/ホイール) が始まったら自転を止め、5秒操作が無ければ再開する。
  // focusPin の到着演出は autoRotate の値に依存しないため (rig.tick 参照)、
  // 一時停止中でも新規到着ピンへの回転・波紋は問題なく再生される。
  const idleResume = options.interactive
    ? createIdleResume(
        () => setAutoRotate(false),
        () => setAutoRotate(true),
        IDLE_RESUME_MS,
      )
    : null;

  const unbindInteraction = options.interactive
    ? bindGlobeInteraction(renderer.domElement, {
        rotateBy: (spin, tilt) => rig.rotateBy(spin, tilt),
        pickPinAt,
        onPinPicked: (id) => {
          idleResume?.touch();
          setAutoRotate(false);
          for (const cb of pinPickedCallbacks) cb(id);
        },
        // 見かけ上の球の直径 (px)。透視投影の厳密な射影計算まではせず、
        // コンテナの短辺の 9 割程度を球の直径とみなす近似で十分な操作感が得られる。
        diameterPx: () => Math.min(container.clientWidth, container.clientHeight) * 0.9,
        onActivity: () => idleResume?.touch(),
      })
    : null;

  const dispose = (): void => {
    cancelAnimationFrame(rafId);
    resizeObserver.disconnect();
    unbindInteraction?.();
    idleResume?.dispose();
    clear();
    sphereGeometry.dispose();
    sphereMaterial.map?.dispose();
    sphereMaterial.dispose();
    scene.remove(hemisphereLight, directionalLight);
    renderer.dispose();
    if (renderer.domElement.parentElement === container) {
      container.removeChild(renderer.domElement);
    }
    frameCallbacks.clear();
    pinPickedCallbacks.clear();
  };

  return {
    addPin,
    removePin,
    clear,
    setRotationTo,
    focusPin,
    dispose,
    onFrame,
    projectPin,
    getBounds,
    render,
    setAutoRotate,
    onPinPicked,
  };
};
