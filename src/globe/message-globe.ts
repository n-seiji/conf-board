import {
  CatmullRomCurve3,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TessellateModifier } from "three/addons/modifiers/TessellateModifier.js";
import fontData from "./message-font-bold.json";

const ROWS = [
  { text: "働く", y: 0.69, width: 2.05 },
  { text: "意味で、", y: 0.23, width: 2.6 },
  { text: "世界を", y: -0.23, width: 2.55 },
  { text: "満たす。", y: -0.69, width: 2.1 },
];
// Dense packing with a narrow clearance for the raised side walls and outlines.
const GLYPH_HEIGHT = 0.4685;
const PUNCTUATION_WEIGHT = 0.24;

/** Real extruded glyphs bent around a sphere, not a raster label or a flat billboard. */
export const createMessageGlobe = () => {
  const group = new Group();
  group.name = "miive-message-globe";
  group.rotation.y = (4 * Math.PI) / 180;
  const base = new Mesh(
    new SphereGeometry(1, 96, 64),
    new MeshStandardMaterial({
      color: "#5fcfbf",
      roughness: 0.9,
      emissive: "#5fcfbf",
      emissiveIntensity: 0.12,
    }),
  );
  group.add(base);
  const font = new FontLoader().parse({
    ...fontData,
    ascender: 1000,
    descender: -200,
    underlinePosition: -100,
    boundingBox: { ...fontData.boundingBox, xMin: 0, xMax: 1000 },
    original_font_information: {
      license: "SIL Open Font License 1.1",
      source: "M PLUS Rounded 1c 900",
    },
  });
  const material = new MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.9,
    metalness: 0,
    emissive: "#ffffff",
    emissiveIntensity: 0.18,
  });
  const letters: Mesh[] = [];
  const outlineMaterial = new MeshBasicMaterial({ color: "#318f83" });
  const outlines: Mesh[] = [];
  for (const row of ROWS) {
    const chars = Array.from(row.text);
    const weights = chars.map((char) => (char === "、" || char === "。" ? PUNCTUATION_WEIGHT : 1));
    const unit = row.width / weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = -row.width / 2;
    chars.forEach((char, column) => {
      const cell = unit * weights[column]!;
      const cellCenter = cursor + cell / 2;
      cursor += cell;
      const shapes = font.generateShapes(char, 1);
      const project = (flatX: number, flatY: number, radius: number) => {
        const y = Math.max(-0.97, Math.min(0.97, flatY * 0.97));
        const x = (flatX / (row.width / 2)) * Math.sqrt(1 - y * y) * 0.98;
        return new Vector3(x, y, Math.sqrt(Math.max(0.001, 1 - x * x - y * y))).multiplyScalar(
          radius,
        );
      };
      const flat = new ExtrudeGeometry(shapes, {
        depth: 0.03,
        bevelEnabled: true,
        bevelThickness: 0.001,
        bevelSize: 0.0015,
        bevelSegments: 2,
        curveSegments: 8,
        steps: 1,
      });
      // Remove font side bearings: pack actual ink bounds, not full-width advances.
      // Punctuation retains its small size and baseline.
      flat.computeBoundingBox();
      const box = flat.boundingBox!;
      const centerX = (box.min.x + box.max.x) / 2;
      const scaleX = (cell * 0.985) / (box.max.x - box.min.x);
      flat.translate(-centerX, -0.36, 0);
      flat.scale(scaleX, GLYPH_HEIGHT, 1);
      flat.translate(cellCenter, row.y, 0);
      const geometry = new TessellateModifier(0.035, 7).modify(flat);
      flat.dispose();
      const points = geometry.getAttribute("position");
      const originalNormals = geometry.getAttribute("normal");
      const caps = Array.from({ length: points.count }, (_, i) => originalNormals.getZ(i) > 0.99);
      for (let i = 0; i < points.count; i++) {
        // Fit the frontal lettering to the circular silhouette, like the supplied artwork.
        // Unlike longitude wrapping, this keeps edge glyphs facing the reader.
        const p = project(points.getX(i), points.getY(i), 1.003 + points.getZ(i));
        points.setXYZ(i, p.x, p.y, p.z);
      }
      points.needsUpdate = true;
      geometry.computeVertexNormals();
      // ExtrudeGeometry is non-indexed. Analytic cap normals remove the visible
      // triangle patches without smoothing the crisp outline into its side wall.
      const normals = geometry.getAttribute("normal");
      for (let i = 0; i < points.count; i++) {
        if (!caps[i]) continue;
        const length = Math.hypot(points.getX(i), points.getY(i), points.getZ(i));
        normals.setXYZ(
          i,
          points.getX(i) / length,
          points.getY(i) / length,
          points.getZ(i) / length,
        );
      }
      normals.needsUpdate = true;
      geometry.computeBoundingSphere();
      const mesh = new Mesh(geometry, material);
      mesh.name = char;
      if (row.text === "満たす。") mesh.rotation.y = (5 * Math.PI) / 180;
      // Follow the font's actual contours, including counters. Child meshes inherit
      // the glyph's rise animation; a tiny round stroke avoids screen-space line limits.
      for (const shape of shapes) {
        for (const [index, contour] of [shape, ...shape.holes].entries()) {
          const samples = contour
            .getSpacedPoints(256)
            .slice(0, -1)
            .map((p) =>
              project(
                (p.x - centerX) * scaleX + cellCenter,
                (p.y - 0.36) * GLYPH_HEIGHT + row.y,
                1.0345,
              ),
            );
          const outline = new Mesh(
            new TubeGeometry(new CatmullRomCurve3(samples, true), 256, 0.0018, 4, true),
            outlineMaterial,
          );
          outline.name = index === 0 ? "glyph-outline-outer" : "glyph-outline-hole";
          mesh.add(outline);
          outlines.push(outline);
        }
      }
      group.add(mesh);
      letters.push(mesh);
    });
  }
  return {
    group,
    base,
    letters,
    update(seconds: number) {
      letters.forEach((mesh, i) => {
        const t = Math.max(0, Math.min(1, (seconds - i * 0.065) / 1.1));
        mesh.visible = t > 0;
        // Rise from within the mint sphere; staggered relief gradually fills its surface.
        mesh.scale.setScalar(0.92 + 0.08 * (1 - (1 - t) ** 3));
      });
    },
    dispose() {
      group.removeFromParent();
      base.geometry.dispose();
      base.material.dispose();
      material.dispose();
      outlineMaterial.dispose();
      outlines.forEach((m) => m.geometry.dispose());
      letters.forEach((m) => m.geometry.dispose());
    },
  };
};
