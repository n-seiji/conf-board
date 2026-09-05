"""Build expanded slogan outlines. Run with: uv run --with shapely this-script.py"""
import json
from pathlib import Path
from shapely.geometry import Polygon, GeometryCollection
from shapely.affinity import scale, translate
from shapely.geometry.polygon import orient

root = Path(__file__).resolve().parents[2]
data = json.loads((root / "src/globe/message-font.json").read_text())
for char, glyph in data["glyphs"].items():
    tokens = iter(glyph["o"].split())
    rings, ring = [], []
    def point():
        return (float(next(tokens)), float(next(tokens)))
    for command in tokens:
        if command == "m":
            if ring:
                rings.append(ring)
            ring = [point()]
        elif command == "l":
            ring.append(point())
        elif command in ("q", "b"):
            start, end, control = ring[-1], point(), point()
            control2 = point() if command == "b" else None
            for step in range(1, 13):
                t = step / 12
                s = 1 - t
                ring.append(tuple(
                    s*s*start[i] + 2*s*t*control[i] + t*t*end[i]
                    if command == "q" else
                    s**3*start[i] + 3*s*s*t*control[i] + 3*s*t*t*control2[i] + t**3*end[i]
                    for i in range(2)
                ))
        else:
            raise ValueError(command)
    rings.append(ring)
    original = GeometryCollection()
    for ring in rings:
        original = original.symmetric_difference(Polygon(ring).buffer(0))
    # Compensate for fitting back into the tightly packed original glyph bounds.
    # Fit back to the original bounds so the packed rows do not start overlapping.
    bounds = original.bounds
    amount = data["resolution"] * (0.005 if char in "働意味世界満" else 0.012)
    original_parts = [original] if original.geom_type == "Polygon" else list(original.geoms)
    holes = [Polygon(hole) for part in original_parts for hole in part.interiors]
    for _ in range(24):
        bold = original.buffer(amount, quad_segs=6)
        b = bold.bounds
        bold = scale(bold, (bounds[2]-bounds[0])/(b[2]-b[0]),
                     (bounds[3]-bounds[1])/(b[3]-b[1]), origin=original.centroid)
        bold = translate(bold, bounds[0]-bold.bounds[0], bounds[1]-bold.bounds[1])
        parts = [bold] if bold.geom_type == "Polygon" else list(bold.geoms)
        if (len(parts) == len(original_parts)
                and sum(len(p.interiors) for p in parts) == len(holes)
                and all(hole.difference(bold).area / hole.area >= 0.65 for hole in holes)):
            break
        amount *= 0.8
    else:
        raise ValueError(f"{char}: could not safely expand outline")
    assert bold.is_valid and bold.area > original.area, char
    # A surviving pinhole is not enough: preserve most of every original counter.
    for hole in holes:
        assert hole.difference(bold).area / hole.area >= 0.65, f"{char}: counter collapsed"
    commands = []
    parts = [bold] if bold.geom_type == "Polygon" else list(bold.geoms)
    for part in parts:
        part = orient(part, sign=-1)
        for ring in [part.exterior, *part.interiors]:
            for i, (x, y) in enumerate(ring.coords):
                commands.extend(["m" if i == 0 else "l", f"{x:.3f}", f"{y:.3f}"])
    glyph["o"] = " ".join(commands)
    print(f"{char}: filled area {bold.area/original.area:.2f}x, expansion {amount:.1f}")
data["familyName"] += " Boldened"
(root / "src/globe/message-font-bold.json").write_text(json.dumps(data, ensure_ascii=False))
