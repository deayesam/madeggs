'use strict';
// Add a map = add an entry to MAPS. Rects are written for one quadrant and mirrored for fairness.
const W_ = (x, y, w, h) => ({ x, y, w, h, t: 'wall' });
const L_ = (x, y, w, h) => ({ x, y, w, h, t: 'low' });

function mirrorRects(W, H, rects) {
  const out = [], seen = new Set();
  const add = r => {
    const k = [r.x, r.y, r.w, r.h, r.t].join(',');
    if (!seen.has(k)) { seen.add(k); out.push(r); }
  };
  for (const r of rects) {
    add(r);
    add({ ...r, x: W - r.x - r.w });
    add({ ...r, y: H - r.y - r.h });
    add({ ...r, x: W - r.x - r.w, y: H - r.y - r.h });
  }
  return out;
}
function mirrorPts(W, H, pts) {
  const out = [], seen = new Set();
  const add = p => { const k = p.join(','); if (!seen.has(k)) { seen.add(k); out.push(p); } };
  for (const [x, y] of pts) { add([x, y]); add([W - x, y]); add([x, H - y]); add([W - x, H - y]); }
  return out;
}

const MAPS = {};

// ---------- EGG FACTORY ----------
(function () {
  const W = 1400, H = 900;
  const base = [
    // NW bunker with two doorways
    W_(120, 100, 260, 24), W_(120, 100, 24, 200), W_(120, 276, 100, 24), W_(290, 276, 90, 24),
    W_(356, 100, 24, 70), W_(356, 230, 24, 70),
    // L-shaped corridor wall
    W_(520, 180, 24, 200), W_(520, 180, 160, 24),
    // jumpable cover
    L_(400, 380, 60, 30), L_(640, 380, 50, 50), L_(250, 520, 70, 30)
  ];
  MAPS.factory = {
    id: 'factory', name: 'Egg Factory', W, H,
    walls: mirrorRects(W, H, base),
    spawns: [[60, 60], [1340, 60], [60, 840], [1340, 840], [700, 50], [700, 850], [50, 450], [1350, 450]],
    weaponSpots: mirrorPts(W, H, [[250, 190]]).concat([[700, 450], [700, 110], [700, 790]]),
    itemSpots: mirrorPts(W, H, [[450, 300], [280, 380]]).concat([[700, 330], [700, 570]]),
    decor: {
      pads: [{ x: 700, y: 450, r: 95, c: '#a45cff' }, { x: 700, y: 110, r: 40, c: '#ffcb2f' }, { x: 700, y: 790, r: 40, c: '#38e07b' }],
      neon: [{ x1: 40, y1: 40, x2: 1360, y2: 40, c: '#a45cff' }, { x1: 40, y1: 860, x2: 1360, y2: 860, c: '#3b9dff' },
             { x1: 40, y1: 40, x2: 40, y2: 860, c: '#38e07b' }, { x1: 1360, y1: 40, x2: 1360, y2: 860, c: '#ffcb2f' }],
      graffiti: [
        { x: 700, y: 640, text: 'CRACK IT', s: 54, rot: -0.04, c: '#ffcb2f' },
        { x: 260, y: 440, text: 'MAD EGGS', s: 40, rot: -0.12, c: '#a45cff' },
        { x: 1140, y: 470, text: 'NO REFUNDS', s: 34, rot: 0.1, c: '#38e07b' },
        { x: 700, y: 250, text: 'SUNNY SIDE UP', s: 30, rot: 0.02, c: '#3b9dff' },
        { x: 190, y: 740, text: 'OMELETTE ZONE', s: 28, rot: 0.06, c: '#ff6bd6' }
      ],
      logos: [{ x: 700, y: 450, r: 60 }, { x: 200, y: 200, r: 34 }, { x: 1200, y: 700, r: 34 }]
    }
  };
})();

// ---------- NEON ALLEY ----------
(function () {
  const W = 1500, H = 760;
  const base = [
    W_(160, 150, 260, 24), W_(160, 150, 24, 140),
    W_(520, 90, 24, 150), W_(520, 330, 130, 24),
    L_(600, 200, 60, 30), L_(340, 420, 70, 30), L_(250, 300, 50, 50)
  ];
  const walls = mirrorRects(W, H, base);
  walls.push(W_(690, 340, 120, 80)); // central block
  MAPS.alley = {
    id: 'alley', name: 'Neon Alley', W, H, walls,
    spawns: [[70, 70], [1430, 70], [70, 690], [1430, 690], [750, 60], [750, 700], [60, 380], [1440, 380]],
    weaponSpots: mirrorPts(W, H, [[250, 230]]).concat([[750, 250], [750, 510]]),
    itemSpots: mirrorPts(W, H, [[450, 380], [600, 120], [380, 230]]),
    decor: {
      pads: [{ x: 750, y: 380, r: 120, c: '#3b9dff' }],
      neon: [{ x1: 40, y1: 40, x2: 1460, y2: 40, c: '#ff6bd6' }, { x1: 40, y1: 720, x2: 1460, y2: 720, c: '#38e07b' },
             { x1: 40, y1: 40, x2: 40, y2: 720, c: '#ffcb2f' }, { x1: 1460, y1: 40, x2: 1460, y2: 720, c: '#a45cff' }],
      graffiti: [
        { x: 750, y: 600, text: 'ALLEY OOP', s: 52, rot: -0.03, c: '#3b9dff' },
        { x: 300, y: 560, text: 'LAWRENCE WAS HERE', s: 26, rot: 0.08, c: '#3b9dff' },
        { x: 1200, y: 200, text: 'BULALA WAS LOUDER', s: 26, rot: -0.08, c: '#a45cff' },
        { x: 750, y: 170, text: 'EGG-CELLENT', s: 34, rot: 0.03, c: '#ffcb2f' }
      ],
      logos: [{ x: 750, y: 380, r: 50 }, { x: 150, y: 600, r: 30 }, { x: 1350, y: 160, r: 30 }]
    }
  };
})();

const MAP_LIST = Object.values(MAPS).map(m => ({ id: m.id, name: m.name }));
module.exports = { MAPS, MAP_LIST };
