"""Extract only the slogan's outlines from the existing OFL-licensed webfont.
Run: uv run --with fonttools --with brotli assets/gopher/build-message-font.py
"""
import json
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen

root = Path(__file__).resolve().parents[2]
source = root / "node_modules/@fontsource/m-plus-rounded-1c"
chars = set("働く意味で、世界を満たす。")
glyphs = {}

class OutlinePen(BasePen):
    def __init__(self, glyph_set):
        super().__init__(glyph_set)
        self.commands = []
    def emit(self, command, *points):
        self.commands.append(command)
        self.commands.extend(str(round(v, 3)) for point in points for v in point)
    def _moveTo(self, p): self.emit("m", p)
    def _lineTo(self, p): self.emit("l", p)
    def _qCurveToOne(self, control, end): self.emit("q", end, control)
    def _curveToOne(self, c1, c2, end): self.emit("b", end, c1, c2)
    def _closePath(self): pass

for path in sorted((source / "files").glob("*-900-normal.woff2")):
    with TTFont(path) as font:
        cmap = font.getBestCmap()
        for char in chars - glyphs.keys():
            name = cmap.get(ord(char))
            if not name: continue
            pen = OutlinePen(font.getGlyphSet())
            font.getGlyphSet()[name].draw(pen)
            glyphs[char] = {"ha": font["hmtx"][name][0], "x_min": 0, "x_max": font["head"].unitsPerEm, "o": " ".join(pen.commands)}
            resolution = font["head"].unitsPerEm
assert chars == glyphs.keys(), chars - glyphs.keys()
out = root / "src/globe/message-font.json"
out.write_text(json.dumps({"glyphs": glyphs, "familyName": "M PLUS Rounded 1c Slogan Subset", "resolution": resolution, "boundingBox": {"yMin": -200, "yMax": 1000}, "underlineThickness": 50}, ensure_ascii=False))
(root / "public/models/message-font-LICENSE.txt").write_text((source / "LICENSE").read_text())
print(f"Extracted {len(glyphs)} glyphs: {out.stat().st_size} bytes")
