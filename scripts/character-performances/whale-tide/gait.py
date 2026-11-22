"""Paint the two 60 fps walks. All distances are in the 384 x 512 drawing space.

The foreground pelvis is registered to (151,483) on the terrace. Each footprint
is authored once in terrace coordinates and stays there until that foot lifts.
Output is straight-alpha PNG plus local shoe markers and world-space root offsets.
"""
import argparse
import json
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

import cv2 as cv
import numpy as np
from scipy.interpolate import PchipInterpolator


ART = Path(__file__).resolve().parent
ROOT = ART.parents[2]
PERFORMANCE = ROOT / ".verification/wallpaper-hd"
RIFE = ROOT / ".verification/wallpaper-walk/rife"
W, H, FPS = 384, 512, 60
SCALE = 2.56
NEARBY = (952 - 1194) / SCALE
LEGS = ("near", "far")
NAMES = ("hinge", "knee", "ankle", "sole", "toe", "heel")
Y, X = np.mgrid[:H, :W].astype(np.float32)
GRID = np.dstack((X, Y))
# Only the lower half needs inverse bone skinning. The painted apron covers the hip.
LEG_GRID = GRID[280:]
SAMPLES = 24


def smooth(t):
    t = np.clip(t, 0., 1.)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def premul(img):
    p = img.astype(np.float32) / 255.
    p[:, :, :3] *= p[:, :, 3:]
    return p


def straight(p):
    alpha = p[:, :, 3:]
    return np.uint8(np.rint(255 * np.clip(np.concatenate(
        (p[:, :, :3] / np.maximum(alpha, 1e-6), alpha), axis=2), 0, 1)))


def over(back, front):
    return front + back * (1 - front[:, :, 3:])


def read_art():
    sheet = cv.imread(str(ART / "cels.webp"), cv.IMREAD_UNCHANGED)
    records = json.loads((ART / "bones.json").read_text(encoding="utf-8"))
    poses = {}
    for i in (0, 1, 7):
        rec = records[i]
        block = sheet[i//4*4*H:(i//4+1)*4*H, i%4*W:(i%4+1)*W]
        layers = {name: premul(block[j*H:(j+1)*H]) for j, name in enumerate(("body", "far", "near", "back"))}
        drawing = layers["back"]
        for name in rec["backToFront"][1:]:
            drawing = over(drawing, layers[name])
        layers["all"] = drawing
        layers["upper"] = over(layers["back"], layers["body"])
        layers["bones"] = {leg: np.float32([rec[leg][k] for k in NAMES]) for leg in LEGS}
        poses[i] = layers
    return poses


def hand_release(rest):
    # The hands are registered by shoulder, elbow, wrist and fingertip.
    # Keep the original head and the dress hem throughout the release.
    sheet = cv.imread(str(ART/"gait/release.webp"), cv.IMREAD_UNCHANGED)
    if sheet is None or sheet.shape != (785,920,4):
        raise ValueError("Expected 25 release cels of 184 by 157 pixels")
    frames = []
    for key in range(25):
        row,col = divmod(key,5)
        pose = rest[:384].copy()
        cel = sheet[row*157:(row+1)*157,col*184:(col+1)*184]
        pose[127:284,45:229] = premul(cel)
        frames.append(pose)
    return frames


def paint_track(poses, rife, model, folder):
    # Each heading uses a three-quarter drawing. Keep the hair ornament and
    # eye on their original painted side even when the actor returns.
    turn = cv.imread(str(ART/"center/turn.webp"), cv.IMREAD_UNCHANGED)
    edge = [(0,365),(110,357),(119,352),(125,350),(130,349.9),(137,350.2),
            (146,350.6),(152,350.9),(161,350.3),(168,350.4),(175,350),(185,352),(220,363),(383,363)]
    rim = np.interp(X,*np.float32(edge).T)
    def upper(cel):
        cut = cel.copy()
        cut[:,:,3] = np.uint8(np.rint(cut[:,:,3]*np.clip(rim-Y+.5,0,1)))
        return premul(cut)[:384]
    authored = cv.imread(str(ART/"gait/carriage.webp"),cv.IMREAD_UNCHANGED)
    if authored is None or authored.shape!=(H,2*W,4):
        raise ValueError("Expected two registered three-quarter carriage paintings")
    held, opening = (upper(authored[:,n*W:(n+1)*W]) for n in range(2))
    front,quarter = (upper(turn[:H,n*W:(n+1)*W]) for n in range(2))
    release = hand_release(poses[0]["upper"])
    right = premul(cv.imread(str(ART/"gait-right.webp"),cv.IMREAD_UNCHANGED)[:,:W])[:384]
    # Joined hands leave the table. At rest they part, lower and settle.
    # The return faces the table and ends by reversing the original clasp.
    uppers = [release[0],held,opening,quarter,poses[7]["upper"][:384],
              front,right,front,release[-1],release[12],release[0]]
    inp,out = folder/"drawings",folder/"interpolation"
    inp.mkdir()
    out.mkdir()
    matte = np.float32([.88,.84,.79])
    for i,top in enumerate(uppers):
        alpha = top[:,:,3:]
        color = top[:,:,:3] + matte*(1-alpha)
        dual = np.concatenate((color,np.zeros((384,32,3),np.float32),np.repeat(alpha,3,axis=2)),axis=1)
        cv.imwrite(str(inp/f"{i:02}.png"),np.uint8(np.rint(255*np.clip(dual,0,1))))
    # In directory mode this renderer allocates output slots even for the
    # final still. Its source cel k is at k * (n / input_count).
    count = len(uppers)*SAMPLES
    subprocess.run([str(rife),"-i",str(inp),"-o",str(out),"-m",str(model),
                    "-n",str(count),"-j","2:1:2","-f","%04d.png"],check=True)
    paths = sorted(out.glob("*.png"))
    if len(paths)!=count:
        raise ValueError("Missing optical in-betweens")
    track = []
    for i,path in enumerate(paths[:(len(uppers)-1)*SAMPLES+1]):
        if i>=8*SAMPLES:
            k=(10*SAMPLES-i)*12/SAMPLES
            track.append(lerp(release[int(k)],release[min(24,int(k)+1)],k-int(k)))
        elif i%SAMPLES==0:
            track.append(uppers[i//SAMPLES].copy())
        else:
            pair = cv.imread(str(path)).astype(np.float32)/255
            alpha = pair[:,W+32:,1:2]
            color = np.clip(pair[:,:W]-matte*(1-alpha),0,alpha)
            track.append(np.concatenate((color,alpha),axis=2))
    install_release(track,upper,held,poses[7]["upper"][:384])
    return track


def install_release(track, upper, held, entry):
    sheet = cv.imread(str(ART/"gait/carriage-release.webp"),cv.IMREAD_UNCHANGED)
    settle = cv.imread(str(ART/"gait/turn-settle.webp"),cv.IMREAD_UNCHANGED)
    if sheet.shape!=(7*151,7*165,4) or settle.shape!=(3*360,4*W,4):
        raise ValueError("Invalid carriage or turn registration")
    # These 49 samples were posed on individual shoulder, elbow, wrist and
    # fingertip tracks, then composited over the matching armless costume.
    for n in range(49):
        row,col = divmod(n,7)
        frame = held.copy()
        frame[137:288,64:229] = premul(sheet[row*151:(row+1)*151,col*165:(col+1)*165])
        track[SAMPLES+n] = frame
    # Use the same hand, face and apron contours as the opening pivot.
    # The fixed stage gives both sequences one continuous three-quarter turn.
    frames=[]
    for n in range(12):
        row,col=divmod(n,4)
        canvas=np.zeros((H,W,4),np.uint8)
        canvas[:360]=settle[row*360:(row+1)*360,col*W:(col+1)*W]
        frames.append(upper(canvas))
    frames[0] = track[3*SAMPLES]
    frames[-1] = entry
    for n in range(1,SAMPLES+1):
        u=11*n/SAMPLES
        track[3*SAMPLES+n]=lerp(frames[int(u)],frames[min(11,int(u)+1)],u-int(u))


def sample_paint(track, time):
    u = np.clip(time*SAMPLES,0,len(track)-1)
    return lerp(track[int(u)],track[min(int(u)+1,len(track)-1)],u-int(u))


def upper_frame(track, pose, head_pose, heading, cycle, weight, bob, follow, gaze, pressure):
    # The head turns toward the destination before the shoulders follow.
    # Blend their timing across the collar, leaving the face as a single plane.
    painted = sample_paint(track,pose)
    if head_pose!=pose:
        head = sample_paint(track,head_pose)
        painted = lerp(painted,head,(1-smooth((Y[:384]-101)/25))[:,:,None])
    # Weight passes over each foot. A slight lateral shift in the pelvis is
    # balanced by the ribcage; the head stays level while the skirt trails.
    pelvis = np.exp(-((Y-220)/53)**2)
    chest = np.exp(-((Y-145)/45)**2)
    loose = smooth((heading*(151-X)-28)/90)*smooth((Y-75)/80)
    hem = smooth((Y-230)/100)*(.23+.77*smooth((abs(X-148)-13)/65))
    chest_plane = np.exp(-((Y-167)/72)**4)
    shoulder_tilt = heading*pressure*.034*chest_plane
    xshift = heading*pressure*(4.3*pelvis-1.6*chest) + follow*(loose+.72*hem)
    xshift += shoulder_tilt*(Y-211)
    xshift += .035*pressure*(X-150)*chest + .021*pressure*(X-147)*pelvis
    yshift = bob*(.48+.52*smooth((Y-73)/114)) + follow*.22*loose
    yshift += heading*pressure*np.clip((X-151)/43,-1,1)*(.85*chest-.65*pelvis)
    yshift -= shoulder_tilt*(X-150)
    # A short glance leads the first weight transfer. The displacement
    # decays inside each iris, keeping lids, lashes and nose in place.
    if gaze:
        for ex,ey in ((129,76),(152,71)) if heading<0 else ((132,80),(160,76)):
            xshift += heading*gaze*np.exp(-((X-ex)/4.8)**2-((Y-ey)/3.4)**2)
    if heading<0:
        # Treat the two overlapped hands and their cuffs as a single unit.
        # Their follow-through is smaller and slightly later than the chest.
        hands = np.exp(-((X-143)/42)**4-((Y-190)/22)**4)
        lag = weight*np.sin(np.pi*(cycle-.30))
        xshift -= hands*1.15*lag
        yshift += hands*.50*lag
    else:
        # The relaxed return has separate, modest sleeve swings. The shoulder
        # remains fixed, the forearm takes the most travel and the palm trails.
        sleeve = smooth((Y-149)/107)
        near = np.exp(-((X-np.interp(Y,[145,207,249,290],[141,121,109,102]))/15)**4)
        far = np.exp(-((X-np.interp(Y,[145,207,249,290],[190,207,221,233]))/13)**4)
        xshift += sleeve*weight*(near*5.4*np.cos(np.pi*(cycle-.13))
                                 - far*3.1*np.cos(np.pi*(cycle-.23)))
    result = cv.remap(painted,(X-xshift).astype(np.float32),(Y-yshift).astype(np.float32),cv.INTER_LINEAR)
    return result

def unit(v):
    return v/max(np.linalg.norm(v), 1e-6)


def normal(v):
    return np.float32([-v[1],v[0]])


def inverse_bone(origin, vector, src, src_vector):
    axis, ref = unit(vector), unit(src_vector)
    disp = LEG_GRID-origin
    along = (disp @ axis)[:, :, None] * (np.linalg.norm(src_vector)/max(1,np.linalg.norm(vector)))
    return src + along*ref + (disp @ normal(axis))[:, :, None]*normal(ref)


def warp_leg(image, src, dst):
    hip,knee,ankle,_,toe,heel = dst
    h,k,a,_,t,e = src
    thigh = inverse_bone(hip,knee-hip,h,k-h)
    calf = inverse_bone(ankle,knee-ankle,a,k-a)
    shoe = inverse_bone((toe+heel)/2,toe-heel,(t+e)/2,t-e)
    at_knee = smooth(((LEG_GRID-knee) @ unit(ankle-hip)+8)/16)[:, :, None]
    at_ankle = smooth(((LEG_GRID-ankle) @ unit(ankle-knee)+11)/22)[:, :, None]
    lookup = lerp(lerp(thigh,calf,at_knee),shoe,at_ankle).astype(np.float32)
    return cv.remap(image, lookup, None, cv.INTER_LINEAR)


def align_stockings(a, b, t):
    # Preserve a single opaque outline while the knees and shoe fronts turn in depth.
    bounds = []
    for drawing in (a,b):
        mask = drawing[:,:,3]>.49
        left = mask.argmax(1)
        right = np.where(mask.any(1),W-1-mask[:,::-1].argmax(1),-1)
        bounds.append((left,right))
    l,r = (lerp(bounds[0][i],bounds[1][i],t) for i in (0,1))
    shared = (bounds[0][1]>bounds[0][0]+2)&(bounds[1][1]>bounds[1][0]+2)
    aligned = []
    grid = GRID[:a.shape[0]]
    for img,(left,right) in zip((a,b),bounds):
        lut = grid.copy()
        lut[shared,:,0] = left[shared,None]+(lut[shared,:,0]-l[shared,None])*((right[shared]-left[shared])/(r[shared]-l[shared]))[:,None]
        aligned.append(cv.remap(img,lut,None,cv.INTER_LINEAR))
    result = lerp(*aligned,t)
    exterior = (grid[:,:,0] < l[:,None]-2) | (grid[:,:,0] > r[:,None]+2)
    result[shared[:,None] & exterior] = 0
    return result


def prepare_legs(poses):
    donors = {}
    # At rest the foremost leg hides a sliver of its old outline on the rear
    # stocking. Trace the revealed calf before placing the feet apart.
    calf = poses[7]["far"].copy()
    edge = np.interp(Y,[0,377,382,388,394,400,407,511],[0,158,160,162.7,165.3,167.4,169,0])
    mask = np.where((Y>=377)&(Y<=407),np.clip(X-edge+.6,0,1),1)
    calf *= mask[:,:,None]
    left = {"near":poses[7]["near"], "far":calf}
    for leg,opposite in (("near","far"),("far","near")):
        src = poses[7]["bones"][opposite].copy()
        src[:,0] = 302-src[:,0]
        mirror = cv.warpAffine(left[opposite],np.float32([[-1,0,302],[0,1,0]]),(W,H))
        donors[leg] = [(left[leg],poses[7]["bones"][leg]),
                       (poses[0][opposite],poses[0]["bones"][opposite]),(mirror,src)]
    return donors


def front_turn_donors(poses, donors):
    turn = cv.imread(str(ART / "center/turn.webp"), cv.IMREAD_UNCHANGED)[:H,:W]
    poses[0]["front_turn"] = turn
    front = {leg:options.copy() for leg,options in donors.items()}
    bones = {"near":[(134,320),(134,369),(139,446),(139,483),(138,482),(146,469)],
             "far":[(165,320),(165,369),(161,446),(163,482),(164,482),(171,469)]}
    for leg in LEGS:
        image = turn.copy()
        if leg == "near":
            image[:,151:] = 0
            image[:355,:122] = 0
        else:
            image[:,:151] = 0
            image[:355,179:] = 0
        # Continue the small visible strip of stocking behind the front lace.
        image[318:355] = image[355:356]
        image[:318] = 0
        front[leg][1] = (premul(image),np.float32(bones[leg]))
    return front


def leg_pose(src, foot, roll, bob, heading):
    # The upper end of the painted stocking is concealed by the skirt. Use
    # a hip inside the dress to solve the thigh and calf as two rigid links.
    # The small rear offset gives the resting knee its forward-facing bend.
    hip = src[1] + 1.18*(src[1]-src[2])
    hip[0] -= heading*15
    thigh = src[1]-hip
    calf = src[2]-src[1]
    upper_length, lower_length = np.linalg.norm(thigh), np.linalg.norm(calf)
    rotation = np.float32([[np.cos(roll),-np.sin(roll)],[np.sin(roll),np.cos(roll)]])
    dst = src.copy()
    dst[2:] = foot + (src[2:]-src[3]) @ rotation.T
    ankle = dst[2]
    hip[1] += bob
    # At heel strike an extended leg takes the weight. Let the concealed hip
    # lower just enough to reach the planted ankle without lengthening a bone.
    reach = upper_length + lower_length - .15
    span_x = ankle[0]-hip[0]
    hip[1] = max(hip[1], ankle[1]-np.sqrt(max(1.,reach**2-span_x**2)))
    axis = unit(ankle-hip)
    span = np.linalg.norm(ankle-hip)
    along = (upper_length**2 - lower_length**2 + span**2)/(2*span)
    bend = np.sqrt(max(0.,upper_length**2-along**2))
    dst[1] = hip + along*axis - heading*bend*normal(axis)
    # Carry the stocking top around the new knee as a single piece. Stretching
    # the short visible panel from the hem would pull the knee decoration apart.
    ref,aim = unit(thigh), unit(dst[1]-hip)
    offset = src[0]-src[1]
    dst[0] = dst[1] + (offset @ ref)*aim + (offset @ normal(ref))*normal(aim)
    return dst


def render_leg(donors, facing, foot, roll, dy, heading):
    p = np.clip(facing+1.,0.,2.)
    index = min(int(p),1)
    u = p-index
    (image_a,a),(image_b,b) = donors[index:index+2]
    def posed(image, src):
        return warp_leg(image,src,leg_pose(src,foot,roll,dy,heading))
    if u < .00001:
        return posed(image_a,a)
    if u > .99999:
        return posed(image_b,b)
    return align_stockings(posed(image_a,a),posed(image_b,b),u)


class Footsteps:
    """Foot plants are absolute points relative to the table, before root subtraction."""
    def __init__(self, feet):
        self.first = {name:np.float32(point) for name,point in zip(LEGS,feet)}
        self.events = []

    def land(self, name, begin, end, point, height):
        previous = next((e[4] for e in reversed(self.events) if e[0]==name),self.first[name])
        self.events.append((name,begin,end,previous,np.float32(point),height))

    def sample(self, index, heading):
        poses = {leg:(pt.copy(),0.,0.,True) for leg,pt in self.first.items()}
        for leg,start,end,a,b,height in self.events:
            if index >= end:
                poses[leg] = (b.copy(),0.,0.,True)
            elif index > start:
                u = (index-start)/(end-start)
                lift = height * np.sin(np.pi*u)**2
                position = lerp(a,b,smooth(u))
                position[1] -= lift
                roll = heading * np.deg2rad(14) * np.sin(2*np.pi*u)
                poses[leg] = (position,lift,roll,False)
        return poses


def score(phase):
    if phase == "out":
        feet = Footsteps(((141,483),(162,483)))
        frames = [16,50,86,118]
        steps = [(99,483,9),(NEARBY+167,476,11),(NEARBY+121,483,8)]
        # Shift pressure onto the table-side foot before stepping away. The
        # root then travels across each locked foot and brakes at the last plant.
        times = [0,10,18,37,59,80,100,118,126,155]
        offsets = [0,1.6,1.15,-8,-29,-51,-74,NEARBY,NEARBY,NEARBY]
        total = 156
    else:
        feet = Footsteps(((NEARBY+139,483),(NEARBY+163,482)))
        feet.land("far",2,18,(NEARBY+174,480),3.5)
        frames = [18,54,89,124]
        steps = [(97,477,9),(162,483,11),(141,483,7)]
        times = [0,9,19,39,61,81,102,124,135,165]
        offsets = [NEARBY,NEARBY-1.2,NEARBY-.8,-85,-65,-43,-19,0,0,0]
        total = 166
    for i,(x,y,height) in enumerate(steps):
        feet.land(LEGS[i%2],frames[i]+2,frames[i+1],(x,y),height)
    return feet,PchipInterpolator(times,offsets),frames,total


def performance_motion(phase, f, frames):
    cycle = np.interp(f,frames,np.arange(len(frames)))
    if phase == "out":
        # Keep the clasp through the last landing. Only once the feet settle
        # does she open her fingers, lower her hands and prepare to turn.
        turn = smooth((f-5)/30)
        release = smooth((f-118)/15) + smooth((f-130)/15) + smooth((f-144)/11)
        pose = turn + release
        head_pose = smooth((f-1)/24) + release
        facing = -.78*smooth((f-10)/30) - .22*smooth((f-112)/24)
    else:
        turn = smooth((f-5)/28)
        settle = smooth((f-117)/17) + smooth((f-132)/13) + smooth((f-143)/11) + smooth((f-153)/12)
        pose = 5 + turn + settle
        head_pose = 5 + smooth((f-1)/24) + settle
        facing = .78*smooth((f-6)/31)*(1-smooth((f-114)/25))
    weight = smooth((f-10)/20)*smooth((frames[-1]+4-f)/19)
    gaze = 1.05*smooth(f/7)*(1-smooth((f-18)/26))
    prep = 1.8*np.sin(np.pi*np.clip(f/23,0,1))**2
    load = weight*np.sin(np.pi*(cycle-.14))
    bob = prep + weight*(2.85*np.cos(2*np.pi*(cycle-.10))-.52)
    # A small settling breath finishes the hand gesture without freezing
    # mid-pose; its displacement reaches zero at the exact joining cel.
    end = 155 if phase=="out" else 165
    rest = np.clip((f-frames[-1])/(end-frames[-1]),0,1)
    bob += .55*np.sin(2*np.pi*rest)*np.sin(np.pi*rest)**2
    follow = weight*3.8*np.sin(np.pi*(cycle-.32)) + .8*np.sin(np.pi*rest)**2
    return pose,head_pose,facing,bob,follow,cycle,weight,gaze,load

def bake_phase(phase, output, track, poses, donors, turning_legs):
    feet,root,frames,total = score(phase)
    dest = output/phase
    dest.mkdir(parents=True,exist_ok=True)
    heading = -1 if phase=="out" else 1
    manifest = []
    for f in range(total):
        dx = float(root(f))
        pose,head_pose,facing,bob,follow,cycle,weight,gaze,pressure = performance_motion(phase,f,frames)

        targets = feet.sample(f,heading)
        markers = {leg:foot-np.float32([dx,0]) for leg,(foot,_,_,_) in targets.items()}
        if phase == "back" and f == 0:
            pixels = poses[0]["front_turn"]
        elif f in (0,total-1):
            endpoint = 7 if (phase == "out") == (f == total-1) else 0
            pixels = straight(poses[endpoint]["all"])
        else:
            layers = {}
            source = turning_legs if phase=="back" and f<36 else donors
            for leg,(_,_,roll,_) in targets.items():
                layers[leg] = render_leg(source[leg],facing,markers[leg],roll,bob,heading)
            # In the frontal drawing the character's anatomical left is foreground.
            foreground = "near" if facing<-.15 else "far"
            rear = "far" if foreground=="near" else "near"
            image = np.zeros((H,W,4),np.float32)
            image[280:] = over(layers[rear],layers[foreground])
            torso = upper_frame(track,pose,head_pose,heading,cycle,weight,bob,follow,gaze,pressure)
            image = over(image,torso)
            pixels = straight(image)
        cv.imwrite(str(dest/f"{f:04}.png"),pixels,[cv.IMWRITE_PNG_COMPRESSION,2])
        manifest.append(dict(frame=f,dx=round(dx,5),dy=0,
                             hands="held" if phase=="out" and f<=frames[-1] else "free",
                             feet={leg:np.round(marker.astype(float),4).tolist() for leg,marker in markers.items()},
                             planted=[leg for leg,data in targets.items() if data[3]]))
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path,default=PERFORMANCE/"gait")
    parser.add_argument("--rife",type=Path,default=RIFE/"rife-ncnn-vulkan.exe")
    parser.add_argument("--model",type=Path,default=RIFE/"rife-v4.6")
    args = parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    poses = read_art()
    donors = prepare_legs(poses)
    front = front_turn_donors(poses,donors)

    with TemporaryDirectory(prefix="whale-walk-") as scratch:
        track = paint_track(poses,args.rife,args.model,Path(scratch))
        phases = {phase:bake_phase(phase,args.output,track,poses,donors,front) for phase in ("out","back")}
    (args.output/"index.json").write_text(json.dumps(dict(fps=FPS,anchor=[151,483],scale=SCALE,phases=phases),indent=2),encoding="utf-8")


if __name__ == "__main__":
    main()
