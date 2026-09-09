import { createConfetti } from "./confetti";

const sparkleStar = (): SVGSVGElement => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.innerHTML =
    '<path d="M12 0 L14.5 9.5 L24 12 L14.5 14.5 L12 24 L9.5 14.5 L0 12 L9.5 9.5 Z" fill="currentColor"/>';
  return svg;
};

export type Celebration = Readonly<{
  play: () => void;
  dispose: () => void;
}>;

/** 150 件達成演出 (紙吹雪・きらめき・大きなリップル・地球の縁取りアニメーション再生)。 */
export const createCelebration = (
  globeWrap: HTMLElement,
  sparklesHost: HTMLElement,
  getGlobeRadius: () => number,
): Celebration => {
  const confetti = createConfetti(sparklesHost);

  const spawnSparkles = (): void => {
    // 球の半径 (実測) に合わせて配置する (固定値だと球のサイズが変わったときにずれるため)。
    const radius = getGlobeRadius();
    for (let i = 0; i < 6; i++) {
      const el = sparkleStar();
      el.setAttribute("class", "display-sparkle");
      const angle = (i / 6) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      el.style.left = `calc(50% + ${x}px)`;
      el.style.top = `calc(50% + ${y}px)`;
      el.style.animationDelay = `${i * 60}ms`;
      sparklesHost.appendChild(el);
      setTimeout(() => el.remove(), 1400);
    }
  };

  const spawnBigRipples = (): void => {
    for (let i = 0; i < 2; i++) {
      const ring = document.createElement("div");
      ring.className = "display-ripple-big";
      ring.style.animationDelay = `${i * 150}ms`;
      sparklesHost.appendChild(ring);
      setTimeout(() => ring.remove(), 1400);
    }
  };

  const play = (): void => {
    confetti.play();
    globeWrap.classList.remove("globe-wrap--celebrate");
    // reflow してアニメーションを再トリガーできるようにする。
    void globeWrap.offsetWidth;
    globeWrap.classList.add("globe-wrap--celebrate");
    spawnBigRipples();
    spawnSparkles();
  };

  return { play, dispose: confetti.dispose };
};
