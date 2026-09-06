import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { CELEBRATION_THRESHOLD } from "../shared/constants";
import { createCharacterPins, type CharacterOptions } from "./character-pins";

/** Persistent sequence keeps the character stable after deletes and reconnects. */
export const isRenPost = (seq: number): boolean => seq >= CELEBRATION_THRESHOLD;

const GOPHER: CharacterOptions = {};

const REN: CharacterOptions = {
  name: "ren-pin",
  height: 3.083,
  clips: ["Wave", "Bow", "Nod", "Jump", "Dance"],
  sizeMultiplier: 1.3,
  recolor: false,
  logoMesh: "T-shirt_•_continuous_shoulders_and_sleeves",
  headBone: "Head",
  bodyBone: "Spine",
};

/** 地表での占有半径 (`spacedPinLatLon` に渡す衝突半径)。 */
const GOPHER_OCCUPIED_RADIUS = 0.12;
const REN_OCCUPIED_RADIUS = 0.156;
export const occupiedRadiusFor = (ren: boolean): number =>
  ren ? REN_OCCUPIED_RADIUS : GOPHER_OCCUPIED_RADIUS;

/** Ren の登場落下 (`arrival.fallingPosition`) にかける時間 (ms)。 */
export const REN_FALL_DURATION_MS = 1100;

export const createGopherPins = (
  load: () => Promise<GLTF> = () =>
    new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/gopher.glb`),
) => createCharacterPins(load, GOPHER);

export const createRenPins = (
  load: () => Promise<GLTF> = () =>
    new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/ren.glb`),
) => createCharacterPins(load, REN);
