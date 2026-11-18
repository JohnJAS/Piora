# -*- coding: utf-8 -*-
"""Piora / POLARIS 2076 — The Sightline. Self-contained, editable Blender film.
Build from the checkout or open the shipped scene and render its baked timeline.
"""
from __future__ import annotations

import argparse
import bisect
import json
import math
import random
import sys
from datetime import datetime
from pathlib import Path

try:
    import bpy
    from mathutils import Vector, Matrix
except ImportError:
    bpy = None  # Allows the pure numerical functions to be tested outside Blender.

# ============================================================================
# 用户配置：通常只需修改这里
# ============================================================================
CONFIG = {
    "brand": "piora",                       # 车身两侧 + 片尾的真实文字
    "year": 2076,
    "duration": 8.0,                         # 秒；可改为 4.0，动作会整体压缩
    "fps": 30,
    "resolution": (1920, 1080),
    "quality": "PREVIEW",                    # PREVIEW=25%分辨率；FINAL=100%
    "engine": "CYCLES",                       # EEVEE 或 CYCLES
    "render_mode": "BUILD",                  # BUILD / FRAME / ANIMATION
    "output_format": "MP4",                  # MP4 或 PNG_SEQUENCE
    "output_dir": "",                        # 留空：用户主目录/Piora_Animation
    "font_path": "",                         # 留空用 Blender 内置字体
    "save_blend": True,
    "tracks": True,
    "motion_blur": False,
    "seed": 2076,
}

# 颜色为设计值，不是天体实测值。避免高饱和霓虹、过度赛博朋克。
PALETTE = {
    "ceramic": "CBD1D8",
    "ceramic_dark": "939BA9",
    "graphite": "202532",
    "rubber": "131821",
    "metal": "667181",
    "dark_metal": "353F50",
    "glass": "111D33",
    "violet": "9585D8",
    "ice_blue": "B5CADC",
    "white": "E8ECF5",
    "ground_dark": "171E2C",
    "ground_light": "566274",
    "frost": "9AABB9",
    "background": "060912",
}
WHEEL_RADIUS = 0.68
WHEEL_X = (-1.55, 0.0, 1.55)
WHEEL_Y = (-1.22, 1.22)
START_X = -9.5
END_X = 2.6
PREFIX = "PIORA_"
SCENE = None
COLLECTIONS = {}
MATERIALS = {}
MESH_CACHE = {}
AXIS_COORDS = []
CFG = {}
RNG = None
OUT = None

# ============================================================================
# 纯数学函数；可以不依赖 Blender 进行测试
# ============================================================================
def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def smooth(x):
    x = clamp(x)
    return x * x * (3.0 - 2.0 * x)


def smoother(x):
    x = clamp(x)
    return x * x * x * (x * (6.0 * x - 15.0) + 10.0)


def lerp(a, b, t):
    return a + (b - a) * t


def drive_x(u):
    """Constant approach speed, then constant deceleration into the crest."""
    t = clamp(u) * 239
    brake, stop = 124, 151
    if t >= stop:
        return END_X
    elapsed = min(t, stop)
    travel = elapsed - max(0, elapsed - brake) ** 2 / (2 * (stop - brake))
    return lerp(START_X, END_X, travel / ((brake + stop) * .5))


def terrain_height(x, y):
    # A diagonal transverse lip makes the six contact patches cross at different times.
    lip = x - .32 * y
    lane = (.12 + .92 * smooth((x + 5) / 8)
            + .23 * math.exp(-((lip + .7) / .92) ** 2)
            + .085 * math.exp(-((lip + 6.45) / .56) ** 2)
            + .045 * math.sin(1.72 * x + .62 * y))
    shelf = (1.12 + .8 * math.sin(x * .19 + y * .17)
             + .48 * math.sin(x * .49 - y * .25) + .18 * math.sin(y * 1.4 + x * .6))
    shelf = lerp(lane, shelf, smooth((abs(y) - 2.2) / 5))
    ravine = smooth((y - 7 - 2.7 * math.sin(x * .13)) / 11)
    opposite = smooth((y - 60 - 6 * math.cos(x * .13)) / 15)
    gullies = 1.6 * math.sin(x * .13 + y * .04) + .7 * math.sin(x * .4 - y * .2)
    return shelf - ravine * (11 + gullies) + opposite * (5 + gullies)


def make_axis(preview=False):
    # Identical ground and contact geometry in scouting renders and in the negative.
    inner = [i / 4 for i in range(-96, 97)]
    outer = [24 + 480 * (i / 45) ** 1.70 for i in range(1, 46)]
    return [-v for v in reversed(outer)] + inner + outer


def surface_height(x, y):
    """Interpolate the ACTUAL triangle surface used by the generated terrain."""
    if not AXIS_COORDS:
        return terrain_height(x, y)
    xs = AXIS_COORDS
    i = min(len(xs) - 2, max(0, bisect.bisect_right(xs, x) - 1))
    j = min(len(xs) - 2, max(0, bisect.bisect_right(xs, y) - 1))
    a, b = xs[i], xs[i + 1]
    c, d = xs[j], xs[j + 1]
    tx, ty = clamp((x - a) / (b - a)), clamp((y - c) / (d - c))
    h00, h10 = terrain_height(a, c), terrain_height(b, c)
    h11, h01 = terrain_height(b, d), terrain_height(a, d)
    # Matching diagonal: (00,10,11) and (00,11,01).
    if ty <= tx:
        return (1.0 - tx) * h00 + (tx - ty) * h10 + ty * h11
    return (1.0 - ty) * h00 + tx * h11 + (ty - tx) * h01


def wheel_support(x, y):
    """Lowest non-penetrating pose for a tread cylinder on a diagonal, faceted ridge."""
    support = -math.inf
    for step in range(-12,13):
        dx = step * .025
        radius_z = math.sqrt(WHEEL_RADIUS**2 - dx**2)
        for dy in (-.201,0.,.201):
            support = max(support, surface_height(x+dx,y+dy) + radius_z)
    return support


FINAL_CAMERA = (59., -88., 19.5)
FINAL_HEADING = (-.46, math.sqrt(1 - .46 ** 2))
FINAL_PITCH = .025
FINAL_LENS = 32.
ALIGN_FRAME = 220


def sight_basis():
    dx, dy = FINAL_HEADING
    cp, sp = math.cos(FINAL_PITCH), math.sin(FINAL_PITCH)
    return (dx * cp, dy * cp, sp), (dy, -dx, 0.), (-dx * sp, -dy * sp, cp)


def screen_ray(sx, sy, depth):
    """Unproject positions from the locked composition onto separate depth planes."""
    fw, rt, up = sight_basis()
    width = 36 / FINAL_LENS
    return tuple(FINAL_CAMERA[i] + depth * (fw[i] + width * ((sx-.5)*rt[i]
                 + (sy-.5)*9/16*up[i])) for i in range(3))


def icon_screen(x, y):
    return .553 + (x - 512) * .00064, .505 + (550 - y) * .00064 * 16/9


def camera_pose(u):
    frame = 1 + 239 * u
    x = drive_x(u)
    front = x + WHEEL_X[-1]
    if frame >= ALIGN_FRAME:
        return FINAL_CAMERA, screen_ray(.5,.5,112), FINAL_LENS
    if frame < 43:
        walk = front - (START_X + WHEEL_X[-1])
        aim_x = front + .76 - .39 * walk
        ground = surface_height(aim_x, -1.4)
        return ((aim_x + .66, -3.76, ground + .70),
                (aim_x, -1.16, ground + .41), 37.)
    a = clamp((frame - 43) / 92)
    offset = (lerp(4.42, 4.75, a), lerp(-8.85, -9.15, a), lerp(1.34, 1.84, a))
    floor = surface_height(x, 0)
    start_pos = (x + offset[0], offset[1], floor + offset[2])
    # A small lead to the right leaves the column rising behind the vehicle.
    start_aim = (x + .22, -.03, floor + 1.55)
    if frame <= 136:
        return start_pos, start_aim, lerp(40., 42., a)
    t = smooth((frame - 136) / (ALIGN_FRAME - 136))
    yaw0 = math.atan2(4.75, 9.15)
    yaw1 = math.atan2(FINAL_CAMERA[0] - END_X, -FINAL_CAMERA[1])
    # A bowed jib path keeps the monuments separated until the end of the move.
    yaw = lerp(yaw0, yaw1, t) + .67 * math.sin(math.pi * t)
    length = lerp(math.hypot(4.75, 9.15), math.hypot(FINAL_CAMERA[0]-END_X, FINAL_CAMERA[1]), t)
    pos = (x + math.sin(yaw)*length, -math.cos(yaw)*length,
           lerp(floor + 1.84, FINAL_CAMERA[2], t) + 3.4*math.sin(math.pi*t))
    end_aim = screen_ray(.5, .5, 112)
    aim = tuple(lerp(start_aim[i], end_aim[i], t) for i in range(3))
    aim = (aim[0], aim[1], aim[2] + 6*math.sin(math.pi*t))
    return pos, aim, lerp(42., FINAL_LENS, t) - 12.5*math.sin(math.pi*t)


def rgba(hex_string, alpha=1.0):
    """sRGB design hex -> linear scene values."""
    s = hex_string.lstrip("#")
    def lin(v):
        v = int(v, 16) / 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(lin(s[i:i + 2]) for i in (0, 2, 4)) + (alpha,)


def F(u):
    return 1 + round(clamp(u) * (SCENE.frame_end - 1))


def set_input(node, name, value):
    socket = node.inputs.get(name)
    if socket is not None:
        socket.default_value = value
        return True
    return False


def obj_new(name, data, group="Rover", parent=None):
    ob = bpy.data.objects.new(PREFIX + name, data)
    COLLECTIONS[group].objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def empty(name, parent=None, group="Rover"):
    ob = obj_new(name, None, group, parent)
    ob.empty_display_size = 0.15
    return ob


def mesh_data(name, verts, faces):
    me = bpy.data.meshes.new(PREFIX + name)
    me.from_pydata(verts, [], faces)
    me.update()
    return me


def mesh_obj(name, verts, faces, mat, group="Rover", parent=None, bevel=0.0):
    me = mesh_data(name, verts, faces)
    if mat:
        me.materials.append(mat)
    ob = obj_new(name, me, group, parent)
    if bevel:
        mod = ob.modifiers.new("Manufactured edge radii", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        mod.limit_method = "ANGLE"
        mod = ob.modifiers.new("Panel normals", "WEIGHTED_NORMAL")
        mod.keep_sharp = True
        mod.weight = 40
    return ob


def smooth_mesh(ob):
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


BOX_FACES = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


def box_geometry(dim):
    x, y, z = (d / 2.0 for d in dim)
    return [(-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z),
            (-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z)]


def box(name, loc, dim, mat, bevel=0.02, parent=None, group="Rover", rot=None):
    ob = mesh_obj(name, box_geometry(dim), BOX_FACES, mat, group, parent, bevel)
    ob.location = loc
    if rot is not None:
        ob.rotation_euler = rot
    return ob


def cylinder(name, loc, radius, depth, mat, parent=None, rot=None,
             group="Rover", segments=40):
    key = ("cyl", radius, depth, segments, mat.name)
    if key not in MESH_CACHE:
        v = [(radius * math.cos(i * math.tau / segments),
              radius * math.sin(i * math.tau / segments), z)
             for z in (-depth / 2, depth / 2) for i in range(segments)]
        f = [tuple(reversed(range(segments))), tuple(range(segments, 2 * segments))]
        for i in range(segments):
            k = (i + 1) % segments
            f.append((i, k, k + segments, i + segments))
        me = mesh_data("Cylinder", v, f)
        me.materials.append(mat)
        for p in list(me.polygons)[2:]:
            p.use_smooth = True
        MESH_CACHE[key] = me
    ob = obj_new(name, MESH_CACHE[key], group, parent)
    ob.location = loc
    if rot is not None:
        ob.rotation_euler = rot
    return ob


def torus(name, loc, major, minor, mat, parent=None, rot=None, group="Rover"):
    key = ("torus", major, minor, mat.name)
    if key not in MESH_CACHE:
        a, b = 56, 10
        v, f = [], []
        for i in range(a):
            u = math.tau * i / a
            for j in range(b):
                w = math.tau * j / b
                r = major + minor * math.cos(w)
                v.append((r * math.cos(u), r * math.sin(u), minor * math.sin(w)))
        for i in range(a):
            for j in range(b):
                f.append((i*b+j, ((i+1)%a)*b+j,
                          ((i+1)%a)*b+(j+1)%b, i*b+(j+1)%b))
        me = mesh_data("Torus", v, f)
        me.materials.append(mat)
        for p in me.polygons:
            p.use_smooth = True
        MESH_CACHE[key] = me
    ob = obj_new(name, MESH_CACHE[key], group, parent)
    ob.location = loc
    if rot is not None:
        ob.rotation_euler = rot
    return ob


def sphere_data(name, rings=16, segments=32):
    v = [(0, 0, -1)]
    for j in range(1, rings):
        lat = -math.pi/2 + math.pi*j/rings
        for i in range(segments):
            ang = math.tau*i/segments
            v.append((math.cos(lat)*math.cos(ang), math.cos(lat)*math.sin(ang),
                      math.sin(lat)))
    top = len(v)
    v.append((0, 0, 1))
    f = []
    for i in range(segments):
        f.append((0, 1+(i+1)%segments, 1+i))
    for j in range(rings-2):
        for i in range(segments):
            a = 1+j*segments+i
            b = 1+j*segments+(i+1)%segments
            f.append((a, b, b+segments, a+segments))
    last = 1+(rings-2)*segments
    for i in range(segments):
        f.append((last+i, last+(i+1)%segments, top))
    return mesh_data(name, v, f)


def sphere(name, loc, scale, mat, group="Environment", parent=None, detail=16):
    key = ("sphere", detail, mat.name)
    if key not in MESH_CACHE:
        me = sphere_data("Sphere", detail, detail*2)
        me.materials.append(mat)
        for p in me.polygons:
            p.use_smooth = True
        MESH_CACHE[key] = me
    ob = obj_new(name, MESH_CACHE[key], group, parent)
    ob.location = loc
    ob.scale = (scale, scale, scale) if isinstance(scale, (int, float)) else scale
    return ob


def rod(name, start, end, radius, mat, parent=None, group="Rover"):
    ob = cylinder(name, (0, 0, 0), radius, 1.0, mat, parent, group=group, segments=20)
    update_rod(ob, Vector(start), Vector(end))
    return ob


def update_rod(ob, start, end):
    delta = end - start
    ob.location = (start + end) / 2
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(delta.normalized())
    ob.scale = (1, 1, max(delta.length, 0.0001))


def curve_line(name, points, mat, radius=0.012, parent=None, group="Rover"):
    cu = bpy.data.curves.new(PREFIX + name, "CURVE")
    cu.dimensions = "3D"
    cu.resolution_u = 1
    cu.bevel_depth = radius
    cu.bevel_resolution = 2
    sp = cu.splines.new("POLY")
    sp.points.add(len(points) - 1)
    for p, co in zip(sp.points, points):
        p.co = (*co, 1)
    cu.materials.append(mat)
    return obj_new(name, cu, group, parent)


def text(name, body, loc, size, mat, parent=None, group="Rover",
         rot=None, align="CENTER", tracking=1.0):
    cu = bpy.data.curves.new(PREFIX + name, "FONT")
    cu.body = body
    cu.size = size
    cu.align_x = align
    cu.align_y = "CENTER"
    cu.space_character = tracking
    cu.extrude = 0.0015 if group == "Rover" else 0
    cu.bevel_depth = 0.0005 if group == "Rover" else 0
    cu.resolution_u = 12
    if CFG["font_path"]:
        cu.font = MATERIALS["font"]
    cu.materials.append(mat)
    ob = obj_new(name, cu, group, parent)
    ob.location = loc
    if rot:
        ob.rotation_euler = rot
    return ob


def principled(name, color, metallic=0.0, roughness=0.45, coat=0.0):
    ma = bpy.data.materials.new(PREFIX + name)
    ma.diffuse_color = rgba(color)
    ma.use_nodes = True
    bs = ma.node_tree.nodes.get("Principled BSDF")
    set_input(bs, "Base Color", rgba(color))
    set_input(bs, "Metallic", metallic)
    set_input(bs, "Roughness", roughness)
    set_input(bs, "Coat Weight", coat)
    return ma


def emissive(name, color, strength=1.0, fade=False):
    ma = bpy.data.materials.new(PREFIX + name)
    ma.diffuse_color = rgba(color)
    ma.use_nodes = True
    ns, ls = ma.node_tree.nodes, ma.node_tree.links
    ns.clear()
    out = ns.new("ShaderNodeOutputMaterial")
    em = ns.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = rgba(color)
    em.inputs["Strength"].default_value = strength
    if fade:
        trans = ns.new("ShaderNodeBsdfTransparent")
        mix = ns.new("ShaderNodeMixShader")
        val = ns.new("ShaderNodeValue")
        val.name = "Visibility"
        val.outputs[0].default_value = 0.0
        ls.new(val.outputs[0], mix.inputs[0])
        ls.new(trans.outputs[0], mix.inputs[1])
        ls.new(em.outputs[0], mix.inputs[2])
        ls.new(mix.outputs[0], out.inputs["Surface"])
        if hasattr(ma, "surface_render_method"):
            ma.surface_render_method = "DITHERED"
        elif hasattr(ma, "blend_method"):
            ma.blend_method = "BLEND"
    else:
        ls.new(em.outputs[0], out.inputs["Surface"])
    return ma


def animate_value(socket, keys):
    for frame, value in keys:
        socket.default_value = value
        socket.keyframe_insert("default_value", frame=frame)


def build_materials():
    for key, metal, rough, coat in [
        ("ceramic", .28, .32, .23), ("ceramic_dark", .32, .4, .12),
        ("graphite", .6, .38, .08), ("rubber", .12, .84, 0),
        ("metal", .85, .28, .05), ("dark_metal", .72, .4, 0),
        ("glass", .60, .12, .6)]:
        MATERIALS[key] = principled(key, PALETTE[key], metal, rough, coat)
    MATERIALS["lettering"] = principled("Ceramic inlay lettering", "F4F5F8", .2, .35)
    MATERIALS["small_print"] = principled("Service markings", "4B5666", .2, .6)
    MATERIALS["violet"] = emissive("Low power violet status light", PALETTE["violet"], 2.1)
    MATERIALS["headlamp"] = emissive("Headlamp diffuser", "FFF0D3", 8.0)
    MATERIALS["lens"] = principled("Coated optic", "172C43", .78, .13, .7)
    MATERIALS["tracks"] = principled("Compressed wheel regolith", "141B29", .05, .98)
    if CFG["font_path"]:
        fp = Path(CFG["font_path"]).expanduser()
        if not fp.is_file():
            raise FileNotFoundError("找不到字体文件：" + str(fp))
        MATERIALS["font"] = bpy.data.fonts.load(str(fp), check_existing=True)


def field(ma, vector, scale, detail=3., rough=.62, distortion=0.):
    ns, ls = ma.node_tree.nodes, ma.node_tree.links
    n = ns.new("ShaderNodeTexNoise")
    for key, val in (("Scale", scale), ("Detail", detail), ("Roughness", rough), ("Distortion", distortion)):
        n.inputs[key].default_value = val
    if vector is not None:
        ls.new(vector, n.inputs["Vector"])
    return n.outputs["Fac"]


def ramp(ma, source, stops):
    n = ma.node_tree.nodes.new("ShaderNodeValToRGB")
    c = n.color_ramp
    c.elements.remove(c.elements[1])
    for i, (pos, color) in enumerate(stops):
        e = c.elements[0] if i == 0 else c.elements.new(pos)
        e.position = pos
        e.color = rgba(color)
    ma.node_tree.links.new(source, n.inputs[0])
    return n.outputs["Color"]


def vector_scale(ma, vec, factors):
    n = ma.node_tree.nodes.new("ShaderNodeVectorMath")
    n.operation = "MULTIPLY"
    n.inputs[1].default_value = factors
    ma.node_tree.links.new(vec, n.inputs[0])
    return n.outputs[0]


def mix_color(ma, fac, a, b):
    ns, ls = ma.node_tree.nodes, ma.node_tree.links
    n = ns.new("ShaderNodeMixRGB")
    for i, val in enumerate((fac, a, b)):
        if isinstance(val, (float, int, tuple)):
            n.inputs[i].default_value = val
        else:
            ls.new(val, n.inputs[i])
    return n.outputs[0]


def map_value(ma, source, low, high):
    nodes, links = ma.node_tree.nodes, ma.node_tree.links
    node = nodes.new("ShaderNodeMapRange")
    node.inputs["To Min"].default_value = low
    node.inputs["To Max"].default_value = high
    links.new(source, node.inputs["Value"])
    return node.outputs["Result"]


def relief(ma, source, distance, strength):
    ns, ls = ma.node_tree.nodes, ma.node_tree.links
    n = ns.new("ShaderNodeBump")
    normal = ns["Principled BSDF"].inputs["Normal"]
    n.inputs["Distance"].default_value = distance
    n.inputs["Strength"].default_value = strength
    if normal.is_linked:
        ls.new(normal.links[0].from_socket, n.inputs["Normal"])
    ls.new(source, n.inputs["Height"])
    ls.new(n.outputs["Normal"], normal)


def machine_finish(ma, stops, scale, roughness, depth, direction=(1., 1., 1.)):
    nodes, links = ma.node_tree.nodes, ma.node_tree.links
    surface = nodes["Principled BSDF"]
    # Local coordinates keep wear marks attached to rolling wheels and the chassis.
    position = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    grain = field(ma, vector_scale(ma, position, direction), scale, 2., .65)
    links.new(ramp(ma, grain, stops), surface.inputs["Base Color"])
    links.new(map_value(ma, grain, *roughness), surface.inputs["Roughness"])
    relief(ma, grain, depth, .32)


def finish_rover_surfaces():
    m = MATERIALS
    rubber = m["rubber"].node_tree.nodes["Principled BSDF"]
    set_input(rubber, "Metallic", 0.)
    machine_finish(m["rubber"], [(.18, "20272D"), (.47, "323B43"), (.78, "4A5154")],
                   72., (.64, .91), .0028)
    machine_finish(m["metal"], [(.21, "545F68"), (.48, "65717B"), (.78, "7B8992")],
                   63., (.24, .38), .00042, (.9, 3.2, .9))
    machine_finish(m["ceramic"], [(.16, "B4B6B1"), (.46, "C8CCC9"), (.79, "DBDDD5")],
                   27., (.29, .45), .00072)
    m["traction"] = principled("Forged carbide traction shoes", "44515D", .65, .43)
    machine_finish(m["traction"], [(.20, "27353F"), (.50, "4B5A64"), (.79, "687783")],
                   61., (.33, .57), .0024)
    m["traction_edge"] = principled("Burnished contact edges", "8C99A0", .71, .32)


def mineral(name, stops, scales, rough, metallic=.12, bump=.045):
    ma = principled(name, stops[1][1], metallic, rough, .18)
    nodes, links = ma.node_tree.nodes, ma.node_tree.links
    pos = nodes.new("ShaderNodeNewGeometry").outputs["Position"]
    vec = vector_scale(ma, pos, scales)
    veining = field(ma, vec, 1.0, 4., .67, .33)
    links.new(ramp(ma, veining, stops), nodes["Principled BSDF"].inputs["Base Color"])
    relief(ma, field(ma, vec, 4., 2.2), bump, .24)
    return ma


def build_ice_materials():
    m = MATERIALS
    m["terrain"] = mineral("Wind-scoured ice over shale",
        [(.18, "162837"), (.39, "2C4755"), (.52, "405E6F"), (.64, "60828E"), (.76, "91A9AA")],
        (.38, 1.2, .75), .47, .035, .021)
    n, l = m["terrain"].node_tree.nodes, m["terrain"].node_tree.links
    pos = n.new("ShaderNodeNewGeometry").outputs["Position"]
    ice = n.new("ShaderNodeTexVoronoi")
    ice.feature = "DISTANCE_TO_EDGE"
    ice.inputs["Scale"].default_value = .48
    l.new(vector_scale(m["terrain"], pos, (.75, 1.5, 1.)), ice.inputs["Vector"])
    bs = n["Principled BSDF"]
    base = bs.inputs["Base Color"].links[0].from_socket
    line = ramp(m["terrain"], ice.outputs["Distance"], [(0., "161616"), (.007, "9B9B9B"), (.018, "FFFFFF")])
    bed = mix_color(m["terrain"], line, rgba("223944"), base)
    drifts = field(m["terrain"], vector_scale(m["terrain"], pos, (.61, 2.4, 2.2)), 2.1, 2.8, .64)
    frost = ramp(m["terrain"], drifts, [(.39, "000000"), (.53, "353535"), (.64, "BEBEBE"), (.75, "F2F2EB")])
    grain=field(m["terrain"],vector_scale(m["terrain"],pos,(1.8,3.7,1.4)),23,2.4)
    snow = ramp(m["terrain"], grain, [(.15, "8BA1AA"), (.46, "ADBEBE"), (.79, "D3D3C4")])
    l.new(mix_color(m["terrain"], frost, bed, snow), bs.inputs["Base Color"])
    l.new(map_value(m["terrain"], frost, .31, .78), bs.inputs["Roughness"])
    relief(m["terrain"],grain,.014,.34)
    m["rock"] = mineral("Laminated graphite / exposed bedrock",
        [(.23,"132734"),(.43,"243543"),(.57,"415461"),(.64,"687578"),(.78,"95978B")], (.8,.7,5), .60)
    m["pack"] = mineral("Glacial blue / sheared shelf",
        [(.22,"142D3B"),(.43,"365767"),(.59,"6D909A"),(.69,"A4B9B9"),(.82,"D0D8D2")], (.9,.5,5.2), .36, .06)
    m["salt"] = mineral("Opaque hoarfrost / fresh break",
        [(.24,"819DA2"),(.46,"B9CDCB"),(.61,"E6E4CF"),(.78,"FFF1D4")], (12,15,19), .51, .06, .008)
    m["ruin"] = mineral("Antique gneiss / trapped blue ice",
        [(.19,"354755"),(.39,"536675"),(.53,"77868A"),(.61,"9AA19A"),(.80,"BCBDB0")],
        (.22,.145,.66), .55, .045, .19)
    m["rind"] = mineral("Pressure-polished mineral rind",
        [(.19,"62717D"),(.40,"839093"),(.55,"A2ACA6"),(.69,"BAC2B3"),(.81,"D6D0BD")], (.27,.31,.51), .44, .07, .16)
    m["violet_ice"] = mineral("Amethyst inclusions",
        [(.24,"3F455D"),(.43,"68668B"),(.59,"9589BB"),(.74,"BEB6CD")], (.11,.21,.55), .28, .25)
    m["edge"] = mineral("Cyan transmitted ice at the foot",
        [(.22,"356A83"),(.45,"548C9D"),(.58,"83B6C1"),(.77,"ADD6D1")], (.13,.19,.52), .22, .16)
    m["seam"] = principled("Recessed mineral fault", "566267", .20, .54)
    ice_edge = m["edge"].node_tree.nodes["Principled BSDF"]
    set_input(ice_edge, "Emission Color", rgba("93DEE2"))
    set_input(ice_edge, "Emission Strength", .09)
    m["amber"] = principled("Ochre ceramic service enamel", "D79B54", .38, .34)
    m["small_print"].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = rgba("AAB9B8")
    # A transparent closure keeps the rock visible through two real, separated ice faces in EEVEE.
    ma = principled("Clear laminar ice / air interface", "A3CBCB", .04, .21, .31)
    ns, ls = ma.node_tree.nodes, ma.node_tree.links
    fres = ns.new("ShaderNodeFresnel")
    fres.inputs["IOR"].default_value = 1.31
    mapping = ns.new("ShaderNodeMapRange")
    mapping.inputs["To Min"].default_value = .10
    mapping.inputs["To Max"].default_value = .90
    ls.new(fres.outputs[0], mapping.inputs[0])
    mix = ns.new("ShaderNodeMixShader")
    ls.new(mapping.outputs[0], mix.inputs[0])
    ls.new(ns.new("ShaderNodeBsdfTransparent").outputs[0], mix.inputs[1])
    ls.new(ns["Principled BSDF"].outputs[0], mix.inputs[2])
    ls.new(mix.outputs[0], ns["Material Output"].inputs["Surface"])
    ma.surface_render_method = "BLENDED"
    m["glaze"] = ma.copy()
    m["glaze"].name = PREFIX + "Wind-polished thin glaze"
    glaze_nodes, glaze_links = m["glaze"].node_tree.nodes, m["glaze"].node_tree.links
    coverage = glaze_nodes.new("ShaderNodeAttribute")
    coverage.attribute_name = "IceCoverage"
    glaze_mix = glaze_nodes.get(mix.name).inputs[0]
    fade = glaze_nodes.new("ShaderNodeMath")
    fade.operation = "MULTIPLY"
    glaze_links.new(glaze_mix.links[0].from_socket, fade.inputs[0])
    glaze_links.new(coverage.outputs["Fac"], fade.inputs[1])
    glaze_links.new(fade.outputs[0], glaze_mix)
    if CFG["engine"] == "CYCLES":
        glass=ns.new("ShaderNodeBsdfGlass")
        glass.inputs["Color"].default_value=rgba("EEF9FA")
        glass.inputs["IOR"].default_value=1.31
        position=ns.new("ShaderNodeTexCoord").outputs["Object"]
        waves=field(ma,vector_scale(ma,position,(1.,3.2,1.)),17.,2.8)
        ls.new(map_value(ma,waves,.035,.15),glass.inputs["Roughness"])
        normals=ns.new("ShaderNodeBump")
        normals.inputs["Distance"].default_value=.0029
        normals.inputs["Strength"].default_value=.27
        ls.new(waves,normals.inputs["Height"])
        ls.new(normals.outputs[0],glass.inputs["Normal"])
        ls.new(glass.outputs[0],ns["Material Output"].inputs["Surface"])
    m["clear"] = ma
    m["glint"] = principled("Polished edge of the fracture", "B3CED0", .055, .26, .22)
    bs = m["glint"].node_tree.nodes["Principled BSDF"]
    set_input(bs, "Emission Color", rgba("FFE3B8"))
    set_input(bs, "Emission Strength", .08)
    machine_finish(m["glint"], [(.20,"809DA5"),(.49,"BECFCC"),(.73,"E0E0CF")],
                   115., (.19,.44), .0018)


def build_world():
    world = bpy.data.worlds.new(PREFIX + "Polar dawn")
    world.use_nodes = True
    SCENE.world = world
    ns, ls = world.node_tree.nodes, world.node_tree.links
    bg = ns.get("Background")
    direction = ns.new("ShaderNodeTexCoord").outputs["Normal"]
    split = ns.new("ShaderNodeSeparateXYZ")
    ls.new(direction, split.inputs[0])
    # World Normal points inward. Map a small elevation range into the horizon gradient.
    height = ns.new("ShaderNodeMath")
    height.operation = "MULTIPLY_ADD"
    height.inputs[1].default_value = -1.7
    height.inputs[2].default_value = .19
    ls.new(split.outputs["Z"], height.inputs[0])
    sky = ramp(world, height.outputs[0], [(0.,"ACABAA"),(.19,"D6BBA4"),(.26,"ABB8BC"),
               (.42,"688391"),(.63,"405C70"),(.87,"253D53"),(1.,"21384C")])
    mist = field(world, vector_scale(world, direction, (4., 5., 29.)), 2.2, 4, .66, .44)
    filaments = ramp(world, mist, [(.37,"000000"),(.53,"101010"),(.67,"424242"),(.80,"636363")])
    ls.new(mix_color(world, filaments, sky, rgba("C9BCAF")), bg.inputs["Color"])
    bg.inputs["Strength"].default_value = .65


def mountain_ranges():
    from mathutils import noise
    for layer,(base_y,height,tint,snow,veil) in enumerate([
            (252,43,"647684","C5C7C3",.66), (177,30,"5D7281","BDC7C8",.56),
            (121,17,"4C6777","AEBFC0",.46)]):
        mat=principled("Nunatak %d / windward snow and blue shale" % layer,tint,.06,.78)
        ns,ls=mat.node_tree.nodes,mat.node_tree.links
        geom=ns.new("ShaderNodeNewGeometry")
        split=ns.new("ShaderNodeSeparateXYZ")
        ls.new(geom.outputs["Normal"],split.inputs[0])
        broad=field(mat,vector_scale(mat,geom.outputs["Position"],(.14,.11,.33)),.93,3.)
        blend=ns.new("ShaderNodeMath")
        blend.operation="MULTIPLY_ADD"
        ls.new(broad,blend.inputs[0])
        blend.inputs[1].default_value=.35
        ls.new(split.outputs["Z"],blend.inputs[2])
        snowline=ramp(mat,blend.outputs[0],[(.49,"252525"),(.79,"777777"),(.96,"FFFFFF")])
        ls.new(mix_color(mat,snowline,rgba(tint),rgba(snow)),ns["Principled BSDF"].inputs["Base Color"])
        # Aerial perspective increases for each successive range.
        atmosphere=ns.new("ShaderNodeMixShader")
        atmosphere.inputs[0].default_value=veil
        air=ns.new("ShaderNodeEmission")
        air.inputs["Color"].default_value=rgba(("A7AAAB","A0AAAD","91A2A8")[layer])
        air.inputs["Strength"].default_value=.78
        ls.new(ns["Principled BSDF"].outputs[0],atmosphere.inputs[1])
        ls.new(air.outputs[0],atmosphere.inputs[2])
        ls.new(atmosphere.outputs[0],ns["Material Output"].inputs["Surface"])
        verts,faces=[],[]
        samples,rows=323,20
        for j in range(rows):
            v=j/(rows-1)
            for i in range(samples):
                x=(i-samples/2)*1.85
                k=x+layer*78.3
                n=noise.noise_vector(Vector((k*.043,layer+.142,1.63))).x
                mass=(.22 + .25*(1+math.sin(k*.039+1.1)) + .11*(1+math.sin(k*.087))
                      + .21*abs(n)+.10*abs(math.sin(k*.143+.7)))
                ridge=base_y + 11*math.sin(k*.039)+3.6*n
                y=ridge+(v-.77)*44
                profile=max(0.,1-abs(v-.77)/.77)
                relief=noise.fractal(Vector((k*.087,y*.073,layer+.68)),.8,2.1,3)
                xval=x+(1-v)*(2.2*n+1.35*math.sin(k*.27))
                z=-7+height*mass*profile+2.15*profile*relief
                verts.append((xval,y,z))
        for j in range(rows-1):
            for i in range(samples-1):
                a=j*samples+i
                faces.extend(((a,a+1,a+samples+1),(a,a+samples+1,a+samples)))
        smooth_mesh(mesh_obj("Distant glacier range %d"%layer,verts,faces,mat,"Environment"))


def floe(name, x, y, sx, sy, height, heading, group="Environment"):
    # Broad tabular forms, a tilted cleavage plane and a strip of opaque snow at its rim.
    m = MATERIALS
    profile = [(-.99,-.40),(-.50,-.88),(.49,-.73),(1.,-.12),(.64,.69),(-.56,.70)]
    v, f, indices = [], [], []
    for level, inset in ((0.,1.),(.73,.95),(.90,.91),(1.,.86)):
        for a, b in profile:
            v.append((a*sx*inset + .16*level*sx, b*sy*inset,
                      height * level * (.67 + .27*b - .23*a)))
    for j in range(3):
        for i in range(6):
            k = (i+1)%6
            f.append((j*6+i,j*6+k,(j+1)*6+k,(j+1)*6+i))
            indices.append(2 if j == 2 else (0 if j == 0 and i%3==0 else 1))
    f.extend([(18,19,20,21,22,23),(5,4,3,2,1,0)])
    indices.extend([1,0])
    ob = mesh_obj(name, v, f, m["rock"], group)
    for mat in (m["pack"],m["salt"]):
        ob.data.materials.append(mat)
    for p, idx in zip(ob.data.polygons,indices):
        p.material_index = idx
    ob.location = (x,y,surface_height(x,y)-height*.14)
    ob.rotation_euler.z = heading
    return ob


def build_landscape():
    global AXIS_COORDS
    AXIS_COORDS = make_axis()
    n = len(AXIS_COORDS)
    verts = [(x,y,terrain_height(x,y)) for y in AXIS_COORDS for x in AXIS_COORDS]
    faces = []
    for j in range(n-1):
        for i in range(n-1):
            a = j*n+i
            faces.extend(((a,a+1,a+n+1),(a,a+n+1,a+n)))
    smooth_mesh(mesh_obj("Fictional ice world", verts, faces, MATERIALS["terrain"], "Environment"))
    mountain_ranges()
    for i in range(147):
        x, y = RNG.uniform(-64,66), RNG.uniform(-22,63)
        if abs(y)<4.5 or (y < -2 and -10 < x < 8):
            continue
        size = RNG.uniform(.6, 3.5) * (1.6 if y>12 else .75)
        floe("Calved ice and shale %03d" % i,x,y,size,RNG.uniform(.4,1.1)*size,
             size*RNG.uniform(.45,1.85),RNG.uniform(-1,1))
    for x,y,sx,sy,h,a in [(-14,-4.5,1.1,.43,.28,.22),(-6,-5.9,1.3,.44,.39,.3),
                            (-3.5,-3.8,.94,.42,.62,-.15),(.2,-4.3,1.85,.59,.74,.22),
                            (4.9,-4,1.36,.46,.66,-.7),(7.5,-3.7,1.94,.63,.88,.25)]:
        floe("Foreground shear / tracking parallax",x,y,sx,sy,h,a)
    # Long exposed strata along the canyon banks instead of a flat featureless floor.
    for i in range(46):
        x = -70 + i * 3.2
        y = 11 + 2.6*math.sin(x*.13)
        floe("Canyon lip / bedded basalt", x,y,RNG.uniform(2.7,6),RNG.uniform(1.5,3.8),
             RNG.uniform(2.6,5.1),RNG.uniform(-.27,.27))


def read_icon_paths():
    import re
    import xml.etree.ElementTree as ET
    # Keep the source path with the editable scene for use away from the checkout.
    if "__file__" in globals():
        icon = Path(__file__).resolve().parents[2] / "desktop/build/piora-icon.svg"
        if icon.is_file():
            source = icon.read_text(encoding="utf-8")
        else:
            source = bpy.data.texts["piora-icon.svg"].as_string()
    else:
        source = bpy.data.texts["piora-icon.svg"].as_string()
    if not bpy.data.texts.get("piora-icon.svg"):
        bpy.data.texts.new("piora-icon.svg").write(source)
    path = next(p for p in ET.fromstring(source).iter() if p.get("stroke") == "url(#pi)")
    return [[(v[i],v[i+1]) for i in range(0,8,2)] for v in
            ([float(n) for n in re.findall(r"-?[\d.]+", sub)] for sub in path.get("d").split("M")[1:])]


def build_ruin():
    fw = Vector(sight_basis()[0])
    m = MATERIALS
    for idx,(controls,depth,title) in enumerate(zip(read_icon_paths(), (153.,124.,174.),
            ("Lintel / crossing the gorge","West pier / near ice","East pier / buried basalt"))):
        def path(t):
            u = 1-t
            weights = (u**3,3*u*u*t,3*u*t*t,t**3)
            uv = [sum(w*p[i] for w,p in zip(weights,controls)) for i in (0,1)]
            return Vector(screen_ray(*icon_screen(*uv),depth))
        radius = depth * 36/FINAL_LENS * .00064*54
        # Cylindrical courses alternate with a recessed, worn joint. The tips are hemispherical.
        cuts = (.11,.285,.49,.685,.875) if idx==0 else (.12,.32,.54,.735,.90)
        ts = sorted({i/70 for i in range(71)} | {v+d for v in cuts for d in (-.007,0,.006)})
        rings = [(0., -math.sin(a)*radius, max(.018,math.cos(a))) for a in (math.pi/2,1.27,.98,.68,.36,.17)]
        rings += [(t,0.,1.) for t in ts]
        rings += [(1.,math.sin(a)*radius,max(.018,math.cos(a))) for a in (.17,.36,.68,.98,1.27,math.pi/2)]
        verts,faces,slots = [],[],[]
        sides = 28
        for j,(t,extension,r) in enumerate(rings):
            tangent = (path(min(1,t+.001))-path(max(0,t-.001))).normalized()
            across = fw.cross(tangent).normalized()
            center = path(t) + tangent*extension
            joint = min(abs(t-c) for c in cuts)
            taper = 1 - .018*max(0,1-joint/.007)
            for k in range(sides):
                angle = k*math.tau/sides
                ca,sa = math.cos(angle),math.sin(angle)
                flutes = .025*math.sin(k*2.51 + idx) + .016*math.sin(k*1.9+11*t)
                erode = 1+flutes+.016*math.sin(32*t + k*.59)+.007*math.sin(91*t+3*k)
                # Broad chisel facets on the main face; organic weathering along the edges.
                v = across*math.copysign(abs(ca)**.84,ca) + fw*.73*math.copysign(abs(sa)**.84,sa)
                verts.append(tuple(center + v*(radius*r*taper*erode)))
                if j==len(rings)-1:
                    continue
                p = j*sides+k
                q = j*sides+(k+1)%sides
                faces.append((p,q,q+sides,p+sides))
                weathering = math.sin(4*angle + 8*t) + .65*math.cos(9*angle - 5*t)
                slot = 1 if weathering > .96 or (idx==0 and weathering > 0 and ca>.62) else 0
                if idx==2 and t>.56+.055*math.sin(5*angle) and k%10 not in (0,1):
                    slot = 2 if t<.77+.05*math.cos(4*angle) else 3
                if joint<.003 and math.sin(k*.58 + t*19)>.02:
                    slot = 4
                slots.append(slot)
        faces += [tuple(reversed(range(sides))),tuple(range(len(verts)-sides,len(verts)))]
        slots += [1,1]
        ob = mesh_obj(title,verts,faces,m["ruin"],"Relic")
        for key in ("rind","violet_ice","edge","seam"):
            ob.data.materials.append(m[key])
        for face,slot in zip(ob.data.polygons,slots):
            face.material_index=slot
        ob["sightline_depth_m"] = depth
        ob["svg_start"] = list(controls[0])
        ob["svg_end"] = list(controls[-1])
        # Rounded cap terminates in a low mass of displaced, half-buried scree.
        if idx:
            foot = path(1)
            for k in range(11):
                a = RNG.uniform(0,math.tau)
                rr = radius*RNG.uniform(.9,1.65)
                x,y=foot.x+rr*math.cos(a),foot.y+rr*math.sin(a)
                if y < 3.8:
                    continue
                floe("Pier talus",x,y,RNG.uniform(.7,2.2),RNG.uniform(.5,1.8),RNG.uniform(.45,1.6),a)


def make_light(name, kind, loc, energy, color, size=3.0, target=(0, 0, 1), parent=None):
    data = bpy.data.lights.new(PREFIX + name, kind)
    data.energy = energy
    data.color = rgba(color)[:3]
    if kind == "AREA":
        data.shape = "DISK"
        data.size = size
    elif kind == "SUN":
        data.angle = math.radians(7)
    elif kind == "SPOT":
        data.spot_size = math.radians(size)
        data.spot_blend = .65
        data.shadow_soft_size = .08
    ob = obj_new(name, data, "Lighting", parent)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return ob


def build_lighting():
    key = make_light("Dawn / warm grazing light", "SUN", (-35,5,15), 2.95, "FFE4BF")
    key.data.angle = math.radians(2.8)
    sky = make_light("Ice valley / skylight", "SUN", (18,-38,43), .71, "BACFE9")
    sky.data.use_shadow = False
    bounce = make_light("Body / soft overhead reflection","AREA",(-1,-1.8,6.9),690,"EBF0EF",6)
    strip = make_light("Nameplate / moving bevel reflection","AREA",(-.8,-5.5,3.1),485,"FFE4C7",3.3,
                       (-.5,0,1.8))
    strip.data.shape = "RECTANGLE"
    strip.data.size, strip.data.size_y = .48,4.8
    for lamp in (bounce,strip):
        energy = lamp.data.energy
        for frame, level in ((1,1.),(128,1.),(158,.09)):
            lamp.data.energy = energy*level
            lamp.data.keyframe_insert("energy",frame=shot_frame(frame))
    if CFG["engine"] == "CYCLES":
        flag = box("Crest sunset / off-camera shadow flag",(-15.4,2.8,10.1),(6.5,7,.24),
                   MATERIALS["rock"],0,group="Lighting")
        flag.visible_camera = flag.visible_glossy = flag.visible_transmission = False
    make_light("Lintel / first light","AREA",(-39,13,62),63000,"FFE1BA",19,(-24,38,51))
    make_light("East pier / light through brash","AREA",(27,66,5),9400,"A6D3EF",12,(18,85,2))
    make_light("Clear ice / back edge","AREA",(-7.3,.7,1.55),420,"FFD6A4",1.7,(-6.5,-1.5,.4))
    card = make_light("Macro / narrow reflection card","AREA",(-6.1,-4.1,1.9),78,"F4D4AC",.7,(-6.5,-1.4,.5))
    card.data.shape="RECTANGLE"
    card.data.size,card.data.size_y=.19,1.3


def octagon(length, width, z, corner):
    x, y, c = length/2, width/2, corner
    return [(-x+c, -y, z), (x-c, -y, z), (x, -y+c, z), (x, y-c, z),
            (x-c, y, z), (-x+c, y, z), (-x, y-c, z), (-x, -y+c, z)]


def hull(name, rings, mat, parent, bevel=.035):
    v = [pt for ring in rings for pt in ring]
    f = [tuple(reversed(range(8))), tuple(range(len(v)-8, len(v)))]
    for j in range(len(rings)-1):
        for i in range(8):
            f.append((j*8+i, j*8+(i+1)%8, (j+1)*8+(i+1)%8, (j+1)*8+i))
    return mesh_obj(name, v, f, mat, parent=parent, bevel=bevel)


def batch_boxes(name, records, mat, parent):
    verts, faces = [], []
    for center, dims, basis in records:
        k = len(verts)
        verts.extend(tuple(Vector(center) + basis @ Vector(v)) for v in box_geometry(dims))
        faces.extend(tuple(k+i for i in face) for face in BOX_FACES)
    return mesh_obj(name, verts, faces, mat, parent=parent, bevel=0)


def wheel_band(name, outer, inner, width, mat, parent):
    n = 64
    verts = []
    for y, r in [(-width/2, outer), (width/2, outer),
                 (-width/2, inner), (width/2, inner)]:
        verts.extend((r*math.cos(math.tau*i/n), y, r*math.sin(math.tau*i/n))
                     for i in range(n))
    faces = []
    for i in range(n):
        j = (i+1)%n
        faces.extend(((i, n+i, n+j, j),
                      (2*n+i, 2*n+j, 3*n+j, 3*n+i),
                      (i, j, 2*n+j, 2*n+i),
                      (n+i, 3*n+i, 3*n+j, n+j)))
    return smooth_mesh(mesh_obj(name, verts, faces, mat, parent=parent))


def build_wheel(parent, tag):
    m = MATERIALS
    wheel_band("Airless outer belt " + tag, .645, .565, .39, m["rubber"], parent)
    for side in (-1, 1):
        torus("Titanium belt hoop " + tag, (0, side*.205, 0), .594, .028,
              m["metal"], parent, (math.pi/2, 0, 0))
        torus("Inner support hoop " + tag, (0, side*.18, 0), .355, .026,
              m["dark_metal"], parent, (math.pi/2, 0, 0))
        cylinder("Wheel center " + tag, (0, side*.20, 0), .205, .10,
                 m["graphite"], parent, (math.pi/2, 0, 0))
        cylinder("Axle cap " + tag, (0, side*.259, 0), .115, .025,
                 m["metal"], parent, (math.pi/2, 0, 0))
    for i in range(8):
        a=math.tau*i/8
        cylinder("Wheel lug "+tag, (.145*math.cos(a),-.258,.145*math.sin(a)),.018,.018,
                 m["metal"], parent,(math.pi/2,0,0),segments=6)
    for side in (-1, 1):
        for radius, gauge in ((.181,.008),(.105,.007),(.071,.005)):
            torus("Turned hub shoulder "+tag,(0,side*.275,0),radius,gauge,m["dark_metal"],parent,(math.pi/2,0,0))
        torus("Elastomer sidewall "+tag,(0,side*.165,0),.542,.071,m["rubber"],parent,(math.pi/2,0,0))
        for radius in (.529,.548,.566):
            torus("Sidewall moulding "+tag,(0,side*.230,0),radius,.005,m["graphite"],parent,(math.pi/2,0,0))
    # An ochre inspection mark makes angular motion visible in the opening shot.
    box("Tire inspection mark "+tag,(.588,-.226,0),(.066,.012,.046),m["amber"],.003,parent)
    spokes, treads = [], []
    for i in range(24):
        a = math.tau*i/24
        radial = Vector((math.cos(a), 0, math.sin(a)))
        tangent = Vector((-math.sin(a), 0, math.cos(a)))
        axial = Vector((0, 1, 0))
        basis = Matrix((radial, axial, tangent)).transposed()
        spokes.append((radial*.397, (.39, .31, .024), basis))
    for i in range(32):
        a = math.tau*i/32
        radial = Vector((math.cos(a), 0, math.sin(a)))
        tangent = Vector((-math.sin(a), 0, math.cos(a)))
        axial = Vector((0, 1, 0))
        for side in (-1, 1):
            angle = side*.24
            t = tangent*math.cos(angle) + axial*math.sin(angle)
            w = -tangent*math.sin(angle) + axial*math.cos(angle)
            basis = Matrix((t, w, -radial)).transposed()
            # Max radial face .68. Contact includes a tiny corner tolerance.
            treads.append((radial*.6625 + axial*side*.093,
                           (.068, .203, .035), basis))
    batch_boxes("Compliant lattice " + tag, spokes, m["dark_metal"], parent)
    batch_boxes("Chevron traction shoes " + tag, treads, m["traction"], parent)
    shoe = bpy.data.objects.get(PREFIX + "Chevron traction shoes " + tag)
    shoe.data.materials.append(m["traction_edge"])
    chamfer = shoe.modifiers.new("Polished tread edges", "BEVEL")
    chamfer.width, chamfer.segments = .0065, 2
    chamfer.material = 1


def build_fender(carrier, tag):
    n = 24
    verts, faces = [], []
    for y in (-.265, .265):
        for i in range(n+1):
            a = lerp(math.radians(22), math.radians(158), i/n)
            verts.append((.775*math.cos(a), y, .775*math.sin(a)))
    for i in range(n):
        faces.append((i, n+1+i, n+2+i, i+1))
    ob = mesh_obj("Carbon wheel guard " + tag, verts, faces, MATERIALS["graphite"], parent=carrier)
    sol = ob.modifiers.new("Guard thickness", "SOLIDIFY")
    sol.thickness = .035
    return ob


def star_mark(name, loc, size, mat, group, parent=None, rot=None):
    p = [(0, size), (.13*size, .18*size), (.65*size, 0),
         (.13*size, -.18*size), (0, -size), (-.13*size, -.18*size),
         (-.65*size, 0), (-.13*size, .18*size)]
    verts = [(0, 0, 0)] + [(x, y, 0) for x, y in p]
    faces = [(0, 1+(i+1)%8, 1+i) for i in range(8)]
    ob = mesh_obj(name, verts, faces, mat, group, parent)
    ob.location = loc
    if rot:
        ob.rotation_euler = rot
    return ob


def build_rover():
    m = MATERIALS
    root = empty("Rover chassis — baked terrain pose")
    hull("Structural keel", [octagon(3.88, 1.58, 1.05, .22),
         octagon(4.28, 1.85, 1.36, .28)], m["graphite"], root)
    hull("Continuous ceramic shell", [octagon(4.06, 1.78, 1.30, .20),
         octagon(4.46, 1.98, 1.65, .31), octagon(4.02, 1.68, 2.02, .31)],
         m["ceramic"], root, .055)
    hull("Dark roof insert", [octagon(2.94, 1.36, 2.015, .18),
         octagon(2.80, 1.30, 2.075, .18)], m["graphite"], root, .018)
    for side in (-1, 1):
        box("Recessed side badge", (0, side*.984, 1.705), (2.58, .10, .37),
            m["graphite"], .025, root)
        # Readable on BOTH sides: rotations have outward normals, not mirrored text.
        rot = (math.pi/2, 0, 0) if side < 0 else (math.pi/2, 0, math.pi)
        # Keep the descender of "p" clear of the separate serial-number line.
        text("piora body badge", CFG["brand"], (.04, side*1.037, 1.766), .35,
             m["lettering"], root, rot=rot)
        star_mark("Navigation badge", (.97*side, side*1.038, 1.717),
                  .105, m["violet"], "Rover", root, rot)
        box("Status strip housing", (.25, side*.982, 1.491), (1.76, .118, .056),
            m["graphite"], .012, root)
        box("Quiet side status strip", (.25, side*1.043, 1.494), (1.65, .012, .015),
            m["violet"], .004, root)
        text("Vehicle serial", "PX-06   /   POLARIS   2076", (0, side*1.037, 1.550),
             .055, m["small_print"], root, rot=rot, tracking=1.1)
        for sign in (-1, 1):
            for z in (1.59, 1.80):
                cylinder("Nameplate rivet", (sign*1.18, side*1.045, z), .023, .013,
                         m["metal"],root, (math.pi/2,0,0),segments=12)
        for i in range(3):
            box("Ochre service chevron", (1.44+i*.088,side*.968,1.68),(.043,.032,.17),
                m["amber"],.004,root,rot=(0,-.27,0))
        text("Expedition stencil", "06", (-1.59, side*.97,1.70),.19,m["graphite"],root,rot=rot)
    # Low, unmanned forward sensor fascia — no cockpit, no humanoid face.
    box("Front sensor fascia", (2.17, 0, 1.62), (.09, 1.36, .27), m["graphite"], .035, root)
    for side in (-1, 1):
        box("Headlight strip", (2.222, side*.45, 1.659), (.024, .38, .079),
            m["headlamp"], .008, root)
        cylinder("Forward proximity optic", (2.229, side*.16, 1.607), .056, .035,
                 m["lens"], root, (0, math.pi/2, 0))
        rod("Front tow bracket", (1.86, side*.64, 1.21), (2.18, side*.64, 1.24),
            .055, m["metal"], root)
        torus("Recovery eye", (2.21, side*.64, 1.25), .067, .018,
              m["metal"], root, (0, math.pi/2, 0))
        make_light("Terrain headlamp", "SPOT", (2.24, side*.46, 1.65), 35,
                   "D7E3EF", 42, (6.5, side*.5, .05), root)
    # Roof power/thermal tiles, separated panel seams and recessed fasteners.
    box("Photovoltaic substrate", (-.60, 0, 2.10), (1.55, 1.11, .05), m["dark_metal"], .025, root)
    for i in range(5):
        for j in range(4):
            box("Energy collection tile", (-1.2+i*.299, -.40+j*.265, 2.135),
                (.275, .235, .024), m["glass"], .006, root)
    box("Thermal management pod", (-1.69, 0, 2.0), (.49, 1.22, .23),
        m["ceramic_dark"], .065, root)
    for i in range(9):
        box("Radiator fin", (-1.76+i*.023, 0, 2.137), (.012, .93, .08),
            m["dark_metal"], .003, root)
    for x in (-1.44, 1.37):
        for y in (-.63, .63):
            cylinder("Flush roof fastener", (x, y, 2.075), .032, .014,
                     m["metal"], root, segments=12)
    # Multi-modal perception head on a compact articulated mast.
    cylinder("Mast footing", (.83, 0, 2.105), .23, .095, m["metal"], root)
    rod("Mast spar", (.82, 0, 2.15), (.91, 0, 2.76), .087, m["graphite"], root)
    rod("Mast cable conduit", (.73, .075, 2.17), (.83, .075, 2.74), .023,
        m["dark_metal"], root)
    sensor = empty("Perception head yaw", root)
    sensor.location = (.91, 0, 2.76)
    box("Perception head", (0, 0, .08), (.66, .78, .27), m["ceramic"], .078, sensor)
    box("Optical rail", (.326, 0, .083), (.035, .61, .155), m["graphite"], .035, sensor)
    for y, radius in [(-.21, .060), (0, .082), (.21, .060)]:
        cylinder("Multi spectral lens rim", (.36, y, .083), radius, .033,
                 m["metal"], sensor, (0, math.pi/2, 0))
        cylinder("Multi spectral glass", (.381, y, .083), radius*.81, .014,
                 m["lens"], sensor, (0, math.pi/2, 0))
    cylinder("Lidar wafer", (0, 0, .237), .15, .066, m["graphite"], sensor)
    cylinder("Lidar optical edge", (0, 0, .24), .153, .014, m["violet"], sensor)
    # Flat-panel comms instead of a retro dish.
    rod("Antenna support", (-1.28, .50, 2.10), (-1.32, .50, 2.55), .022, m["metal"], root)
    box("Phased array antenna", (-1.32, .5, 2.57), (.42, .07, .28),
        m["ceramic_dark"], .035, root, rot=(0, -.20, 0))
    for z in (2.50, 2.56, 2.62):
        box("Antenna slots", (-1.32, .46, z), (.30, .005, .012),
            m["graphite"], .002, root)
    # Folded sampling manipulator, kept off the hero side so the logo stays clear.
    for j, (a, b) in enumerate([
            ((.95, .9, 1.5), (.25, 1.05, 1.34)),
            ((.25, 1.05, 1.34), (1.18, 1.09, 1.22))]):
        rod("Stowed sample arm %d" % j, a, b, .064, m["metal"], root)
        cylinder("Sample arm joint", a, .104, .12, m["graphite"], root, (math.pi/2, 0, 0))
    box("Sample tool cassette", (1.24, 1.09, 1.22), (.28, .16, .14), m["graphite"], .028, root)
    wheels = []
    for x in WHEEL_X:
        for y in WHEEL_Y:
            tag = "%+.2f_%+.2f" % (x, y)
            carrier = empty("Suspension carrier " + tag, root)
            carrier.location = (x, y, WHEEL_RADIUS)
            carrier.rotation_mode = "QUATERNION"
            spin = empty("Wheel roll " + tag, carrier)
            build_wheel(spin, tag)
            build_fender(carrier, tag)
            arms = []
            for dx in (-.36, .36):
                anchor = Vector((x+dx, y*.63, 1.17))
                arm = rod("Articulated wishbone " + tag, anchor, carrier.location,
                          .052, m["dark_metal"], root)
                arms.append((arm, anchor, "arm"))
            anchor = Vector((x-.24, y*.64, 1.44))
            outer = rod("Suspension damper barrel " + tag, anchor, carrier.location,
                        .067, m["ceramic_dark"], root)
            piston = rod("Suspension damper piston " + tag, anchor, carrier.location,
                         .030, m["metal"], root)
            arms.extend(((outer, anchor, "barrel"), (piston, anchor, "piston")))
            wheels.append({"x": x, "y": y, "carrier": carrier, "spin": spin,
                           "arms": arms, "angle": 0.0, "last_center": None})
    for sign in (-1,1):
        box("Corner lamp / warm lens",(2.205,sign*.72,1.64),(.078,.098,.071),
            m["headlamp"],.016,root)
    return root, sensor, wheels


def build_camera():
    data = bpy.data.cameras.new(PREFIX + "Cinematic camera")
    cam = obj_new("Cinematic camera", data, "Cameras")
    data.sensor_width = 36
    data.sensor_fit = "HORIZONTAL"
    data.clip_start, data.clip_end = .08, 1500
    data.dof.use_dof = True
    data.dof.aperture_fstop = 10.  # Preserve the side logo and landscape together.
    data.dof.aperture_blades = 7
    focus = empty("Camera focus", group="Cameras")
    data.dof.focus_object = focus
    SCENE.camera = cam
    return cam, focus


def key_transform(ob, f, scale=False):
    ob.keyframe_insert("location", frame=f)
    ob.keyframe_insert("rotation_quaternion" if ob.rotation_mode == "QUATERNION"
                       else "rotation_euler", frame=f)
    if scale:
        ob.keyframe_insert("scale", frame=f)


def bake_motion(root, sensor, wheels, cam, focus):
    height = pitch = roll = 0.
    for f in range(1, SCENE.frame_end+1):
        u=(f-1)/(SCENE.frame_end-1)
        frame=1+239*u
        x=drive_x(u)
        hs=[surface_height(x+w["x"],w["y"]) for w in wheels]
        mean=sum(hs)/len(hs)
        want_pitch=-math.atan2(sum(hs[4:])-sum(hs[:2]), 6.2)
        want_roll=math.atan2(sum(hs[1::2])-sum(hs[::2]), 7.32)
        gain=1. if f==1 else .245
        height=lerp(height,mean,gain)
        roll=lerp(roll,want_roll,gain)
        pitch=lerp(pitch,want_pitch,gain)
        brake=math.exp(-((frame-145)/6.5)**2)-.44*math.exp(-((frame-155)/4.8)**2)
        sink=.057*math.exp(-((frame-18)/4.7)**2) + .042*brake
        root.location=(x,0,height-sink)
        root.rotation_euler=(roll,pitch+.032*brake+.022*math.exp(-((frame-18)/5.3)**2),0)
        key_transform(root,f)
        inv=root.rotation_euler.to_matrix().transposed()
        qinv=root.rotation_euler.to_quaternion().conjugated()
        for w,h in zip(wheels,hs):
            px,py=x+w["x"],w["y"]
            center=Vector((px,py,wheel_support(px,py)))
            local=inv@(center-root.location)
            w["carrier"].location=local
            w["carrier"].rotation_quaternion=qinv
            key_transform(w["carrier"],f)
            if w["last_center"] is not None:
                w["angle"]+=(center-w["last_center"]).length/WHEEL_RADIUS
            w["last_center"]=center.copy()
            w["spin"].rotation_euler.y=w["angle"]
            w["spin"].keyframe_insert("rotation_euler",frame=f)
            for arm,anchor,kind in w["arms"]:
                if kind=="barrel":
                    a,b=anchor,anchor.lerp(local,.58)
                elif kind=="piston":
                    a,b=anchor.lerp(local,.47),local
                else:
                    a,b=anchor,local
                update_rod(arm,a,b)
                key_transform(arm,f,scale=True)
        look=smooth((frame-138)/24)
        sensor.rotation_euler.z=lerp(.04,1.19,look)
        sensor.rotation_euler.y=lerp(.065,-.43,look)
        sensor.keyframe_insert("rotation_euler",frame=f)
        pos,aim,lens=camera_pose(u)
        cam.location=pos
        cam.rotation_euler=(Vector(aim)-cam.location).to_track_quat("-Z","Y").to_euler()
        cam.data.lens=lens
        key_transform(cam,f)
        cam.data.keyframe_insert("lens",frame=f)
        focus.location=aim
        focus.keyframe_insert("location",frame=f)


def scale_visibility(ob, on, off=None, scale=(1, 1, 1)):
    ob.scale = (0, 0, 0)
    ob.keyframe_insert("scale", frame=1)
    if on > 1:
        ob.keyframe_insert("scale", frame=on-1)
    ob.scale = scale
    ob.keyframe_insert("scale", frame=on)
    if off is not None:
        ob.keyframe_insert("scale", frame=off-1)
        ob.scale = (0, 0, 0)
        ob.keyframe_insert("scale", frame=off)


def build_tracks():
    samples = [drive_x((f-1)/(SCENE.frame_end-1)) for f in range(1, SCENE.frame_end+1)]
    # Visible marks trail the REAR wheel, never appear in front of the vehicle.
    start, end = START_X-4.5, END_X-1.55
    count = int((end-start)/.17)
    for j in range(count+1):
        x = lerp(start, end, j/count)
        on = 1 if x <= START_X-1.55 else 1+bisect.bisect_left(samples, x+1.55)
        on = min(on, SCENE.frame_end)
        for y in WHEEL_Y:
            verts, faces = [], []
            for side in (-1, 1):
                # Individual flat chevrons following all four terrain corners.
                local = [(-.052, side*.014), (.018, side*.014),
                         (.083, side*.188), (.013, side*.188)]
                k = len(verts)
                for dx, dy in local:
                    px, py = x+dx, y+dy
                    verts.append((px, py, surface_height(px, py)+.004))
                face = tuple(range(k, k+4))
                faces.append(face if side > 0 else tuple(reversed(face)))
            ob = mesh_obj("Compressed tread", verts, faces, MATERIALS["tracks"], "Effects")
            scale_visibility(ob, on)


def shot_frame(reference):
    return F((reference - 1) / 239)


def reveal_crack(name, xy, radius, start, finish):
    points = [(x, y, surface_height(x,y)+.028) for x,y in xy]
    ob = curve_line(name, points, MATERIALS["salt"], radius*.64, group="Effects")
    cu = ob.data
    for i,p in enumerate(cu.splines[0].points):
        p.radius = (1.05-.89*i/(len(points)-1)) * (1 + .13*math.sin(i*3.7))
    curves = [cu]
    if len(points)>4:
        lower = [(x,y+.003,z-.002) for x,y,z in points]
        fault = curve_line(name+" / blue cleft", lower, MATERIALS["rock"],radius*1.32,group="Effects")
        for i,p in enumerate(fault.data.splines[0].points):
            p.radius = 1 - .9*i/(len(points)-1)
        curves.append(fault.data)
    for spline in curves:
        for ref, amount in ((1,0.), (start,0.), (finish,1.)):
            spline.bevel_factor_end = amount
            spline.keyframe_insert("bevel_factor_end", frame=shot_frame(ref))
    return ob


def break_ice():
    m = MATERIALS
    axle = lambda f: drive_x((f-1)/239) + WHEEL_X[-1]
    cx, cy = axle(12)+.09, -1.475
    # Rock inclusions under an optically clear surface; only a few centimetres of ice.
    for k in range(12):
        x,y=cx+RNG.uniform(-.45,2.1),cy+RNG.uniform(-.75,.81)
        floe_ob=floe("Sub-surface shale",x,y,RNG.uniform(.08,.23),RNG.uniform(.035,.09),.024,RNG.uniform(-1,1))
        for p in floe_ob.data.polygons:
            p.material_index=0
    # Obsidian beneath the pressure plate follows the irregular perimeter of the ice.
    # The mouth of the fracture remains open once the fore-wheel ejects the lid.
    under_x,under_y=cx+1.10,cy-.28
    boundary=[]
    for i in range(34):
        a=i*math.tau/34
        r=.89+.11*math.sin(3*a+.3)+.09*math.cos(a*7)
        x=under_x+r*math.cos(a)*.79+math.sin(a)*.17
        y=under_y+r*math.sin(a)*.38
        boundary.append((x,y))
    rock_verts=[(under_x,under_y,surface_height(under_x,under_y)+.009)]
    rock_verts.extend((x,y,surface_height(x,y)+.006) for x,y in boundary)
    fan=[(0,i+1,(i+1)%len(boundary)+1) for i in range(len(boundary))]
    mesh_obj("Obsidian exposed in the shallow break",rock_verts,fan,m["rock"],"Effects")
    # The glaze peters out along a fault; there is no straight rectangular patch edge.
    vertices=[(under_x,under_y,surface_height(under_x,under_y)+.021)]
    coverage=[1.]
    faces=[]
    for j in range(1,6):
        u=j/5
        for i,(bx,by) in enumerate(boundary):
            x=lerp(under_x,bx,1.15*u)
            y=lerp(under_y,by,1.22*u)
            vertices.append((x,y,surface_height(x,y)+.021-.014*u**3))
            coverage.append(1.-smooth((u-.59)/.41))
            if j==1:
                faces.append((0,1+i,1+(i+1)%len(boundary)))
            else:
                a=1+(j-2)*len(boundary)
                ni=(i+1)%len(boundary)
                faces.append((a+i,a+i+len(boundary),a+ni+len(boundary),a+ni))
    glaze=mesh_obj("Thin ice / bedrock visible below",vertices,faces,m["glaze"],"Effects")
    glaze.data.attributes.new("IceCoverage","FLOAT","POINT").data.foreach_set("value",coverage)
    # Trapped air turns the transparent sheet milky just outside the contact patch.
    frost_v, frost_f = [], []
    for i in range(170):
        angle=RNG.uniform(0,math.tau)
        r=math.sqrt(RNG.random())
        u,v=.17*r*math.cos(angle),.066*r*math.sin(angle)
        q=RNG.uniform(.003,.013)*(1.1-.45*r)
        k=len(frost_v)
        frost_v.extend(((u-q,v,0.),(u+q*.8,v-q*.45,0.),(u+q*.53,v+q*.68,.001)))
        frost_f.append((k,k+1,k+2))
    frost=mesh_obj("Cloud of crushed ice cells",frost_v,frost_f,m["salt"],"Effects")
    frost.location=(cx,cy,surface_height(cx,cy)+.026)
    for frame,amount in ((1,0.),(7,0.),(10,.40),(14,1.)):
        frost.scale=(amount,amount,amount)
        frost.keyframe_insert("scale",frame=shot_frame(frame))
    # Stress whitening grows where the lug lands, followed by a branching extensional fracture.
    for k in range(30):
        ang = RNG.uniform(0, math.tau)
        radius = RNG.uniform(.045,.19)
        xx,yy = cx+RNG.uniform(-.032,.045),cy+RNG.uniform(-.03,.035)
        xy = [(xx,yy),(xx+.45*radius*math.cos(ang+.22),yy+.4*radius*math.sin(ang)),
              (xx+radius*math.cos(ang),yy+radius*math.sin(ang))]
        reveal_crack("Crushed grains / load patch",xy,.0039,RNG.randint(8,11),RNG.randint(12,15))
    for j,(length,angle) in enumerate(((1.67,-.28),(1.12,.51),(.83,-.8),(.46,1.4))):
        xy=[(cx,cy)]
        for i in range(1,10):
            x = cx + math.cos(angle)*length*i/9
            y = cy + math.sin(angle)*length*i/9 + RNG.uniform(-.042,.042)
            xy.append((x,y))
        reveal_crack("Running fracture %d" % j,xy,.006 if j==0 else .004,13+j,24+j)
        for i in (3,6):
            x,y=xy[i]
            sign=(-1)**(i+j)
            reveal_crack("Fracture bifurcation",[(x,y),(x+.1,y+.085*sign),(x+.25,y+.13*sign)],
                         .003,14+i,22+i)
    origin = Vector((axle(23)+.17,-1.56,0))
    origin.z = surface_height(origin.x,origin.y)+.031
    corners=[(-.31,-.12),(-.19,-.23),(.19,-.18),(.34,-.025),(.16,.15),(-.08,.195),(-.29,.09)]
    outline=[]
    for i,(x,y) in enumerate(corners):
        ex,ey=corners[(i+1)%len(corners)]
        for k in range(5):
            t=k/5
            outline.append((lerp(x,ex,t)+RNG.uniform(-.008,.008),lerp(y,ey,t)+RNG.uniform(-.005,.005)))
    count=len(outline)
    v=[]
    for layer in range(3):
        for i,(x,y) in enumerate(outline):
            thickness=.012+.024*(.33-x)/.66+.004*math.sin(i*2.47)
            inset=(1.,.998,.976+.014*math.sin(i*2.23))[layer]
            v.append((x*inset,y*inset,thickness*(0.,.67,1.)[layer]+.019*x))
    faces=[tuple(reversed(range(count))),tuple(range(2*count,3*count))]
    indices=[0,0]
    for j in range(2):
        for k in range(count):
            p=j*count+k
            q=j*count+(k+1)%count
            faces.append((p,q,q+count,p+count))
            indices.append(1 if (k<7 or k>29) and k%5!=2 else (2 if j==1 or 10<k<22 else 0))
    shard=mesh_obj("Spalled shell / three material fracture",v,faces,m["clear"],"Effects")
    for key in ("salt","glint"):
        shard.data.materials.append(m[key])
    for p,idx in zip(shard.data.polygons,indices):
        p.material_index=idx
    for i in range(21):
        t=i/21
        x,y=-.20+t*.34,-.14+.17*t+.016*math.sin(t*7)
        a=RNG.uniform(.026,.096)*(1-t*.6)
        cu=curve_line("Feather inclusion",[(x-.045,y-.017,.013),(x,y,.014),
                     (x+a*.40,y+a*.29,.016),(x+a*.75,y+a,.019)],m["salt"],RNG.uniform(.00045,.0010),shard,"Effects")
        cu.data.splines[0].points[-1].radius=.15
    for i in range(25):
        a=RNG.uniform(.0008,.0026)
        sphere("Trapped air", (RNG.uniform(-.19,.14),RNG.uniform(-.13,.11),.014),
               (a*1.5,a,a*.66),m["salt"],"Effects",shard,detail=5)
    cam_pos,aim,_ = camera_pose(41/239)
    direction=(Vector(aim)-Vector(cam_pos)).normalized()
    near=Vector(cam_pos)+direction*.17
    for f,pos,rot in [(1,origin,(0,0,0)),(22,origin,(0,0,0)),
            (26,origin+Vector((.08,-.06,.118)),(-.47,-.17,-.09)),
            (31,origin+Vector((.31,-.30,.37)),(-.96,-.37,.08)),
            (36,origin.lerp(near,.57)+Vector((0,0,.24)),(-1.50,-.53,.36)),
            (42,near,(-2.16,-.61,.59)),(49,near+Vector((.65,-.87,-.63)),(-3.,-.74,1.2))]:
        shard.location=pos
        shard.rotation_euler=rot
        key_transform(shard,shot_frame(f))
    shard.location.z=surface_height(shard.location.x,shard.location.y)-.07
    shard.keyframe_insert("location",frame=shot_frame(54))
    for i in range(6):
        p=origin+Vector((RNG.uniform(-.1,.1),RNG.uniform(-.12,.12),.006))
        s=RNG.uniform(.025,.07)
        fleck=mesh_obj("Secondary brittle flake",[(0,0,0),(s,0,0),(.3*s,s*.7,.008),(0,0,.014)],
                       [(0,2,1),(0,1,3),(1,2,3),(2,0,3)],m["salt"],"Effects")
        delta=Vector((RNG.uniform(.2,.7),-RNG.uniform(.1,.45),0))
        for f,h,t in ((24,0.,0.),(31,.18+i*.017,.42),(42,0.,1.)):
            fleck.location=p+delta*t+Vector((0,0,h))
            fleck.rotation_euler.y=t*(1+i)
            key_transform(fleck,shot_frame(f))


def build_compositor():
    if bpy.app.version >= (5,0,0):
        tree=bpy.data.node_groups.new(PREFIX+"Optical highlights","CompositorNodeTree")
        tree.interface.new_socket(name="Image",in_out="OUTPUT",socket_type="NodeSocketColor")
        SCENE.compositing_node_group=tree
        out=tree.nodes.new("NodeGroupOutput")
    else:
        SCENE.use_nodes=True
        tree=SCENE.node_tree
        tree.nodes.clear()
        out=tree.nodes.new("CompositorNodeComposite")
    beauty=tree.nodes.new("CompositorNodeRLayers")
    beauty.scene=SCENE
    glow=tree.nodes.new("CompositorNodeGlare")
    if glow.inputs.get("Type") is not None:
        set_input(glow,"Type","Fog Glow")
        set_input(glow,"Quality","Medium")
        set_input(glow,"Threshold",3.2)
        set_input(glow,"Strength",.16)
        set_input(glow,"Size",.21)
    else:
        glow.glare_type="FOG_GLOW"
        glow.threshold=3.2
        glow.mix=-.84
    tree.links.new(beauty.outputs["Image"],glow.inputs["Image"])
    tree.links.new(glow.outputs["Image"],out.inputs["Image"])


def configure_scene(scene, hud=False):
    engine_id = "BLENDER_EEVEE_NEXT" if CFG["engine"] == "EEVEE" or hud else "CYCLES"
    try:
        scene.render.engine = engine_id
    except (TypeError, ValueError):
        if engine_id == "BLENDER_EEVEE_NEXT":
            scene.render.engine = "BLENDER_EEVEE"
        else:
            raise
    scene.render.resolution_x, scene.render.resolution_y = CFG["resolution"]
    scene.render.resolution_percentage = 25 if CFG["quality"] == "PREVIEW" else 100
    scene.render.fps = CFG["fps"]
    scene.frame_start = 1
    scene.frame_end = max(2, round(CFG["duration"] * CFG["fps"]))
    scene.render.film_transparent = hud
    scene.render.image_settings.color_mode = "RGBA" if hud else "RGB"
    scene.render.use_file_extension = True
    if hasattr(scene.render, "use_motion_blur"):
        scene.render.use_motion_blur = CFG["motion_blur"] and not hud
        scene.render.motion_blur_shutter = .28
    eevee = getattr(scene, "eevee", None)
    if eevee and hasattr(eevee, "taa_render_samples"):
        eevee.taa_render_samples = 4 if CFG["quality"] == "PREVIEW" else 16
    if eevee and hasattr(eevee, "volumetric_samples"):
        eevee.volumetric_samples = 32 if CFG["quality"] == "PREVIEW" else 64
    if scene.render.engine == "CYCLES":
        scene.cycles.samples = 6 if CFG["quality"] == "PREVIEW" else 20
        scene.cycles.use_adaptive_sampling = True
        scene.cycles.adaptive_threshold = .075
        scene.cycles.adaptive_min_samples = 6
        scene.cycles.transparent_max_bounces = 6
        scene.render.use_persistent_data = True
        scene.cycles.use_denoising = True
        scene.cycles.max_bounces = 6
        scene.cycles.volume_bounces = 1
        scene.cycles.device = "CPU"  # Safe unless a usable GPU is discovered.
        addon = bpy.context.preferences.addons.get("cycles")
        if addon:
            prefs = addon.preferences
            original = prefs.compute_device_type
            for backend in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
                try:
                    prefs.compute_device_type = backend
                    prefs.get_devices()
                    devices = [d for d in prefs.devices if d.type == backend]
                    if devices:
                        for d in prefs.devices:
                            d.use = d in devices
                        scene.cycles.device = "GPU"
                        if backend == "OPTIX":
                            scene.cycles.denoiser = "OPTIX"
                            scene.cycles.denoising_use_gpu = True
                        print("[Piora] Cycles GPU:", backend)
                        break
                except (TypeError, ValueError, RuntimeError):
                    continue
            else:
                prefs.compute_device_type = original
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
    except (TypeError, ValueError):
        pass
    scene.view_settings.exposure = .05
    scene.view_settings.gamma = 1.0
    if not hud:
        set_output(scene)


def set_output(scene):
    if CFG["output_format"] == "MP4":
        if CFG["quality"] == "PREVIEW":
            scene.render.resolution_x += (-scene.render.resolution_x) % 4
            scene.render.resolution_y += (-scene.render.resolution_y) % 4
        if hasattr(scene.render.image_settings, "media_type"):
            scene.render.image_settings.media_type = "VIDEO"
        else:
            scene.render.image_settings.file_format = "FFMPEG"
        scene.render.image_settings.color_mode = "RGB"
        scene.render.ffmpeg.format = "MPEG4"
        scene.render.ffmpeg.codec = "H264"
        scene.render.ffmpeg.constant_rate_factor = "HIGH"
        scene.render.ffmpeg.ffmpeg_preset = "GOOD"
        scene.render.ffmpeg.gopsize = CFG["fps"]*2
        scene.render.ffmpeg.audio_codec = "NONE"
        scene.render.filepath = str(OUT / "piora_intro.mp4")
    else:
        (OUT / "frames").mkdir(exist_ok=True)
        if hasattr(scene.render.image_settings, "media_type"):
            scene.render.image_settings.media_type = "IMAGE"
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGB"
        scene.render.image_settings.color_depth = "8"
        scene.render.filepath = str(OUT / "frames" / "frame_")


def linearize_actions():
    """Supports legacy and layered actions. No interpolation overshoot in bakes."""
    ids = list(SCENE.objects)
    ids += [o.data for o in ids if o.data is not None]
    ids += [m.node_tree for m in bpy.data.materials
            if m.name.startswith(PREFIX) and m.use_nodes]
    ids += [SCENE.compositing_node_group if bpy.app.version >= (5, 0, 0) else SCENE.node_tree]
    seen = set()
    for owner in ids:
        ad = getattr(owner, "animation_data", None)
        action = ad.action if ad else None
        if action is None or action.as_pointer() in seen:
            continue
        seen.add(action.as_pointer())
        curves = []
        # 4.4+ uses slotted actions; prefer channelbags rather than action.fcurves.
        for layer in getattr(action, "layers", []):
            for strip in getattr(layer, "strips", []):
                bags = getattr(strip, "channelbags", [])
                for bag in bags:
                    curves.extend(list(bag.fcurves))
        if not curves:
            try:
                curves = list(action.fcurves)
            except AttributeError:
                pass
        for fc in curves:
            for key in fc.keyframe_points:
                key.interpolation = "LINEAR"


def setup_workspace():
    if bpy.context.window:
        bpy.context.window.scene = SCENE
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                space = area.spaces.active
                space.region_3d.view_perspective = "CAMERA"
                space.overlay.show_overlays = False
                space.shading.type = "MATERIAL"
    for name,frame in (("01 / CONTACT",1),("Pressure fracture",13),("Spall",26),
                       ("02 / RIDGE",43),("Side plate / poster",118),
                       ("03 / DISCOVERY",136),("Stop",152),("Sightline lock",220)):
        SCENE.timeline_markers.new(name, frame=shot_frame(frame))
    SCENE.frame_set(shot_frame(118))


def get_config():
    cfg = dict(CONFIG)
    if "--" in sys.argv:
        args = sys.argv[sys.argv.index("--")+1:]
        p = argparse.ArgumentParser(description="Generate the Piora startup animation")
        p.add_argument("--mode", choices=["BUILD", "FRAME", "ANIMATION"])
        p.add_argument("--quality", choices=["PREVIEW", "FINAL"])
        p.add_argument("--engine", choices=["EEVEE", "CYCLES"])
        p.add_argument("--format", choices=["MP4", "PNG_SEQUENCE"])
        p.add_argument("--out")
        p.add_argument("--seconds", type=float)
        opts = p.parse_args(args)
        for src, dst in (("mode", "render_mode"), ("quality", "quality"),
                         ("engine", "engine"), ("format", "output_format"),
                         ("out", "output_dir"), ("seconds", "duration")):
            value = getattr(opts, src)
            if value is not None:
                cfg[dst] = value
    for key, allowed in (("quality", {"PREVIEW", "FINAL"}),
                         ("engine", {"EEVEE", "CYCLES"}),
                         ("render_mode", {"BUILD", "FRAME", "ANIMATION"}),
                         ("output_format", {"MP4", "PNG_SEQUENCE"})):
        cfg[key] = str(cfg[key]).upper()
        if cfg[key] not in allowed:
            raise ValueError("Invalid %s: %r" % (key, cfg[key]))
    if not (2 <= cfg["duration"] <= 60):
        raise ValueError("duration 必须在 2–60 秒之间。")
    if not (12 <= cfg["fps"] <= 120):
        raise ValueError("fps 必须在 12–120 之间。")
    if len(cfg["resolution"]) != 2 or min(cfg["resolution"]) < 320:
        raise ValueError("resolution 必须为有效的 (宽, 高)。")
    if cfg["resolution"][0] < cfg["resolution"][1]:
        raise ValueError("这版镜头针对横屏设计，请使用宽度 >= 高度的分辨率。")
    if cfg["output_format"] == "MP4" and any(n % 2 for n in cfg["resolution"]):
        raise ValueError("H.264 MP4 的宽高请使用偶数。")
    if not str(cfg["brand"]).strip():
        raise ValueError("brand 不能为空。")
    return cfg


def main():
    global CFG, RNG, SCENE, OUT
    if bpy is None:
        raise RuntimeError("此文件必须在 Blender 中运行，不能用普通 Python 生成场景。")
    if bpy.app.version < (4, 5, 0):
        raise RuntimeError("本脚本以 Blender 4.5 LTS 为基线，请使用 4.5 或更新版本。")
    CFG = get_config()
    RNG = random.Random(CFG["seed"])
    base = Path(CFG["output_dir"]).expanduser().resolve() if CFG["output_dir"] else Path.home()/"Piora_Animation"
    OUT = base / datetime.now().strftime("run_%Y%m%d_%H%M%S_%f")
    OUT.mkdir(parents=True, exist_ok=False)
    MESH_CACHE.clear()
    MATERIALS.clear()
    COLLECTIONS.clear()
    SCENE = bpy.data.scenes.new(PREFIX + "Polaris expedition 2076")
    if bpy.context.window:
        bpy.context.window.scene = SCENE
    for name in ("Rover", "Environment", "Relic", "Lighting", "Cameras", "Effects"):
        col = bpy.data.collections.new(PREFIX + name)
        SCENE.collection.children.link(col)
        COLLECTIONS[name] = col
    configure_scene(SCENE)
    print("[Piora] Building procedural materials and ice world...")
    build_materials()
    build_ice_materials()
    finish_rover_surfaces()
    build_landscape()
    build_ruin()
    build_world()
    build_lighting()
    print("[Piora] Building six-wheel autonomous rover...")
    root, sensor, wheels = build_rover()
    emitter=MATERIALS["headlamp"].node_tree.nodes.get("Emission")
    animate_value(emitter.inputs["Strength"],[(1,5.),(shot_frame(142),5.),(shot_frame(161),27.)])
    cam, focus = build_camera()
    print("[Piora] Baking ground contact, wheel rotation and camera...")
    bake_motion(root, sensor, wheels, cam, focus)
    if CFG["tracks"]:
        build_tracks()
    break_ice()
    build_compositor()
    linearize_actions()
    setup_workspace()
    (OUT / "render_config.json").write_text(json.dumps(CFG, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        source = Path(__file__)
        if source.is_file():
            block = bpy.data.texts.new("piora_intro_source.py")
            block.write(source.read_text(encoding="utf-8"))
    except (NameError, OSError):
        pass
    if CFG["save_blend"]:
        # Keep output portable if the saved project moves to another workstation.
        render_path = SCENE.render.filepath
        SCENE.render.filepath = "//frames/frame_" if CFG["output_format"] == "PNG_SEQUENCE" else "//piora_intro.mp4"
        # copy=True does not overwrite/switch the user's original .blend filepath.
        bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "piora_polaris_2076.blend"), copy=True, compress=True, relative_remap=False)
        SCENE.render.filepath = render_path
    print("[Piora] Scene:", SCENE.name)
    print("[Piora] Output:", OUT)
    print("[Piora] The current frame is the side-logo hero view. F12 previews it.")
    if CFG["render_mode"] == "FRAME":
        old_format, old_path = SCENE.render.image_settings.file_format, SCENE.render.filepath
        old_media = getattr(SCENE.render.image_settings, "media_type", None)
        if old_media is not None:
            SCENE.render.image_settings.media_type = "IMAGE"
        SCENE.render.image_settings.file_format = "PNG"
        SCENE.render.filepath = str(OUT / "piora_preview.png")
        try:
            bpy.ops.render.render(write_still=True, scene=SCENE.name)
        finally:
            if old_media is not None:
                SCENE.render.image_settings.media_type = old_media
            if old_media != "VIDEO":
                SCENE.render.image_settings.file_format = old_format
            SCENE.render.filepath = old_path
    elif CFG["render_mode"] == "ANIMATION":
        bpy.ops.render.render(animation=True, scene=SCENE.name)
    print("[Piora] Done. Existing scenes were preserved.")


if __name__ == "__main__":
    main()
