import {
  AdditiveBlending,
  Color,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { pinColorHex } from "../shared/colors";
import type { Post } from "../shared/types";
import {
  bindGlobeInteraction,
  closestPointOnSegment,
  createIdleResume,
  nearestPinWithin,
} from "./interaction";
import { orientPinToNormal } from "./pin-mesh";
import { createGopherPins } from "./gopher-pins";
import { createRenPins, isRenPost } from "./ren-pins";
import { fallingPosition } from "./arrival";
import {
  advanceNewGopher,
  dismissNewGopher,
  newGopherState,
  newBadgePlacement,
  type NewGopherState,
} from "./new-gopher";
import { createNewBadges } from "./new-badge";
import { spacedPinLatLon, type OccupiedPin } from "./pins";
import {
  DEFAULT_FOCUS_DURATION_MS,
  GlobeRig,
  TILT_DEG,
  ROTATION_PERIOD_SEC,
  latLonToVector3,
} from "./rig";
import { createWorldTexture } from "./world-texture";
import { createMessageGlobe } from "./message-globe";

export { latLonToVector3, TILT_DEG, frontFacingAngle } from "./rig";

const SPHERE_RADIUS = 1;
/** 着地済みピンの先端 (テクスチャ下端) が接する球面からの距離。 */
const RIPPLE_SURFACE_OFFSET = 1.002;
/** 描画するピンの上限。display 側の snapshot スライスにも同じ値を使う (`MAX_PIN_MESHES` を import)。 */
export const MAX_PIN_MESHES = 200;
const CAMERA_FOV = 25;
/**
 * 球がcanvasの短辺の約66%に収まる距離。従来の3倍高いGopherが
 * 地球の縁に立っても、初期ズームでは頭が切れにくい余白を確保する。
 */
const CAMERA_DISTANCE = 6.8;
/** 半分の視野角 (rad)。透視投影の画面占有率の計算で使う。 */
const HALF_FOV_RAD = (CAMERA_FOV / 2) * (Math.PI / 180);
/**
 * 球の直径が canvas の短辺に占める割合を、カメラ距離 (ズームで変化する) から求める
 * (透視投影: 1 / (距離 × tan(fov/2)))。ズームで距離が縮むほど、球は画面に大きく映る。
 */
const sphereScreenFraction = (distance: number): number => 1 / (distance * Math.tan(HALF_FOV_RAD));
/** ズーム倍率の範囲。1 (既定) より外へは縮小させず (`never zoom out beyond the default`)、
 * 2.5 倍で画面いっぱいに特定の地域が映る程度を上限にする。 */
const MIN_ZOOM = 1;
const MAX_ZOOM = 2.5;
/** 自転再開後、ズームを既定 (1倍) へ戻す速さ (`settleTilt` と同じ考え方)。 */
const ZOOM_SETTLE_RATE = 3;
const RIPPLE_DURATION_MS = 900;
const RIPPLE_INNER_START = 0.04;
const RIPPLE_OUTER_START = 0.3;
/** 外側の波紋リングを内側より遅らせて開始する時間 (ms)。同時開始だと重なって1本に見えるため。 */
const RIPPLE_OUTER_DELAY_MS = 150;
/**
 * 法線とカメラ方向の内積がこれ未満なら裏側とみなし非表示にする (吹き出し・リーダー線用)。
 * 仕様上の裏側判定は 0.05 (ほぼ真横) だが、その値では球の縁 (limb) 付近で
 * dot が閾値をまたいで前後するフレームが生じ、吹き出し・線が高頻度でちらつく。
 * 0.15 まで早めに切ることでちらつきを抑える。ピン自体は 3D メッシュのため球の
 * depth buffer に自然に隠れ、この閾値は吹き出し・リーダー線の表示判定にのみ影響する。
 */
const BACKSIDE_DOT_THRESHOLD = 0.15;

type Ripple = Readonly<{
  meshes: readonly [Mesh, Mesh];
  startedAt: number;
}>;

type PinMeta = {
  ripple: Ripple | null;
  arrived: boolean;
  ren: boolean;
  fallStarted?: number;
  fresh: NewGopherState | null;
  onArrived?: () => void;
  badge?: ReturnType<ReturnType<typeof createNewBadges>["create"]>;
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
  selected?: boolean;
}>;

export type AddPinOptions = Readonly<{
  /**
   * true (既定値): 新規投稿。モデルの準備ができ次第、配置先にNEW付きで登場。
   * 登場するまでは吹き出し・クリックの対象にしない。
   * false: snapshot復元。即座に地表へ配置し、通常の動きをループ再生する。
   */
  animate?: boolean;
}>;

export type GlobeHandle = Readonly<{
  /** 静止した立体メッセージ球と通常の地球を切り替える。投稿は保持する。 */
  setMessageMode: (visible: boolean) => void;
  /** 吹き出し表示中は頭上のNEWを隠す。吹き出し側にNEWを表示すべきならtrue。 */
  setNewBadgeCallout: (id: string, visible: boolean) => boolean;
  addPin: (post: Pick<Post, "id" | "countryId" | "color" | "seq">, options?: AddPinOptions) => void;
  removePin: (id: string) => void;
  clear: () => void;
  setRotationTo: (lat: number, lon: number) => void;
  /**
   * 新規Gopherが配置先へ登場した時の通知を登録する。
   * 互換性のため名前・引数を維持するが、強制回転・落下は行わずdurationMsは未使用。
   */
  focusPin: (id: string, durationMs?: number, onArrived?: () => void) => void;
  /**
   * クリック/タップされたピンを画面中央 (経度・緯度とも正面) へ回す。着地アニメーション・
   * 波紋は再生しない、選択演出専用のメソッド。「クリック → 中央へ回転 → onArrived で
   * 吹き出しを表示 → (呼び出し側で) 5 秒後に自転再開」という流れの、回転部分だけを担う。
   */
  centerPin: (id: string, durationMs?: number, onArrived?: () => void) => void;
  dispose: () => void;
  onFrame: (cb: (elapsedSec: number) => void) => () => void;
  /** 動くGopherの頭の画面座標 (コンテナ基準px)。裏側・登場前はvisible=false。 */
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
  /**
   * `setAutoRotate` の値が実際に変化するたびに呼ばれる購読を登録する (手動操作・
   * アイドル復帰のどちらの経路でも発火する)。解除関数を返す。ドラッグ/クリックで
   * 一時停止した自転が再開したタイミングでアンビエントな吹き出し補充を再開する
   * (`display/main.ts` 参照) のに使う。
   */
  onAutoRotateChange: (cb: (enabled: boolean) => void) => () => void;
  /** ピンがクリック/タップで選ばれるたびに呼ばれる購読を登録する。解除関数を返す。 */
  onPinPicked: (cb: (id: string) => void) => () => void;
  /**
   * ズーム倍率を直接設定する (1 = 既定, 最大 2.5)。ピンチ操作や ctrl+ホイールから
   * `zoomBy` 経由で呼ばれるほか、外部からも直接呼べる。範囲外の値は自動でクランプする。
   * 自転が再開すると (`autoRotate: true` の間) 毎フレーム既定倍率 (1) へ指数関数的に戻る
   * (`tick` 内、`settleTilt` と同じ考え方)。
   */
  setZoom: (zoom: number) => void;
}>;

/** 手動操作が止んでから自転を再開するまでのアイドル時間 (ms)。 */
const IDLE_RESUME_MS = 5000;
/** ピンのクリック/タップ判定半径 (px)。タッチでも押しやすいよう、実サイズより広めに取る。 */
/** クリック判定の半径 (px)。先端〜頭の線分からこの距離以内ならそのピンとみなす。 */
const PICK_RADIUS_PX = 22;
/** `centerPin` の既定所要時間 (ms)。到着演出の `focusPin` (900ms) より短くし、選択操作への応答性を優先する。 */
const CENTER_PIN_DURATION_MS = 700;

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
  camera.position.set(0, 0, CAMERA_DISTANCE);

  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  const rig = new GlobeRig(TILT_DEG);
  let messageMode = false;
  let messageStarted = 0;
  let messageGlobe: ReturnType<typeof createMessageGlobe> | null = null;
  rig.autoRotate = options.autoRotate ?? true;
  scene.add(rig.tiltGroup);

  const sphereGeometry = new SphereGeometry(SPHERE_RADIUS, 64, 64);
  const sphereMaterial = new MeshStandardMaterial({ map: createWorldTexture(), roughness: 0.85 });
  const sphereMesh = new Mesh(sphereGeometry, sphereMaterial);
  rig.spinGroup.add(sphereMesh);

  // 地球とGopherに柔らかな昼光の陰影を付ける。
  const hemisphereLight = new HemisphereLight("#fffdf0", "#778c93", 2);
  const directionalLight = new DirectionalLight("#fff5de", 3.3);
  directionalLight.position.set(2, 3, 4);
  scene.add(hemisphereLight, directionalLight);

  const gophers = createGopherPins();
  const rens = createRenPins();
  const charactersFor = (id: string) => (pinMeta.get(id)?.ren ? rens : gophers);
  const newBadges = createNewBadges();
  let modelsReady = false;
  void Promise.all([gophers.ready, rens.ready]).then(() => {
    modelsReady = true;
    if (rens.error) console.warn("Ren model unavailable; using colored pins.", rens.error);
    if (gophers.error) console.warn("Gopher model unavailable; using colored pins.", gophers.error);
  });

  const pinMeta = new Map<string, PinMeta>();
  const pinOrder: string[] = [];
  let selectedPinId: string | null = null;
  const uprightRotation = new Quaternion();
  const updateSelectedPose = (): void => {
    if (!selectedPinId) return;
    const pin = rig.getPin(selectedPinId);
    if (!pin) return;
    // Camera is fixed on +Z: identity in world space gives feet-down, head-up,
    // face-forward for either character while the foot position stays fixed.
    pin.object.quaternion.copy(rig.pinsGroup.getWorldQuaternion(uprightRotation).invert());
    pin.object.updateWorldMatrix(true, true);
  };
  const selectPose = (id: string | null): void => {
    if (selectedPinId) {
      const old = rig.getPin(selectedPinId);
      if (old) {
        orientPinToNormal(old.object, old.localDir);
        old.object.traverse((o) => {
          if (o instanceof Mesh) o.layers.set(0);
        });
      }
    }
    selectedPinId = id;
    if (id)
      rig.getPin(id)?.object.traverse((o) => {
        if (o instanceof Mesh) o.layers.set(1);
      });
    updateSelectedPose();
  };

  hemisphereLight.layers.enable(1);
  directionalLight.layers.enable(1);
  const renderScene = (): void => {
    renderer.autoClear = true;
    camera.layers.set(0);
    renderer.render(scene, camera);
    if (selectedPinId && !messageMode) {
      // Only the inspected character is foreground; normal pins still share depth.
      renderer.autoClear = false;
      renderer.clearDepth();
      camera.layers.set(1);
      renderer.render(scene, camera);
      camera.layers.set(0);
      renderer.autoClear = true;
    }
  };

  const frameCallbacks = new Set<(elapsedSec: number) => void>();

  /** 現在のズーム倍率 (1 = 既定)。カメラ距離は `CAMERA_DISTANCE / zoom` (ズームが大きいほど近づく)。 */
  let zoom = 1;
  const currentCameraDistance = (): number => CAMERA_DISTANCE / zoom;
  const applyZoomToCamera = (): void => {
    camera.position.z = currentCameraDistance();
  };
  const setZoom = (nextZoom: number): void => {
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    applyZoomToCamera();
  };

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
    if (selectedPinId === id) selectPose(null);
    meta?.badge?.dispose();
    // 個体の色・骨・ミキサーを解放。共有モデルは地球のdisposeまで保持する。
    charactersFor(id).remove(id);
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
    post: Pick<Post, "id" | "countryId" | "color" | "seq">,
    addOptions: AddPinOptions = {},
  ): void => {
    if (rig.getPin(post.id)) return;
    const ren = isRenPost(post.seq);
    const occupied: OccupiedPin[] = [];
    for (const [id, meta] of pinMeta) {
      const existing = rig.getPin(id);
      if (existing)
        occupied.push({ direction: existing.localDir, radius: meta.ren ? 0.156 : 0.12 });
    }
    const [lat, lon] = spacedPinLatLon(post, occupied, ren ? 0.156 : 0.12);
    const dir = latLonToVector3(lat, lon, 1);
    const willAnimate = addOptions.animate ?? true;

    const object = (ren ? rens : gophers).create(post.id, post.color, pinColorHex(post.color));
    orientPinToNormal(object, dir);
    const restDistance = SPHERE_RADIUS;
    setPinDistance(object, dir, restDistance);
    object.visible = !willAnimate;

    rig.addPin(post.id, object, dir);
    pinMeta.set(post.id, {
      ripple: null,
      ren,
      arrived: !willAnimate,
      fresh: willAnimate ? newGopherState() : null,
    });
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

  const focusPin = (
    id: string,
    _durationMs = DEFAULT_FOCUS_DURATION_MS,
    onArrived?: () => void,
  ): void => {
    // Compatibility with callers: arrival is passive now, never force-spin or drop.
    const meta = pinMeta.get(id);
    if (!meta) return;
    if (meta.arrived) onArrived?.();
    else meta.onArrived = onArrived;
  };

  /**
   * クリック/タップされたピンを画面中央へ回す (経度・緯度とも正面に合わせる)。
   * 選択操作だけは正面合わせを行う。新規投稿の受信では回転を変えない。
   * 回転後に腰から見上げ、呼び出し側で吹き出しを表示する。
   */
  const dismissPinNew = (id: string): void => {
    const meta = pinMeta.get(id);
    if (meta?.fresh) dismissNewGopher(meta.fresh);
    meta?.badge?.dispose();
    if (meta) {
      meta.badge = undefined;
      meta.fresh = null;
    }
  };

  const centerPin = (
    id: string,
    durationMs = CENTER_PIN_DURATION_MS,
    onArrived?: () => void,
  ): void => {
    if (messageMode) return;
    dismissPinNew(id);
    selectPose(null);
    gophers.lookUp(null);
    rens.lookUp(null);
    rig.startCenterOn(id, performance.now(), durationMs, () => {
      // 手動操作中と同様、回転が終わって吹き出しが出てから 5 秒のアイドルを数え直す
      // (吹き出しが出た直後にすぐ自転が再開してしまうのを防ぐ)。
      idleResume?.touch();
      selectPose(id);
      charactersFor(id).lookUp(id, false);
      charactersFor(id).react(id);
      onArrived?.();
    });
  };

  const setNewBadgeCallout = (id: string, visible: boolean): boolean => {
    const meta = pinMeta.get(id);
    const placement = newBadgePlacement(meta?.fresh ?? null, visible);
    meta?.badge?.setLabelVisible(placement === "head");
    return placement === "callout";
  };

  const updateNewGophers = (now: number, autoRotation: number): void => {
    for (const [id, meta] of pinMeta) {
      const front = rig.projectPin(id, BACKSIDE_DOT_THRESHOLD)?.visible ?? false;
      if (meta.ren && meta.arrived) {
        const object = rig.getPin(id)?.object;
        if (object) object.visible = front;
      }
      if (!meta.fresh || !modelsReady) continue;
      const pin = rig.getPin(id);
      if (!pin) continue;
      const projected = rig.projectPin(id, BACKSIDE_DOT_THRESHOLD);
      if (meta.ren && meta.fresh.phase === "pending") {
        // Wait until the destination faces the audience, then fall in screen-up space.
        if (!front && meta.fallStarted === undefined) continue;
        meta.fallStarted ??= now;
        const progress = Math.min(1, (now - meta.fallStarted) / 1100);
        rig.pinsGroup.updateWorldMatrix(true, false);
        const surface = rig.pinsGroup.localToWorld(
          pin.localDir.clone().multiplyScalar(SPHERE_RADIUS),
        );
        pin.object.position.copy(rig.pinsGroup.worldToLocal(fallingPosition(surface, progress)));
        pin.object.visible = front;
        if (progress < 1) continue;
        setPinDistance(pin.object, pin.localDir, SPHERE_RADIUS);
      }
      if (advanceNewGopher(meta.fresh, autoRotation)) {
        meta.arrived = true;
        pin.object.visible = true;
        meta.badge = newBadges.create();
        scene.add(meta.badge.group);
        charactersFor(id).react(id);
        triggerRipple(id);
        const callback = meta.onArrived;
        meta.onArrived = undefined;
        callback?.();
      }
      if (meta.fresh.phase === "done") {
        meta.badge?.dispose();
        meta.badge = undefined;
        meta.fresh = null;
      } else if (meta.badge) {
        const head = charactersFor(id).headPosition(id);
        if (head) meta.badge.group.position.copy(head).add(new Vector3(0, 0.075, 0));
        meta.badge.group.visible = !messageMode && (projected?.visible ?? false);
        meta.badge.update(now / 1000);
      }
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
    const autoRotation =
      !messageMode && rig.autoRotate && !rig.isFocusing()
        ? (Math.max(0, dt) * Math.PI * 2) / ROTATION_PERIOD_SEC
        : 0;
    if (!messageMode) rig.tick(dt, now);
    updateRipples(now);
    if (!messageMode) {
      gophers.update(dt);
      rens.update(dt);
    }
    updateSelectedPose();
    updateNewGophers(now, autoRotation);
    if (messageMode)
      messageGlobe?.update(
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 2
          : (now - messageStarted) / 1000,
      );
    // 自転中のみ、ズームを既定 (1倍) へ指数関数的に戻す (`GlobeRig.settleTilt` と同じ考え方)。
    if (rig.autoRotate && zoom !== MIN_ZOOM) {
      const factor = 1 - Math.exp(-dt * ZOOM_SETTLE_RATE);
      setZoom(zoom + (MIN_ZOOM - zoom) * factor);
    }
    renderScene();

    for (const cb of frameCallbacks) cb(now / 1000);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  const onFrame = (cb: (elapsedSec: number) => void): (() => void) => {
    frameCallbacks.add(cb);
    return () => frameCallbacks.delete(cb);
  };

  /** world 座標をコンテナ基準の画面 px に投影する。 */
  const toScreen = (worldPos: Vector3): Readonly<{ x: number; y: number }> => {
    const ndc = worldPos.clone().project(camera);
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    return {
      x: (ndc.x * 0.5 + 0.5) * width,
      y: (1 - (ndc.y * 0.5 + 0.5)) * height,
    };
  };

  const projectPin = (id: string): ProjectedPin | null => {
    const pin = rig.getPin(id);
    const projected = rig.projectPin(id, BACKSIDE_DOT_THRESHOLD);
    if (!pin || !projected) return null;

    const head = charactersFor(id).headPosition(id);
    if (!head) return null;
    const { x, y } = toScreen(head);
    return {
      x,
      y,
      visible: !messageMode && projected.visible && (pinMeta.get(id)?.arrived ?? false),
      dot: projected.dot,
      selected: selectedPinId === id,
    };
  };

  const getBounds = (): DOMRect => container.getBoundingClientRect();

  const render = (): void => {
    renderScene();
  };

  const autoRotateChangeCallbacks = new Set<(enabled: boolean) => void>();
  const setAutoRotate = (enabled: boolean): void => {
    if (messageMode) enabled = false;
    // 値が実際に変わったときだけ通知する (手動操作中の連続呼び出しで無駄に発火しないように)。
    if (rig.autoRotate === enabled) return;
    rig.autoRotate = enabled;
    if (enabled) {
      selectPose(null);
      gophers.lookUp(null);
      rens.lookUp(null);
    }
    for (const cb of autoRotateChangeCallbacks) cb(enabled);
  };
  const onAutoRotateChange = (cb: (enabled: boolean) => void): (() => void) => {
    autoRotateChangeCallbacks.add(cb);
    return () => autoRotateChangeCallbacks.delete(cb);
  };

  const setMessageMode = (visible: boolean): void => {
    if (visible === messageMode) return;
    if (visible && !messageGlobe) {
      messageGlobe = createMessageGlobe();
      scene.add(messageGlobe.group);
    }
    if (visible) selectPose(null);
    messageMode = visible;
    messageStarted = performance.now();
    rig.tiltGroup.visible = !visible;
    if (messageGlobe) {
      messageGlobe.group.visible = visible;
      messageGlobe.update(0);
    }
    renderer.domElement.style.pointerEvents = visible ? "none" : "";
    renderer.domElement.setAttribute(
      "aria-label",
      visible ? "働く意味で、世界を満たす。立体メッセージ" : "投稿の地球儀",
    );
    for (const meta of pinMeta.values()) if (meta.badge) meta.badge.group.visible = false;
    setZoom(1);
    setAutoRotate(!visible);
  };

  const pinPickedCallbacks = new Set<(id: string) => void>();
  const onPinPicked = (cb: (id: string) => void): (() => void) => {
    pinPickedCallbacks.add(cb);
    return () => pinPickedCallbacks.delete(cb);
  };

  // interactive: true のときだけドラッグ/ホイール操作とピンのクリック選択を有効にする
  // (スマホの到着画面は演出専用のため既定では無効)。
  // ピックは 3D レイキャストではなく画面座標上の最近傍探索で行う。ピンの見た目
  // (Gopher GLB、読み込み中はフォールバックのピン) に依存せず、
  // 自転中でも押しやすいタップ/クリック判定になる (`nearestPinWithin` 参照)。
  const pickPinAt = (clientX: number, clientY: number): string | null => {
    const rect = container.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    // The floating NEW label can sit outside the head/foot hit segment, especially
    // when zoomed in. Treat its actual projected rectangle as part of the pin.
    for (const id of [...pinOrder].reverse()) {
      const meta = pinMeta.get(id);
      const badge = meta?.badge;
      if (!meta?.arrived || !badge?.group.visible || !badge.label.visible) continue;
      if (!projectPin(id)?.visible) continue;
      const center = badge.label.getWorldPosition(new Vector3());
      const size = badge.label.getWorldScale(new Vector3());
      const topLeft = toScreen(center.clone().add(new Vector3(-size.x / 2, size.y / 2, 0)));
      const bottomRight = toScreen(center.clone().add(new Vector3(size.x / 2, -size.y / 2, 0)));
      const padding = 6;
      if (
        px >= topLeft.x - padding &&
        px <= bottomRight.x + padding &&
        py >= topLeft.y - padding &&
        py <= bottomRight.y + padding
      )
        return id;
    }
    // 実際の足元〜アニメーション中の頭を結ぶ線分で判定する。
    const candidates = pinOrder
      .map((id) => {
        const projected = projectPin(id);
        const pin = rig.getPin(id);
        if (!projected || !pin) return null;
        const tip = pin.object.getWorldPosition(new Vector3());
        const footScreen = toScreen(tip);
        const nearest = closestPointOnSegment(
          projected.x,
          projected.y,
          footScreen.x,
          footScreen.y,
          px,
          py,
        );
        return { id, x: nearest.x, y: nearest.y, visible: projected.visible };
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
          dismissPinNew(id);
          idleResume?.touch();
          setAutoRotate(false);
          for (const cb of pinPickedCallbacks) cb(id);
        },
        // 見かけ上の球の直径 (px)。現在のカメラ距離 (ズーム後) と fov から求めた短辺に対する割合を使う。
        diameterPx: () =>
          Math.min(container.clientWidth, container.clientHeight) *
          sphereScreenFraction(currentCameraDistance()),
        zoomBy: (factor) => setZoom(zoom * factor),
        onActivity: () => idleResume?.touch(),
      })
    : null;

  const dispose = (): void => {
    cancelAnimationFrame(rafId);
    resizeObserver.disconnect();
    unbindInteraction?.();
    idleResume?.dispose();
    clear();
    gophers.dispose();
    rens.dispose();
    newBadges.dispose();
    messageGlobe?.dispose();
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
    autoRotateChangeCallbacks.clear();
  };

  return {
    setMessageMode,
    setNewBadgeCallout,
    addPin,
    removePin,
    clear,
    setRotationTo,
    focusPin,
    centerPin,
    dispose,
    onFrame,
    projectPin,
    getBounds,
    render,
    setAutoRotate,
    onAutoRotateChange,
    onPinPicked,
    setZoom,
  };
};
