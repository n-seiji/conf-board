"""Rig the user-approved fixed GLB and author five independent looping clips."""
import bpy
import math
import json
from pathlib import Path
from mathutils import Vector,Quaternion,Matrix

ROOT=Path(__file__).resolve().parent
ROOT.mkdir(parents=True,exist_ok=True)
SOURCE=ROOT.parent/'kurita-miive-v2'/'kurita-miive-fixed.glb'
scene=bpy.data.scenes.new('miive • five motions')
bpy.context.window.scene=scene
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
meshes=list(scene.objects)
assert len(meshes)==20 and all(o.type=='MESH' for o in meshes)
assert not any('outline' in o.name.lower() for o in meshes)
for o in meshes:
    o.data.transform(o.matrix_world);o.matrix_world=Matrix.Identity(4)

character=bpy.data.collections.new('Animated character')
studio=bpy.data.collections.new('Preview studio')
scene.collection.children.link(character);scene.collection.children.link(studio)
for o in meshes:
    for c in list(o.users_collection):c.objects.unlink(o)
    character.objects.link(o)

bpy.ops.object.armature_add()
rig=bpy.context.object;rig.name='MiiveRig'
for c in list(rig.users_collection):c.objects.unlink(rig)
character.objects.link(rig)
rig.show_in_front=True
bpy.ops.object.mode_set(mode='EDIT')
rig.data.edit_bones.remove(rig.data.edit_bones[0])
def bone(name,head,tail,parent=None):
    b=rig.data.edit_bones.new(name);b.head=head;b.tail=tail
    if parent:b.parent=rig.data.edit_bones[parent]
    return b
bone('Root',(0,0,0),(0,0,.22))
bone('Hips',(0,.025,.73),(0,.025,1.0),'Root')
bone('Spine',(0,.025,1.0),(0,0,1.53),'Hips')
bone('Head',(0,0,1.55),(0,0,2.65),'Spine')
for side,s in [('L',-1),('R',1)]:
    bone('UpperArm.'+side,(s*.28,.015,1.39),(s*.455,.015,.955),'Spine')
    bone('Forearm.'+side,(s*.455,.015,.955),(s*.49,.015,.68),'UpperArm.'+side)
    bone('Leg.'+side,(s*.245,.025,.73),(s*.255,.025,.22),'Hips')
    bone('Foot.'+side,(s*.255,.025,.22),(s*.255,-.20,.10),'Leg.'+side)
bpy.ops.object.mode_set(mode='OBJECT')
for p in rig.pose.bones:p.rotation_mode='QUATERNION'

def smooth(a,b,x):
    t=max(0,min(1,(x-a)/(b-a)))
    return t*t*(3-2*t)

weight_report=[]
for o in meshes:
    groups={n:o.vertex_groups.new(name=n) for n in rig.pose.bones.keys()}
    center_x=sum(v.co.x for v in o.data.vertices)/len(o.data.vertices)
    side='L' if center_x<0 else 'R'
    for v in o.data.vertices:
        x,y,z=v.co
        if o.name.startswith('Head') or 'ear' in o.name:
            weights={'Head':1}
        elif o.name.startswith('Neck'):
            h=smooth(1.49,1.59,z);weights={'Head':h,'Spine':1-h}
        elif o.name.startswith('T-shirt'):
            arm=smooth(.245,.445,abs(x))*smooth(.86,1.04,z)
            spine=smooth(.77,1.16,z)
            s='L' if x<0 else 'R'
            weights={'UpperArm.'+s:arm,'Spine':(1-arm)*spine,'Hips':(1-arm)*(1-spine)}
        elif 'arm and hand' in o.name:
            upper=smooth(.855,1.02,z)
            weights={'UpperArm.'+side:upper,'Forearm.'+side:1-upper}
        elif 'mitten' in o.name:
            weights={'Forearm.'+side:1}
        elif o.name.startswith('Trousers'):
            waist=smooth(.59,.77,z)
            s='L' if x<0 else 'R'
            weights={'Hips':waist,'Leg.'+s:1-waist}
        elif 'sneaker' in o.name.lower():
            weights={'Foot.'+side:1}
        else:raise AssertionError('Unclassified mesh '+o.name)
        assert abs(sum(weights.values())-1)<1e-6
        for n,w in weights.items():
            if w>1e-6:groups[n].add([v.index],w,'REPLACE')
    o.parent=rig
    modifier=o.modifiers.new('Soft motion skin','ARMATURE');modifier.object=rig
    modifier.use_deform_preserve_volume=False
    weight_report.append({'mesh':o.name,'vertices':len(o.data.vertices)})

rig.animation_data_create();scene.render.fps=30
def reset():
    for p in rig.pose.bones:
        p.location=(0,0,0);p.rotation_quaternion=(1,0,0,0);p.scale=(1,1,1)

def pose(name,axis=(0,1,0),angle=0,offset=(0,0,0),scale=(1,1,1)):
    p=rig.pose.bones[name];rest=p.bone.matrix_local.to_quaternion()
    p.location=rest.inverted()@Vector(offset)
    p.rotation_quaternion=rest.inverted()@Quaternion(axis,angle)@rest
    # Root is oriented along Z in world coordinates: convert scale accordingly.
    if name=='Root':p.scale=(scale[0],scale[2],scale[1])
    else:p.scale=scale

def key(frame):
    for p in rig.pose.bones:
        for channel in ('location','rotation_quaternion','scale'):
            p.keyframe_insert(data_path=channel,frame=frame,group=p.name)

CLIPS=[('Wave',3.2,'手を振る'),('Bow',2.8,'おじぎ'),('Nod',2.4,'うなずく'),('Jump',2.8,'喜んでジャンプ'),('Dance',3.2,'左右にダンス')]
actions=[]
for name,duration,label in CLIPS:
    reset();a=bpy.data.actions.new(name);a.use_fake_user=True
    rig.animation_data.action=a
    count=round(duration*30)
    for f in range(count+1):
        t=f/count;phase=math.tau*t;env=math.sin(math.pi*t)**2
        reset()
        if name=='Wave':
            lift=smooth(0,.20,t)*(1-smooth(.80,1,t))
            flutter=math.sin(phase*3)*lift
            pose('UpperArm.R',angle=-1.63*lift)
            pose('Forearm.R',angle=(-.60+.23*math.sin(phase*3))*lift)
            pose('UpperArm.L',angle=.08*env)
            pose('Head',angle=-.05*env)
            pose('Spine',angle=-.025*env)
        elif name=='Bow':
            bow=smooth(.05,.38,t)*(1-smooth(.60,.94,t))
            pose('Hips',axis=(1,0,0),angle=.10*bow)
            pose('Spine',axis=(1,0,0),angle=.27*bow)
            pose('Head',axis=(1,0,0),angle=.09*bow)
            for side in ['L','R']:
                pose('UpperArm.'+side,axis=(1,0,0),angle=-.13*bow)
                pose('Forearm.'+side,axis=(1,0,0),angle=.05*bow)
        elif name=='Nod':
            nod=.19*env*math.sin(phase*2)
            pose('Head',axis=(1,0,0),angle=nod)
            pose('Spine',axis=(1,0,0),angle=.020*env)
            pose('UpperArm.L',angle=.045*env);pose('UpperArm.R',angle=-.045*env)
        elif name=='Jump':
            jump=lift=squash=0
            if .08<=t<.25:squash=.065*math.sin(math.pi*(t-.08)/.17)
            elif .25<=t<=.70:
                u=(t-.25)/.45;lift=math.sin(math.pi*u);jump=.35*4*u*(1-u);squash=-.028*lift
            elif .70<t<.89:squash=.07*math.sin(math.pi*(t-.70)/.19)
            pose('Root',offset=(0,0,jump),scale=(1+squash*.4,1+squash*.4,1-squash))
            for side,s in [('L',1),('R',-1)]:
                pose('UpperArm.'+side,angle=s*1.27*lift)
                pose('Forearm.'+side,angle=s*.22*lift)
                pose('Leg.'+side,angle=s*.065*lift)
                pose('Foot.'+side,axis=(1,0,0),angle=-.12*lift)
        else:
            beat=math.sin(phase*2);counter=math.sin(phase*2+.65)
            pose('Root',offset=(.095*env*beat,0,.035*env*(1-math.cos(phase*4))))
            pose('Hips',angle=.045*env*beat)
            pose('Spine',angle=-.095*env*beat)
            pose('Head',angle=.065*env*beat)
            for side,s in [('L',1),('R',-1)]:
                pose('UpperArm.'+side,angle=s*(.24+.15*s*counter)*env)
                pose('Forearm.'+side,axis=(1,0,0),angle=.34*env*(1+s*beat*.4))
                pose('Leg.'+side,axis=(1,0,0),angle=.035*env*s*beat)
                pose('Foot.'+side,axis=(1,0,0),angle=.08*env*max(0,s*beat))
        key(f+1)
    for layer in a.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for fc in bag.fcurves:
                    for p in fc.keyframe_points:p.interpolation='LINEAR'
    a['label_ja']=label;a['duration_seconds']=duration
    track=rig.animation_data.nla_tracks.new();track.name=name
    track.strips.new(name,1,a);track.mute=True
    actions.append(a)

loop_report=[]
for a in actions:
    rig.animation_data.action=a;samples=[]
    for f in (1,int(a.frame_range[1])):
        scene.frame_set(f)
        samples.append([n for p in rig.pose.bones for n in (*p.location,*p.rotation_quaternion,*p.scale)])
    error=max(abs(x-y) for x,y in zip(*samples));assert error<1e-5,(a.name,error)
    loop_report.append({'clip':a.name,'duration_seconds':a['duration_seconds'],'endpoint_error':error})

rig.animation_data.action=None;reset();scene.frame_set(1);bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
for o in character.objects:o.select_set(True)
bpy.context.view_layer.objects.active=rig
glb=ROOT/'kurita-miive-animated.glb'
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,use_active_scene=True,
    export_yup=True,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,
    export_force_sampling=True,export_anim_slide_to_zero=True,export_frame_range=False,
    export_skins=True,export_influence_nb=4,export_extras=True,export_cameras=False,export_lights=False,
    export_texcoords=True,export_materials='EXPORT')

# Preview the actual skinned mesh, with the same unlit materials as the GLB.
scene.render.engine='BLENDER_EEVEE';scene.render.resolution_x=1000;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.view_settings.view_transform='Standard';scene.view_settings.look='None'
scene.world=bpy.data.worlds.new('White motion preview');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(1,1,1,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=1
bpy.ops.object.camera_add(location=(.8,-10,1.7));cam=bpy.context.object
for c in list(cam.users_collection):c.objects.unlink(cam)
studio.objects.link(cam);cam.data.type='ORTHO';cam.data.ortho_scale=4.05
cam.rotation_euler=(Vector((0,0,1.70))-cam.location).to_track_quat('-Z','Y').to_euler();scene.camera=cam
sample_frames={'Wave':39,'Bow':40,'Nod':47,'Jump':40,'Dance':34}
for a in actions:
    rig.animation_data.action=a;scene.frame_set(sample_frames[a.name])
    scene.render.filepath=str(ROOT/('preview-'+a.name.lower()+'.png'));bpy.ops.render.render(write_still=True)
rig.animation_data.action=actions[0];scene.frame_start=1;scene.frame_end=97;scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.shading.type='MATERIAL';area.spaces.active.overlay.show_overlays=False
            area.spaces.active.region_3d.view_perspective='CAMERA'
for im in bpy.data.images:
    if im.source=='FILE':im.pack()
scene['README']='Five looping Actions at 30 fps: Wave / Bow / Nod / Jump / Dance. Press Space to preview Wave. No black outline hulls.'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'kurita-miive-animated.blend'))
(ROOT/'rig-report.json').write_text(json.dumps({'bones':len(rig.pose.bones),'meshes':weight_report,'clips':loop_report},indent=2)+'\n')
print(json.dumps({'glb':str(glb),'clips':loop_report,'bones':len(rig.pose.bones)}))
