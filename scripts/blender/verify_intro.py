"""Check the saved negative, including wheel travel, the edit and the fixed sightline."""
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET
import re

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
from mathutils.bvhtree import BVHTree


scene = next(s for s in bpy.data.scenes if s.name.startswith("PIORA_Polaris expedition"))
bpy.context.window.scene = scene
assert (scene.frame_start, scene.frame_end, scene.render.fps) == (1, 240, 30)
assert (scene.render.resolution_x, scene.render.resolution_y) == (1920, 1080)
rover = bpy.data.collections["PIORA_Rover"]
monuments = list(bpy.data.collections["PIORA_Relic"].objects)
assert len(monuments) == 3 and len({o["sightline_depth_m"] for o in monuments}) == 3
assert all(o.parent is None and o.animation_data is None and o.data.animation_data is None for o in monuments)
root = next(o for o in rover.objects if o.name.startswith("PIORA_Rover chassis"))
ground = next(o for o in scene.objects if o.name.startswith("PIORA_Fictional ice world"))
terrain = BVHTree.FromPolygons([ground.matrix_world @ v.co for v in ground.data.vertices],
                               [tuple(p.vertices) for p in ground.data.polygons])
carriers = [o for o in rover.objects if o.name.startswith("PIORA_Suspension carrier")]
assert len(carriers) == 6
wheels = []
for c in carriers:
    spin = next(o for o in c.children if o.name.startswith("PIORA_Wheel roll"))
    shoes = next(o for o in spin.children if o.name.startswith("PIORA_Chevron traction"))
    wheels.append((c, spin, shoes, [v.co.copy() for v in shoes.data.vertices]))
badges = sorted((o for o in rover.objects if o.name.startswith("PIORA_piora body badge")), key=lambda o:o.name)
serials = sorted((o for o in rover.objects if o.name.startswith("PIORA_Vehicle serial")), key=lambda o:o.name)
assert len(badges) == len(serials) == 2
for badge,serial in zip(badges,serials):
    bottom = min((badge.matrix_local @ Vector(v)).z for v in badge.bound_box)
    top = max((serial.matrix_local @ Vector(v)).z for v in serial.bound_box)
    assert bottom > top + .004


def floor(x, y):
    hit = terrain.ray_cast(Vector((x, y, 90)), Vector((0, 0, -1)))[0]
    assert hit is not None
    return hit.z


def screen(point):
    return world_to_camera_view(scene, scene.camera, point)


previous = {}
max_center_error = max_roll_error = 0
min_shoe_gap, max_shoe_gap = 1, -1
screen_margin = 1
for frame in range(1,241):
    scene.frame_set(frame)
    for carrier,spin,shoes,corners in wheels:
        center = carrier.matrix_world.translation
        expected = max(floor(center.x+dx,center.y+dy)+math.sqrt(.68**2-dx**2)
                       for dx in (step*.025 for step in range(-12,13)) for dy in (-.201,0.,.201))
        max_center_error = max(max_center_error, abs(center.z-expected))
        assert abs(center.z-expected) < .003, (frame,carrier.name,center.z-expected)
        angle = spin.rotation_euler.y
        if carrier.name in previous:
            last_center,last_angle = previous[carrier.name]
            error = abs((center-last_center).length - .68*(angle-last_angle))
            max_roll_error = max(max_roll_error,error)
            assert error < .0001, (frame,carrier.name,error)
        previous[carrier.name] = center.copy(),angle
        # Compare the actual outline of the traction shoes with the triangle terrain.
        matrix = shoes.matrix_world
        low = center.z-.68+.065
        gap = 1
        for corner in corners:
            p = matrix @ corner
            if p.z < low:
                gap = min(gap, p.z-floor(p.x,p.y))
        min_shoe_gap,max_shoe_gap = min(min_shoe_gap,gap),max(max_shoe_gap,gap)
        assert -.025 < gap < .015, (frame,shoes.name,gap)
    if frame <= 136:
        right = scene.camera.matrix_world.to_quaternion() @ Vector((1,0,0))
        assert right.x > .8, (frame,"travel reverses")
    if frame in (43,75,100,118,136,168,195,220,240):
        for obj in rover.objects:
            if obj.type not in ("MESH","FONT","CURVE"):
                continue
            for corner in obj.bound_box:
                p = screen(obj.matrix_world @ Vector(corner))
                margin = min(p.x,p.y,1-p.x,1-p.y)
                assert p.z > 0 and margin > -.01,(frame,obj.name,tuple(p))
                screen_margin = min(screen_margin,margin)
    if frame == 152:
        parked_x = root.matrix_world.translation.x
    if frame > 152:
        assert abs(root.matrix_world.translation.x-parked_x) < .00001
    if frame == 220:
        locked = scene.camera.matrix_world.copy()
        locked_lens = scene.camera.data.lens
    if frame >= 220:
        assert all(abs(a-b)<.00001 for ar,br in zip(scene.camera.matrix_world,locked) for a,b in zip(ar,br))
        assert scene.camera.data.lens == locked_lens

# Use the actual mesh perimeter at each full-width end of the stone. The target
# coordinates come from the embedded design SVG, independently of the mesh builder.
svg = ET.fromstring(bpy.data.texts["piora-icon.svg"].as_string())
curve = next(el for el in svg.iter() if el.get("stroke")=="url(#pi)")
paths = [[float(n) for n in re.findall(r"-?[\d.]+",sub)] for sub in curve.get("d").split("M")[1:]]
max_reprojection = 0
for ob,path in zip(monuments, paths):
    ring_size = len(ob.data.polygons[-1].vertices)
    assert ring_size == len(ob.data.polygons[-2].vertices)
    rings, remainder = divmod(len(ob.data.vertices), ring_size)
    assert remainder == 0 and rings > 14
    for ring,(x,y) in ((6,path[:2]),(rings-7,path[-2:])):
        vertices = ob.data.vertices[ring_size*ring:ring_size*(ring+1)]
        center = sum((ob.matrix_world @ v.co for v in vertices),Vector())/ring_size
        p = screen(center)
        sx, sy = .553+(x-512)*.00064, .505+(550-y)*.00064*16/9
        delta = math.hypot((p.x-sx)*1920,(p.y-sy)*1080)
        max_reprojection = max(max_reprojection,delta)
        assert delta < 3, (ob.name,delta)
scene.frame_set(118)
report = dict(blender=bpy.app.version_string,framesChecked=240,wheelContactChecks=1440,
              maxWheelCenterErrorMeters=max_center_error,maxRollingErrorPerStepMeters=max_roll_error,
              treadClearanceRangeMeters=[min_shoe_gap,max_shoe_gap],minimumWideShotRoverMargin=screen_margin,
              stationaryMonuments=3,maximumSvgReprojectionErrorPixels=max_reprojection,
              cameraHoldFrames=21,posterFrame=118,vehicleBadgeAndSerialDoNotOverlap=True)
Path(bpy.data.filepath).with_name("blender-validation.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
print(json.dumps(report,indent=2))
