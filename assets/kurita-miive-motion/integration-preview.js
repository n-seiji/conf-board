import { Object3D, PerspectiveCamera } from "three";
import { createGlobe } from "/src/globe/index.ts";
import { createCallouts } from "/src/globe/callouts.ts";
import { pinLatLon } from "/src/globe/pins.ts";
const project = PerspectiveCamera.prototype.updateProjectionMatrix;
PerspectiveCamera.prototype.updateProjectionMatrix = function () {
  window.testCamera = this;
  return project.call(this);
};
const original = Object3D.prototype.add;
Object3D.prototype.add = function (...objects) {
  if (this.isScene) window.testScene = this;
  return original.apply(this, objects);
};
window.passes = [];
const clear = WebGL2RenderingContext.prototype.clear;
WebGL2RenderingContext.prototype.clear = function (mask) {
  if (window.passes.length < 30) window.passes.push(mask);
  return clear.call(this, mask);
};
const globe = createGlobe(document.querySelector("#globe"), {
  autoRotate: false,
  preserveDrawingBuffer: true,
  interactive: true,
});
window.globe = globe;
const callouts = createCallouts(document.querySelector("#globe"), globe);
callouts.setAmbientEnabled(false);
window.callouts = callouts;
globe.onPinPicked((id) => {
  window.picked = id;
  globe.centerPin(id, 0, () => callouts.addCallout(window.renPost));
});
const ren = {
  id: "ren-front",
  countryId: 0,
  color: 0,
  seq: 150,
  nickname: "Ren",
  body: "NEW確認",
  createdAt: Date.now(),
};
const [lat, lon] = pinLatLon(ren);
globe.setRotationTo(lat, lon);
globe.addPin(ren, { animate: true });
globe.addPin({ ...ren, id: "gopher-149", seq: 149 }, { animate: false });
globe.focusPin(ren.id, 0, () => (window.renLanded = true));
window.renPost = ren;
