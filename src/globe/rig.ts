import { Group, type Object3D, Vector3 } from "three";

/**
 * 地球のシーングラフ (tiltGroup → spinGroup → pinsGroup) と回転の数式だけを持つ、
 * レンダラー/カメラに依存しない純粋なクラス。WebGL 無しで vitest からテストできる。
 */

export const TILT_DEG = 12;
export const ROTATION_PERIOD_SEC = 24;
export const DEFAULT_FOCUS_DURATION_MS = 900;
/** これを超えて focus 待ちが積み上がった分は、正面合わせをせずその場で即着地させる。 */
export const MAX_FOCUS_QUEUE = 3;
/** キューに後続が残っている間、1 件あたりの focus 所要時間をこれまで短縮して追いつく。 */
export const BACKLOG_DURATION_MS = 500;
/** ドラッグ/ホイールで許容する tilt の最大絶対値 (度)。北極・南極が見えなくなるほど傾けさせない。 */
export const MAX_TILT_DEG = 60;
const MAX_TILT_RAD = (MAX_TILT_DEG * Math.PI) / 180;
/** 手動操作後、自転再開時に既定の傾きへ戻る速さ (大きいほど速く収束する)。 */
const TILT_SETTLE_RATE = 3;

/** カメラは常に world +Z 側から原点を見ている前提の固定方向。 */
const CAMERA_DIRECTION: Readonly<Vector3> = new Vector3(0, 0, 1);

/** 緯度経度 (度) → 単位球上の方向ベクトル。equirectangular テクスチャの UV マッピングに対応する。 */
export const latLonToVector3 = (lat: number, lon: number, radius = 1): Vector3 => {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
};

/** ベクトルの (x,z) 成分から、正面 (+Z) を向かせるために必要な spinGroup.rotation.y を求める。 */
export const frontFacingAngle = (dir: Vector3): number => -Math.atan2(dir.x, dir.z);

/** 角度差を [-π, π] に正規化する (最短回転方向を得るため)。 */
const normalizeAngleDelta = (delta: number): number => {
  const twoPi = Math.PI * 2;
  let d = delta % twoPi;
  if (d > Math.PI) d -= twoPi;
  if (d < -Math.PI) d += twoPi;
  return d;
};

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

type FocusAnimation = Readonly<{
  pinId: string;
  fromY: number;
  toY: number;
  startedAt: number;
  durationMs: number;
  onArrived?: () => void;
}>;

type FocusRequest = Readonly<{
  pinId: string;
  durationMs: number;
  onArrived?: () => void;
}>;

export type RigPin = Readonly<{
  id: string;
  object: Object3D;
  /** tiltGroup の傾きを含まない、spinGroup ローカル座標系での単位方向ベクトル。 */
  localDir: Vector3;
}>;

export type ProjectedRigPin = Readonly<{
  normal: Vector3;
  /** 法線と (0,0,1) の内積。1 に近いほど正面。 */
  dot: number;
  visible: boolean;
}>;

/**
 * 地球のシーングラフと回転ロジックだけを持つ純粋なクラス。
 * WebGLRenderer/PerspectiveCamera を作らないため、three.js の Object3D 演算だけで
 * node/vitest 上でも動作を検証できる。
 */
export class GlobeRig {
  readonly tiltGroup = new Group();
  readonly spinGroup = new Group();
  readonly pinsGroup = new Group();
  readonly tiltRad: number;
  autoRotate = true;

  private pins = new Map<string, RigPin>();
  private focusAnimation: FocusAnimation | null = null;
  /**
   * focusPin は同時に 1 件しかアニメーションできないため、実行中に別の focusPin が
   * 呼ばれた場合はここに積んでおき、完了ごとに次を開始する。これをしないと、投稿が
   * 900ms 未満の間隔で連続到着したとき、先に呼ばれた focusPin の focusAnimation が
   * 後発の呼び出しに上書きされて消え、その onArrived が永久に呼ばれなくなる
   * (吹き出し・波紋・音が出ないまま止まって見えるバグの原因)。
   */
  private focusQueue: FocusRequest[] = [];

  constructor(tiltDeg: number = TILT_DEG) {
    this.tiltRad = (tiltDeg * Math.PI) / 180;
    this.tiltGroup.rotation.x = this.tiltRad;
    this.tiltGroup.add(this.spinGroup);
    this.spinGroup.add(this.pinsGroup);
    this.tiltGroup.updateMatrixWorld(true);
  }

  /** ピンを登録する。object はすでに localDir * offset の位置に配置済みであること。 */
  addPin(id: string, object: Object3D, localDir: Vector3): void {
    this.pinsGroup.add(object);
    this.pins.set(id, { id, object, localDir: localDir.clone().normalize() });
  }

  removePin(id: string): Object3D | null {
    const pin = this.pins.get(id);
    if (!pin) return null;
    this.pinsGroup.remove(pin.object);
    this.pins.delete(id);
    if (this.focusAnimation?.pinId === id) {
      this.focusAnimation = null;
      // このピンの focus が消えたので、キューに次があれば進める (止まったままにしない)。
      this.tryStartNextFocus(performance.now());
    }
    return pin.object;
  }

  getPin(id: string): RigPin | undefined {
    return this.pins.get(id);
  }

  isFocusing(): boolean {
    return this.focusAnimation !== null;
  }

  /**
   * 指定した緯度経度がカメラ正面 (dot=1) に来るよう回転する。
   * spinGroup は Y 軸回転だけで経度を正面に合わせ、tiltGroup の X 軸回転を
   * その地点の緯度に合わせることで緯度も中心に持ってくる。Y/X 軸回転のみを組み合わせる
   * ため、ロール (北が傾く) が発生せず「北が上」の向きを保てる
   * (任意軸の quaternion 回転だと地図が斜めになってしまうため使わない)。
   * ディスプレイ用の既定の傾き (TILT_DEG) はこの呼び出しで上書きされる。
   */
  setRotationTo(lat: number, lon: number): void {
    const dir = latLonToVector3(lat, lon, 1).normalize();
    this.spinGroup.rotation.y = frontFacingAngle(dir);
    this.tiltGroup.rotation.x = (lat * Math.PI) / 180;
    this.tiltGroup.updateMatrixWorld(true);
  }

  /**
   * 指定したピンの経度が正面に来るまでの ease-out アニメーションをキューに積む。
   * 既に別のピンの focus 中なら、それが完了してから順番に開始する (取りこぼさない)。
   * ただしキューが `MAX_FOCUS_QUEUE` 件を超える分は自転を止めてまで待たせず、
   * focus (正面合わせの回転) をせずにその場で `onArrived` を即座に呼ぶ
   * (投稿が連投されたときに自転が止まったまま浮いたピンが溜まるのを防ぐ)。
   * `nowMs` は呼び出し時刻 (`performance.now()` 等)。実際に回転が進むのは `tick` 呼び出し時。
   */
  focusPin(
    id: string,
    nowMs: number,
    durationMs = DEFAULT_FOCUS_DURATION_MS,
    onArrived?: () => void,
  ): void {
    if (this.focusQueue.length >= MAX_FOCUS_QUEUE) {
      onArrived?.();
      return;
    }
    this.focusQueue.push({ pinId: id, durationMs, onArrived });
    this.tryStartNextFocus(nowMs);
  }

  private tryStartNextFocus(nowMs: number): void {
    if (this.focusAnimation) return;
    const next = this.focusQueue.shift();
    if (!next) return;

    const pin = this.pins.get(next.pinId);
    if (!pin) {
      // 削除済みのピンはスキップし、次のリクエストへ進む (呼び出し元には完了扱いで通知)。
      next.onArrived?.();
      this.tryStartNextFocus(nowMs);
      return;
    }

    const targetAngle = frontFacingAngle(pin.localDir);
    const fromY = this.spinGroup.rotation.y;
    const delta = normalizeAngleDelta(targetAngle - fromY);
    // 後続が詰まっている間は 1 件あたりの所要時間を短縮して早く追いつく。
    const durationMs =
      this.focusQueue.length > 0 ? Math.min(next.durationMs, BACKLOG_DURATION_MS) : next.durationMs;
    this.focusAnimation = {
      pinId: next.pinId,
      fromY,
      toY: fromY + delta,
      startedAt: nowMs,
      durationMs,
      onArrived: next.onArrived,
    };
  }

  /**
   * dtSeconds 分の自転 (もしくは focus アニメーション) を進める。
   * `nowMs` は focus アニメーションの経過時間計算に使う絶対時刻。
   * 呼び出し後は `tiltGroup.updateMatrixWorld(true)` 済みで、即座に world 座標を読める
   * (WebGLRenderer.render を待たずに `projectPin` や `onArrived` 内の位置参照が最新になる)。
   */
  tick(dtSeconds: number, nowMs: number): void {
    const angularSpeed = (Math.PI * 2) / ROTATION_PERIOD_SEC;

    if (this.focusAnimation) {
      const { fromY, toY, startedAt, durationMs, onArrived } = this.focusAnimation;
      const t = Math.min(1, (nowMs - startedAt) / durationMs);
      this.spinGroup.rotation.y = fromY + (toY - fromY) * easeOutCubic(t);
      if (t >= 1) {
        this.focusAnimation = null;
        this.tiltGroup.updateMatrixWorld(true);
        onArrived?.();
        this.tryStartNextFocus(nowMs);
        return;
      }
    } else if (this.autoRotate) {
      // 回転する点の速度は dx/dθ = z (現在の局所 z 座標) という一般的な性質があり、
      // 正面 (z=1) にある点では dx/dθ=1 になる。よって += が「画面上で表面が
      // 左→右に流れる」向きになる (rig.test.ts で直接検証済み)。
      this.spinGroup.rotation.y += angularSpeed * dtSeconds;
      this.settleTilt(dtSeconds);
    }
    this.tiltGroup.updateMatrixWorld(true);
  }

  /**
   * ドラッグ/ホイール操作による手動回転を spinGroup/tiltGroup に加える。
   * `deltaSpinRad` は spinGroup.rotation.y に、`deltaTiltRad` は tiltGroup.rotation.x に
   * そのまま加算し、tilt は ±`MAX_TILT_DEG` にクランプする (極が裏返らないようにする)。
   * focus アニメーション中は到着演出を優先し、手動回転は無視する (no-op)。
   */
  rotateBy(deltaSpinRad: number, deltaTiltRad: number): void {
    if (this.focusAnimation) return;
    this.spinGroup.rotation.y += deltaSpinRad;
    const nextTilt = this.tiltGroup.rotation.x + deltaTiltRad;
    this.tiltGroup.rotation.x = Math.min(MAX_TILT_RAD, Math.max(-MAX_TILT_RAD, nextTilt));
    this.tiltGroup.updateMatrixWorld(true);
  }

  /**
   * 自転中のみ、tiltGroup.rotation.x を既定の傾き (`this.tiltRad`) へ指数関数的に
   * 戻す。ドラッグでディスプレイ既定の傾きから外れた後、手を離して自転が再開したら
   * 徐々に元の見た目へ収束させるための処理 (`tick` の autoRotate 分岐からのみ呼ぶ)。
   */
  settleTilt(dtSeconds: number): void {
    const factor = 1 - Math.exp(-dtSeconds * TILT_SETTLE_RATE);
    this.tiltGroup.rotation.x += (this.tiltRad - this.tiltGroup.rotation.x) * factor;
  }

  /** ピンの世界座標の法線と (0,0,1) の内積、および可視判定。 */
  projectPin(id: string, visibleDotThreshold: number): ProjectedRigPin | null {
    const pin = this.pins.get(id);
    if (!pin) return null;
    const worldPos = pin.object.getWorldPosition(new Vector3());
    const normal = worldPos.normalize();
    const dot = normal.dot(CAMERA_DIRECTION);
    return { normal, dot, visible: dot >= visibleDotThreshold };
  }
}
