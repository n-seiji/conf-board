"""Run after build_gopher.py in the active Gopher Studio scene via MCP."""
import bpy
import math
from mathutils import Vector, Quaternion
from pathlib import Path

OUTPUT=Path('/Users/sijis/ghq/github.com/n-seiji/conf-board/assets/gopher')
scene=bpy.context.scene
rig=next(o for o in scene.objects if o.type=='ARMATURE')
scene.render.fps=30
rig.animation_data_create()

def reset_pose():
    for p in rig.pose.bones:
        p.location=(0,0,0)
        p.rotation_quaternion=(1,0,0,0)
        p.scale=(1,1,1)

def pose(name, offset=(0,0,0), axis=(0,1,0), angle=0, scale=(1,1,1)):
    p=rig.pose.bones[name]
    rest=p.bone.matrix_local.to_quaternion()
    p.location=rest.inverted() @ Vector(offset)
    p.rotation_quaternion=rest.inverted() @ Quaternion(axis,angle) @ rest
    p.scale=scale

def key(frame):
    for p in rig.pose.bones:
        for prop in ('location','rotation_quaternion','scale'):
            p.keyframe_insert(data_path=prop, frame=frame, group=p.name)

actions=[]
for name,seconds in [('Dance',3.2),('Wave',3.0),('Hop',2.4)]:
    reset_pose()
    action=bpy.data.actions.new(name)
    action.use_fake_user=True
    rig.animation_data.action=action
    count=round(seconds*30)
    for f in range(count+1):
        t=f/count
        a=math.tau*t
        reset_pose()
        if name=='Dance':
            beat=math.sin(a*2)
            # Squash and sway around the belly's base, with planted alternating feet.
            pose('Body',offset=(0,0,.035*(1-math.cos(4*a))),axis=(0,1,0),angle=.085*math.sin(a*2),scale=(1+.018*math.sin(4*a),1-.025*math.sin(4*a),1+.018*math.sin(4*a)))
            for side,sign in [('L',1),('R',-1)]:
                pose('Arm.'+side,axis=(0,1,0),angle=-sign*(.4+.7*math.sin(a*2+sign*.6)))
                pose('Foot.'+side,offset=(0,0,.075*max(0,sign*beat)**2),axis=(1,0,0),angle=.13*max(0,sign*beat))
        elif name=='Wave':
            # Smooth envelope: lower the hand at both ends for seamless repeat.
            envelope=math.sin(math.pi*t)**2
            pose('Body',axis=(0,1,0),angle=-.045*envelope)
            pose('Arm.L',axis=(0,1,0),angle=-envelope*(2.0+.3*math.sin(a*3)))
            pose('Arm.R',axis=(0,1,0),angle=-.1*envelope)
        else:
            # Crouch -> takeoff -> float -> landing -> settle, twice per loop.
            u=(t*2)%1
            jump=0.0
            squash=0.0
            lift=0.0
            if u<.18:
                squash=.13*math.sin(math.pi*u/.18)
            elif u<.72:
                v=(u-.18)/.54
                jump=.48*math.sin(math.pi*v)
                lift=math.sin(math.pi*v)
                squash=-.05*math.sin(math.pi*v)
            elif u<.92:
                squash=.11*math.sin(math.pi*(u-.72)/.20)
            pose('Root',offset=(0,0,jump))
            pose('Body',scale=(1+squash*.5,1-squash,1+squash*.5))
            for side,sign in [('L',1),('R',-1)]:
                pose('Arm.'+side,axis=(0,1,0),angle=-sign*1.9*lift)
                pose('Foot.'+side,axis=(1,0,0),angle=-.16*lift)
        key(f+1)
    # Bake explicit per-frame keys; linear interpolation matches GLB samples.
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in bag.fcurves:
                    for k in curve.keyframe_points:
                        k.interpolation='LINEAR'
    action['description']={'Dance':'Side-to-side groove with alternating toe taps','Wave':'Friendly raised-hand wave','Hop':'Two joyful hops with anticipation and landing'}[name]
    actions.append(action)
    # Store all clips as NLA strips; mute tracks so the active Action previews alone.
    track=rig.animation_data.nla_tracks.new()
    track.name=name
    nla=track.strips.new(name,1,action)
    track.mute=True

rig.animation_data.action=actions[0]
scene.frame_start=1
scene.frame_end=97
scene.frame_set(1)
# Endpoints must have matching local transforms for all six bones.
report=[]
for action in actions:
    rig.animation_data.action=action
    samples=[]
    for frame in (int(action.frame_range[0]),int(action.frame_range[1])):
        scene.frame_set(frame)
        samples.append([v for p in rig.pose.bones for v in (*p.location,*p.rotation_quaternion,*p.scale)])
    error=max(abs(a-b) for a,b in zip(*samples))
    assert error<1e-5,(action.name,error)
    report.append({'name':action.name,'frames':list(action.frame_range),'loop_error':error})
rig.animation_data.action=actions[0]
scene.frame_set(1)
result={'clips':report,'bones':len(rig.pose.bones)}
