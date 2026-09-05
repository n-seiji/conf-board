import {
  AdditiveBlending,
  Color,
  DoubleSide,
  type Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
} from "three";

/** 着地済みピンの先端 (テクスチャ下端) が接する球面からの距離。 */
const RIPPLE_SURFACE_OFFSET = 1.002;
const RIPPLE_DURATION_MS = 900;
const RIPPLE_INNER_START = 0.04;
const RIPPLE_OUTER_START = 0.3;
/** 外側の波紋リングを内側より遅らせて開始する時間 (ms)。同時開始だと重なって1本に見えるため。 */
const RIPPLE_OUTER_DELAY_MS = 150;

type Ripple = Readonly<{
  meshes: readonly [Mesh, Mesh];
  startedAt: number;
}>;

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

/** ピンの着地位置に広がる波紋の生成・更新・破棄をまとめて持つ。 */
export const createRipples = (parent: Group) => {
  const ripples = new Map<string, Ripple>();

  const remove = (id: string): void => {
    const ripple = ripples.get(id);
    if (!ripple) return;
    for (const m of ripple.meshes) {
      parent.remove(m);
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
    }
    ripples.delete(id);
  };

  return {
    /** localDir 方向の地表に波紋を発生させる。 */
    spawn(id: string, localDir: Vector3): void {
      const [inner, outer] = createRippleMeshes();
      const ripplePosition = localDir.clone().multiplyScalar(RIPPLE_SURFACE_OFFSET);
      for (const ring of [inner, outer]) {
        ring.position.copy(ripplePosition);
        ring.lookAt(localDir.clone().multiplyScalar(2));
        parent.add(ring);
      }
      ripples.set(id, { meshes: [inner, outer], startedAt: performance.now() });
    },
    remove,
    update(now: number): void {
      for (const [id, ripple] of ripples) {
        const innerT = (now - ripple.startedAt) / RIPPLE_DURATION_MS;
        // 外側リングは内側より RIPPLE_OUTER_DELAY_MS 遅れて開始する (重なって1本に見えないように)。
        const outerT = (now - ripple.startedAt - RIPPLE_OUTER_DELAY_MS) / RIPPLE_DURATION_MS;
        // 終了判定は、後から終わる外側リングの完了を待つ。
        if (outerT >= 1) {
          remove(id);
          continue;
        }
        const [inner, outer] = ripple.meshes;
        applyRippleState(inner, innerT);
        applyRippleState(outer, outerT);
      }
    },
    dispose(): void {
      for (const id of [...ripples.keys()]) remove(id);
    },
  };
};
