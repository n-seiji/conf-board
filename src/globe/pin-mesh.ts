import {
  ConeGeometry,
  Group,
  Mesh,
  type Object3D,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import type { PinColorId } from "../shared/colors";

/**
 * Gopherの読み込み中・失敗時に使うフォールバックと、共通の配置契約。
 * 通常の見た目・アニメーションは gopher-pins.ts が担当する。
 * - 原点 (0,0,0) はピンの先端 (球面に接する点)。
 * - +Y が「上」(球面から離れる方向)。
 * - 全体の高さは `PIN_HEIGHT` (球半径 1 に対する比率)。
 * - 色は投稿ごとに `colorHex` で指定する。
 */

/** Gopher全高。前版0.42の0.8倍 (球半径1に対する比率)。 */
export const PIN_HEIGHT = 0.24;

const HEAD_RADIUS = PIN_HEIGHT * 0.25;
/** 針の長さは「全体の高さ − 頭の直径」で決め、先端から頭の上端までがちょうど PIN_HEIGHT になるようにする。 */
const NEEDLE_HEIGHT = PIN_HEIGHT - HEAD_RADIUS * 2;
const NEEDLE_RADIUS = PIN_HEIGHT * 0.07;

/** 針 (needle) と頭 (head) のジオメトリはピン全体で共有するモジュール単位のシングルトン。 */
const needleGeometry = new ConeGeometry(NEEDLE_RADIUS, NEEDLE_HEIGHT, 12);
const headGeometry = new SphereGeometry(HEAD_RADIUS, 16, 12);

const materialCache = new Map<PinColorId, MeshStandardMaterial>();

/** 色ごとにマテリアルを 1 つだけ生成してキャッシュする (dispose せず使い回す)。 */
const materialForColor = (colorId: PinColorId, colorHex: string): MeshStandardMaterial => {
  const cached = materialCache.get(colorId);
  if (cached) return cached;
  const material = new MeshStandardMaterial({ color: colorHex });
  materialCache.set(colorId, material);
  return material;
};

const UP = new Vector3(0, 1, 0);

/** 法線ベクトルから、ローカル +Y をその向きに揃えるための quaternion を求める純粋関数。 */
export const pinQuaternionFor = (normal: Vector3): Quaternion =>
  new Quaternion().setFromUnitVectors(UP, normal.clone().normalize());

/** object のローカル +Y が normal を向くよう回転させる。 */
export const orientPinToNormal = (object: Object3D, normal: Vector3): void => {
  object.quaternion.copy(pinQuaternionFor(normal));
};

/**
 * 色付きピンの 3D オブジェクトを新規作成する。ジオメトリは共有、マテリアルは色ごとに共有する
 * (呼び出しごとに新規生成しない)。原点がピンの先端になるよう配置する。
 */
export const createPinObject = (colorId: PinColorId, colorHex: string): Object3D => {
  const group = new Group();
  group.name = "pin";

  const material = materialForColor(colorId, colorHex);

  const needle = new Mesh(needleGeometry, material);
  needle.name = "pin-needle";
  // ConeGeometry は原点中心・下端が -height/2 なので、先端 (下端) が y=0 に来るよう持ち上げる。
  needle.position.y = NEEDLE_HEIGHT / 2;
  needle.castShadow = false;
  needle.receiveShadow = false;

  const head = new Mesh(headGeometry, material);
  head.name = "pin-head";
  head.position.y = NEEDLE_HEIGHT + HEAD_RADIUS;
  head.castShadow = false;
  head.receiveShadow = false;

  group.add(needle, head);
  return group;
};
