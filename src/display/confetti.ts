const DURATION_MS = 5000;
const COLORS = ["#68dec5", "#ffe078", "#ffffff", "#ff958a"] as const;

/** Sample once per launch, never per frame: independent parameters avoid bands and mirrored waves. */
export const createConfettiParticles = (random = Math.random) =>
  Array.from({ length: 1600 }, () => ({
    side: random() < 0.5 ? -1 : 1,
    startX: random() * 0.07,
    startY: 0.45 + random() * 0.5,
    delay: random() * 0.8,
    speedX: 0.2 + random() * 0.62,
    speedY: 0.5 + random() * 0.65,
    drag: 1.2 + random() * 1.8,
    fallSpeed: 0.1 + random() * 0.15,
    spin: (random() - 0.5) * 12,
    flutter: 2 + random() * 7,
    sway: 0.008 + random() * 0.03,
    phase: random() * Math.PI * 2,
    size: 5 + random() * 10,
    color: COLORS[Math.floor(random() * COLORS.length)]!,
  }));

/** Normalized positions keep the same five-second flight at every viewport size. */
export const confettiFrame = (
  seconds: number,
  particles: ReturnType<typeof createConfettiParticles>,
) => {
  if (seconds < 0 || seconds >= DURATION_MS / 1000) return [];
  return particles
    .filter((p) => seconds >= p.delay)
    .map((p) => {
      const age = seconds - p.delay;
      const travel = 1 - Math.exp(-age * p.drag);
      const inward = p.startX + p.speedX * travel;
      return {
        x:
          (p.side === -1 ? inward : 1 - inward) +
          Math.sin(age * p.flutter + p.phase) * p.sway * Math.min(1, age),
        y: p.startY - p.speedY * travel + age * p.fallSpeed,
        rotation: p.phase + age * p.spin,
        flip: Math.cos(p.phase + age * p.flutter),
        size: p.size,
        color: p.color,
        opacity: Math.min(1, (5 - seconds) / 0.8),
      };
    });
};

/** One overlay per celebration; replay cancels and removes the previous one. */
export const createConfetti = (host: HTMLElement) => {
  let stop = () => {};
  return {
    play() {
      stop();
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const canvas = document.createElement("canvas");
      canvas.className = "display-confetti";
      canvas.setAttribute("aria-hidden", "true");
      const context = canvas.getContext("2d");
      if (!context) return;
      host.appendChild(canvas);
      let frame = 0;
      let stopped = false;
      const started = performance.now();
      const pieces = createConfettiParticles();
      const timer = setTimeout(() => stop(), DURATION_MS);
      stop = () => {
        stopped = true;
        cancelAnimationFrame(frame);
        clearTimeout(timer);
        canvas.remove();
      };
      const draw = (now: number) => {
        if (stopped) return;
        const elapsed = now - started;
        if (elapsed >= DURATION_MS) {
          stop();
          return;
        }
        const particles = confettiFrame(elapsed / 1000, pieces);
        const width = host.clientWidth,
          height = host.clientHeight;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (
          canvas.width !== Math.round(width * dpr) ||
          canvas.height !== Math.round(height * dpr)
        ) {
          canvas.width = Math.round(width * dpr);
          canvas.height = Math.round(height * dpr);
        }
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);
        for (const p of particles) {
          context.save();
          context.translate(p.x * width, p.y * height);
          context.rotate(p.rotation);
          context.scale(1, p.flip);
          context.globalAlpha = p.opacity;
          context.fillStyle = p.color;
          context.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          context.restore();
        }
        frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
    },
    dispose() {
      stop();
    },
  };
};
