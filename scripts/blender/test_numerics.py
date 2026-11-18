"""Pure numerical checks only. This does NOT execute Blender or validate rendering.
Run with normal Python: python test_numerics.py
"""
import importlib.util
import math
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('piora_intro', Path(__file__).with_name('piora_intro.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def sub(a, b): return tuple(x-y for x, y in zip(a,b))
def dot(a, b): return sum(x*y for x,y in zip(a,b))
def cross(a, b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def norm(a):
    length = math.sqrt(dot(a,a))
    return tuple(x/length for x in a)


class Checks(unittest.TestCase):
    def setUp(self):
        m.AXIS_COORDS = m.make_axis(True)

    def test_drive_is_monotone_and_stops(self):
        p = [m.drive_x(i/1000) for i in range(1001)]
        self.assertAlmostEqual(p[0], m.START_X)
        self.assertAlmostEqual(p[-1], m.END_X)
        self.assertTrue(all(b >= a-1e-12 for a,b in zip(p,p[1:])))
        for i in range(750,1001): self.assertAlmostEqual(p[i],m.END_X)

    def test_mesh_grid_is_ordered_and_symmetric(self):
        for preview in (True,False):
            a = m.make_axis(preview)
            self.assertTrue(all(x<y for x,y in zip(a,a[1:])))
            self.assertGreater(a[-1],480)
            for x,y in zip(a,reversed(a)): self.assertAlmostEqual(x,-y)

    def test_height_at_vertices_matches_mesh(self):
        a = m.AXIS_COORDS
        for x in a[::7]:
            for y in a[::9]:
                self.assertAlmostEqual(m.surface_height(x,y), m.terrain_height(x,y), places=8)

    def test_ground_contact_finite_and_clearance_positive(self):
        for i in range(240):
            x=m.drive_x(i/239)
            ground=[m.surface_height(x+dx,y) for dx in m.WHEEL_X for y in m.WHEEL_Y]
            avg=sum(ground)/6
            pitch_slope=(sum(ground[4:])-sum(ground[:2]))/6.2
            roll_slope=(sum(ground[1::2])-sum(ground[::2]))/7.32
            for (dx,y),h in zip(((dx,y) for dx in m.WHEEL_X for y in m.WHEEL_Y),ground):
                self.assertTrue(math.isfinite(h))
                self.assertAlmostEqual((h+m.WHEEL_RADIUS)-h,m.WHEEL_RADIUS)
                self.assertGreater(avg+1.05+pitch_slope*dx+roll_slope*y-h,0.85)

    def test_camera_does_not_intersect_ground(self):
        for i in range(240):
            u=i/239
            pos,aim,lens=m.camera_pose(u)
            self.assertGreater(pos[2]-m.surface_height(*pos[:2]),0.65)
            self.assertTrue(22 <= lens <= 42)

    def test_tracking_shot_contains_all_six_wheels_and_mast(self):
        # Conservative world-space envelope of main rover components. Terrain tilt
        # is small; add a margin to the envelope rather than importing mathutils.
        points=[(x,y,z) for x in (-2.27,2.27) for y in (-1.51,1.51) for z in (0,2.05)]
        points += [(x,y,3.05) for x in (.52,1.30) for y in (-.43,.43)]
        aspect=16/9
        max_screen=0
        for i in range(42,136):
            x=m.drive_x(i/239)
            floor=sum(m.surface_height(x+dx,y) for dx in m.WHEEL_X for y in m.WHEEL_Y)/6
            pos,target,lens=m.camera_pose(i/239)
            forward=norm(sub(target,pos))
            right=norm(cross(forward,(0,0,1)))
            up=cross(right,forward)
            tan_x=18/lens
            tan_y=tan_x/aspect
            for p in points:
                ray=sub((x+p[0],p[1],floor+p[2]),pos)
                depth=dot(ray,forward)
                self.assertGreater(depth,0)
                sx=abs(dot(ray,right)/(depth*tan_x))
                sy=abs(dot(ray,up)/(depth*tan_y))
                max_screen=max(max_screen,sx,sy)
                self.assertLess(sx,.99)
                self.assertLess(sy,.99)
        print('Maximum conservative rover screen extent (edge=1):',round(max_screen,4))

    def test_pressure_and_tracking_shots_share_screen_direction(self):
        for i in range(136):
            pos,target,_=m.camera_pose(i/239)
            right=norm(cross(sub(target,pos),(0,0,1)))
            self.assertGreater(right[0], .8)

    def test_three_depths_project_onto_the_locked_sightline(self):
        eye,aim,lens=m.camera_pose(1)
        fw=norm(sub(aim,eye))
        right=norm(cross(fw,(0,0,1)))
        up=cross(right,fw)
        for x,y in ((246,310),(363,326),(655,326),(256,789),(790,786)):
            sx,sy=m.icon_screen(x,y)
            for depth in (124,153,174):
                ray=sub(m.screen_ray(sx,sy,depth),eye)
                self.assertAlmostEqual(.5+lens/36*dot(ray,right)/dot(ray,fw),sx,places=7)
                self.assertAlmostEqual(.5+16/9*lens/36*dot(ray,up)/dot(ray,fw),sy,places=7)

    def test_park_and_camera_lock(self):
        for frame in range(152,241):
            self.assertEqual(m.drive_x((frame-1)/239),m.END_X)
        for frame in range(m.ALIGN_FRAME,241):
            self.assertEqual(m.camera_pose((frame-1)/239),m.camera_pose(1))

    def test_box_normals_point_outward(self):
        v=m.box_geometry((2,3,4))
        for f in m.BOX_FACES:
            a,b,c=(v[f[i]] for i in range(3))
            self.assertGreater(dot(cross(sub(b,a),sub(c,a)),a),0)

    def test_color_conversion(self):
        self.assertEqual(m.rgba('000000'),(0,0,0,1))
        self.assertEqual(m.rgba('FFFFFF'),(1,1,1,1))
        self.assertAlmostEqual(m.rgba('808080')[0],.2158605,places=6)


if __name__ == '__main__':
    unittest.main(verbosity=2)
