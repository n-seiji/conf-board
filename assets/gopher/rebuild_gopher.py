"""Rebuild only the generated Gopher Studio; preserve the original scene."""
import bpy
from pathlib import Path

base=Path('/Users/sijis/ghq/github.com/n-seiji/conf-board/assets/gopher')
old=bpy.data.scenes.get('Gopher Studio')
if old:
    assert any(o.name=='GopherRig' and o.type=='ARMATURE' for o in old.objects)
    # Keep the first completed version available for comparison/recovery.
    backup=base/'gopher-previous.blend'
    if not backup.exists():
        bpy.ops.wm.save_as_mainfile(filepath=str(backup),copy=True,check_existing=False)
    original=bpy.data.scenes.get('Scene')
    if original is None:
        original=bpy.data.scenes.new('Scene')
    bpy.context.window.scene=original
    collections=list(old.collection.children)
    for obj in list(old.objects):
        data=obj.data
        bpy.data.objects.remove(obj,do_unlink=True)
        if data and data.users==0:
            if isinstance(data,bpy.types.Mesh):bpy.data.meshes.remove(data)
            elif isinstance(data,bpy.types.Armature):bpy.data.armatures.remove(data)
    for collection in collections:
        if collection.users<=1:bpy.data.collections.remove(collection)
    bpy.data.scenes.remove(old)
    for name in ['Dance','Wave','Hop']:
        action=bpy.data.actions.get(name)
        if action:bpy.data.actions.remove(action,do_unlink=True)
    for name in ['BodyColor','Ink','EyeWhite','PawCream','Teeth','EyeHighlight','StudioFloor']:
        mat=bpy.data.materials.get(name)
        if mat:bpy.data.materials.remove(mat,do_unlink=True)

exec(compile((base/'build_gopher.py').read_text(),'build_gopher.py','exec'))
exec(compile((base/'expressions_gopher.py').read_text(),'expressions_gopher.py','exec'))
exec(compile((base/'animate_gopher.py').read_text(),'animate_gopher.py','exec'))
result={'scene':bpy.context.scene.name,'rebuilt':True}
