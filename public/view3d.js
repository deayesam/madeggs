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
    if (!GEO) GEO = makeGeo();
    if (!R) {
      R = new T.WebGLRenderer({ canvas: canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
      R.setClearColor(0x05030a, 1);
      cam = new T.PerspectiveCamera(64, 1.7, 4, 3200);
    }
    buildScene(G0);
    resize(innerWidth, innerHeight, Math.min(window.devicePixelRatio || 1, 2));
  }

  function disposeObj(o) {
    o.traverse(function (n) {
      if (n.geometry && n.geometry.userData && n.geometry.userData.own) n.geometry.dispose();
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

  /* ---------- customisable egg: masks, tops, bottoms, shoes (see shared/cosmetics.js) ---------- */
  function lookSig(look, name) { return JSON.stringify(look) + '|' + String(name || '').trim().charAt(0).toUpperCase(); }

  function letterTexture(ch, hex) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    x.clearRect(0, 0, 128, 128); x.fillStyle = hex; x.font = '900 104px Rubik, Impact, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(ch, 64, 70);
    return new THREE.CanvasTexture(c);
  }

  function makeEgg(look, name) {
    const T = THREE, M = MECOS, PI2 = Math.PI / 2;
    look = M.sanitizeLook(look);
    const g = new T.Group(), mats = [], root = new T.Group(); g.add(root);
    const accHex = new T.Color(CH[look.a].color).getHex();
    const gm = function (i) { return new T.Color(M.GARMENT[i]).getHex(); };
    const mk = function (hex, em) { const m = new T.MeshLambertMaterial({ color: hex, emissive: em == null ? 0x000000 : em, transparent: true, opacity: 1 }); mats.push(m); return m; };
    const mkB = function (hex, op) { const m = new T.MeshBasicMaterial({ color: hex, transparent: true, opacity: op }); m.userData.base = op; mats.push(m); return m; };
    const SHELL = 0xe9e4d6, BLACK = 0x15111f, WHITE = 0xffffff;
    const trim = mk(accHex, accHex), dark = mk(BLACK), shell = mk(SHELL), metal = mk(0xc9ccd6);
    const topC = gm(look.tc), botC = gm(look.bc), shoC = gm(look.sc);
    const add = function (geo, mat, x, y, z, rx, ry, rz, parent) {
      const m = new T.Mesh(geo, mat); m.position.set(x, y, z);
      if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
      (parent || root).add(m); return m;
    };

    /* legs + bottoms + shoes (hip pivots so they can swing) */
    const legs = [];
    [-5, 5].forEach(function (z) {
      const lg = new T.Group(); lg.position.set(0, 14, z); root.add(lg); legs.push(lg);
      const bm = mk(botC);
      if (look.b === 'shorts') { add(gbox(7.8, 8, 8.8), bm, 0, -4, 0, 0, 0, 0, lg); add(gbox(5.2, 7, 5.6), shell, 0, -10.5, 0, 0, 0, 0, lg); }
      else {
        add(gbox(7, 14, 8), bm, 0, -7, 0, 0, 0, 0, lg);
        if (look.b === 'cargo') add(gbox(5, 5, 1.5), trim, 0, -5, z < 0 ? -4.6 : 4.6, 0, 0, 0, lg);
      }
      const sy = -11.6;
      if (look.s === 'boots') {
        add(gbox(12, 5, 9.4), mk(shoC), 2, sy, 0, 0, 0, 0, lg); add(gbox(7.6, 5.5, 8.6), mk(shoC), -0.2, sy + 3.2, 0, 0, 0, 0, lg);
        add(gbox(12.2, 1.3, 9.6), trim, 2, sy + 1.4, 0, 0, 0, 0, lg);
      } else if (look.s === 'sneakers') {
        add(gbox(12.6, 1.6, 9.8), mk(WHITE), 2, sy - 1.2, 0, 0, 0, 0, lg); add(gbox(11, 3.6, 8.8), mk(shoC), 1.6, sy + 0.8, 0, 0, 0, 0, lg);
        add(gbox(3.5, 2.8, 9), trim, 7.4, sy + 0.4, 0, 0, 0, 0, lg);
      } else if (look.s === 'match') {
        add(gbox(12, 5, 9.4), mk(topC), 2, sy, 0, 0, 0, 0, lg); add(gbox(7.6, 5.5, 8.6), mk(topC), -0.2, sy + 3.2, 0, 0, 0, 0, lg);
        add(gbox(12.2, 1.1, 9.6), mk(WHITE), 2, sy + 0.4, 0, 0, 0, 0, lg); add(gbox(12.2, 1.1, 9.6), trim, 2, sy + 2.2, 0, 0, 0, 0, lg);
      } else add(gbox(10.5, 3, 8.2), shell, 1.6, sy + 0.6, 0, 0, 0, 0, lg);
    });

    /* torso + tops */
    const top = look.t, topMat = mk(topC);
    const torsoMat = top === 'armor' ? dark : topMat;
    const torso = add(gcyl(11, 12.5, 20, 12), torsoMat, 0, 24, 0);
    add(gcyl(7, 9, 6, 10), top === 'hoodie' ? topMat : dark, 0, 35, 0);
    const sleeveMat = (top === 'vest' || top === 'tshirt') ? shell : (top === 'tactical' || top === 'armor') ? dark : topMat;
    [-11.5, 11.5].forEach(function (z) {
      add(gbox(12, 5, 5), sleeveMat, 5, 28, z);
      if (top === 'hoodie' || top === 'vest') add(gbox(2.6, 5.4, 5.4), trim, 10.6, 28, z);
    });
    if (top === 'tactical') {
      add(gcyl(12.8, 12.8, 3.2, 12), trim, 0, 28, 0); add(gbox(2, 10, 14), trim, 11.6, 24, 0); add(gbox(6, 14, 13), dark, -11, 25, 0);
      [-12, 12].forEach(function (z) { add(gsph(5), dark, 0, 31, z); });
    } else if (top === 'hoodie') {
      const hood = add(gsph(1), topMat, -5, 38, 0); hood.scale.set(7, 8, 9);
      add(gtor(7.5, 1.8, 6.2832), topMat, 0, 35.5, 0, PI2, 0, 0);
      add(gcyl(12.9, 12.9, 2.6, 12), trim, 0, 16, 0);
      const L = String(name || '').trim().charAt(0).toUpperCase() || 'A';
      const lm = new T.MeshBasicMaterial({ map: letterTexture(L, CH[look.a].color), transparent: true }); lm.userData.base = 1; mats.push(lm);
      const plane = new T.Mesh(new T.PlaneGeometry(10, 10), lm); plane.geometry.userData.own = true;
      plane.position.set(-12.8, 25, 0); plane.rotation.y = -PI2; root.add(plane);
    } else if (top === 'jacket') {
      add(gbox(1.6, 17, 9), mk(0xe8d9b0), 11.7, 23.5, 0);
      [-5.6, 5.6].forEach(function (z) { add(gbox(2, 9, 3.4), topMat, 11.5, 29, z, 0, 0, z < 0 ? 0.2 : -0.2); });
      add(gcyl(12.9, 12.9, 2.2, 12), mk(0x5a1a1a), 0, 15.5, 0);
    } else if (top === 'vest') {
      const wh = mk(WHITE);
      [29.5, 24.5].forEach(function (y, i) {
        const w = i ? 8 : 10;
        add(gbox(1.6, 2.6, w), wh, 11.7, y, -w * 0.4, 0.6, 0, 0); add(gbox(1.6, 2.6, w), wh, 11.7, y, w * 0.4, -0.6, 0, 0);
      });
      [18.5, 16].forEach(function (y) { add(gbox(1.8, 1.4, 13), trim, 11.8, y, 0); });
      const pad = add(gsph(1), dark, 0, 32, 12.5); pad.scale.set(7, 5.5, 7.5);
      add(gcyl(12.9, 12.9, 2.4, 12), trim, 0, 15.6, 0);
    } else if (top === 'armor') {
      [-12.5, 12.5].forEach(function (z) { const p = add(gsph(1), metal, 0, 32, z); p.scale.set(7, 5.5, 7.5); });
      add(gbox(2.4, 13, 15), mk(0x4a4562), 11.8, 25, 0); add(gcyl(12.9, 12.9, 2.4, 12), trim, 0, 15.6, 0);
    } else add(gtor(7.2, 1.2, 6.2832), topMat, 0, 35, 0, PI2, 0, 0);

    /* head + masks */
    const headCol = { skull: 0xf3f0e6, webhero: 0xc62828, monkey: 0x8a4b22, clown: 0xf8f8f8 }[look.m] || SHELL;
    const head = add(gsph(1), mk(headCol), 0, 46, 0); head.scale.set(12, 15, 12);
    let headMesh = head;
    const onHead = function (z, y) { const v = 1 - (z / 12) * (z / 12) - ((y - 46) / 15) * ((y - 46) / 15); return v > 0.02 ? 12 * Math.sqrt(v) : null; };
    // place a piece on the face surface: pivot yawed to the surface normal, piece tilted by rx/rz inside it
    const fb = function (geo, mat, z, y, lift, rx, rz) {
      const x = onHead(z, y); if (x == null) return null;
      const pv = new T.Group(); pv.position.set(x, y, z); pv.rotation.y = -Math.atan2(z, x); root.add(pv);
      const m = new T.Mesh(geo, mat); m.position.x = lift == null ? 0.4 : lift; if (rx || rz) m.rotation.set(rx || 0, 0, rz || 0); pv.add(m); return m;
    };
    const lines = function (pts, hex) {
      const lg = new T.BufferGeometry(); lg.setAttribute('position', new T.Float32BufferAttribute(pts, 3)); lg.userData.own = true;
      root.add(new T.LineSegments(lg, new T.LineBasicMaterial({ color: hex })));
    };
    const slit = function (mat, zs, y, rxv) { zs.forEach(function (z) { fb(gbox(2.4, 1.8, 6), mat, z, y, 0.8, z < 0 ? rxv : -rxv); }); };
    const seriousMask = function () {
      [-8, -4, 0, 4, 8].forEach(function (z) { fb(gbox(2.4, 9.5, 4.6), dark, z, 40, 0.8); });
      const beak = fb(gcone(3.2, 8, 4), metal, 0, 41, 3.5, 0, -PI2);
      void beak;
      [-4.6, 4.6].forEach(function (z) { fb(gbox(1.2, 1.8, 5.6), trim, z, 48.6, 0.8, z < 0 ? 0.3 : -0.3); fb(gbox(1.6, 1.2, 7), dark, z, 51.4, 0.9, z < 0 ? -0.28 : 0.28); });
    };
    switch (look.m) {
      case 'scary': {
        const red = mk(0xff2a2a, 0xff2a2a), mouth = mk(0x100008), tooth = mk(WHITE);
        slit(red, [-5, 5], 49, 0.5);
        for (let z = -8; z <= 8; z += 2) fb(gbox(1, 4.4, 2.2), mouth, z, 38.5, 0.5);
        for (let i = 0; i < 7; i++) { const z = -7.5 + i * 2.5; fb(gbox(1.4, 1.7, 1.4), tooth, z, i % 2 ? 40.6 : 36.6, 0.9); }
        break;
      }
      case 'funny': {
        const w = mk(WHITE), b = mk(0x0a0a14), sm = mk(0x2a1a1a);
        [-5.2, 5.2].forEach(function (z) { fb(gsph(3.6), w, z, 49, 1.6); fb(gsph(1.6), b, z * 0.75, 48.2, 4.9); });
        fb(gsph(2.4), mk(0xff9a8a), 0, 44.5, 1.6);
        for (let z = -7; z <= 7; z += 2) fb(gbox(0.9, 1.1, 2.4), sm, z, 38.5 + 0.09 * z * z, 0.2);
        fb(gbox(0.9, 3, 2.4), w, -1.2, 36.6, 0.6); fb(gbox(0.9, 3, 2.4), w, 1.2, 36.6, 0.6);
        break;
      }
      case 'clown': {
        const red = mk(0xe02020), blue = mk(0x2a6bff, 0x102a66);
        fb(gsph(3.4), red, 0, 44, 2);
        [-5.4, 5.4].forEach(function (z) { fb(gbox(0.9, 4, 4), blue, z, 49, 0.3, 0.785); });
        for (let z = -7.5; z <= 7.5; z += 1.9) fb(gbox(1, 1.6, 2.2), red, z, 38.5 + 0.1 * z * z, 0.3);
        [[-2, 56, -9, 0xff7a1a], [-2, 56, 9, 0xff7a1a], [-3, 50, -12.4, 0x35d070], [-3, 50, 12.4, 0x35d070]].forEach(function (h) { const s = add(gsph(5), mk(h[3], h[3] & 0x3f3f3f), h[0], h[1], h[2]); s.scale.set(1, 1, 1); });
        add(gtor(8.5, 2, 6.2832), mk(0xff5ee1), 0, 36.5, 0, PI2, 0, 0);
        break;
      }
      case 'serious': { slit(trim, [], 0, 0); seriousMask(); break; }
      case 'webhero': {
        const w = mk(WHITE, 0x888888), out = mk(0x0a0a10), pts = [];
        const pt = function (a, r) { const z = Math.cos(a) * r * 10, y = 46 + Math.sin(a) * r * 13, x = onHead(z, y); return x == null ? null : [x + 0.25, y, z]; };
        for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + 0.2, p0 = pt(a, 0.12), p1 = pt(a, 0.98); if (p0 && p1) pts.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]); }
        [0.4, 0.7, 0.95].forEach(function (r) { for (let k = 0; k < 16; k++) { const p0 = pt(k * Math.PI / 8, r), p1 = pt((k + 1) * Math.PI / 8, r); if (p0 && p1) pts.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]); } });
        lines(pts, 0x0a0a10);
        [-5.6, 5.6].forEach(function (z) { const rx = z < 0 ? 0.55 : -0.55; fb(gbox(1.0, 6.2, 8.2), out, z, 48.5, 0.5, rx); fb(gbox(1.4, 5.2, 7), w, z, 48.5, 0.7, rx); });
        break;
      }
      case 'skull': {
        const blk = mk(0x0a0a10), tooth = mk(0xfffdf0), glow = mk(accHex, accHex);
        [-5, 5].forEach(function (z) { fb(gbox(1.6, 5, 5), blk, z, 48.4, 0.5); fb(gsph(1.2), glow, z, 48.2, 1); });
        fb(gbox(1.2, 2.6, 2), blk, 0, 43.6, 0.5);
        [-6, -3, 0, 3, 6].forEach(function (z) { fb(gbox(1.4, 3.4, 3), tooth, z, 37.8, 0.3); });
        [-4.5, -1.5, 1.5, 4.5].forEach(function (z) { fb(gbox(1.6, 3.6, 0.4), blk, z, 37.8, 0.4); });
        break;
      }
      case 'shadow': {
        head.visible = false;
        const hood = add(gbox(23, 31, 21), mk(BLACK), 0, 45, 0); headMesh = hood;
        add(gbox(19, 5, 20), dark, -1, 61.5, 0, 0, 0, 0.06);
        const ye = mk(0xffd21f, 0xffb800), re = mk(0xff2a2a, 0xff1a1a), we = mk(WHITE, 0xaaaaaa);
        add(gbox(1.4, 3.8, 4.6), ye, 11.9, 47, 5.2); add(gbox(1.4, 3.8, 1.2), we, 11.9, 47, 8.0);
        add(gbox(1.4, 3.8, 4.6), ye, 11.9, 47, -5.4);
        add(gbox(1.4, 2.4, 2.4), re, 11.9, 51.2, -6.2); add(gbox(1.4, 2.4, 2.4), re, 11.9, 43, -6.2); add(gbox(1.4, 3, 2.4), re, 11.9, 47, -9.4);
        break;
      }
      case 'monkey': {
        const pale = mk(0xf0d8d2), navy = mk(0x0a0e2a), brown = mk(0x5c2f12), cream = mk(0xe8d9b0), patch = mk(0xb36a2e);
        [-5.3, 5.3].forEach(function (z) { fb(gsph(4.3), pale, z, 48.6, 1.2); fb(gsph(1.9), navy, z * 0.8, 48, 4.8); add(gsph(3.6), brown, 0, 47, z < 0 ? -12.6 : 12.6); });
        fb(gsph(2.2), brown, 0, 44.5, 1.4);
        const mz = fb(gsph(1), cream, 0, 40.2, 0.4); if (mz) mz.scale.set(3, 4, 7);
        for (let i = 0; i < 12; i++) { const z = ((i * 37) % 17) - 8, y = 40 + ((i * 53) % 20); fb(gbox(0.8, 2.6, 2.6), patch, z, y, 0.2); }
        break;
      }
      case 'spiky': {
        seriousMask();
        const hair = mk(0xb04dff, 0x5a1fa0);
        for (let i = 0; i < 9; i++) {
          const a = i / 9 * Math.PI * 2, tall = i === 0 ? 1.4 : 1, d = new T.Vector3(Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55).normalize();
          const s = add(gcone(3.4, 16 * tall, 5), hair, Math.cos(a) * 5.5 + d.x * 8 * tall, 56.5 + d.y * 8 * tall, Math.sin(a) * 5.5 + d.z * 8 * tall);
          s.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d);
        }
        break;
      }
      default: { // cracked classic
        slit(trim, [], 0, 0);
        [-5.4, 5.4].forEach(function (z, i) { add(gbox(2.6, 3.2, 5.4), trim, 10.4, 48, z, i ? -0.38 : 0.38, 0, 0); });
        const pts = []; let prev = null;
        for (let i = 0; i <= 8; i++) { const z = -8 + i * 2, y = i % 2 ? 38.5 : 41.5, x = onHead(z, y); if (x == null) continue; const p = [x * 1.015, y, z]; if (prev) pts.push(prev[0], prev[1], prev[2], p[0], p[1], p[2]); prev = p; }
        [[-3, 56, 4, 51], [3, 55, 7, 50], [6, 52, -2, 45]].forEach(function (c) { const x1 = onHead(c[0], c[1]), x2 = onHead(c[2], c[3]); if (x1 != null && x2 != null) pts.push(x1, c[1], c[0], x2, c[3], c[2]); });
        lines(pts, 0x14101a);
      }
    }

    /* weapon mount */
    const gun = new T.Group(); gun.position.set(13, 25, 11); root.add(gun);
    /* ground bits */
    const shadow = new T.Mesh(GEO.shadow, mkB(0x000000, 0.35)); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.6; g.add(shadow);
    const ringMat = mkB(0xffffff, 0.8);
    const ring = new T.Mesh(GEO.ring, ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 1.2; ring.visible = false; g.add(ring);
    const shield = new T.Mesh(GEO.shield, mkB(0x9ad0ff, 0.22)); shield.position.y = 26; shield.visible = false; g.add(shield);
    const ice = new T.Mesh(GEO.ice, mkB(0xaee8ff, 0.45)); ice.position.y = 29; ice.visible = false; g.add(ice);
    return { g: g, root: root, legs: legs, mats: mats, head: headMesh, torso: torso, ring: ring, ringMat: ringMat, shield: shield, ice: ice,
      sig: lookSig(look, name), last: null, lastT: 0, phase: 0, lift: 0, flash: 0, alpha: 1, gun: gun, wid: null };
  }

  /* ---------- weapon models (every weapon has its own silhouette + accent colour) ---------- */
  const GC = {};
  function gbox(w, h, d) { const k = 'b' + w + '_' + h + '_' + d; return GC[k] || (GC[k] = new THREE.BoxGeometry(w, h, d)); }
  function gcyl(rt, rb, h, sg) { const k = 'c' + rt + '_' + rb + '_' + h + '_' + sg; return GC[k] || (GC[k] = new THREE.CylinderGeometry(rt, rb, h, sg || 10)); }
  function gsph(r) { const k = 's' + r; return GC[k] || (GC[k] = new THREE.SphereGeometry(r, 12, 10)); }
  function gcone(r, h, sg) { const k = 'k' + r + '_' + h + '_' + sg; return GC[k] || (GC[k] = new THREE.ConeGeometry(r, h, sg || 6)); }
  function gtor(r, t, arc) { const k = 't' + r + '_' + t + '_' + arc; return GC[k] || (GC[k] = new THREE.TorusGeometry(r, t, 6, 22, arc)); }
  const WCOL = { pistol: 0xffe36b, rifle: 0x3dff7a, scatter: 0xff9f43, plasma: 0xff5ee1, hammer: 0x3da5ff, blades: 0x7ff0ff, bow: 0x7fffd4, grenade: 0xffd24d, omelette: 0xffcf33 };

  function makeWeapon(id) {
    const T = THREE, g = new T.Group(), col = WCOL[id] || 0xffffff, PI2 = Math.PI / 2;
    const dark = function () { return new T.MeshLambertMaterial({ color: 0x1a1626 }); };
    const metal = function () { return new T.MeshLambertMaterial({ color: 0x4a4562 }); };
    const glow = function (c) { const v = c == null ? col : c; return new T.MeshLambertMaterial({ color: v, emissive: v }); };
    const add = function (geo, mat, x, y, z, rx, ry, rz) {
      const m = new T.Mesh(geo, mat); m.position.set(x, y, z);
      if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
      g.add(m); return m;
    };
    switch (id) {
      case 'rifle':
        add(gbox(28, 5, 4.6), metal(), 4, 0, 0); add(gbox(10, 7, 4), dark(), -14, -1.5, 0); add(gbox(12, 6, 5), dark(), 14, 0, 0);
        add(gcyl(1.5, 1.5, 14, 8), dark(), 23, 1, 0, 0, 0, PI2); add(gbox(5, 11, 4), dark(), 3, -7.5, 0, 0, 0, 0.15);
        add(gcyl(2.1, 2.1, 10, 10), dark(), 5, 5.5, 0, 0, 0, PI2); add(gcyl(2, 2, 0.8, 10), glow(), 10.4, 5.5, 0, 0, 0, PI2);
        add(gbox(12, 1, 4.8), glow(), 9, 2.8, 0); break;
      case 'scatter':
        add(gcyl(2.7, 2.7, 22, 10), metal(), 7, 1.5, -3, 0, 0, PI2); add(gcyl(2.7, 2.7, 22, 10), metal(), 7, 1.5, 3, 0, 0, PI2);
        add(gcyl(3, 3, 1.6, 10), glow(), 18.5, 1.5, -3, 0, 0, PI2); add(gcyl(3, 3, 1.6, 10), glow(), 18.5, 1.5, 3, 0, 0, PI2);
        add(gbox(10, 8, 6), dark(), -8, -2, 0, 0, 0, -0.15); add(gbox(8, 4.5, 9), glow(), 6, -2.8, 0); add(gbox(4, 4, 9), dark(), 0, 1, 0); break;
      case 'plasma':
        add(gcyl(5, 5, 26, 12), metal(), 3, 2, 0, 0, 0, PI2); add(gcyl(6, 6, 4, 12), dark(), -10, 2, 0, 0, 0, PI2);
        add(gtor(5.8, 1, 6.2832), glow(), -2, 2, 0, 0, PI2, 0); add(gtor(5.8, 1, 6.2832), glow(), 8, 2, 0, 0, PI2, 0);
        add(gsph(7), glow(), 19, 2, 0); add(gbox(5, 9, 4), dark(), -4, -6, 0); break;
      case 'hammer':
        add(gcyl(1.8, 1.8, 38, 8), new T.MeshLambertMaterial({ color: 0x4a3426 }), 0, 0, 0, 0, 0, PI2);
        add(gbox(12, 15, 11), metal(), 19, 0, 0); add(gbox(10, 10, 1.2), glow(), 19, 0, 5.7); add(gbox(10, 10, 1.2), glow(), 19, 0, -5.7);
        add(gbox(2, 4, 2), glow(), 19, 9.5, 0); add(gbox(2, 4, 2), glow(), 19, -9.5, 0); add(gbox(8, 2.6, 2.6), glow(), -12, 0, 0); break;
      case 'blades':
        [-6, 6].forEach(function (z, i) {
          const sp = i ? 0.14 : -0.14;
          add(gbox(26, 1.4, 5), new T.MeshLambertMaterial({ color: 0xcfe9ff, emissive: 0x335a66 }), 7, 0, z, 0, sp, 0);
          add(gbox(26, 0.6, 1), glow(), 7, 0.9, z, 0, sp, 0); add(gbox(7, 3, 3), dark(), -9, 0, z, 0, sp, 0); add(gbox(2, 4, 7), glow(), -5, 0, z, 0, sp, 0);
        }); break;
      case 'bow':
        add(gtor(15, 1.5, Math.PI), new T.MeshLambertMaterial({ color: 0x234d46, emissive: col, emissiveIntensity: 0.4 }), -4, 0, 0, 0, 0, -PI2);
        add(gbox(0.6, 30, 0.6), glow(), -4, 0, 0); add(gbox(26, 1, 1), new T.MeshLambertMaterial({ color: 0xeeeeee }), 5, 0, 0);
        add(gbox(4, 2.4, 2.4), glow(), 18.5, 0, 0); add(gbox(3, 8, 4), dark(), 11, 0, 0); break;
      case 'grenade':
        add(gcyl(4.2, 4.2, 22, 12), metal(), 5, 1, 0, 0, 0, PI2); add(gcyl(5.4, 5.4, 3, 12), glow(), 16.5, 1, 0, 0, 0, PI2);
        add(gcyl(6.5, 6.5, 8, 12), dark(), -1, -1, 0, 0, 0, PI2); add(gcyl(6.8, 6.8, 1.2, 12), glow(), -3.5, -1, 0, 0, 0, PI2); add(gcyl(6.8, 6.8, 1.2, 12), glow(), 1.5, -1, 0, 0, 0, PI2);
        add(gbox(5, 9, 4), dark(), -6, -7, 0); add(gbox(3, 3, 2), glow(), 9, 6, 0); break;
      case 'omelette': {
        const body = add(gsph(1), new T.MeshLambertMaterial({ color: 0xf0ead8, emissive: 0x5a4a10 }), 2, 0, 0); body.scale.set(14, 9.5, 9.5);
        [-3.6, 0, 3.6].forEach(function (z) { add(gcyl(1.8, 1.8, 12, 8), glow(), 16, 0, z, 0, 0, PI2); });
        add(gsph(3.4), glow(), 0, 9, 0); add(gbox(5, 8, 4), dark(), -6, -8, 0); add(gbox(8, 0.8, 0.8), dark(), 3, 4, 7.6, 0, 0, 0.5); break;
      }
      default: // pistol
        add(gbox(18, 5.5, 4.6), metal(), 3, 0, 0); add(gbox(5, 10, 4), dark(), -3, -6.5, 0, 0, 0, -0.2);
        add(gbox(4, 3, 3.2), glow(), 12.5, 0.6, 0); add(gbox(10, 1.2, 4.8), glow(), 2, 3.2, 0);
    }
    return g;
  }

  function setWeapon(e, id) {
    while (e.gun.children.length) { const c = e.gun.children[0]; e.gun.remove(c); disposeObj(c); }
    e.gun.add(makeWeapon(id || 'pistol')); e.wid = id;
  }

  /* ---------- menu / outfit previews: a slowly turning egg on the home screen ---------- */
  const previews = []; let pvLoop = 0;
  function preview(canvas, getSpec) {
    if (!supported() || !canvas) return false;
    try {
      const T = THREE; if (!GEO) GEO = makeGeo();
      const r = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
      r.setClearColor(0x000000, 0);
      const sc = new T.Scene(), cm = new T.PerspectiveCamera(32, 1, 1, 600);
      sc.add(new T.AmbientLight(0x9a88c8, 1.0));
      const d = new T.DirectionalLight(0xffffff, 0.9); d.position.set(60, 120, 100); sc.add(d);
      sc.add(new T.HemisphereLight(0xa45cff, 0x1a0f2a, 0.5));
      const glow = new T.Mesh(new T.CircleGeometry(36, 32), new T.MeshBasicMaterial({ color: 0xa45cff, transparent: true, opacity: 0.3 }));
      glow.rotation.x = -Math.PI / 2; glow.position.y = 0.2; sc.add(glow);
      previews.push({ canvas: canvas, r: r, sc: sc, cm: cm, getSpec: getSpec, egg: null, sig: '', w: 0, h: 0 });
      if (!pvLoop) pvLoop = requestAnimationFrame(pvTick);
      return true;
    } catch (e) { return false; }
  }
  function pvTick(now) {
    pvLoop = requestAnimationFrame(pvTick);
    for (let i = 0; i < previews.length; i++) {
      const p = previews[i], w = p.canvas.clientWidth, h = p.canvas.clientHeight;
      if (!w || !h) continue; // screen not visible
      if (w !== p.w || h !== p.h) {
        p.w = w; p.h = h; p.r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        p.r.setSize(w, h, false); p.cm.aspect = w / h; p.cm.updateProjectionMatrix();
      }
      const spec = p.getSpec(), sg = lookSig(spec.look, spec.name);
      if (sg !== p.sig) {
        if (p.egg) { p.sc.remove(p.egg.g); disposeObj(p.egg.g); }
        p.egg = makeEgg(spec.look, spec.name); setWeapon(p.egg, 'pistol'); p.sc.add(p.egg.g); p.sig = sg;
      }
      const t = now / 1000;
      p.egg.g.rotation.y = spec.spin ? -Math.PI / 2 + t * 0.9 : -Math.PI / 2 + 0.45 + Math.sin(t * 0.9) * 0.5;
      p.egg.root.position.y = Math.abs(Math.sin(t * 1.8)) * 2;
      const sw = Math.sin(t * 1.8) * 0.15; p.egg.legs[0].rotation.z = sw; p.egg.legs[1].rotation.z = -sw;
      p.cm.position.set(0, 50, 150); p.cm.lookAt(0, 30, 0);
      p.r.render(p.sc, p.cm);
    }
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
      const owner = o.clone ? G0.players[o.o] : pl, lk = (owner && owner.look) || MECOS.DEFAULT_LOOK, nm = owner ? owner.name : '';
      const sig = lookSig(lk, nm);
      let e = ents[key];
      if (!e || e.sig !== sig) {
        if (e) { scene.remove(e.g); disposeObj(e.g); }
        e = ents[key] = makeEgg(lk, nm); scene.add(e.g);
      }
      seen[key] = 1;
      const wid = o.clone ? 'pistol' : (o.w || 'pistol'); if (e.wid !== wid) setWeapon(e, wid);
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
          ? (function () { const w = makeWeapon(pk[5]); w.scale.set(1.9, 1.9, 1.9); return w; })()
          : kind === 'mystery'
            ? (function () { const m = new T.Mesh(GEO.ball, new T.MeshLambertMaterial({ color: 0xfff7e0, emissive: 0x6b4fb0 })); m.scale.set(8, 11, 8); return m; })()
            : new T.Mesh(GEO.octa, new T.MeshLambertMaterial({ color: col, emissive: new T.Color(col).multiplyScalar(0.7) }));
        body.position.y = 22; g.add(body);
        if (kind === 'weapon') { const beam = new T.Mesh(gcyl(2.4, 2.4, 120, 8), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.2, depthWrite: false })); beam.position.y = 60; g.add(beam); }
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

  return { supported: supported, init: init, clear: clear, resize: resize, render: render, project: project, bindLook: bindLook, preview: preview };
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
