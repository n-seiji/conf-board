import QRCode from "qrcode";
import { BoardAudio } from "../globe/audio";
import { createCallouts } from "../globe/callouts";
import { MAX_PIN_MESHES, createGlobe } from "../globe/index";
import { BoardSocket } from "../shared/api";
import { getCountryName } from "../shared/countries";
import type { Post } from "../shared/types";
import "../styles/base.css";
import "./display.css";

const TARGET_POSTS = 150;
const TOAST_DURATION_MS = 3000;

const soundOnIcon = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6a9 9 0 0 1 0 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const soundOffIcon = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

const sparkleStar = (): SVGSVGElement => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.innerHTML =
    '<path d="M12 0 L14.5 9.5 L24 12 L14.5 14.5 L12 24 L9.5 14.5 L0 12 L9.5 9.5 Z" fill="currentColor"/>';
  return svg;
};

const buildDom = (
  root: HTMLElement,
): Readonly<{
  stage: HTMLDivElement;
  globeArea: HTMLDivElement;
  globeWrap: HTMLDivElement;
  overlayHost: HTMLDivElement;
  svg: SVGSVGElement;
  toast: HTMLDivElement;
  counterValue: HTMLDivElement;
  qrImg: HTMLImageElement;
  soundToggle: HTMLButtonElement;
  sparklesHost: HTMLDivElement;
}> => {
  root.innerHTML = "";
  const screen = document.createElement("div");
  screen.className = "display-screen";

  const stage = document.createElement("div");
  stage.className = "display-stage";

  const globeArea = document.createElement("div");
  globeArea.className = "globe-area";
  const globeWrap = document.createElement("div");
  globeWrap.className = "globe-wrap";
  globeArea.appendChild(globeWrap);
  stage.appendChild(globeArea);

  const overlayHost = document.createElement("div");
  overlayHost.className = "callouts-host";
  overlayHost.style.position = "absolute";
  overlayHost.style.inset = "0";
  stage.appendChild(overlayHost);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
  svg.setAttribute("class", "callout-leader-svg");
  stage.appendChild(svg);

  const heading = document.createElement("div");
  heading.className = "display-heading";
  heading.innerHTML = `
    <p class="display-heading__sub">こんな福利厚生、欲しい!</p>
    <p class="display-heading__main">働く意味で、世界を満たす。</p>
  `;
  stage.appendChild(heading);

  const toast = document.createElement("div");
  toast.className = "display-toast";
  stage.appendChild(toast);

  const counter = document.createElement("div");
  counter.className = "display-counter";
  counter.innerHTML = `
    <div class="display-counter__value"><span class="counter-n">0</span><span class="display-counter__total"> / ${TARGET_POSTS}</span></div>
    <div class="display-counter__label">世界を満たした願い</div>
    <div class="display-counter__brand">miive</div>
  `;
  stage.appendChild(counter);
  const counterValue = counter.querySelector<HTMLDivElement>(".counter-n");
  if (!counterValue) throw new Error("counter element not found");

  const qr = document.createElement("div");
  qr.className = "display-qr";
  const qrImg = document.createElement("img");
  qr.innerHTML =
    '<div class="display-qr__box"></div><div class="display-qr__label">スマホで投稿 →</div>';
  qr.querySelector(".display-qr__box")?.appendChild(qrImg);
  stage.appendChild(qr);

  const soundToggle = document.createElement("button");
  soundToggle.className = "display-sound-toggle";
  soundToggle.type = "button";
  soundToggle.innerHTML = soundOnIcon;
  stage.appendChild(soundToggle);

  const sparklesHost = document.createElement("div");
  sparklesHost.className = "display-sparkles";
  stage.appendChild(sparklesHost);

  screen.appendChild(stage);
  root.appendChild(screen);

  return {
    stage,
    globeArea,
    globeWrap,
    overlayHost,
    svg,
    toast,
    counterValue,
    qrImg,
    soundToggle,
    sparklesHost,
  };
};

const main = (): void => {
  const app = document.getElementById("app");
  if (!app) return;

  const dom = buildDom(app);
  const globe = createGlobe(dom.globeWrap);
  const callouts = createCallouts(dom.overlayHost, dom.svg, globe);
  const audio = new BoardAudio();

  // 開発時のみ: ブラウザの devtools から `window.__confBoard.globe.projectPin(id)` 等で
  // 回転・可視性を直接測れるようにする (本番ビルドには含まれない)。
  if (import.meta.env.DEV) {
    (window as Window & { __confBoard?: unknown }).__confBoard = { globe };
  }

  window.addEventListener(
    "pointerdown",
    () => {
      audio.unlock();
    },
    { once: true },
  );

  dom.soundToggle.addEventListener("click", () => {
    const enabled = audio.toggle();
    dom.soundToggle.innerHTML = enabled ? soundOnIcon : soundOffIcon;
  });

  QRCode.toDataURL(`${location.origin}/`, { margin: 1, width: 240 })
    .then((url) => {
      dom.qrImg.src = url;
    })
    .catch(() => {
      // QR 生成に失敗しても画面は表示を続ける。
    });

  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  const showToast = (message: string): void => {
    dom.toast.textContent = message;
    dom.toast.classList.add("display-toast--visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      dom.toast.classList.remove("display-toast--visible");
    }, TOAST_DURATION_MS);
  };

  const spawnSparkles = (): void => {
    // 球の半径 (実測) に合わせて配置する (固定値だと球のサイズが変わったときにずれるため)。
    const radius = globe.getBounds().width / 2;
    for (let i = 0; i < 6; i++) {
      const el = sparkleStar();
      el.setAttribute("class", "display-sparkle");
      const angle = (i / 6) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      el.style.left = `calc(50% + ${x}px)`;
      el.style.top = `calc(50% + ${y}px)`;
      el.style.animationDelay = `${i * 60}ms`;
      dom.sparklesHost.appendChild(el);
      setTimeout(() => el.remove(), 1400);
    }
  };

  const spawnBigRipples = (): void => {
    for (let i = 0; i < 2; i++) {
      const ring = document.createElement("div");
      ring.className = "display-ripple-big";
      ring.style.animationDelay = `${i * 150}ms`;
      dom.sparklesHost.appendChild(ring);
      setTimeout(() => ring.remove(), 1400);
    }
  };

  const celebrate = (): void => {
    dom.globeWrap.classList.remove("globe-wrap--celebrate");
    // reflow してアニメーションを再トリガーできるようにする。
    void dom.globeWrap.offsetWidth;
    dom.globeWrap.classList.add("globe-wrap--celebrate");
    spawnBigRipples();
    spawnSparkles();
    showToast("150の願いで世界が満たされました!");
  };

  let knownIds = new Set<string>();
  let celebratedState = false;

  const setCounter = (total: number): void => {
    dom.counterValue.textContent = String(total);
  };

  const renderSnapshot = (posts: readonly Post[], total: number, celebrated: boolean): void => {
    globe.clear();
    // snapshot は完全置換。古い吹き出しが残らないよう、こちらも一旦全部消す。
    callouts.clearAll();
    knownIds = new Set();
    const toRender = posts.slice(Math.max(0, posts.length - MAX_PIN_MESHES));
    for (const post of toRender) {
      globe.addPin(post, { animate: false });
      knownIds.add(post.id);
    }
    setCounter(total);
    celebratedState = celebrated;
  };

  const handlePost = (post: Post, total: number, celebrated: boolean): void => {
    if (!knownIds.has(post.id)) {
      globe.addPin(post, { animate: true });
      knownIds.add(post.id);
      // 自転を正面に合わせてから波紋・吹き出し・音を出す (裏側に着地した場合の対策)。
      globe.focusPin(post.id, 900, () => {
        callouts.addCallout(post);
        audio.playLanding();
        showToast(`また世界がひとつ満たされました! (${getCountryName(post.countryId)})`);
      });
    }
    setCounter(total);

    // celebrated が false→true になった瞬間だけ 150 演出を出す。
    if (!celebratedState && celebrated) {
      celebrate();
    }
    celebratedState = celebrated;
  };

  const socket = new BoardSocket({
    onSnapshot: (posts, total, celebrated) => {
      renderSnapshot(posts, total, celebrated);
    },
    onPost: (post, total, celebrated) => {
      handlePost(post, total, celebrated);
    },
    onDelete: (id, total) => {
      globe.removePin(id);
      callouts.removeCallout(id);
      knownIds.delete(id);
      setCounter(total);
    },
    onReset: () => {
      globe.clear();
      callouts.clearAll();
      knownIds = new Set();
      celebratedState = false;
      setCounter(0);
    },
  });
  socket.connect();

  window.addEventListener("beforeunload", () => {
    socket.close();
    callouts.dispose();
    globe.dispose();
  });
};

main();
