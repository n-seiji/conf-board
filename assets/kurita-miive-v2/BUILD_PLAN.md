# Approved illustration → 3D

The user approved `character-sheet.png` on 2026-09-05. This is the design source of truth; do not reuse the rejected model geometry or materials.

- [x] Build closed, rounded volumes from the illustrated contours: head/hair, ears, continuous T-shirt and sleeves, seamless arms/hands, trousers, sneakers.
- [x] Project the approved artwork onto the meshes. Preserve colors with glTF unlit materials; keep facial features graphic and avoid anatomical eyes, lips, and joints.
- [x] Export a self-contained GLB and editable Blender scene. Keep the approved PNG and generation prompt beside them.
- [x] Render front, three-quarter, side, and back views; compare silhouettes and colors with the approved sheet and correct visible problems.
- [x] Reimport the GLB and verify materials, embedded textures, mesh bounds, two-head proportions, and no studio objects in the export.

Outputs live exclusively in this asset directory; no application code changes or deployment are involved. The existing project has unrelated ongoing changes.
