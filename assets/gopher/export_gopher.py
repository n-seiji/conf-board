"""Save editable studio and export a joined, skinned GLB through Blender MCP."""
import bpy
import json
from pathlib import Path
from mathutils import Vector

OUTPUT=Path('/Users/sijis/ghq/github.com/n-seiji/conf-board/assets/gopher')
GLB=OUTPUT.parents[1]/'public/models/gopher.glb'
scene=bpy.context.scene
rig=next(o for o in scene.objects if o.type=='ARMATURE')
collection=rig.users_collection[0]
rig.animation_data.action=None
for track in rig.animation_data.nla_tracks:
    track.mute=True
for p in rig.pose.bones:
    p.location=(0,0,0)
    p.rotation_quaternion=(1,0,0,0)
    p.scale=(1,1,1)
scene.frame_set(1)
bpy.context.view_layer.update()

# Retain the separate named components in the .blend, combine only export copies.
copies=[]
for obj in list(collection.objects):
    if obj.type=='MESH' and obj.name!='FaceExpressions':
        copy=obj.copy()
        copy.data=obj.data.copy()
        collection.objects.link(copy)
        copies.append(copy)
bpy.ops.object.select_all(action='DESELECT')
for obj in copies:
    obj.select_set(True)
bpy.context.view_layer.objects.active=copies[0]
bpy.ops.object.join()
joined=bpy.context.object
joined.name='GopherMesh'
rig.select_set(True)
face=scene.objects.get('FaceExpressions')
if face:
    face.select_set(True)
    for key in face.data.shape_keys.key_blocks:key.value=0
bpy.context.view_layer.objects.active=rig
try:
    bpy.ops.export_scene.gltf(
        filepath=str(GLB),export_format='GLB',use_selection=True,use_active_scene=True,
        export_yup=True,export_animations=True,export_animation_mode='ACTIONS',
        export_anim_single_armature=True,export_force_sampling=True,
        export_anim_slide_to_zero=True,export_frame_range=False,
        export_skins=True,export_influence_nb=4,export_morph=True,
        export_morph_animation=False,
        export_extras=True,export_cameras=False,export_lights=False,
        export_texcoords=False,export_materials='EXPORT',
    )
finally:
    export_mesh=joined.data
    bpy.data.objects.remove(joined,do_unlink=True)
    if export_mesh.users==0:
        bpy.data.meshes.remove(export_mesh)

# Portraits are useful outside Blender too.
scene.render.resolution_x=1000
scene.render.resolution_y=1000
camera=scene.camera
camera.location=(4,-8,4.1)
camera.rotation_euler=(Vector((0,0,1.6))-camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(OUTPUT/'preview-three-quarter.png')
bpy.ops.render.render(write_still=True)
camera.location=(0,-9,2.4)
camera.rotation_euler=(Vector((0,0,1.6))-camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(OUTPUT/'preview-front.png')
bpy.ops.render.render(write_still=True)
camera.location=(4,8,3.6)
camera.rotation_euler=(Vector((0,0,1.6))-camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(OUTPUT/'preview-back.png')
bpy.ops.render.render(write_still=True)
camera.location=(9,0,2.4)
camera.rotation_euler=(Vector((0,0,1.6))-camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(OUTPUT/'preview-side.png')
bpy.ops.render.render(write_still=True)
camera.location=(4,-8,4.1)
camera.rotation_euler=(Vector((0,0,1.6))-camera.location).to_track_quat('-Z','Y').to_euler()
rig.animation_data.action=bpy.data.actions['Wave']
scene.frame_set(46)
scene.render.filepath=str(OUTPUT/'preview-wave.png')
bpy.ops.render.render(write_still=True)

# Open on Wave frame 1: the reference's neutral stance, ready for Space to play.
rig.animation_data.action=bpy.data.actions['Wave']
scene.frame_start=1
scene.frame_end=91
scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active=rig
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.region_3d.view_perspective='CAMERA'
        area.spaces.active.shading.type='MATERIAL'
scene['README']='Gopher: Dance 1–97 / Wave 1–91 / Hop 1–73 at 30fps. All blue surfaces: BodyColor material. GLB +Y up / +Z front. Studio excluded from GLB.'
scene.render.filepath=str(OUTPUT/'preview-three-quarter.png')
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT/'gopher.blend'),check_existing=False)
result={'blend':str(OUTPUT/'gopher.blend'),'glb':str(GLB),'glb_bytes':GLB.stat().st_size,'scene':scene.name}
