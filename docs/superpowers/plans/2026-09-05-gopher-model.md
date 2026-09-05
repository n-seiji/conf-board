# Gopher model implementation plan

**Goal:** Build the approved reference-inspired rounded gopher in Blender through MCP, with editable body color and three looping animations for Three.js.

**Architecture:** A dedicated Blender scene contains separate named mesh parts weighted to a compact armature. All cyan parts share `BodyColor`. Only the character and armature are exported to a Y-up GLB with feet at the origin; a studio is retained in the editable blend file.

**Tech stack:** Blender 5.2, Blender MCP, glTF 2.0, existing Three.js 0.169.

**Spec:** User-approved design in conversation: rounded matte figure, no sticker border, Dance/Wave/Hop loops, shared BodyColor, foot origin, blend + GLB + usage example. Existing application behavior stays outside the requested asset work.

## Tasks

- [x] Model: write `assets/gopher/build_gopher.py`, execute via Blender MCP into a new scene, inspect front and three-quarter views. Retain existing scene data.
- [x] Animate: build six-bone rig with three named Actions; sample their endpoints and inspect motion poses. Grounded feet and root stationarity are required except for Hop's intentional vertical movement.
- [x] Export: write `assets/gopher/gopher.blend` and `public/models/gopher.glb`; parse GLB using the existing Three.js GLTFLoader and check clips, skeleton, bounds, materials, and independent recoloring.
- [x] Handoff: add a standalone preview and usage module under `assets/gopher/`, demonstrate color and clip switching plus globe-surface orientation, and document Blender editing and export steps.

## Accepted revision

The user supplied a turnaround sheet and explicitly requested a fresh rebuild from that reference. Rebuilt the body profile with an elliptical crown, straight sides and round low belly; lowered and flattened the eyes, removed all pupil highlights, used thin ear outlines with cyan backs, independent cream flippers, short outward feet, and a cream tail. Rebuilt all three Actions and re-exported the final GLB. The original scene and a previous-version blend backup remain available.

## Verification

Latest requested revision: removed ear and eye outlines, baked depth ×1.1 and height ×0.9 into geometry and skeleton. Added independent Neutral/Smile/Wink/Surprised morph expressions, preview controls, and runtime isolation tests. Exported GLB: 30,864 triangles, 1,147,384 bytes, height 2.844. All three animation and globe-placement checks pass.

Use visual inspection for silhouette, face, and posed limbs. Use actual exported animation tracks to check all three clips are nonempty, looping, and affect expected bones. Load the exported GLB in Three.js and inspect sampled animated bounds and independent material clones. No application code changes or dependency installation are required.
