"""Build actual rounded 3D volumes from the approved illustration, with its colors.

The PNG is used unchanged as a UV texture. No rejected v1 geometry is reused.
Run with Blender --background --factory-startup --python this_file.py.
"""
import bpy
import bmesh
import math
import json
from collections import deque
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parent
scene=bpy.data.scenes.new('miive • approved illustration in 3D')
bpy.context.window.scene=scene
character=bpy.data.collections.new('Character • export')
studio=bpy.data.collections.new('Preview studio')
scene.collection.children.link(character)
scene.collection.children.link(studio)
image=bpy.data.images.load(str(ROOT/'character-sheet.png'),check_existing=True)
image.pack()
W,H=image.size
PIX=list(image.pixels[:])

def color_at(x,y):
    x=max(0,min(W-1,int(x)));y=max(0,min(H-1,int(y)))
    k=((H-1-y)*W+x)*4
    return PIX[k:k+3]

def unlit(name,hexcode=None,texture=False):
    m=bpy.data.materials.new(name);m.use_nodes=True
    n=m.node_tree.nodes;n.clear();out=n.new('ShaderNodeOutputMaterial')
    if texture:
        source=n.new('ShaderNodeTexImage');source.image=image
        source.interpolation='Linear';source.extension='EXTEND'
        m.node_tree.links.new(source.outputs['Color'],out.inputs['Surface'])
    else:
        source=n.new('ShaderNodeRGB')
        def lin(v):
            c=int(v,16)/255
            return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
        rgba=tuple(lin(hexcode[i:i+2]) for i in (0,2,4))+(1,)
        source.outputs[0].default_value=rgba;m.diffuse_color=rgba
        m.node_tree.links.new(source.outputs[0],out.inputs['Surface'])
    return m

art=unlit('Approved illustration • original colors',texture=True)
skin=unlit('Skin • peach from approved palette','FFD5B3')
cotton=unlit('Cotton • illustration charcoal','202020')
trousers=unlit('Trousers • illustration charcoal','191A1A')
shoe=unlit('White sneaker','F4F4F2')
detail=unlit('Warm hand and ear detail','B97D58')
shoe_detail=unlit('Sneaker stitch • soft grey','858C8B')
ink=unlit('Outline • charcoal','101111');ink.use_backface_culling=True

def position(px,py):
    x=(px-323)*1.55/410
    z=1.55+(490-py)*1.55/410 if py<=490 else (929-py)*1.55/439
    return x,z

def uv_at(px,py):return px/W,1-py/H

def contour_from_art(x0,x1,y0,y1):
    """Read artwork silhouette into geometry; fill enclosed white facial features."""
    width=x1-x0+1;height=y1-y0+1
    foreground={(x,y) for y in range(y0,y1+1) for x in range(x0,x1+1) if min(color_at(x,y))<.90}
    outside=set();q=deque()
    for x in range(x0,x1+1):q.extend([(x,y0),(x,y1)])
    for y in range(y0,y1+1):q.extend([(x0,y),(x1,y)])
    while q:
        p=q.popleft()
        if p in outside or p in foreground:continue
        x,y=p
        if x<x0 or x>x1 or y<y0 or y>y1:continue
        outside.add(p);q.extend([(x-1,y),(x+1,y),(x,y-1),(x,y+1)])
    filled={(x,y) for y in range(y0,y1+1) for x in range(x0,x1+1) if (x,y) not in outside}
    edges={}
    for x,y in filled:
        if (x,y-1) not in filled:edges.setdefault((x,y),[]).append((x+1,y))
        if (x+1,y) not in filled:edges.setdefault((x+1,y),[]).append((x+1,y+1))
        if (x,y+1) not in filled:edges.setdefault((x+1,y+1),[]).append((x,y+1))
        if (x-1,y) not in filled:edges.setdefault((x,y+1),[]).append((x,y))
    paths=[]
    while edges:
        start=next(iter(edges));p=start;path=[]
        while p in edges:
            path.append(p);v=edges[p].pop()
            if not edges[p]:del edges[p]
            p=v
            if p==start:break
        paths.append(path)
    boundary=max(paths,key=len)
    # Remove pixel stair steps geometrically without changing the source image.
    for _ in range(4):
        boundary=[tuple((boundary[(i-2)%len(boundary)][j]+2*boundary[(i-1)%len(boundary)][j]+3*p[j]+2*boundary[(i+1)%len(boundary)][j]+boundary[(i+2)%len(boundary)][j])/9 for j in [0,1]) for i,p in enumerate(boundary)]
    return resample(boundary,256)

def resample(points,count):
    lengths=[math.dist(points[i],points[(i+1)%len(points)]) for i in range(len(points))]
    total=sum(lengths);out=[];j=0;start=0
    for n in range(count):
        target=n*total/count
        while start+lengths[j]<target:
            start+=lengths[j];j+=1
        t=(target-start)/max(lengths[j],1e-9)
        a=points[j];b=points[(j+1)%len(points)]
        out.append((a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t))
    return out

def smooth_poly(points,count=192):
    # Centripetal-style rounded hand-drawn contour with modest corner smoothing.
    for _ in range(2):
        new=[]
        for a,b in zip(points,points[1:]+points[:1]):
            new.extend([(a[0]*.8+b[0]*.2,a[1]*.8+b[1]*.2),(a[0]*.2+b[0]*.8,a[1]*.2+b[1]*.8)])
        points=new
    return resample(points,count)

def row_bounds(x0,x1,y):
    hits=[x for x in range(x0,x1+1) if min(color_at(x,y))<.85]
    return (min(hits),max(hits)) if hits else ((x0+x1)/2-2,(x0+x1)/2+2)

front_rows={y:row_bounds(106,530,y) for y in range(78,491)}
back_rows={y:row_bounds(1050,1467,y) for y in range(78,476)}
dark_back_rows={}
for y in range(327,465):
    runs=[];start=None
    for x in range(1050,1468):
        dark=max(color_at(x,y))<.28
        if dark and start is None:start=x
        if not dark and start is not None:runs.append((start,x-1));start=None
    if start is not None:runs.append((start,1467))
    dark_back_rows[y]=max(runs,key=lambda p:p[1]-p[0]) if runs else back_rows[y]

def head_back_uv(px,py):
    yb=max(99,min(463,99+(py-79)*(463-99)/(490-79)))
    fl,fr=front_rows[max(78,min(490,round(py)))];bl,br=back_rows[round(yb)]
    if round(yb)>=327:
        bl,br=dark_back_rows[round(yb)]
    frac=max(.07,min(.93,(px-fl)/max(1,fr-fl)))
    return uv_at(br-frac*(br-bl),yb)

def shirt_back_uv(px,py):
    return uv_at(1260-(px-323)*.965,480+(py-490)*1.035)

objects=[]
def volume(name,outline,center,front_depth,back_depth=None,yoffset=0,backmat=None,backuv=None,rings=32,front_power=3):
    """Closed smooth volume with independently UV-mapped front/back hemispheres."""
    back_depth=back_depth or front_depth
    N=len(outline);verts=[];coords=[];faces=[];sides=[];radii=[]
    equator=[]
    for side in [-1,1]:
        cidx=len(verts);x,z=position(*center)
        verts.append((x,yoffset+side*(front_depth if side<0 else back_depth),z));coords.append(center);radii.append(0)
        prev=None
        for k in range(1,rings+1):
            r=k/rings
            if side==1 and k==rings:
                current=equator
            else:
                current=[]
                for bx,by in outline:
                    px=center[0]+r*(bx-center[0]);py=center[1]+r*(by-center[1])
                    x,z=position(px,py)
                    bulge=math.sqrt(max(0,1-r**(front_power if side<0 else 2.4)))
                    depth=(front_depth if side<0 else back_depth)*bulge
                    current.append(len(verts));verts.append((x,yoffset+side*depth,z));radii.append(r)
                    factor=(.87+(r-.87)*.12)/r if r>.87 else 1
                    coords.append((center[0]+(px-center[0])*factor,center[1]+(py-center[1])*factor))
                if side<0 and k==rings:equator=current
            if prev is None:
                for i in range(N):faces.append((cidx,current[i],current[(i+1)%N]));sides.append(side)
            else:
                for i in range(N):faces.append((prev[i],current[i],current[(i+1)%N],prev[(i+1)%N]));sides.append(side)
            prev=current
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update()
    o=bpy.data.objects.new(name,me);character.objects.link(o)
    me.materials.append(art)
    me.materials.append(backmat or art)
    uv=me.uv_layers.new(name='Illustration projection')
    for p,side in zip(me.polygons,sides):
        p.use_smooth=True;p.material_index=0 if side<0 else 1
        if 'sneaker' in name and max(radii[i] for i in p.vertices)>.70:p.material_index=1
        for li in p.loop_indices:
            px,py=coords[me.loops[li].vertex_index]
            # Extend an interior color toward the seam instead of stretching
            # anti-aliased black/white silhouette pixels over the side surface.
            uv.data[li].uv=uv_at(px,py) if side<0 or backuv is None else backuv(px,py)
    bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(me);bm.free()
    o['design_source']='character-sheet.png, approved by user'
    if 'arm and hand' in name or 'ear' in name or name.startswith('Neck'):
        me.materials[0]=skin
    if 'sneaker' in name:me.materials[0]=shoe
    cx,cz=position(*center);o['outline_center']=[cx,yoffset,cz]
    objects.append(o)
    return o

# Every part is constructed anew from the approved drawing.
head_outline=smooth_poly([(113,275),(118,236),(135,197),(156,163),(185,132),(219,108),(245,97),(269,100),(286,111),(306,96),(331,84),(358,81),(385,86),(416,100),(448,124),(478,158),(502,198),(518,237),(523,273),(517,296),(500,321),(482,340),(474,364),(469,393),(455,426),(432,453),(407,471),(377,482),(346,488),(315,489),(282,484),(251,478),(224,467),(202,451),(187,432),(177,410),(172,383),(169,357),(162,340),(143,330),(127,311),(117,293)],256)
head=volume('Head and hair • illustrated smile',head_outline,(323,301),.54,.61,backuv=head_back_uv,rings=52,front_power=3.5)
left_ear=smooth_poly([(154,345),(167,350),(177,367),(183,389),(189,404),(182,418),(169,426),(155,420),(144,407),(136,386),(135,366),(141,351)],128)
right_ear=smooth_poly([(479,346),(493,348),(503,362),(504,380),(497,399),(485,416),(473,425),(462,420),(464,404),(471,385),(471,361)],128)
volume('Left ear',left_ear,(161,383),.069,.069,.025,skin,rings=20)
volume('Right ear',right_ear,(484,383),.069,.069,.025,skin,rings=20)

# Continuous neckline, shoulder and sleeves, with no separate shoulder spheres.
shirt_outline=smooth_poly([(286,489),(291,502),(304,512),(325,516),(344,511),(356,503),(362,489),(390,500),(414,514),(432,534),(448,564),(463,594),(477,617),(456,629),(429,638),(429,713),(410,720),(246,722),(220,715),(221,637),(195,631),(173,618),(187,584),(201,550),(218,525),(243,505),(267,496)])
shirt=volume('T-shirt • continuous shoulders and sleeves',shirt_outline,(324,602),.225,.20,backmat=art,backuv=shirt_back_uv,rings=38,front_power=5)

neck_outline=smooth_poly([(287,475),(356,475),(361,491),(354,505),(334,512),(310,510),(292,502)])
neck=volume('Neck • mostly concealed',neck_outline,(324,491),.12,.12,yoffset=.035,backmat=skin,rings=16)

left_arm=[(188,623),(221,635),(220,660),(217,683),(219,700),(222,713),(221,725),(212,736),(200,740),(187,737),(177,727),(174,714),(177,696),(181,683),(183,655)]
right_arm=[(428,638),(460,625),(465,650),(468,676),(475,695),(477,712),(474,726),(466,736),(451,741),(439,736),(430,725),(427,713),(431,699),(431,680)]
volume('Left arm and hand • seamless',smooth_poly(left_arm,128),(199,687),.087,.080,.015,skin,rings=26)
volume('Right arm and hand • seamless',smooth_poly(right_arm,128),(451,686),.087,.080,.015,skin,rings=26)

trouser_outline=smooth_poly([(223,705),(426,705),(424,754),(423,813),(419,865),(411,876),(393,881),(371,877),(358,867),(347,822),(328,753),(316,752),(306,800),(297,862),(289,875),(271,881),(249,877),(234,869),(230,836),(226,783)])
volume('Trousers • continuous waist and legs',trouser_outline,(324,734),.158,.153,.025,trousers,rings=40,front_power=6)

left_shoe=smooth_poly([(239,874),(249,871),(270,876),(286,888),(294,898),(297,914),(286,921),(264,925),(237,926),(216,920),(211,911),(215,897),(227,886)],128)
right_shoe=smooth_poly([(369,875),(383,872),(404,878),(420,888),(433,901),(439,913),(437,920),(422,926),(397,926),(371,922),(356,915),(357,899),(362,886)],128)
volume('Left sneaker',left_shoe,(253,902),.242,.214,-.02,shoe,rings=26,front_power=3)
volume('Right sneaker',right_shoe,(397,902),.242,.214,-.02,shoe,rings=26,front_power=3)

# Thin inverted hulls preserve the illustration's contour when viewed from the side.
for obj in list(objects):
    shell=obj.copy();shell.data=obj.data.copy();shell.name=obj.name+' • outline'
    character.objects.link(shell);shell.data.materials.clear();shell.data.materials.append(ink)
    bm=bmesh.new();bm.from_mesh(shell.data);bm.normal_update()
    origin=Vector(obj['outline_center'])
    for v in bm.verts:
        ray=v.co-origin
        v.co=origin+ray+ray.normalized()*.012
    bmesh.ops.reverse_faces(bm,faces=bm.faces);bm.to_mesh(shell.data);bm.free()
    for p in shell.data.polygons:p.material_index=0

def stroke(name,points,material=detail,radius=.0055):
    d=bpy.data.curves.new(name,'CURVE');d.dimensions='3D';d.bevel_depth=radius;d.bevel_resolution=3;d.resolution_u=12
    spline=d.splines.new('BEZIER');spline.bezier_points.add(len(points)-1)
    for p,(px,py,depth) in zip(spline.bezier_points,points):
        x,z=position(px,py);p.co=(x,depth,z);p.handle_left_type='AUTO';p.handle_right_type='AUTO'
    obj=bpy.data.objects.new(name,d);character.objects.link(obj);d.materials.append(material)
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    bpy.ops.object.convert(target='MESH')

stroke('Left mitten thumb',[(206,712,-.077),(208,724,-.075),(214,727,-.063)])
stroke('Right mitten thumb',[(444,712,-.077),(442,724,-.075),(437,727,-.063)])
stroke('Left ear inner fold',[(144,366,-.038),(151,359,-.047),(160,361,-.047),(167,369,-.039)],radius=.005)
stroke('Right ear inner fold',[(481,362,-.046),(490,358,-.045),(497,366,-.038)],radius=.005)
for shift in [0,144]:
    stroke('Sneaker lace',[(241+shift,890,-.226),(254+shift,888,-.230),(270+shift,893,-.225)],shoe_detail,.0045)
    stroke('Sneaker lace',[(237+shift,898,-.239),(253+shift,896,-.253),(273+shift,900,-.236)],shoe_detail,.0045)
    stroke('Sneaker sole seam',[(224+shift,914,-.175),(240+shift,918,-.220),(258+shift,919,-.225),(277+shift,915,-.200),(287+shift,910,-.148)],shoe_detail,.004)

# Export only the model; preserve UVs and original colors with KHR_materials_unlit.
bpy.ops.object.select_all(action='DESELECT')
for o in character.objects:
    # Some viewers force double-sided rendering and turn an inverted outline
    # hull into an opaque black cover. Keep it in Blender, never in the GLB.
    o.select_set(' • outline' not in o.name)
bpy.context.view_layer.objects.active=head
glb=ROOT/'kurita-miive-v2.glb'
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,use_active_scene=True,export_apply=True)

scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x=1100;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.view_settings.view_transform='Standard'
scene.view_settings.look='None'
scene.world=bpy.data.worlds.new('White illustration backdrop');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(1,1,1,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=1
scene.render.film_transparent=False

bpy.ops.object.camera_add(location=(0,-10,1.55))
cam=bpy.context.object
for c in list(cam.users_collection):c.objects.unlink(cam)
studio.objects.link(cam)
cam.name='Illustration camera';cam.data.type='ORTHO';cam.data.ortho_scale=3.64;scene.camera=cam
def aim(degrees):
    a=math.radians(degrees);cam.location=(10*math.sin(a),-10*math.cos(a),1.55)
    cam.rotation_euler=(Vector((0,0,1.55))-cam.location).to_track_quat('-Z','Y').to_euler()
aim(25)
scene['source']='Approved 2D character-sheet.png'
scene['look']='Unlit illustrated 3D; graphic eyes and smile, continuous arms and T-shirt'
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.shading.type='MATERIAL'
            area.spaces.active.overlay.show_overlays=False
            area.spaces.active.region_3d.view_perspective='CAMERA'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'kurita-miive-v2.blend'))
for name,angle in [('front',0),('preview',30),('side',90),('back',180)]:
    aim(angle);scene.render.filepath=str(ROOT/(name+'.png'));bpy.ops.render.render(write_still=True)
print(json.dumps({'glb':str(glb),'model_parts':len(objects),'head_contour_points':len(head_outline)}))
