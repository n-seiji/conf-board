import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { createGopherPins } from "./gopher-pins";

/** Persistent sequence keeps the character stable after deletes and reconnects. */
export const isRenPost = (seq: number): boolean => seq >= 150;
export const createRenPins = (
  load: () => Promise<GLTF> = () =>
    new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/ren.glb`),
) =>
  createGopherPins(load, {
    name: "ren-pin",
    height: 3.083,
    clips: ["Wave", "Bow", "Nod", "Jump", "Dance"],
    sizeMultiplier: 1.3,
    recolor: false,
    headBone: "Head",
    bodyBone: "Spine",
  });
