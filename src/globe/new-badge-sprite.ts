import { CanvasTexture, Group, Sprite, SpriteMaterial, SRGBColorSpace } from "three";

/** Shared textures; each NEW label owns only its small sprite materials. */
export const createNewBadgeSprites = () => {
  const texture = (star: boolean) => {
    const canvas = document.createElement("canvas");
    canvas.width = star ? 64 : 256;
    canvas.height = 96;
    const ctx = canvas.getContext("2d")!;
    if (star) {
      ctx.fillStyle = "#fff3a0";
      ctx.beginPath();
      ctx.moveTo(32, 0);
      ctx.lineTo(40, 35);
      ctx.lineTo(64, 48);
      ctx.lineTo(40, 61);
      ctx.lineTo(32, 96);
      ctx.lineTo(24, 61);
      ctx.lineTo(0, 48);
      ctx.lineTo(24, 35);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = "#fff3a0";
      ctx.strokeStyle = "#34534e";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.roundRect(4, 4, 248, 88, 28);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#34534e";
      ctx.font = "900 58px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("NEW", 128, 49);
    }
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    return map;
  };
  const labelMap = texture(false),
    starMap = texture(true);
  return {
    create() {
      const group = new Group();
      const label = new Sprite(new SpriteMaterial({ map: labelMap, depthWrite: false }));
      label.scale.set(0.18, 0.0675, 1);
      group.add(label);
      const stars = [-1, 1].map((side) => {
        const sprite = new Sprite(new SpriteMaterial({ map: starMap, depthWrite: false }));
        sprite.position.set(side * 0.12, side * 0.018, 0);
        group.add(sprite);
        return sprite;
      });
      return {
        group,
        label,
        setLabelVisible(visible: boolean) {
          label.visible = visible;
        },
        update(seconds: number) {
          stars.forEach((star, i) => {
            const glow = (1 + Math.sin(seconds * 5 + i * Math.PI)) / 2;
            star.material.opacity = 0.25 + glow * 0.75;
            star.scale.setScalar(0.03 + glow * 0.03);
            star.material.rotation = seconds * 0.4 * (i ? -1 : 1);
          });
        },
        dispose() {
          group.removeFromParent();
          label.material.dispose();
          stars.forEach((s) => s.material.dispose());
        },
      };
    },
    dispose() {
      labelMap.dispose();
      starMap.dispose();
    },
  };
};
