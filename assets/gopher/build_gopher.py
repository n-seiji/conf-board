"""Run inside Blender via MCP. Creates a new scene; never deletes existing work."""
import bpy
import math
from mathutils import Vector, Quaternion, Matrix
from pathlib import Path

OUTPUT = Path('/Users/sijis/ghq/github.com/n-seiji/conf-board/assets/gopher')
GLB = OUTPUT.parents[1] / 'public/models/gopher.glb'
OUTPUT.mkdir(parents=True, exist_ok=True)
GLB.parent.mkdir(parents=True, exist_ok=True)

scene = bpy.data.scenes.new('Gopher Studio')
bpy.context.window.scene = scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 1000
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.render.fps = 30
scene.render.film_transparent = False
scene.view_settings.view_transform = 'AgX'
scene.world = bpy.data.worlds.new('Gopher Studio World')
scene.world.use_nodes = True
background = next(n for n in scene.world.node_tree.nodes if n.type == 'BACKGROUND')
background.inputs[0].default_value = (0.18, 0.23, 0.28, 1)
background.inputs[1].default_value = 0.45

character = bpy.data.collections.new('Gopher • export')
studio = bpy.data.collections.new('Studio • not exported')
scene.collection.children.link(character)
scene.collection.children.link(studio)

def linear(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

def material(name, color, roughness=0.55):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    rgba = tuple(linear(int(color[i:i+2], 16) / 255) for i in (0, 2, 4)) + (1,)
    mat.diffuse_color = rgba
    p = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value = rgba
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Specular IOR Level'].default_value = 0.12
    return mat

body_mat = material('BodyColor', '1BAEC7', 0.82)
body_mat['usage'] = 'Change Base Color to recolor all cyan parts. Three.js: material.name === BodyColor.'
ink = material('Ink', '080B0C', 1)
next(n for n in ink.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Specular IOR Level'].default_value = 0
white = material('EyeWhite', 'FFFFFC', 0.8)
cream = material('PawCream', 'F3CEA0', 0.85)
tooth = material('Teeth', 'FFFFFA', 0.8)
floor_mat = material('StudioFloor', 'E8E4DA', 0.8)
parts = []

def move_collection(obj, col):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    col.objects.link(obj)

def finish(obj, name, mat, bone='Body'):
    obj.name = name
    move_collection(obj, character)
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
    parts.append(obj)
    return obj

def ellipsoid(name, loc, scale, mat, bone='Body', segments=32, rings=20):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=loc)
    obj = bpy.context.object
    obj.scale = scale
    return finish(obj, name, mat, bone)

def round_box(name, loc, size, radius, mat, bone='Body'):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mod = obj.modifiers.new('Soft corners', 'BEVEL')
    mod.width = radius
    mod.segments = 4
    bpy.ops.object.modifier_apply(modifier=mod.name)
    finish(obj, name, mat, bone)
    mod = obj.modifiers.new('Face normals', 'WEIGHTED_NORMAL')
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj

def ear_ring(name, loc):
    bpy.ops.mesh.primitive_torus_add(major_segments=48,minor_segments=8,
        location=loc,rotation=(math.pi/2,0,0),major_radius=.188,minor_radius=.014)
    return finish(bpy.context.object,name,ink)

def stroke(name, points, radius, mat, bone):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 8
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    spline = curve.splines.new('BEZIER')
    spline.bezier_points.add(len(points)-1)
    for p, co in zip(spline.bezier_points, points):
        p.co = co
        p.handle_left_type = 'AUTO'
        p.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name, curve)
    character.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    return finish(bpy.context.object, name, mat, bone)

# Turnaround silhouette: elliptical crown, upright sides, rounded low belly.
verts = [(0, 0, 3.16)]
faces = []
profile=[]
for j in range(1,17):
    t=math.pi*j/32
    profile.append((math.sin(t),2.26+.90*math.cos(t)))
for j in range(1,11):
    t=j/10
    profile.append((1+.014*math.sin(math.pi*t),2.26-1.40*t))
for j in range(1,16):
    t=math.pi*j/32
    profile.append((math.cos(t),.86-.70*math.sin(t)))
segments,rings=64,len(profile)+1
for r,z in profile:
    for k in range(segments):
        a = 2 * math.pi * k / segments
        verts.append((.95*r*math.cos(a),.73*r*math.sin(a),z))
bottom = len(verts)
verts.append((0, 0, 0.16))
for k in range(segments):
    faces.append((0, 1+k, 1+(k+1)%segments))
for j in range(rings-2):
    start = 1+j*segments
    nxt = start+segments
    for k in range(segments):
        a, b = start+k, start+(k+1)%segments
        c, d = nxt+(k+1)%segments, nxt+k
        faces.append((a,d,c,b))
last = 1+(rings-2)*segments
for k in range(segments):
    faces.append((last+k, bottom, last+(k+1)%segments))
mesh = bpy.data.meshes.new('Rounded body surface')
mesh.from_pydata(verts, [], faces)
mesh.update()
obj = bpy.data.objects.new('Body', mesh)
character.objects.link(obj)
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
finish(obj, 'Body', body_mat)
# Recalculate mesh orientation consistently, including poles.
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')

for side, sign in [('L', 1), ('R', -1)]:
    # Turnaround sheet: small cyan ears on both sides, including their backs.
    ellipsoid('Ear.'+side, (sign*.815,.02,2.86), (.213,.137,.22), body_mat)
    ellipsoid('Ear center.'+side, (sign*.837,-.112,2.86), (.060,.024,.075), ink, segments=24, rings=16)
    # Lower, flatter eye disks and solid black pupils: no painted highlights.
    x=sign*.345
    eye=ellipsoid('Eye white.'+side,(x+sign*.008,-.677,2.43),(.277,.108,.284),white,segments=48,rings=32)
    eye.rotation_euler[2]=sign*.16
    pupil=ellipsoid('Pupil.'+side,(x+sign*.015,-.785,2.427),(.098,.021,.112),ink,segments=32,rings=20)
    pupil.rotation_euler[2]=sign*.16
    # Independent cream teardrop flippers; no mitten thumb or separate shin.
    hand=ellipsoid('Hand.'+side,(sign*.958,-.015,1.38),(.142,.145,.247),cream,'Arm.'+side)
    hand.rotation_euler[1]=-sign*.4
    foot=ellipsoid('Foot.'+side,(sign*.575,-.04,.17),(.265,.245,.135),cream,'Foot.'+side)
    foot.rotation_euler[1]=sign*.4
    foot.rotation_euler[2]=sign*.28
    # Ground the tilted foot precisely at its lowest actual vertex.
    bpy.context.view_layer.update()
    min_z=min((foot.matrix_world@v.co).z for v in foot.data.vertices)
    foot.location.z-=min_z

# A continuous two-lobed cream muzzle, nose, and two little rounded teeth.
ellipsoid('Muzzle rim', (0,-.726,2.116), (.239,.083,.122), ink)
ellipsoid('Muzzle cream', (0,-.754,2.116), (.214,.073,.099), cream)
for side, sign in [('L',1),('R',-1)]:
    round_box('Tooth rim.'+side,(sign*.060,-.730,1.975),(.127,.09,.205),.048,ink)
    round_box('Tooth.'+side,(sign*.060,-.76,1.98),(.087,.065,.161),.032,tooth)
ellipsoid('Nose', (0,-.807,2.218), (.125,.070,.074), ink)
ellipsoid('Tail', (0,.605,.46), (.145,.168,.17), cream)

# Apply requested proportions to geometry, including facial attachment positions.
proportions=Matrix.Diagonal((1.0,1.1,.9,1.0))
for part in parts:
    transform=proportions @ part.matrix_world
    for vertex in part.data.vertices:
        vertex.co=transform @ vertex.co
    part.matrix_world=Matrix.Identity(4)
    part.data.update()

# Simple named armature; rigid part weighting keeps the illustrated face intact.
bpy.ops.object.select_all(action='DESELECT')
arm_data = bpy.data.armatures.new('Gopher skeleton')
rig = bpy.data.objects.new('GopherRig',arm_data)
character.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
rig.show_in_front = True
bpy.ops.object.mode_set(mode='EDIT')
def bone(name, head, tail, parent=None):
    b = arm_data.edit_bones.new(name)
    b.head,b.tail = proportions @ Vector(head),proportions @ Vector(tail)
    if parent:
        b.parent = arm_data.edit_bones[parent]
    return b
bone('Root',(0,0,0),(0,0,.25))
bone('Body',(0,0,.32),(0,0,2.6),'Root')
for side,sign in [('L',1),('R',-1)]:
    bone('Arm.'+side,(sign*.82,0,1.59),(sign*1.03,0,1.17),'Body')
    bone('Foot.'+side,(sign*.57,0,.16),(sign*.57,-.28,.16),'Root')
bpy.ops.object.mode_set(mode='OBJECT')
for p in rig.pose.bones:
    p.rotation_mode = 'QUATERNION'
for obj in parts:
    mod = obj.modifiers.new('Gopher rig', 'ARMATURE')
    mod.object = rig
    obj.parent = rig

rig['body_material'] = 'BodyColor'
rig['animation_clips'] = 'Dance, Wave, Hop'
rig['forward_blender'] = '-Y (GLB: +Z)'
rig['origin'] = 'Feet at ground; use an outer Three.js Group for globe placement.'
rig['reference'] = 'User supplied gopher illustration; original reference rights remain with their owners.'

# Studio for preview only: soft key, fill, rim and warm neutral floor.
bpy.ops.mesh.primitive_plane_add(size=200)
floor = bpy.context.object
floor.name = 'Studio floor'
move_collection(floor,studio)
floor.data.materials.append(floor_mat)
def point_at(obj,target):
    obj.rotation_euler = (Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
def light(name,loc,power,size,color):
    data = bpy.data.lights.new(name,'AREA')
    data.energy,data.shape,data.size,data.color = power,'DISK',size,color
    obj = bpy.data.objects.new(name,data)
    studio.objects.link(obj)
    obj.location = loc
    point_at(obj,(0,0,1.5))
light('Key softbox',(-3,-4.5,7),650,5,(1,.9,.8))
light('Fill softbox',(4,-2,4),450,4,(.8,.93,1))
light('Rim softbox',(1,3,5),800,3,(1,1,1))
data = bpy.data.cameras.new('Portrait camera')
camera = bpy.data.objects.new('Portrait camera',data)
studio.objects.link(camera)
camera.location = (4,-8,4.1)
point_at(camera,(0,0,1.6))
data.type = 'ORTHO'
data.ortho_scale = 4.4
scene.camera = camera
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str(OUTPUT/'preview-three-quarter.png')
scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        area.spaces.active.region_3d.view_perspective = 'CAMERA'
        area.spaces.active.shading.type = 'MATERIAL'

result = {'scene':scene.name,'parts':len(parts),'vertices':sum(len(o.data.vertices) for o in parts),'bones':list(arm_data.bones.keys()),'output':str(OUTPUT)}
