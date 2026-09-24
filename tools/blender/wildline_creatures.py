"""WILDLINE creature pipeline. Runs INSIDE Blender (built on 5.2 LTS).

    ns = {}
    exec(open('<repo>/tools/blender/wildline_creatures.py').read(), ns)
    ns['build']('boar', '<repo>')        # model, rig, animate, bake, save

Writes:
    assets/src/<species>.blend       editable source: armature, skinned mesh, one Action per clip
    assets/vat/<species>.json|bin    the baked vertex-animation texture the game draws from

Every quadruped shares ONE parametric skeleton, derived from the same
dimensions the procedural builder in src/meshes.js uses (bodyL, bodyW, bodyH,
legH, headS, snout, tail). The wolf's hand-tuned landmarks ARE the template:
feed it wolf dimensions and it reproduces them exactly. Each species then adds
its own anatomy, palette, extras, gait and attack.

Bake format (positionFormat "rgba8-delta"): rest positions once as float32,
then every sampled frame as 8-bit OFFSETS from rest, scaled per axis by the
largest offset in the bake. Half the texel size of the old rgba16f absolute
format, and because most vertices barely move, far better compression.
"""
import bpy, bmesh, json, math, os
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

FPS = 24

def hexc(h):
    return ((h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255, 1.0)

# ============================================================================
#   SPECIES
#   dims:   mirror quadruped({...}) in src/meshes.js
#   attack: windup/recovery mirror ATTACK_MOTION in src/combat-motion.js, so the
#           baked strike lands on the frame the game deals damage
# ============================================================================
BASE_PAL = dict(eye=0x14100c, nose=0x141210)
SPECIES = {
  'wolf': dict(
    dims=dict(bodyL=2.5, bodyW=0.95, bodyH=0.9, legH=0.95, headS=0.72, snout=0.55, tail=1.1),
    pal=dict(fur=0x767d88, belly=0xa7aeb6, saddle=0x4e545e, saddle_edge=0x656c77, dark=0x3a3e45,
             throat=0xb4bac1, ear_in=0xb8a4a2, eye=0xe3a52e, tail_tip=0x3a3e45),
    ears='pointed', tail='bushy', gait='gallop', attack=('bite', 0.13, 0.25),
    walk=(1.00, 0.38), run=(0.52, 0.72), target_verts=1150),
  'alpha': dict(   # pack leader: silver, heavier ruff, darker saddle; game scales it 1.25x
    dims=dict(bodyL=2.5, bodyW=1.0, bodyH=0.95, legH=0.95, headS=0.76, snout=0.55, tail=1.15),
    pal=dict(fur=0xa3abb6, belly=0xd4d8dd, saddle=0x33383f, saddle_edge=0x5a616b, dark=0x2c3036,
             throat=0xdfe2e6, ear_in=0xc2aeac, eye=0xf0d27a, tail_tip=0x2c3036),
    ears='pointed', tail='bushy', ruff=1.42, extras=['mane'], gait='gallop', attack=('bite', 0.13, 0.25),
    walk=(1.00, 0.38), run=(0.52, 0.72), target_verts=1200),
  'boar': dict(
    dims=dict(bodyL=2.6, bodyW=1.35, bodyH=1.25, legH=0.75, headS=0.9, snout=0.6, tail=0.4),
    pal=dict(fur=0x4e3d2c, belly=0x6b563d, saddle=0x33271b, saddle_edge=0x40321f, dark=0x221a12,
             throat=0x5c4a35, ear_in=0x6b4a40, nose=0x5a3a33, tail_tip=0x221a12),
    ears='pointed_small', tail='stub', barrel=True, extras=['tusks', 'bristles'],
    gait='trot', attack=('gore', 0.22, 0.34), walk=(0.90, 0.34), run=(0.46, 0.55), target_verts=1150),
  'ironhide': dict(   # rifle-proof ram: the boar under riveted iron and rust
    dims=dict(bodyL=2.6, bodyW=1.4, bodyH=1.3, legH=0.75, headS=0.92, snout=0.6, tail=0.4),
    pal=dict(fur=0x4a3a2a, belly=0x5e4c38, saddle=0x30251a, saddle_edge=0x3d2f20, dark=0x1e1710,
             throat=0x55432f, ear_in=0x6b4a40, nose=0x5a3a33, tail_tip=0x1e1710),
    ears='pointed_small', tail='stub', barrel=True, extras=['tusks', 'plates'],
    gait='trot', attack=('gore', 0.22, 0.34), walk=(0.95, 0.32), run=(0.48, 0.50), target_verts=1300),
  'bear': dict(
    dims=dict(bodyL=3.5, bodyW=1.9, bodyH=1.8, legH=1.25, headS=1.15, snout=0.7, tail=0.35),
    pal=dict(fur=0x5e4128, belly=0x74522f, saddle=0x4a3220, saddle_edge=0x54391f, dark=0xd8d2c2,
             throat=0x7a5a38, ear_in=0x6e4c30, nose=0x1a120c, jaw=0x9a7a55, tail_tip=0x4a3220),
    ears='round', tail='stub', hump=True, paw=1.35, extras=[],
    gait='gallop', attack=('maul', 0.34, 0.48), walk=(1.25, 0.30), run=(0.62, 0.55), target_verts=1200),
  'capybara': dict(
    dims=dict(bodyL=2.45, bodyW=1.5, bodyH=1.2, legH=0.42, headS=0.82, snout=0.5, tail=0),
    pal=dict(fur=0x7a5433, belly=0x8d6a45, saddle=0x6b4829, saddle_edge=0x734e2e, dark=0x3a2a1c,
             throat=0x8a6743, ear_in=0x5a3d24, nose=0x2a1d13, jaw=0x3a2a1c, tail_tip=0x6b4829),
    ears='tiny', tail='none', barrel=True, blunt=True, extras=[],
    gait='trot', attack=('bite', 0.16, 0.28), walk=(0.85, 0.30), run=(0.38, 0.46), target_verts=1000),
  'porcupine': dict(
    dims=dict(bodyL=2.2, bodyW=1.25, bodyH=1.15, legH=0.62, headS=0.72, snout=0.5, tail=0.5),
    pal=dict(fur=0x4a3b2e, belly=0x6a5946, saddle=0x3a2e22, saddle_edge=0x42352a, dark=0x241c14,
             throat=0x5e4f3e, ear_in=0x5a4535, tail_tip=0x2b2118),
    ears='tiny', tail='stub', barrel=True, extras=['quills'],
    gait='waddle', attack=('slap', 0.22, 0.30), walk=(0.85, 0.30), run=(0.42, 0.42), target_verts=1100),
  'beaver': dict(
    dims=dict(bodyL=2.0, bodyW=1.1, bodyH=1.05, legH=0.5, headS=0.68, snout=0.42, tail=0.9),
    pal=dict(fur=0x533b28, belly=0x6d5137, saddle=0x46321f, saddle_edge=0x4c3622, dark=0x2e2116,
             throat=0x5e4430, ear_in=0x3e2b1c, nose=0x1a120c, tail_tip=0x2e2116),
    ears='tiny', tail='paddle', barrel=True, extras=['incisors'],
    gait='waddle', attack=('bite', 0.16, 0.24), walk=(0.80, 0.30), run=(0.40, 0.44), target_verts=1000),
}

# ============================================================================
#   SKELETON: the wolf's landmarks, generalised
# ============================================================================
def landmarks(sp):
    d = sp['dims']
    L, legH, bodyH, headS, snout = d['bodyL'], d['legH'], d['bodyH'], d['headS'], d['snout']
    fh, hs = bodyH / 0.9, headS / 0.72
    kl = legH / 0.95
    cz = legH + bodyH * 0.5
    W = d['bodyW'] * 0.33
    J = {}
    J['mid']   = (0,  0.048 * L, cz + 0.02)
    J['root']  = (0,  J['mid'][1], 0.30 * kl)
    J['hip']   = (0,  0.38 * L,  cz + 0.07 * fh)
    J['chest'] = (0, -0.256 * L, cz - 0.10 * fh)
    J['neckb'] = (0, -0.40 * L,  cz + 0.22 * fh)
    J['head']  = (0, -0.52 * L,  cz + 0.44 * fh)
    hy, hz = J['head'][1], J['head'][2]
    J['snout'] = (0, hy - (headS * 0.45 + snout * 0.55), hz - 0.18 * hs)
    if sp.get('tail', 'bushy') != 'none' and d['tail'] > 0:
        k = d['tail'] / 1.1
        t0 = Vector((0, 0.48 * L, cz + 0.20 * fh))
        J['tail0'] = tuple(t0)
        style = sp.get('tail')
        if style == 'stub':
            J['tail1'] = tuple(t0 + Vector((0, 0.30, -0.22)) * max(k, 0.3) * 1.4)
        elif style == 'paddle':      # beaver: flat, trailing low and nearly level
            J['tail1'] = tuple(t0 + Vector((0, 0.45, -0.45)) * k)
            J['tail2'] = tuple(Vector(J['tail1']) + Vector((0, 0.55, -0.12)) * k)
        else:
            t1 = t0 + Vector((0, 0.35, -0.20)) * k
            t2 = t1 + Vector((0, 0.25, -0.38)) * k
            J['tail1'], J['tail2'] = tuple(t1), tuple(t2)
            J['tail3'] = tuple(t2 + Vector((0, 0.12, -0.36)) * k)
    for s, sx in (('L', 1), ('R', -1)):
        x = sx * W
        sh = (x, J['chest'][1] - 0.02, legH + bodyH * 0.30)
        J['shoulder.' + s] = sh
        J['elbow.' + s]    = (x * 1.06, sh[1] + 0.06 * kl, 0.78 * legH)
        J['wrist.' + s]    = (x * 1.05, sh[1] - 0.08 * kl, 0.27 * legH)
        J['fpaw.' + s]     = (x * 1.05, sh[1] - 0.26 * kl, 0.05)
        hp = (x, 0.344 * L, legH + bodyH * 0.39)
        J['hipj.' + s]     = hp
        J['stifle.' + s]   = (x * 1.05, hp[1] - 0.26 * kl, 0.84 * legH)
        J['hock.' + s]     = (x * 1.03, hp[1] + 0.10 * kl, 0.40 * legH)
        J['hpaw.' + s]     = (x * 1.03, hp[1] - 0.02 * kl, 0.05)
        ex = sx * headS * 0.267
        ear = sp.get('ears', 'pointed')
        elen = {'pointed': 0.56, 'pointed_small': 0.30, 'round': 0.30, 'tiny': 0.22}[ear]
        J['earb.' + s] = (ex, hy + 0.12 * hs, hz + 0.20 * hs)
        J['eart.' + s] = (ex * 1.22, hy + 0.18 * hs, hz + (0.20 + elen) * hs)
    return J, cz

def skin_nodes(sp, J, cz):
    d = sp['dims']
    L, fh, hs = d['bodyL'], d['bodyH'] / 0.9, d['headS'] / 0.72
    fw = d['bodyW'] / 0.95
    ft = math.sqrt(fw * fh)
    S = {k: v for k, v in J.items() if k != 'root'}
    S['loin'] = (0, 0.224 * L, cz + 0.14 * fh)
    S['ribs'] = (0, -0.12 * L, cz - 0.12 * fh)
    hy, hz, sy = J['head'][1], J['head'][2], J['snout'][1]
    S['muzz'] = (0, hy + (sy - hy) * 0.55, hz - 0.12 * hs)
    ruff = sp.get('ruff', 1.0)
    tuck = 1.0 if sp.get('barrel') else 0.73          # a barrel-bodied animal has no waist
    R = {'ribs': (0.47 * fw, 0.74 * fh), 'chest': (0.46 * fw, 0.66 * fh), 'mid': (0.41 * fw, 0.52 * fh),
         'loin': (0.41 * fw * tuck, 0.40 * fh * tuck), 'hip': (0.38 * fw, 0.39 * fh),
         'neckb': (0.40 * fw * ruff, 0.47 * fh * ruff),
         'head': (0.37 * hs, 0.31 * hs), 'muzz': (0.20 * hs, 0.17 * hs), 'snout': (0.10 * hs, 0.09 * hs)}
    if sp.get('barrel'):
        R['hip'] = (0.44 * fw, 0.46 * fh)
    if sp.get('blunt'):                              # capybara: a square block of a face
        R['muzz'] = (0.30 * hs, 0.27 * hs); R['snout'] = (0.24 * hs, 0.21 * hs)
    paw = sp.get('paw', 1.0)
    for s in 'LR':
        R.update({'shoulder.' + s: (0.25 * ft,) * 2, 'elbow.' + s: (0.13 * ft,) * 2,
                  'wrist.' + s: (0.085 * ft,) * 2, 'fpaw.' + s: (0.11 * ft * paw,) * 2,
                  'hipj.' + s: (0.28 * ft,) * 2, 'stifle.' + s: (0.17 * ft,) * 2,
                  'hock.' + s: (0.085 * ft,) * 2, 'hpaw.' + s: (0.11 * ft * paw,) * 2})
        ear = sp.get('ears', 'pointed')
        eb = {'pointed': 0.13, 'pointed_small': 0.11, 'round': 0.15, 'tiny': 0.10}[ear]
        et = {'pointed': 0.02, 'pointed_small': 0.02, 'round': 0.09, 'tiny': 0.06}[ear]
        R['earb.' + s] = (eb * hs,) * 2; R['eart.' + s] = (et * hs,) * 2
    style = sp.get('tail', 'bushy')
    if 'tail0' in S:
        if style == 'bushy':
            R.update({'tail0': (0.13,) * 2, 'tail1': (0.21,) * 2, 'tail2': (0.19,) * 2, 'tail3': (0.06,) * 2})
        elif style == 'stub':
            R.update({'tail0': (0.10 * fw,) * 2, 'tail1': (0.05 * fw,) * 2})
        elif style == 'paddle':                       # wide and flat: the skin radius is (width, height)
            R.update({'tail0': (0.12, 0.10), 'tail1': (0.34, 0.06), 'tail2': (0.30, 0.05)})
    E = [('hip', 'loin'), ('loin', 'mid'), ('mid', 'ribs'), ('ribs', 'chest'), ('chest', 'neckb'),
         ('neckb', 'head'), ('head', 'muzz'), ('muzz', 'snout')]
    tails = [k for k in ('tail0', 'tail1', 'tail2', 'tail3') if k in S]
    if tails:
        E.append(('hip', tails[0])); E += list(zip(tails, tails[1:]))
    if sp.get('hump'):                                 # bear: the shoulder hump
        S['hump'] = (0, J['chest'][1] + 0.10, cz + 0.62 * fh); R['hump'] = (0.40 * fw, 0.32 * fh)
        E.append(('chest', 'hump'))
    for s in 'LR':
        E += [('chest', 'shoulder.' + s), ('shoulder.' + s, 'elbow.' + s), ('elbow.' + s, 'wrist.' + s),
              ('wrist.' + s, 'fpaw.' + s), ('hip', 'hipj.' + s), ('hipj.' + s, 'stifle.' + s),
              ('stifle.' + s, 'hock.' + s), ('hock.' + s, 'hpaw.' + s),
              ('head', 'earb.' + s), ('earb.' + s, 'eart.' + s)]
    return S, R, E

# ============================================================================
#   BUILD: armature, skin sculpt, rounding, extras, eyes, weights, colour
# ============================================================================
def _clear():
    for o in list(bpy.data.objects):
        if o.name != 'PreviewCam': bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions):
        for x in list(coll):
            if x.users == 0 or coll is bpy.data.actions: coll.remove(x)

def _bake_mods(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    nm = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    old = obj.data; obj.modifiers.clear(); obj.data = nm; bpy.data.meshes.remove(old)

def _armature(name, J):
    arm = bpy.data.objects.new(name + 'Rig', bpy.data.armatures.new(name + 'Rig'))
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    def bone(n, a, b, parent=None, connect=False, deform=True):
        if a not in J or b not in J: return
        bb = eb.new(n); bb.head = Vector(J[a]); bb.tail = Vector(J[b])
        dvec = (bb.tail - bb.head).normalized()
        z = Vector((1, 0, 0)).cross(dvec)
        if z.length < 1e-4: z = Vector((0, 0, 1))
        bb.align_roll(z)             # local X == the body's side axis on every bone
        if parent and parent in eb: bb.parent = eb[parent]; bb.use_connect = connect
        bb.use_deform = deform
    bone('root', 'root', 'mid', deform=False)
    bone('hips', 'mid', 'hip', 'root'); bone('spine', 'mid', 'chest', 'root')
    bone('chest', 'chest', 'neckb', 'spine', True); bone('neck', 'neckb', 'head', 'chest', True)
    bone('head', 'head', 'snout', 'neck', True)
    bone('tail1', 'tail0', 'tail1', 'hips'); bone('tail2', 'tail1', 'tail2', 'tail1', True)
    bone('tail3', 'tail2', 'tail3', 'tail2', True)
    for s in 'LR':
        bone('ear.' + s, 'earb.' + s, 'eart.' + s, 'head')
        bone('upperarm.' + s, 'shoulder.' + s, 'elbow.' + s, 'chest')
        bone('forearm.' + s, 'elbow.' + s, 'wrist.' + s, 'upperarm.' + s, True)
        bone('hand.' + s, 'wrist.' + s, 'fpaw.' + s, 'forearm.' + s, True)
        bone('thigh.' + s, 'hipj.' + s, 'stifle.' + s, 'hips')
        bone('shin.' + s, 'stifle.' + s, 'hock.' + s, 'thigh.' + s, True)
        bone('foot.' + s, 'hock.' + s, 'hpaw.' + s, 'shin.' + s, True)
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.hide_render = True; arm.data.display_type = 'STICK'; arm.show_in_front = True
    return arm

def _round_torso(me, sp, J, extras_from):
    """The skin modifier's cross-sections are four-sided, so the barrel reads as a
    box. Average-smooth the torso, re-inflate each slice to its original mean
    radius (corners in, flats out), and fade the whole correction out at the
    shoulders, hips and leg tops so nothing pinches where it stops."""
    d = sp['dims']; legH = d['legH']
    N = extras_from
    orig = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', orig)
    orig = orig.reshape(-1, 3)
    y0, y1 = J['neckb'][1] - 0.02, J['chest'][1] + 0.02
    y2, y3 = J['hip'][1] - 0.23, J['hip'][1] + 0.23
    z0, z1 = legH - 0.03, legH + 0.17
    xl = d['bodyW'] * 0.65
    idx = np.array([i for i in range(N) if y0 < orig[i, 1] < y3 and orig[i, 2] > z0 and abs(orig[i, 0]) < xl])
    if len(idx) < 20: return
    bins = np.round(orig[idx, 1] / 0.08).astype(int)
    cen = {b: (orig[idx[bins == b], 0].mean(), orig[idx[bins == b], 2].mean()) for b in np.unique(bins)}
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    sel = [bm.verts[int(i)] for i in idx]
    for _ in range(5):
        bmesh.ops.smooth_vert(bm, verts=sel, factor=0.55, use_axis_x=True, use_axis_y=False, use_axis_z=True)
    new = np.array([bm.verts[int(i)].co[:] for i in idx])
    out = new.copy()
    for b in np.unique(bins):
        m = bins == b; cx, cz = cen[b]
        r0 = np.hypot(orig[idx[m], 0] - cx, orig[idx[m], 2] - cz).mean()
        r1 = np.hypot(new[m, 0] - cx, new[m, 2] - cz).mean()
        k = r0 / max(r1, 1e-6)
        out[m, 0] = cx + (new[m, 0] - cx) * k; out[m, 2] = cz + (new[m, 2] - cz) * k
    def ss(e0, e1, x):
        t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)
    y, z = orig[idx, 1], orig[idx, 2]
    w = ss(y0, y1, y) * (1 - ss(y2, y3, y)) * ss(z0, z1, z)
    fin = orig[idx] + (out - orig[idx]) * w[:, None]
    for j, i in enumerate(idx): bm.verts[int(i)].co = fin[j]
    bm.to_mesh(me); bm.free(); me.update()

def _ellipse_torso(me, sp, J, S, R, extras_from):
    """Heavy bodies (boar, bear, capybara...): with big radii on closely spaced
    nodes the skin hull folds over itself into a slab with a hard front edge, and
    no amount of smoothing recovers a body from that. So throw the hull's shape
    away along the trunk: push every trunk vertex radially onto the analytic
    ellipse the design asked for (the skin radii, interpolated along the spine),
    full strength over the back and flanks, fading out toward the belly where the
    legs join and toward the neck and rump."""
    N = extras_from
    co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    keys = sorted((k for k in ('neckb', 'chest', 'ribs', 'mid', 'loin', 'hip') if k in S), key=lambda k: S[k][1])
    ky = np.array([S[k][1] for k in keys]); kz = np.array([S[k][2] for k in keys])
    krx = np.array([R[k][0] for k in keys]); krz = np.array([R[k][1] for k in keys])
    y0, y1 = S['neckb'][1], S['chest'][1] + 0.05
    y2, y3 = S['hip'][1] - 0.10, S['hip'][1] + 0.30
    idx = np.arange(N)
    P = co[idx]
    m = (P[:, 1] > y0) & (P[:, 1] < y3)
    idx, P = idx[m], P[m]
    zc = np.interp(P[:, 1], ky, kz); rx = np.interp(P[:, 1], ky, krx); rz = np.interp(P[:, 1], ky, krz)
    ex, ez = P[:, 0] / rx, (P[:, 2] - zc) / rz
    r = np.hypot(ex, ez)
    keep = r > 0.45                                  # trunk surface, not a leg buried inside it
    idx, P, zc, rx, rz, ex, ez, r = idx[keep], P[keep], zc[keep], rx[keep], rz[keep], ex[keep], ez[keep], r[keep]
    tgt = P.copy()
    tgt[:, 0] = ex / r * rx; tgt[:, 2] = zc + ez / r * rz
    def ss(e0, e1, x):
        t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)
    w = ss(y0, y1, P[:, 1]) * (1 - ss(y2, y3, P[:, 1])) * ss(-0.92, -0.45, ez / r)
    co[idx] = P + (tgt - P) * w[:, None]
    me.vertices.foreach_set('co', co.ravel()); me.update()
    # the hull's old folds now lie on the ellipse but still crease it: relax them
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    sel = [bm.verts[int(i)] for i, wi in zip(idx, w) if wi > 0.2]
    for _ in range(3):
        bmesh.ops.smooth_vert(bm, verts=sel, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(me); bm.free(); me.update()

def _extras(sp, J, cz, bvh):
    """Rigid add-on geometry: (bmesh-built verts, bone to ride, colour hex) per
    part. Joined into the body after skinning so heat weighting never sees them.
    Anything that sits on the hide is placed by raycasting the finished sculpt,
    so plates, bristles and quills root on the real surface instead of floating."""
    d = sp['dims']; hs = d['headS'] / 0.72; fw = d['bodyW'] / 0.95; fh = d['bodyH'] / 0.9
    parts = []
    def surf(axis_pt, dirv):
        """Where a ray from far out along dirv, aimed back at axis_pt, meets the hide."""
        dirv = Vector(dirv).normalized(); a = Vector(axis_pt)
        hit, nrm, _, _ = bvh.ray_cast(a + dirv * 6.0, -dirv)
        return (hit, nrm) if hit is not None else (a + dirv * 0.4, dirv)
    def bone_at(y):
        return 'chest' if y < J['chest'][1] * 0.5 else ('spine' if y < J['hip'][1] * 0.6 else 'hips')
    def cone(base, tip, r0, r1, seg=6):
        bm = bmesh.new()
        base, tip = Vector(base), Vector(tip)
        ax = (tip - base); h = ax.length
        ret = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                                    radius1=r0, radius2=r1, depth=h)
        q = Vector((0, 0, 1)).rotation_difference(ax.normalized())
        for v in bm.verts: v.co = q @ v.co + (base + tip) / 2
        return bm
    def box(center, size, rot=None):
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
            if rot is not None: v.co = rot @ v.co
            v.co += Vector(center)
        return bm
    hy, hz = J['head'][1], J['head'][2]; sy, sz = J['snout'][1], J['snout'][2]
    ex = sp.get('extras', [])
    if 'tusks' in ex:
        for sx in (-1, 1):
            b = (sx * 0.17 * hs, sy + 0.20 * hs, sz - 0.08 * hs)
            t = (sx * 0.24 * hs, sy + 0.02 * hs, sz + 0.22 * hs)
            parts.append((cone(b, t, 0.055 * hs, 0.008), 'head', 0xe8e2cf))
    if 'bristles' in ex:
        for i in range(9):
            u = i / 8.0
            y = J['neckb'][1] + (J['hip'][1] - J['neckb'][1]) * u
            p, n = surf((0, y, cz), (0, 0.15, 1))
            base = p - n * 0.04
            parts.append((cone(base, base + (n * 0.9 + Vector((0, 0.5, 0))).normalized() * (0.30 - 0.1 * u), 0.07, 0.01, 4),
                          bone_at(y), 0x2a2016))
    if 'quills' in ex:
        import random
        rnd = random.Random(7)                        # fixed: the same porcupine every bake
        for i in range(70):
            u = rnd.random()
            y = J['chest'][1] + (J['hip'][1] + 0.35 - J['chest'][1]) * (0.15 + 0.85 * u)
            a = rnd.uniform(-1.15, 1.15)                # across the back, never the belly
            p, n = surf((0, y, cz), (math.sin(a), 0, math.cos(a)))
            base = p - n * 0.03
            dirv = (n * 0.55 + Vector((0, 0.85, 0.1))).normalized()
            L = 0.55 + 0.35 * u + rnd.uniform(-0.08, 0.08)
            col = 0xe8dfc8 if i % 3 else 0x2b2118
            parts.append((cone(base, base + dirv * L, 0.035, 0.004, 4),
                          'spine' if u < 0.4 else 'hips', col))
    if 'mane' in ex:                                  # alpha: a dark shag down the nape and over the shoulders
        for i in range(8):
            u = i / 7.0
            y = J['head'][1] + 0.18 + (J['chest'][1] + 0.35 - J['head'][1] - 0.18) * u
            zc = J['head'][2] + (cz - J['head'][2]) * u
            for a in ((0.0,) if i % 2 else (-0.55, 0.55)):
                p, n = surf((0, y, zc), (math.sin(a), 0.1, math.cos(a)))
                base = p - n * 0.05
                tip = base + (n * 0.6 + Vector((0, 0.8, 0.1))).normalized() * (0.34 - 0.12 * u) * hs
                parts.append((cone(base, tip, 0.11 * hs, 0.012, 5), 'neck' if u < 0.55 else 'chest',
                              sp['pal']['saddle']))
    if 'incisors' in ex:
        for sx in (-1, 1):
            parts.append((box((sx * 0.045 * hs, sy + 0.02, sz - 0.10 * hs), (0.07 * hs, 0.05 * hs, 0.14 * hs)),
                          'head', 0xd4892e))
    if 'plates' in ex:
        from mathutils import Matrix
        def slab(p, n, size, bone, col, rivets=True):
            """A plate lying on the hide at p, its thin axis along the surface normal."""
            zx = n.normalized(); fwd = Vector((0, 1, 0))
            yx = (fwd - zx * fwd.dot(zx)).normalized(); xx = yx.cross(zx)
            M = Matrix((xx, yx, zx)).transposed()        # columns: across, along, out
            c = p + zx * (size[2] * 0.5 - 0.02)
            parts.append((box(c, size, M), bone, col))
            if rivets:
                for ry in (-0.36, 0.36):
                    for rx in (-0.36, 0.36):
                        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.04)
                        q = c + M @ Vector((rx * size[0], ry * size[1], size[2] * 0.5))
                        for v in bm.verts: v.co += q
                        parts.append((bm, bone, 0x9a9ea3))
        # riveted iron over the shoulders, the flanks and the haunches, then a rusted saddle
        ys = (J['chest'][1] + 0.08, 0.05 * d['bodyL'], J['hip'][1] - 0.12)
        for sx in (-1, 1):
            for y, ln in zip(ys, (0.66, 0.72, 0.60)):
                # the ray finds WHERE; the plate's lie comes from the ray itself, because a
                # single decimated facet's normal can tip a flat plate up like a fin
                d_side = Vector((sx, 0, 0.25)).normalized()
                p, _ = surf((0, y, cz + 0.05), d_side)
                slab(p, d_side, (0.62 * fh, ln, 0.08), bone_at(y), 0x474b50)
        for y in ys:
            p, _ = surf((0, y, cz), (0, 0, 1))
            slab(p, Vector((0, 0, 1)), (0.70 * fw, 0.56, 0.08), bone_at(y), 0x8a4f2e, rivets=False)
    return parts

def build(species, repo, render_preview=True):
    sp = dict(SPECIES[species]); sp['_name'] = species
    _clear()
    J, cz = landmarks(sp)
    S, R, E = skin_nodes(sp, J, cz)
    arm = _armature(species.capitalize(), J)

    keys = list(S); idx = {k: i for i, k in enumerate(keys)}
    me = bpy.data.meshes.new(species + '_skel')
    me.from_pydata([S[k] for k in keys], [(idx[a], idx[b]) for a, b in E], [])
    body = bpy.data.objects.new(species.capitalize(), me)
    bpy.context.scene.collection.objects.link(body)
    sk = body.modifiers.new('Skin', 'SKIN'); sk.branch_smoothing = 0.7; sk.use_smooth_shade = False
    sv = me.skin_vertices[0].data
    for k, i in idx.items(): sv[i].radius = R[k]
    sv[idx['mid']].use_root = True
    _bake_mods(body)
    for _ in range(2):
        m = body.modifiers.new('Sub', 'SUBSURF'); m.levels = 1; _bake_mods(body)
    ratio = min(1.0, sp.get('target_verts', 1100) / max(1, len(body.data.vertices)))
    m = body.modifiers.new('Dec', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = ratio; _bake_mods(body)
    base_n = len(body.data.vertices)
    if sp.get('barrel') or sp.get('hump'): _ellipse_torso(body.data, sp, J, S, R, base_n)
    else: _round_torso(body.data, sp, J, base_n)

    # skin FIRST, on the clean sculpt only
    for o in bpy.data.objects:
        try: o.select_set(False)
        except Exception: pass
    body.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')

    # extras + eyes: appended, then rigidly bound
    sv0 = [v.co.copy() for v in body.data.vertices]
    parts = _extras(sp, J, cz, BVHTree.FromPolygons(sv0, [tuple(p.vertices) for p in body.data.polygons]))
    bm = bmesh.new(); bm.from_mesh(body.data)
    face_cols = {}                       # face index -> hex, for the rigid parts
    rigid = []                           # (vertex range, bone)
    for pbm, bone, col in parts:
        tmp = bpy.data.meshes.new('tmp'); pbm.to_mesh(tmp); pbm.free()
        v0, f0 = len(bm.verts), len(bm.faces)
        bm.from_mesh(tmp); bpy.data.meshes.remove(tmp)
        bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
        for fi in range(f0, len(bm.faces)): face_cols[fi] = col
        rigid.append((range(v0, len(bm.verts)), bone))
    bm.to_mesh(body.data); bm.free()

    # eyes: raycast onto the real skull surface rather than guessing where it is
    mev = body.data
    verts = [v.co.copy() for v in mev.vertices]
    polys = [tuple(p.vertices) for p in mev.polygons if all(vi < base_n for vi in p.vertices)]
    bvh = BVHTree.FromPolygons(verts, polys)
    hs = sp['dims']['headS'] / 0.72
    head_c = Vector((0, J['head'][1] + 0.02, J['head'][2] + 0.02))
    eye_parts = []
    for side in (-1, 1):
        dvec = Vector((side * sp.get('eye_side', 0.62), -0.72, 0.30)).normalized()
        hit, nrm, _, _ = bvh.ray_cast(head_c + dvec * 3.0, -dvec)
        if hit is None: continue
        c = hit - nrm * 0.022 * hs
        eb = bmesh.new(); bmesh.ops.create_icosphere(eb, subdivisions=1, radius=0.058 * hs)
        for v in eb.verts: v.co += c
        eye_parts.append(eb)
    bm = bmesh.new(); bm.from_mesh(body.data)
    for eb in eye_parts:
        tmp = bpy.data.meshes.new('tmp'); eb.to_mesh(tmp); eb.free()
        v0, f0 = len(bm.verts), len(bm.faces)
        bm.from_mesh(tmp); bpy.data.meshes.remove(tmp)
        bm.faces.ensure_lookup_table()
        for fi in range(f0, len(bm.faces)): face_cols[fi] = sp['pal'].get('eye', BASE_PAL['eye'])
        rigid.append((range(v0, len(bm.verts)), 'head'))
    bm.to_mesh(body.data); bm.free()

    for vr, bone in rigid:
        ids = list(vr)
        for g in body.vertex_groups: g.remove(ids)
        vg = body.vertex_groups.get(bone) or body.vertex_groups.new(name=bone)
        vg.add(ids, 1.0, 'REPLACE')

    deform = {b.name for b in arm.data.bones if b.use_deform}
    unweighted = sum(1 for v in body.data.vertices
                     if sum(g.weight for g in v.groups if body.vertex_groups[g.group].name in deform) < 1e-4)

    _paint(body, sp, J, cz, base_n, face_cols)
    body.data.update()

    clips = _author_clips(arm, sp, J)
    out = _bake(species, sp, body, arm, clips, repo)

    arm.animation_data.action = None
    for pb in arm.pose.bones: pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
    os.makedirs(os.path.join(repo, 'assets', 'src'), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(repo, 'assets', 'src', species + '.blend'), compress=True)
    out.update(unweighted=unweighted, bones=len(arm.data.bones), blender_verts=base_n)
    return out

def _paint(body, sp, J, cz, base_n, face_cols):
    me = body.data
    if 'Col' in me.color_attributes: me.color_attributes.remove(me.color_attributes['Col'])
    ca = me.color_attributes.new(name='Col', type='BYTE_COLOR', domain='CORNER')
    me.color_attributes.active_color = ca
    P = dict(BASE_PAL); P.update(sp['pal'])
    d = sp['dims']; legH = d['legH']
    hy, sy = J['head'][1], J['snout'][1]
    for p in me.polygons:
        c, n = p.center, p.normal
        if p.index in face_cols: col = face_cols[p.index]
        elif c.y < sy + 0.08:                                    col = P['nose']
        elif 'earb.L' in J and c.z > J['earb.L'][2] - 0.02 and c.y > hy - 0.1 and n.y < -0.25: col = P['ear_in']
        elif c.z < 0.17 * legH / 0.95:                           col = P['dark']
        elif 'tail2' in J and c.y > J['tail2'][1] - 0.02 and c.z < J['tail2'][2] - 0.10: col = P['tail_tip']
        elif J['neckb'][1] - 0.25 < c.y < J['chest'][1] + 0.09 and c.z < cz + 0.15 and n.y < -0.35: col = P['throat']
        elif c.y < hy + 0.15 and n.z < -0.15:                    col = P.get('jaw', P['throat'])
        elif J['chest'][1] - 0.26 < c.y < J['hip'][1] + 0.10 and n.z < -0.30 and c.z < cz - 0.05: col = P['belly']
        elif J['chest'][1] - 0.31 < c.y < J['hip'][1] + 0.30 and c.z > cz + 0.10 and n.z > 0.78: col = P['saddle']
        elif J['chest'][1] - 0.31 < c.y < J['hip'][1] + 0.30 and c.z > cz + 0.10 and n.z > 0.42: col = P['saddle_edge']
        else:                                                    col = P['fur']
        rgba = hexc(col)
        for li in p.loop_indices: ca.data[li].color_srgb = rgba

# ============================================================================
#   ANIMATION: one parametric set of clips, species-tuned
# ============================================================================
def _ss(x): x = max(0.0, min(1.0, x)); return x * x * (3 - 2 * x)
def _lerp(a, b, t): return a + (b - a) * t

def _leg_cycle(u, A, stance=0.6):
    u %= 1.0
    if u < stance: return _lerp(-A, A, u / stance), 0.0
    k = (u - stance) / (1 - stance); return _lerp(A, -A, _ss(k)), math.sin(math.pi * k)

def _pose_legs(P, u_of, A, lf=1.0, lh=1.0, stance=0.6):
    for s in 'LR':
        sw, lift = _leg_cycle(u_of['F' + s], A, stance)
        P['upperarm.' + s] = (sw * 0.95, 0); P['forearm.' + s] = (lift * lf * 0.95, 0)
        P['hand.' + s] = (-sw * 0.55 + lift * lf * 1.15, 0)
        sw, lift = _leg_cycle(u_of['H' + s], A * 0.9, stance)
        P['thigh.' + s] = (sw * 0.9 - lift * lh * 0.25, 0); P['shin.' + s] = (lift * lh * 0.85, 0)
        P['foot.' + s] = (-sw * 0.45 - lift * lh * 0.95, 0)

def _clips(sp):
    walk_s, walk_A = sp['walk']; run_s, run_A = sp['run']
    style = sp.get('gait', 'gallop')
    atk, windup, recovery = sp['attack']
    HIT = windup / (windup + recovery)

    def idle(t):
        P, X = {}, {}; w = 2 * math.pi * t
        P['spine'] = (0.015 * math.sin(w), 0)
        P['neck'] = (0.05 * math.sin(w + 0.6), 0.10 * math.sin(w * 0.5))
        P['head'] = (0.04 * math.sin(w + 1.1), 0.06 * math.sin(w * 0.5 + 0.8))
        for i, b in enumerate(('tail1', 'tail2', 'tail3')):
            P[b] = (0.05 * math.sin(w + 0.5 * i), 0.11 * math.sin(w + 0.6 * i))
        tw = max(0.0, math.sin(w * 2 + 0.3)) ** 8
        P['ear.L'] = (-0.35 * tw, 0); P['ear.R'] = (-0.2 * max(0.0, math.sin(w * 2 + 2.1)) ** 8, 0)
        X['breath'] = 1.0 + 0.035 * math.sin(w); X['bob'] = 0.01 * math.sin(w)
        return P, X

    def walk(t):
        P, X = {}, {}; w = 2 * math.pi * t
        _pose_legs(P, {'HL': t, 'FL': t + 0.25, 'HR': t + 0.5, 'FR': t + 0.75}, walk_A, 0.75, 0.8, 0.62)
        X['bob'] = 0.035 * math.cos(2 * w)
        P['spine'] = (0.03 * math.sin(2 * w), 0.04 * math.sin(w)); P['hips'] = (0.03 * math.sin(2 * w + 1.0), -0.05 * math.sin(w))
        P['neck'] = (-0.05 * math.sin(2 * w) + 0.04, 0.04 * math.sin(w)); P['head'] = (0.05 * math.sin(2 * w + 0.4), 0)
        for i, b in enumerate(('tail1', 'tail2', 'tail3')):
            P[b] = (0.06, 0.15 * math.sin(w + 0.6 * i))
        if style == 'waddle': X['roll'] = 0.07 * math.sin(w)
        X['breath'] = 1.0
        return P, X

    def run(t):
        P, X = {}, {}; w = 2 * math.pi * t
        if style == 'gallop':                  # rotary gallop: hinds together, fronts half a stride on
            u = {'HL': t, 'HR': t + 0.08, 'FL': t + 0.50, 'FR': t + 0.58}; stance = 0.42; flex = 0.09
        elif style == 'trot':                  # diagonal pairs, a flat back
            u = {'FL': t, 'HR': t, 'FR': t + 0.5, 'HL': t + 0.5}; stance = 0.48; flex = 0.03
        else:                                  # waddle: short, rolling, busy
            u = {'FL': t, 'HR': t + 0.05, 'FR': t + 0.5, 'HL': t + 0.55}; stance = 0.5; flex = 0.02
        _pose_legs(P, u, run_A, 1.0, 1.0, stance)
        f = math.sin(w + 0.4)
        P['spine'] = (flex * f, 0); P['hips'] = (-flex * 0.8 * f, 0); P['chest'] = (flex * 0.45 * f, 0)
        P['neck'] = (0.22 - 0.10 * f, 0); P['head'] = (0.10 + 0.08 * f, 0)
        P['tail1'] = (0.55 + 0.10 * f, 0); P['tail2'] = (0.30 + 0.12 * f, 0); P['tail3'] = (0.20 + 0.10 * f, 0)
        P['ear.L'] = (-0.55, 0); P['ear.R'] = (-0.55, 0)
        X['bob'] = (0.14 if style == 'gallop' else 0.06) * max(0.0, math.sin(w + 1.2)) - 0.03
        if style == 'waddle': X['roll'] = 0.10 * math.sin(w)
        X['breath'] = 1.0
        return P, X

    def attack(t):
        P, X = {}, {}
        k_in = _ss(t / HIT) if t < HIT else 1.0
        k_out = 0.0 if t < HIT else (t - HIT) / (1 - HIT)
        snap = math.exp(-7 * k_out) if t >= HIT else 0.0
        if atk == 'bite':
            if t < HIT: head, lunge, crouch = -0.45 * k_in, -0.18 * k_in, -0.10 * k_in
            else:
                head = _lerp(0.42, 0.0, _ss(k_out)) * (0.35 + 0.65 * snap)
                lunge = _lerp(0.48, 0.0, _ss(k_out)); crouch = _lerp(-0.04, 0.0, _ss(k_out))
            P['neck'] = (head * 0.8, 0); P['head'] = (head * 0.6, 0); P['spine'] = (-lunge * 0.25, 0)
        elif atk == 'gore':                    # head dips, then rips UP through the target
            if t < HIT: head, lunge, crouch = 0.40 * k_in, -0.10 * k_in, -0.08 * k_in
            else:
                head = _lerp(-0.55, 0.0, _ss(k_out)) * (0.4 + 0.6 * snap)
                lunge = _lerp(0.55, 0.0, _ss(k_out)); crouch = 0.0
            P['neck'] = (head * 0.7, 0); P['head'] = (head * 0.8, 0); P['spine'] = (-lunge * 0.15, 0)
        elif atk == 'maul':                    # the bear rears, then slams down and forward
            if t < HIT: rear, lunge, crouch = 0.35 * k_in, -0.05 * k_in, 0.05 * k_in
            else:
                rear = _lerp(-0.12, 0.0, _ss(k_out)) * (0.4 + 0.6 * snap)
                lunge = _lerp(0.40, 0.0, _ss(k_out)); crouch = _lerp(-0.06, 0.0, _ss(k_out))
            P['spine'] = (-rear, 0); P['neck'] = (0.15 * rear, 0); P['head'] = (0.3 - 0.4 * rear if t >= HIT else 0.1, 0)
            for s in 'LR':                     # forelimbs come off the ground in the rear
                P['upperarm.' + s] = (-rear * 1.6, 0); P['forearm.' + s] = (rear * 1.2, 0)
            head = 0.0
        else:                                  # 'slap': the porcupine turns its back and lashes the tail
            if t < HIT: sw, lunge, crouch = -0.5 * k_in, 0.0, -0.05 * k_in
            else:
                sw = _lerp(0.9, 0.0, _ss(k_out)) * (0.4 + 0.6 * snap); lunge = 0.0; crouch = 0.0
            P['hips'] = (0, sw * 0.5); P['tail1'] = (0.4, sw); P['spine'] = (0, -sw * 0.25)
            head = 0.0
        P.setdefault('ear.L', (-0.5, 0)); P.setdefault('ear.R', (-0.5, 0))
        if atk in ('bite', 'gore'):
            for s in 'LR':
                P['upperarm.' + s] = (-lunge * 0.6, 0); P['hand.' + s] = (lunge * 0.6, 0)
                P['thigh.' + s] = (lunge * 0.55, 0); P['foot.' + s] = (-lunge * 0.4, 0)
        X['bob'] = crouch; X['fwd'] = lunge * 0.5; X['breath'] = 1.0
        return P, X

    def death(t):
        P, X = {}, {}; k = _ss(t)
        P['neck'] = (0.55 * k, 0); P['head'] = (0.35 * k, 0); P['spine'] = (0.12 * k, 0); P['hips'] = (-0.10 * k, 0)
        P['tail1'] = (-0.25 * k, 0); P['tail2'] = (-0.15 * k, 0)
        P['ear.L'] = (-0.8 * k, 0); P['ear.R'] = (-0.8 * k, 0)
        for s in 'LR':
            P['upperarm.' + s] = (0.55 * k, 0); P['forearm.' + s] = (0.9 * k, 0); P['hand.' + s] = (0.6 * k, 0)
            P['thigh.' + s] = (-0.5 * k, 0); P['shin.' + s] = (0.85 * k, 0); P['foot.' + s] = (-0.7 * k, 0)
        X['bob'] = -0.35 * k; X['breath'] = 1.0
        return P, X

    # name, fn, seconds, loop, bake samples
    return [('idle', idle, 2.0, True, 10), ('walk', walk, walk_s, True, 12), ('run', run, run_s, True, 10),
            ('bite', attack, windup + recovery, False, 10), ('death', death, 0.9, False, 10)], HIT

def _apply_pose(arm, fn, t):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'; pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
    P, X = fn(t)
    for name, (rx, rz) in P.items():
        pb = arm.pose.bones.get(name)
        if pb: pb.rotation_euler = (rx, 0, rz)
    r = arm.pose.bones['root']
    # root bone: local Y is world up, local Z is world FORWARD. So bob and lunge are
    # translations along Y and Z, and a waddle's side-to-side roll is a rotation
    # about Z (the forward axis), not Y (which would turn the animal instead).
    r.location = (0, X.get('bob', 0.0), X.get('fwd', 0.0))
    r.rotation_euler = (0, 0, X.get('roll', 0.0))
    b = X.get('breath', 1.0); arm.pose.bones['chest'].scale = (b, 1.0, b)

def _author_clips(arm, sp, J):
    bpy.context.scene.render.fps = FPS
    arm.animation_data_create()
    clips, HIT = _clips(sp)
    for name, fn, secs, loop, n in clips:
        act = bpy.data.actions.new(sp['_name'] + '_' + name); act.use_fake_user = True
        arm.animation_data.action = act
        nf = max(2, round(secs * FPS))
        for f in range(nf + 1):
            _apply_pose(arm, fn, f / nf)
            for pb in arm.pose.bones:
                pb.keyframe_insert('rotation_euler', frame=f)
                if pb.name == 'root': pb.keyframe_insert('location', frame=f)
                if pb.name == 'chest': pb.keyframe_insert('scale', frame=f)
        act['clip_seconds'] = secs; act['clip_loop'] = loop; act['clip_frames'] = nf; act['clip_samples'] = n
        act['clip_name'] = name
    return clips

# ============================================================================
#   BAKE: rgba8 offsets from rest
# ============================================================================
def _bake(species, sp, body, arm, clips, repo):
    sc = bpy.context.scene
    me = body.data
    me.calc_loop_triangles()
    col = me.color_attributes['Col']
    loop_rgb = np.empty(len(me.loops) * 4, np.float32); col.data.foreach_get('color_srgb', loop_rgb)
    loop_rgb = np.clip(np.round(loop_rgb.reshape(-1, 4)[:, :3] * 255), 0, 255).astype(np.uint8)
    loop_vi = np.empty(len(me.loops), np.int32); me.loops.foreach_get('vertex_index', loop_vi)
    key_to_idx, src_vi, colors, indices = {}, [], [], []
    for tri in me.loop_triangles:
        for li in tri.loops:
            vi = int(loop_vi[li]); c = tuple(int(x) for x in loop_rgb[li]); k = (vi, c)
            j = key_to_idx.get(k)
            if j is None: j = len(src_vi); key_to_idx[k] = j; src_vi.append(vi); colors.append(c)
            indices.append(j)
    src_vi = np.array(src_vi, np.int32); V = len(src_vi); NB = len(me.vertices)

    def positions():
        dg = bpy.context.evaluated_depsgraph_get()
        eo = body.evaluated_get(dg); em = eo.to_mesh()
        a = np.empty(NB * 3, np.float32); em.vertices.foreach_get('co', a); eo.to_mesh_clear()
        a = a.reshape(-1, 3)[src_vi]
        return np.stack([a[:, 0], a[:, 2], -a[:, 1]], axis=1)     # Blender -> game axes

    # the bind pose, with no action on the rig
    arm.animation_data.action = None
    for pb in arm.pose.bones: pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
    sc.frame_set(0)
    rest = positions()

    rows, manifest_clips, sweep = [], [], {}
    for name, fn, secs, loop, n in clips:
        act = next(a for a in bpy.data.actions if a.get('clip_name') == name)   # _clear() left only ours
        arm.animation_data.action = act
        if hasattr(arm.animation_data, 'action_slot') and act.slots and arm.animation_data.action_slot is None:
            arm.animation_data.action_slot = act.slots[0]
        nf = act['clip_frames']; start = len(rows); ys = []
        for i in range(n):
            t = i / n if loop else i / (n - 1)
            f = t * nf
            sc.frame_set(int(f), subframe=f - int(f))
            rows.append(positions())
            pb = arm.pose.bones['hand.L']; ys.append((arm.matrix_world @ pb.tail).y)
        c = {'name': name, 'row': start, 'count': n, 'seconds': round(secs, 4), 'loop': loop}
        if name in ('walk', 'run'):
            stance = 0.62 if name == 'walk' else {'gallop': 0.42, 'trot': 0.48}.get(sp.get('gait'), 0.5)
            c['groundSpeed'] = round((max(ys) - min(ys)) / (stance * secs), 3)
        manifest_clips.append(c)

    vat = np.stack(rows)                                     # (R, V, 3)
    delta = vat - rest[None]
    rng = np.abs(delta).reshape(-1, 3).max(axis=0) + 1e-5
    q = np.clip(np.round((delta / rng * 0.5 + 0.5) * 255), 0, 255).astype(np.uint8)
    R = q.shape[0]
    q4 = np.concatenate([q, np.full((R, V, 1), 255, np.uint8)], axis=2)
    err = float(np.abs((q.astype(np.float32) / 255 * 2 - 1) * rng - delta).max())

    idx = np.array(indices, np.uint16)
    cols = np.concatenate([np.array(colors, np.uint8), np.full((V, 1), 255, np.uint8)], axis=1)
    def pad4(b): return b + b'\0' * ((4 - len(b) % 4) % 4)
    b_idx, b_col, b_rest, b_vat = pad4(idx.tobytes()), pad4(cols.tobytes()), rest.astype(np.float32).tobytes(), q4.tobytes()
    blob = b_idx + b_col + b_rest + b_vat
    o_col = len(b_idx); o_rest = o_col + len(b_col); o_vat = o_rest + len(b_rest)
    vmin = (rest[None] + np.clip(delta, -rng, rng)).reshape(-1, 3).min(axis=0)
    vmax = (rest[None] + np.clip(delta, -rng, rng)).reshape(-1, 3).max(axis=0)
    os.makedirs(os.path.join(repo, 'assets', 'vat'), exist_ok=True)
    with open(os.path.join(repo, 'assets', 'vat', species + '.bin'), 'wb') as fh: fh.write(blob)
    manifest = {
        'version': 2, 'species': species, 'vertexCount': V, 'indexCount': int(len(idx)), 'rows': R,
        'clips': manifest_clips,
        'offsets': {'indices': 0, 'colors': o_col, 'rest': o_rest, 'vat': o_vat},
        'bytes': len(blob), 'positionFormat': 'rgba8-delta',
        'range': [round(float(x), 6) for x in rng],
        'bounds': {'min': [round(float(x), 4) for x in vmin], 'max': [round(float(x), 4) for x in vmax]},
        'hit': round(sp['attack'][1] / (sp['attack'][1] + sp['attack'][2]), 4),   # damage frame, as a fraction of the strike
        'source': 'assets/src/%s.blend' % species, 'axes': 'blender(x,y,z) -> game(x,z,-y); head on game +Z',
        'colorSpace': 'srgb',
    }
    with open(os.path.join(repo, 'assets', 'vat', species + '.json'), 'w') as fh: json.dump(manifest, fh, indent=1)
    return {'export_verts': V, 'tris': len(idx) // 3, 'rows': R, 'kb': round(len(blob) / 1024, 1),
            'quant_err_max': round(err, 4), 'range': manifest['range'],
            'clips': {c['name']: c.get('groundSpeed') for c in manifest_clips}}
