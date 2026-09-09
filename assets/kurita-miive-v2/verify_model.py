"""Verify the GLB container and round-trip it through Blender."""
import bpy
import bmesh
import json
import struct
from pathlib import Path
from mathutils import Vector

root=Path(__file__).resolve().parent
p=root/'kurita-miive-v2.glb'
raw=p.read_bytes()
magic,version,size=struct.unpack_from('<4sII',raw)
assert magic==b'glTF' and version==2 and size==len(raw)
n=struct.unpack_from('<I',raw,12)[0]
gltf=json.loads(raw[20:20+n])
assert all('KHR_materials_unlit' in m.get('extensions',{}) for m in gltf['materials'])
assert gltf.get('images') and all('bufferView' in im and 'uri' not in im for im in gltf['images'])
assert not gltf.get('cameras') and not gltf.get('skins')
assert not any('outline' in n.get('name','').lower() for n in gltf['nodes'])
assert not any('Outline' in m.get('name','') for m in gltf['materials'])

scene=bpy.data.scenes.new('Roundtrip validation')
bpy.context.window.scene=scene
bpy.ops.import_scene.gltf(filepath=str(p))
objs=list(scene.objects)
assert all(o.type=='MESH' for o in objs)
assert len(objs)==20,len(objs)
assert all(o.data.materials for o in objs)
assert not any(o.name=='Cube' for o in objs)
closed=[]
for o in objs:
    if 'outline' in o.name or 'thumb' in o.name or 'fold' in o.name or 'lace' in o.name or 'sole seam' in o.name:continue
    bm=bmesh.new();bm.from_mesh(o.data)
    # glTF splits vertices at material/UV seams; weld coincident vertices for the topology check.
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
    assert all(e.is_manifold for e in bm.edges),o.name
    closed.append(o.name);bm.free()
assert len(closed)==10,len(closed)
head=next(o for o in objs if o.name.startswith('Head') and 'outline' not in o.name)
points=[o.matrix_world@Vector(c) for o in objs for c in o.bound_box]
lo=[min(p[i] for p in points) for i in range(3)]
hi=[max(p[i] for p in points) for i in range(3)]
hb=min((head.matrix_world@Vector(c)).z for c in head.bound_box)
ratio=(hi[2]-lo[2])/(hi[2]-hb)
assert 1.95<ratio<2.05,ratio
report={'glb_roundtrip':'passed','mesh_objects':len(objs),'closed_character_volumes':len(closed),'materials':len(gltf['materials']),'all_materials_unlit':True,'embedded_images':len(gltf['images']),'external_dependencies':False,'height_to_head_ratio':round(ratio,4),'dimensions':[round(hi[i]-lo[i],4) for i in range(3)],'rigged':False,'size_bytes':len(raw)}
(root/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
