'use strict';
/* MAD EGGS - 3D third-person view (visual layer only).
 * The server stays authoritative and 2D (x,y). World (x,y) maps to Three.js (x, 0, z=y).
 * Loaded after the main inline script, so it can use its globals: G, S, CH, PH, TEAM, RARITY, cv, cx, $, clamp, held, stickMove, angDiff.
 * If Three.js or WebGL is unavailable the game silently falls back to the classic 2D view.
 */
const V3 = (function () {
  let R = null, scene = null, cam = null, GEO = null, mapId = null;
  let ents = {}, pks = {}, fxm = new Map(), projPool = [], wellPool = [];
  const WALL_H = 120, LOW_H = 26, CAM_BACK = 118, CAM_SIDE = 30, CAM_H = 56;
  const ITEM_COL = { health: '#ff4d5e', shield: '#9ad0ff', speed: '#ffcb2f', damage: '#ff8a3d', charge: '#c06bff', mystery: '#fff7e0' };
  const camState = { t: 1 };

  function supported() {
    try {
      if (!window.THREE) return false;
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch (e) { return false; }
  }

  function makeGeo() {
    const T = THREE;
    return {
      leg: new T.BoxGeometry(7, 14, 8),
      torso: new T.CylinderGeometry(11, 12.5, 20, 12),
      band: new T.CylinderGeometry(12.8, 12.8, 3.2, 12),
      plate: new T.BoxGeometry(3, 11, 15),
      neck: new T.CylinderGeometry(7, 9, 6, 10),
      head: new T.SphereGeometry(1, 18, 14),
      eye: new T.BoxGeometry(2.6, 3.2, 5.4),
      pad: new T.SphereGeometry(5, 8, 6),
      pack: new T.BoxGeometry(6, 14, 13),
      gun: new T.BoxGeometry(24, 4.6, 4.6),
      barrel: new T.BoxGeometry(7, 3, 3),
      arm: new T.BoxGeometry(12, 5, 5),
      shadow: new T.CircleGeometry(16, 20),
      shield: new T.SphereGeometry(30, 16, 12),
      ice: new T.BoxGeometry(40, 58, 40),
      ring: new T.RingGeometry(21, 25, 28),
      bullet: new T.BoxGeometry(18, 3, 3),
      arrow: new T.BoxGeometry(36, 2.6, 2.6),
      ball: new T.SphereGeometry(1, 10, 8),
      octa: new T.OctahedronGeometry(8),
      pbox: new T.BoxGeometry(20, 6, 7),
      pring: new T.RingGeometry(12, 16, 24),
      unitRing: new T.RingGeometry(0.88, 1, 40),
      disc: new T.CircleGeometry(1, 36),
      bolt: new T.CylinderGeometry(5, 9, 520, 8)
    };
  }

  function init(canvas, G0) {
    const T = THREE;
    if (!R) {
      R = new T.WebGLRenderer({ canvas: canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
      R.setClearColor(0x05030a, 1);
      cam = new T.PerspectiveCamera(64, 1.7, 4, 3200);
      GEO = makeGeo();
    }
    buildScene(G0);
    resize(innerWidth, innerHeight, Math.min(window.devicePixelRatio || 1, 2));
  }

  function disposeObj(o) {
    o.traverse(function (n) {
      if (n.material) { (Array.isArray(n.material) ? n.material : [n.material]).forEach(function (m) { if (m.map) m.map.dispose(); m.dispose(); }); }
    });
  }

  function clear() {
    if (!scene) return;
    while (scene.children.length) { const c = scene.children[0]; scene.remove(c); disposeObj(c); }
    ents = {}; pks = {}; fxm = new Map(); projPool = []; wellPool = [];
  }

  function buildScene(G0) {
    const T = THREE, map = G0.map, W = map.W, H = map.H;
    clear();
    scene = scene || new T.Scene();
    scene.background = new T.Color(0x05030a);
    scene.fog = new T.Fog(0x0b0716, 520, 1700);
    scene.add(new T.AmbientLight(0x8a78b8, 0.95));
    const sun = new T.DirectionalLight(0xfff0dd, 0.85); sun.position.set(W * 0.3, 900, H * 0.1); scene.add(sun);
    scene.add(new T.HemisphereLight(0x9d7bff, 0x1a0f2a, 0.35));

    // floor from the pre-rendered 2D floor (graffiti, pads, neon already baked in)
    const tex = new T.CanvasTexture(G0.floor);
    tex.anisotropy = Math.min(4, R.capabilities.getMaxAnisotropy());
    const floor = new T.Mesh(new T.PlaneGeometry(W, H), new T.MeshLambertMaterial({ map: tex }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(W / 2, 0, H / 2);
    scene.add(floor);
    const ground = new T.Mesh(new T.PlaneGeometry(W * 4, H * 4), new T.MeshBasicMaterial({ color: 0x07040e }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(W / 2, -1, H / 2);
    scene.add(ground);

    const accents = [0xa45cff, 0xffcb2f, 0x38e07b, 0x3b9dff];
    const addBox = function (x, y, w, h, hgt, color, edge) {
      const m = new T.Mesh(new T.BoxGeometry(w, hgt, h), new T.MeshLambertMaterial({ color: color }));
      m.position.set(x + w / 2, hgt / 2, y + h / 2); scene.add(m);
      const e = new T.LineSegments(new T.EdgesGeometry(m.geometry), new T.LineBasicMaterial({ color: edge }));
      e.position.copy(m.position); scene.add(e);
      return m;
    };
    map.walls.forEach(function (w) {
      if (w.t === 'low') addBox(w.x, w.y, w.w, w.h, LOW_H, 0x3a2f55, 0xffcb2f);
      else addBox(w.x, w.y, w.w, w.h, WALL_H, 0x251c3a, accents[(Math.floor(w.x / 200) + Math.floor(w.y / 200)) % 4]);
    });
    // arena boundary so the camera never sees the void
    const B = 60, bc = 0x1a1230, be = 0xa45cff;
    addBox(-B, -B, W + B * 2, B, 170, bc, be); addBox(-B, H, W + B * 2, B, 170, bc, be);
    addBox(-B, 0, B, H, 170, bc, be); addBox(W, 0, B, H, 170, bc, be);
  }

  function resize(cw, ch, dpr) {
    if (!R) return;
    R.setPixelRatio(Math.min(dpr || 1, 1.5));
    R.setSize(cw, ch, false);
    cam.aspect = cw / ch;
    cam.fov = ch > cw ? 76 : 62;
    cam.updateProjectionMatrix();
  }

  /* ---------- egg character ---------- */
  function makeEgg(ci) {
    const T = THREE, col = new T.Color(CH[ci].color), g = new T.Group(), mats = [];
    const mk = function (hex, em) { const m = new T.MeshLambertMaterial({ color: hex, emissive: em == null ? 0x000000 : em, transparent: true, opacity: 1 }); mats.push(m); return m; };
    const mkB = function (hex, op) { const m = new T.MeshBasicMaterial({ color: hex, transparent: true, opacity: op }); m.userData.base = op; mats.push(m); return m; };
    const dark = mk(0x15111f), trim = mk(col.getHex(), col.getHex()), trim2 = mk(col.getHex(), col.getHex()), shell = mk(0xe9e4d6);
    const root = new T.Group(); g.add(root);
    const legs = [];
    [-5, 5].forEach(function (z) {
      const lg = new T.Group(); lg.position.set(0, 14, z);
      const m = new T.Mesh(GEO.leg, dark); m.position.y = -7; lg.add(m); root.add(lg); legs.push(lg);
    });
    const torso = new T.Mesh(GEO.torso, dark); torso.position.y = 24; root.add(torso);
    const band = new T.Mesh(GEO.band, trim); band.position.y = 28; root.add(band);
    const plate = new T.Mesh(GEO.plate, trim2); plate.position.set(11.4, 24, 0); plate.scale.set(0.5, 1, 1); root.add(plate);
    const neck = new T.Mesh(GEO.neck, dark); neck.position.y = 35; root.add(neck);
    [-12, 12].forEach(function (z) { const p = new T.Mesh(GEO.pad, dark); p.position.set(0, 31, z); root.add(p); });
    const pack = new T.Mesh(GEO.pack, dark); pack.position.set(-11, 25, 0); root.add(pack);
    const head = new T.Mesh(GEO.head, shell); head.scale.set(12, 15, 12); head.position.y = 46; root.add(head);
    [-5.4, 5.4].forEach(function (z, i) {
      const eye = new T.Mesh(GEO.eye, trim); eye.position.set(10.4, 48, z); eye.rotation.x = i ? -0.38 : 0.38; root.add(eye);
    });
    // cracked-mask lines: jagged mouth + two cracks on the shell
    const pts = [];
    const onHead = function (z, y) { const v = 1 - (z / 12) * (z / 12) - ((y - 46) / 15) * ((y - 46) / 15); return v > 0.02 ? 12 * Math.sqrt(v) * 1.015 : null; };
    let prev = null;
    for (let i = 0; i <= 8; i++) {
      const z = -8 + i * 2, y = i % 2 ? 38.5 : 41.5, x = onHead(z, y);
      if (x == null) continue;
      const p = [x, y, z]; if (prev) pts.push(prev[0], prev[1], prev[2], p[0], p[1], p[2]); prev = p;
    }
    [[-3, 56, 4, 51], [3, 55, 7, 50], [6, 52, -2, 45]].forEach(function (c) {
      // top-of-head cracks (z,y pairs)
      const x1 = onHead(c[0], c[1]), x2 = onHead(c[2], c[3]);
      if (x1 != null && x2 != null) pts.push(x1, c[1], c[0], x2, c[3], c[2]);
    });
    const lg = new T.BufferGeometry(); lg.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    const lines = new T.LineSegments(lg, new T.LineBasicMaterial({ color: 0x14101a })); root.add(lines);
    // weapon + arms
    const gun = new T.Group(); gun.position.set(11, 25, 11);
    const gb = new T.Mesh(GEO.gun, dark); gb.position.x = 8; gun.add(gb);
    const bar = new T.Mesh(GEO.barrel, trim); bar.position.x = 22; gun.add(bar); root.add(gun);
    const armR = new T.Mesh(GEO.arm, dark); armR.position.set(5, 28, 11.5); root.add(armR);
    const armL = new T.Mesh(GEO.arm, dark); armL.position.set(5, 28, -11.5); root.add(armL);
    // ground bits
    const shadow = new T.Mesh(GEO.shadow, mkB(0x000000, 0.35)); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.6; g.add(shadow);
    const ringMat = mkB(0xffffff, 0.8);
    const ring = new T.Mesh(GEO.ring, ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 1.2; ring.visible = false; g.add(ring);
    const shield = new T.Mesh(GEO.shield, mkB(0x9ad0ff, 0.22)); shield.position.y = 26; shield.visible = false; g.add(shield);
    const ice = new T.Mesh(GEO.ice, mkB(0xaee8ff, 0.45)); ice.position.y = 29; ice.visible = false; g.add(ice);
    return { g: g, root: root, legs: legs, mats: mats, head: head, torso: torso, ring: ring, ringMat: ringMat, shield: shield, ice: ice, ci: ci,
      last: null, lastT: 0, phase: 0, lift: 0, flash: 0, alpha: 1, trimMat: trim };
  }

  /* ---------- helpers ---------- */
  function blocked(map, x, y) {
    const w = map.walls;
    for (let i = 0; i < w.length; i++) {
      const b = w[i]; if (b.t === 'low') continue;
      if (x >= b.x - 8 && x <= b.x + b.w + 8 && y >= b.y - 8 && y <= b.y + b.h + 8) return true;
    }
    return false;
  }

  function project(x, h, y, cw, ch) {
    const v = new THREE.Vector3(x, h, y).project(cam);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x * 0.5 + 0.5) * cw, y: (-v.y * 0.5 + 0.5) * ch };
  }

  /* ---------- per-frame ---------- */
  function render(G0, now, mx, my, others, cw, ch) {
    if (!R) return;
    const T = THREE, map = G0.map, yaw = G0.aim, fx = Math.cos(yaw), fy = Math.sin(yaw), rx = -fy, ry = fx;

    // camera: behind + over the right shoulder, pulled in by walls
    const dx = -fx * CAM_BACK + rx * CAM_SIDE, dy = -fy * CAM_BACK + ry * CAM_SIDE;
    let t = 1;
    for (let s = 0.06; s <= 1.0001; s += 0.06) { if (blocked(map, mx + dx * s, my + dy * s)) { t = Math.max(0.1, s - 0.12); break; } }
    camState.t = t < camState.t ? t : camState.t + (t - camState.t) * 0.25;
    cam.position.set(mx + dx * camState.t, CAM_H, my + dy * camState.t);
    cam.lookAt(mx + fx * 430, 24, my + fy * 430);
    cam.updateMatrixWorld();

    // eggs
    const seen = {};
    for (let i = 0; i < others.length; i++) {
      const o = others[i];
      if (!o.clone && !o.al) continue;
      const key = (o.clone ? 'c' : 'p') + o.i, pl = G0.players[o.i];
      const ci = o.clone ? o.c : pl ? pl.char : 0;
      let e = ents[key];
      if (!e || e.ci !== ci) {
        if (e) { scene.remove(e.g); disposeObj(e.g); }
        e = ents[key] = makeEgg(ci); scene.add(e.g);
      }
      seen[key] = 1;
      const ang = o.isMe ? G0.aim : o.a;
      e.g.visible = true;
      e.g.position.set(o.x, 0, o.y); e.g.rotation.y = -ang;
      const dt = e.lastT ? Math.min(0.1, (now - e.lastT) / 1000) : 0.016; e.lastT = now;
      const sp = e.last ? Math.hypot(o.x - e.last.x, o.y - e.last.y) / Math.max(dt, 0.001) : 0;
      e.phase += Math.min(sp, 320) * dt * 0.075;
      const sw = sp > 12 ? Math.sin(e.phase) * 0.7 : 0;
      e.legs[0].rotation.z = sw; e.legs[1].rotation.z = -sw;
      e.lift += ((o.air ? 22 : 0) - e.lift) * 0.35;
      e.root.position.y = e.lift + (sp > 12 ? Math.abs(Math.sin(e.phase)) * 1.4 : 0);
      if (e.last && o.h < e.last.h) e.flash = now + 90;
      e.head.material.emissive.setHex(now < e.flash ? 0xff7777 : 0x000000);
      e.last = { x: o.x, y: o.y, h: o.h };
      const st = o.st || []; let alpha = 1;
      if (st.indexOf('phantom') >= 0) alpha = 0.3;
      if (st.indexOf('inv') >= 0 && Math.floor(now / 100) % 2) alpha = 0.45;
      if (st.indexOf('dc') >= 0) alpha = 0.35;
      e.mats.forEach(function (m) { m.opacity = (m.userData.base === undefined ? 1 : m.userData.base) * alpha; });
      e.alpha = alpha;
      e.shield.visible = o.s > 0;
      e.ice.visible = st.indexOf('fr') >= 0;
      // ground ring: team colour, or aura/ability colour
      let rc = null;
      if (G0.mode === 'tdm' && !o.clone && pl) rc = TEAM[pl.team].c;
      if (st.indexOf('au') >= 0) rc = '#38e07b'; else if (st.indexOf('bk') >= 0) rc = '#ff3c3c'; else if (st.indexOf('pf') >= 0) rc = '#ff8a3d'; else if (st.indexOf('db') >= 0) rc = '#ffcb2f';
      e.ring.visible = !!rc; if (rc) e.ringMat.color.set(rc);
    }
    for (const k in ents) { if (!seen[k]) { scene.remove(ents[k].g); disposeObj(ents[k].g); delete ents[k]; } }

    // pickups
    const pseen = {};
    for (let i = 0; i < G0.pickups.length; i++) {
      const pk = G0.pickups[i];
      if (!pk[4]) continue;
      const id = pk[0], sig = pk[3] + ':' + pk[5];
      let p = pks[id];
      if (p && p.sig !== sig) { scene.remove(p.g); disposeObj(p.g); p = null; }
      if (!p) {
        const kind = pk[3], col = kind === 'weapon' ? (RARITY[(G0.wp[pk[5]] || {}).rarity] || '#ffffff') : (ITEM_COL[kind] || '#ffffff');
        const g = new T.Group();
        const body = kind === 'weapon'
          ? new T.Mesh(GEO.pbox, new T.MeshLambertMaterial({ color: 0x1b1626, emissive: new T.Color(col).multiplyScalar(0.55) }))
          : kind === 'mystery'
            ? (function () { const m = new T.Mesh(GEO.ball, new T.MeshLambertMaterial({ color: 0xfff7e0, emissive: 0x6b4fb0 })); m.scale.set(8, 11, 8); return m; })()
            : new T.Mesh(GEO.octa, new T.MeshLambertMaterial({ color: col, emissive: new T.Color(col).multiplyScalar(0.7) }));
        body.position.y = 22; g.add(body);
        const rg = new T.Mesh(GEO.pring, new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.65, side: T.DoubleSide }));
        rg.rotation.x = -Math.PI / 2; rg.position.y = 1.4; g.add(rg);
        g.position.set(pk[1], 0, pk[2]); scene.add(g);
        p = pks[id] = { g: g, body: body, sig: sig };
      }
      pseen[id] = 1;
      p.body.position.y = 22 + Math.sin(now / 280 + id) * 3;
      p.body.rotation.y = now / 600;
    }
    for (const k in pks) { if (!pseen[k]) { scene.remove(pks[k].g); disposeObj(pks[k].g); delete pks[k]; } }

    // projectiles
    const prs = G0.last.pr, dtp = Math.min(0.05, (now - G0.last.at) / 1000);
    for (let i = 0; i < prs.length; i++) {
      const q = prs[i];
      let m = projPool[i];
      if (!m) { m = projPool[i] = new T.Mesh(GEO.bullet, new T.MeshBasicMaterial({ color: 0xffffff })); scene.add(m); }
      m.visible = true;
      const kind = q[4], col = CH[q[5]] ? CH[q[5]].color : '#ffffff';
      m.position.set(q[0] + q[2] * dtp, 22, q[1] + q[3] * dtp);
      m.rotation.set(0, -Math.atan2(q[3], q[2]), 0);
      m.scale.set(1, 1, 1);
      if (kind === 'arrow') { m.geometry = GEO.arrow; m.material.color.set(col); }
      else if (kind === 'plasma') { m.geometry = GEO.ball; m.scale.set(8, 8, 8); m.material.color.set('#d58bff'); }
      else if (kind === 'grenade') { m.geometry = GEO.ball; m.scale.set(6, 6, 6); m.material.color.set(Math.floor(now / 90) % 2 ? '#ff4d5e' : '#2a2a38'); }
      else if (kind === 'egg') { m.geometry = GEO.ball; m.scale.set(9, 11, 9); m.rotation.z = now / 120; m.material.color.set('#fff7e0'); }
      else { m.geometry = GEO.bullet; m.material.color.set(col); }
    }
    for (let i = prs.length; i < projPool.length; i++) projPool[i].visible = false;

    // gravity wells
    const wl = G0.last.wl || [];
    for (let i = 0; i < wl.length; i++) {
      let w = wellPool[i];
      if (!w) {
        w = wellPool[i] = [];
        for (let k = 0; k < 3; k++) {
          const m = new T.Mesh(GEO.unitRing, new T.MeshBasicMaterial({ color: 0xc06bff, transparent: true, opacity: 0.6, side: T.DoubleSide }));
          m.rotation.x = -Math.PI / 2; m.position.y = 3; scene.add(m); w.push(m);
        }
      }
      for (let k = 0; k < 3; k++) {
        const ph = ((now / 400) + k / 3) % 1, m = w[k];
        m.visible = true; m.position.x = wl[i][0]; m.position.z = wl[i][1];
        m.scale.set(ph * wl[i][2], ph * wl[i][2], 1); m.material.opacity = 0.65 - ph * 0.5;
      }
    }
    for (let i = wl.length; i < wellPool.length; i++) wellPool[i].forEach(function (m) { m.visible = false; });

    // effects (G.fx entries are filtered by the main loop; we mirror them)
    const alive = new Set(G0.fx);
    fxm.forEach(function (m, f) { if (!alive.has(f)) { scene.remove(m); disposeObj(m); fxm.delete(f); } });
    for (let i = 0; i < G0.fx.length; i++) {
      const f = G0.fx[i], p = Math.min(1, (now - f.t) / f.d);
      let m = fxm.get(f);
      if (!m) {
        const col = f.c || '#ffffff';
        if (f.k === 'ring') { m = new T.Mesh(GEO.unitRing, new T.MeshBasicMaterial({ color: col, transparent: true, side: T.DoubleSide })); m.rotation.x = -Math.PI / 2; m.position.set(f.x, 2, f.y); }
        else if (f.k === 'boom') { m = new T.Mesh(GEO.ball, new T.MeshBasicMaterial({ color: col, transparent: true })); m.position.set(f.x, 22, f.y); }
        else if (f.k === 'warn') { m = new T.Mesh(GEO.disc, new T.MeshBasicMaterial({ color: 0xffe94d, transparent: true, side: T.DoubleSide })); m.rotation.x = -Math.PI / 2; m.position.set(f.x, 2, f.y); }
        else if (f.k === 'bolt') { m = new T.Mesh(GEO.bolt, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true })); m.position.set(f.x, 260, f.y); }
        else if (f.k === 'swing') { m = new T.Group(); const s = new T.Mesh(new T.CircleGeometry(f.r + 14, 14, -0.8, 1.6), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: T.DoubleSide })); s.rotation.x = -Math.PI / 2; m.add(s); m.position.set(f.x, 20, f.y); m.rotation.y = -f.a; }
        else { m = new T.Mesh(GEO.ball, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true })); m.position.set(f.x, 24, f.y); }
        scene.add(m); fxm.set(f, m);
      }
      if (f.k === 'ring') { const s = f.r * (0.2 + p * 0.8); m.scale.set(s, s, 1); m.material.opacity = 1 - p; }
      else if (f.k === 'boom') { const s = f.r * (0.4 + p * 0.6); m.scale.set(s, s, s); m.material.opacity = (1 - p) * 0.65; }
      else if (f.k === 'warn') { m.scale.set(f.r, f.r, 1); m.material.opacity = 0.12 + 0.18 * Math.abs(Math.sin(now / 60)); }
      else if (f.k === 'bolt') { m.material.opacity = 1 - p; }
      else if (f.k === 'swing') { m.children[0].material.opacity = 0.55 * (1 - p); }
      else { const s = 6 * (1 - p); m.scale.set(s, s, s); m.material.opacity = 1 - p; }
    }

    R.render(scene, cam);
  }

  /* ---------- look controls (swipe on the right side = turn the camera) ---------- */
  let looking = false;
  function bindLook() {
    if (looking) return; looking = true;
    const zone = $('#zone-aim'); let pid = null, lx = 0;
    zone.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.btn-g') || pid !== null) return;
      pid = e.pointerId; lx = e.clientX;
    });
    zone.addEventListener('pointermove', function (e) {
      if (e.pointerId !== pid || !G || !G.use3d) return;
      G.aim += (e.clientX - lx) * 0.0078 * (S.set.sens || 1); lx = e.clientX;
    });
    const end = function (e) { if (e.pointerId === pid) pid = null; };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
    // desktop: click to capture the mouse, move to turn
    cv.addEventListener('mousedown', function () { if (G && G.use3d && cv.requestPointerLock && document.pointerLockElement !== cv) { try { cv.requestPointerLock(); } catch (x) { /* ok */ } } });
    document.addEventListener('mousemove', function (e) {
      if (G && G.use3d && document.pointerLockElement === cv) G.aim += e.movementX * 0.0032 * (S.set.sens || 1);
    });
  }

  return { supported: supported, init: init, clear: clear, resize: resize, render: render, project: project, bindLook: bindLook };
})();

/* Movement is camera-relative in 3D: stick up = walk where the camera faces. */
function readInput3d() {
  let sx = 0, sy = 0;
  if (stickMove && stickMove.on) { sx = stickMove.x; sy = stickMove.y; } else { sx = held.kx; sy = held.ky; }
  const yaw = G.aim, c = Math.cos(yaw), s = Math.sin(yaw);
  const mx = c * -sy - s * sx, my = s * -sy + c * sx;
  let aim = yaw, fire = held.fire || held.mdown;
  const me = G.pred, live = G.last && G.last.ph === 'live' && G.me && G.me.al;
  let best = null, bd = 0.3, bDist = 0;
  if (G.others) {
    for (const o of G.others) {
      if (o.isMe || o.clone || !o.al) continue;
      if (G.mode === 'tdm' && G.players[o.i] && G.players[G.you] && G.players[o.i].team === G.players[G.you].team) continue;
      const dx = o.x - me.x, dy = o.y - me.y, dist = Math.hypot(dx, dy);
      if (dist > 620) continue;
      const a = Math.atan2(dy, dx), d = Math.abs(angDiff(yaw, a));
      if (d < bd && PH.ray(me.x, me.y, a, dist, G.map.walls) >= dist - 6) { bd = d; best = a; bDist = dist; }
    }
  }
  G.xhairOn = !!(best != null && bd < 0.08);
  if (live && best != null) {
    if (S.set.autofire && bd < 0.07) fire = true;
    if (fire && S.set.assist) aim = yaw + angDiff(yaw, best) * 0.6;
  }
  void bDist;
  return { mx: mx, my: my, a: +aim.toFixed(3), f: fire };
}

/* Called from the main frame() loop when 3D is active. Draws the 2D overlay (tags, damage numbers, crosshair). */
function frame3d(now, mx, my, others, me) {
  const dpr = cv.dpr, cw = cv.width / dpr, ch = cv.height / dpr;
  if (!G.yawInit && G.last) {
    const mp = G.last.p.find(function (p) { return p.i === G.you; });
    G.aim = mp ? mp.a : 0; G.yawInit = true;
  }
  G.fx = G.fx.filter(function (f) { return now - f.t < f.d; });
  V3.render(G, now, mx, my, others, cw, ch);
  cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, cw, ch);
  cx.textAlign = 'center'; cx.lineJoin = 'round';

  // name tags + health bars (teammates and enemies)
  for (const o of others) {
    if (o.clone || !o.al || o.isMe) continue;
    const pr = V3.project(o.x, 66, o.y, cw, ch); if (!pr) continue;
    const dist = Math.hypot(o.x - mx, o.y - my), k = clamp(1.25 - dist / 900, 0.7, 1.15);
    const pl = G.players[o.i], ci = pl ? pl.char : 0;
    cx.font = `700 ${Math.round(12 * k)}px Rubik, sans-serif`; cx.lineWidth = 3; cx.strokeStyle = '#000';
    cx.fillStyle = G.mode === 'tdm' && pl ? TEAM[pl.team].c : CH[ci].color;
    cx.strokeText(pl ? pl.name : '', pr.x, pr.y - 12 * k); cx.fillText(pl ? pl.name : '', pr.x, pr.y - 12 * k);
    const bw = 40 * k, hp = clamp(o.h / 100, 0, 1);
    cx.fillStyle = '#000'; cx.fillRect(pr.x - bw / 2 - 1, pr.y - 8 * k, bw + 2, 7 * k);
    cx.fillStyle = hp > 0.35 ? '#38e07b' : '#ff4d5e'; cx.fillRect(pr.x - bw / 2, pr.y - 7 * k, bw * hp, 5 * k);
  }
  // pickup names when close
  for (const pk of G.pickups) {
    if (!pk[4] || pk[3] !== 'weapon' || Math.hypot(pk[1] - mx, pk[2] - my) > 120) continue;
    const pr = V3.project(pk[1], 40, pk[2], cw, ch); if (!pr) continue;
    const col = RARITY[(G.wp[pk[5]] || {}).rarity] || '#fff', nm = (G.wp[pk[5]] || {}).name || '';
    cx.font = '700 13px Rubik, sans-serif'; cx.lineWidth = 3; cx.strokeStyle = '#000'; cx.fillStyle = col;
    cx.strokeText(nm, pr.x, pr.y); cx.fillText(nm, pr.x, pr.y);
    cx.font = '600 10px Rubik, sans-serif'; cx.fillStyle = '#fff'; cx.strokeText('tap USE', pr.x, pr.y + 13); cx.fillText('tap USE', pr.x, pr.y + 13);
  }
  // damage numbers
  G.floats = G.floats.filter(function (f) { return now - f.t < 800; });
  for (const f of G.floats) {
    const p = (now - f.t) / 800, pr = V3.project(f.x, 56 + p * 30, f.y, cw, ch); if (!pr) continue;
    cx.globalAlpha = 1 - p * p; cx.font = `800 ${f.big ? 22 : 15}px Rubik, sans-serif`; cx.lineWidth = 3; cx.strokeStyle = '#000'; cx.fillStyle = f.c;
    cx.strokeText(f.txt, pr.x, pr.y); cx.fillText(f.txt, pr.x, pr.y); cx.globalAlpha = 1;
  }
  // crosshair at screen centre (the camera looks exactly along the aim direction)
  if (me.al && G.last.ph === 'live') {
    const ax = cw / 2, ay = ch / 2, empty = me.am === 0 && G.wp[me.w].kind !== 'melee';
    cx.strokeStyle = empty ? '#ff4d5e' : G.xhairOn ? '#ffcb2f' : '#ffffff'; cx.lineWidth = 2; cx.globalAlpha = 0.9;
    cx.beginPath(); cx.arc(ax, ay, G.xhairOn ? 7 : 9, 0, 6.3);
    cx.moveTo(ax - 16, ay); cx.lineTo(ax - 7, ay); cx.moveTo(ax + 7, ay); cx.lineTo(ax + 16, ay);
    cx.moveTo(ax, ay - 16); cx.lineTo(ax, ay - 7); cx.moveTo(ax, ay + 7); cx.lineTo(ax, ay + 16); cx.stroke(); cx.globalAlpha = 1;
  }
}
