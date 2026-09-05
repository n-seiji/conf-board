import { createGlobe } from "/src/globe/index.ts";
import { pinLatLon } from "/src/globe/pins.ts";
import { createCallouts } from "/src/globe/callouts.ts";
import { createConfetti } from "/src/display/confetti.ts";
import { MilestoneState } from "/src/display/milestone.ts";
const host = document.querySelector("#globe"),
  status = document.querySelector("#status");
const globe = createGlobe(host, { interactive: true, autoRotate: false });
const milestone = new MilestoneState();
const viewToggle = document.createElement("button");
viewToggle.className = "display-view-toggle";
viewToggle.hidden = true;
document.querySelector("#stage").appendChild(viewToggle);
let showingMessage = false;
const applyMessageMode = () => {
  viewToggle.hidden = !milestone.available;
  viewToggle.textContent = milestone.message ? "地球に戻る" : "メッセージを見る";
  if (showingMessage === milestone.message) return;
  showingMessage = milestone.message;
  globe.setMessageMode(showingMessage);
  if (showingMessage) callouts.clearAll();
};
viewToggle.onclick = () => {
  milestone.toggle();
  applyMessageMode();
};
globe.onFrame(() => {
  milestone.tick(performance.now());
  applyMessageMode();
});
// Preview only: reproduce display/main.ts's celebration with the production CSS.
// No API calls or changes to the real post count / celebrated flag.
const sparkles = document.createElement("div");
sparkles.className = "display-sparkles";
document.querySelector("#stage").appendChild(sparkles);
const confetti = createConfetti(sparkles);
document.querySelector("#celebrate").onclick = () => {
  milestone.sync(150);
  milestone.celebrate(performance.now());
  applyMessageMode();
  host.classList.remove("globe-wrap--celebrate");
  void host.offsetWidth;
  host.classList.add("globe-wrap--celebrate");
  sparkles.replaceChildren();
  confetti.play();
  for (let i = 0; i < 2; i++) {
    const ring = document.createElement("div");
    ring.className = "display-ripple-big";
    ring.style.animationDelay = `${i * 150}ms`;
    sparkles.appendChild(ring);
    setTimeout(() => ring.remove(), 1400);
  }
  const radius = globe.getBounds().width / 2;
  for (let i = 0; i < 6; i++) {
    const star = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    star.setAttribute("viewBox", "0 0 24 24");
    star.setAttribute("class", "display-sparkle");
    star.innerHTML =
      '<path d="M12 0 L14.5 9.5 L24 12 L14.5 14.5 L12 24 L9.5 14.5 L0 12 L9.5 9.5 Z" fill="currentColor"/>';
    const angle = (i / 6) * Math.PI * 2;
    star.style.left = `calc(50% + ${Math.cos(angle) * radius}px)`;
    star.style.top = `calc(50% + ${Math.sin(angle) * radius}px)`;
    star.style.animationDelay = `${i * 60}ms`;
    sparkles.appendChild(star);
    setTimeout(() => star.remove(), 1400);
  }
  status.textContent = "150の願いで世界が満たされました!（プレビュー・投稿数は変更しません）";
};
const callouts = createCallouts(document.querySelector("#stage"), globe);
callouts.setAmbientEnabled(false);
const post = {
  id: "gopher-integration-demo",
  countryId: 0,
  color: 2,
  nickname: "テストGopher",
  body: "こんな福利厚生がほしい！",
  createdAt: Date.now(),
};
let bubbleVisible = false;
const [lat, lon] = pinLatLon(post);
globe.setRotationTo(lat, lon);
globe.addPin(post, { animate: false });
document.querySelector("#bubble").onclick = () => {
  bubbleVisible = !bubbleVisible;
  if (bubbleVisible) callouts.addCallout(post);
  else callouts.clearAll();
};
document.querySelector("#look").onclick = () => {
  globe.setAutoRotate(false);
  globe.centerPin(post.id, () => {
    status.textContent = "中央：足元を残して腰から見上げ中";
  });
};
document.querySelector("#resume").onclick = () => {
  globe.setAutoRotate(true);
  status.textContent = "通常の動きに復帰";
};
document.querySelector("#arrive").onclick = () => {
  globe.setAutoRotate(false);
  callouts.clearAll();
  globe.removePin(post.id);
  globe.addPin(post, { animate: true });
  const start = performance.now();
  status.textContent = "ワープ登場待ち（モデル準備中）";
  globe.onPinArrived(post.id, () => {
    bubbleVisible = true;
    callouts.addCallout(post);
    status.textContent =
      "NEWで登場：" + Math.round(performance.now() - start) + "ms。自転1周でNEWが消えます";
  });
};
globe.onPinPicked((id) => {
  globe.setAutoRotate(false);
  globe.centerPin(id, () => {
    status.textContent = "クリック選択：見上げ中";
  });
});

// Shareable, local-only preview; no requests to the posts API or production state.
if (location.hash === "#celebrate") document.querySelector("#celebrate").click();
