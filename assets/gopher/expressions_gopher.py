"""Build independent shape-key facial expressions; body animation remains separate."""
import bpy
import math
from mathutils import Vector

scene=bpy.context.scene
rig=scene.objects['GopherRig']
col=rig.users_collection[0]
ink=bpy.data.materials['Ink']
face_parts=[o for o in col.objects if o.type=='MESH' and o.name.startswith(('Eye white.','Pupil.','Muzzle','Tooth','Nose'))]

# Mouth and tongue are collapsed inside the body in the neutral expression.
for name,material_name,color in [('Open mouth','Ink',None),('Tongue','TonguePink',(0.65,.08,.12,1))]:
    mat=bpy.data.materials.get(material_name)
    if mat is None:
        mat=bpy.data.materials.new(material_name);mat.use_nodes=True
        p=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        p.inputs['Base Color'].default_value=color;p.inputs['Roughness'].default_value=.85
        mat.diffuse_color=color
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=20)
    o=bpy.context.object;o.name=name
    for c in list(o.users_collection):c.objects.unlink(o)
    col.objects.link(o);o.data.materials.append(mat)
    for poly in o.data.polygons:poly.use_smooth=True
    o.vertex_groups.new(name='Body').add(list(range(len(o.data.vertices))),1,'REPLACE')
    # Retain unit sphere coordinates temporarily for target construction.
    face_parts.append(o)

# Construct matching shape keys before joining; Blender joins matching key names.
for o in face_parts:
    o.shape_key_add(name='Basis')
    targets={name:o.shape_key_add(name=name) for name in ['Smile','Wink','Surprised']}
    original=[v.co.copy() for v in o.data.vertices]
    if o.name in ['Open mouth','Tongue']:
        mouth=o.name=='Open mouth'
        center=Vector((0,-.807 if mouth else -.862,1.69 if mouth else 1.57))
        size=Vector((.165,.06,.205) if mouth else (.085,.025,.046))
        for i,v in enumerate(original):
            collapsed=Vector((v.x*.001, v.y*.001,1.7+v.z*.001))
            o.data.vertices[i].co=collapsed
            o.data.shape_keys.key_blocks['Basis'].data[i].co=collapsed
            for name,key in targets.items():
                key.data[i].co=center+Vector((v.x*size.x,v.y*size.y,v.z*size.z)) if name=='Surprised' else collapsed
    else:
        center=sum(original,Vector())/len(original)
        for name,key in targets.items():
            if o.name.startswith('Pupil.'):
                closed=name=='Smile' or (name=='Wink' and o.name.endswith('.L'))
                for i,v in enumerate(original):
                    d=v-center
                    if closed:
                        x=d.x/.098
                        key.data[i].co=center+Vector((d.x*1.68,d.y, .080*(1-x*x)+d.z*.115))
                    elif name=='Surprised':
                        key.data[i].co=center+Vector((d.x*.72,d.y,d.z*.72))
            elif o.name.startswith('Eye white.') and name=='Surprised':
                for i,v in enumerate(original):
                    d=v-center;key.data[i].co=center+Vector((d.x*1.055,d.y,d.z*1.055))
    o['face_part']=True

bpy.ops.object.select_all(action='DESELECT')
for o in face_parts:o.select_set(True)
bpy.context.view_layer.objects.active=face_parts[0]
bpy.ops.object.join()
face=bpy.context.object;face.name='FaceExpressions'
face.parent=rig
if not any(m.type=='ARMATURE' for m in face.modifiers):
    face.modifiers.new('Gopher rig','ARMATURE').object=rig
face['expressions']='Neutral (all 0), Smile, Wink, Surprised; set one key to 1'
for key in face.data.shape_keys.key_blocks:key.value=0
result={'face':face.name,'keys':list(face.data.shape_keys.key_blocks.keys()),'vertices':len(face.data.vertices)}
