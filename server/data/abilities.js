'use strict';
// Add an ability = add one def({...}) call. Abilities are assigned randomly per player per match.
// activate(g, p) gets the Game (g) and the player (p). `charge` = seconds to fill the meter by time alone.
const ABILITIES = {};
const def = o => { ABILITIES[o.id] = o; };
const rnd = (a, b) => a + Math.random() * (b - a);

def({ id: 'phantom', name: 'Phantom Shift', icon: '\u{1F47B}', color: '#c9b6ff', charge: 22,
  desc: 'Untouchable for 3 seconds. Bullets just say hi.',
  activate(g, p) { g.addStatus(p, 'phantom', 3); g.fx('phantom', p.x, p.y); } });

def({ id: 'thunder', name: 'Thunder Crash', icon: '\u26A1', color: '#ffe94d', charge: 28,
  desc: 'Three lightning strikes land where you aim.',
  activate(g, p) {
    const d = Math.min(300, Math.max(60, g.ray(p, p.aim, 300) - 12));
    const cx = p.x + Math.cos(p.aim) * d, cy = p.y + Math.sin(p.aim) * d;
    const pts = [[cx, cy], [cx + rnd(-90, 90), cy + rnd(-90, 90)], [cx + rnd(-90, 90), cy + rnd(-90, 90)]];
    pts.forEach((pt, i) => {
      const delay = 0.8 + i * 0.3;
      g.ev('warn', { x: pt[0], y: pt[1], r: 100, d: delay });
      g.later(delay, () => { g.ev('thunder', { x: pt[0], y: pt[1], r: 100 }); g.areaDamage(p, pt[0], pt[1], 100, 55, 'thunder'); });
    });
  } });

def({ id: 'timelock', name: 'Time Lock', icon: '\u23F1\uFE0F', color: '#7ee8ff', charge: 26,
  desc: 'Freeze the enemy you aim at for 2.2 seconds.',
  activate(g, p) {
    const t = g.target(p, 540);
    if (!t) return g.refund(p, 55, 'Time Lock found nobody. Awkward.');
    g.addStatus(t, 'timelock', 2.2); t.fire = false;
    g.fx('timelock', t.x, t.y);
  } });

def({ id: 'clone', name: 'Shadow Clone', icon: '\u{1F465}', color: '#9aa0ff', charge: 22,
  desc: 'Two decoys run off. One shot pops each.',
  activate(g, p) { g.addClone(p); g.addClone(p); g.fx('clone', p.x, p.y); } });

def({ id: 'fortress', name: 'Iron Fortress', icon: '\u{1F6E1}\uFE0F', color: '#9ad0ff', charge: 28,
  desc: 'A 100-point shield for 7 seconds.',
  activate(g, p) { p.shield = 100; p.shieldUntil = g.t + 7; g.fx('fortress', p.x, p.y); } });

def({ id: 'phoenix', name: 'Phoenix Rebirth', icon: '\u{1F525}', color: '#ff8a3d', charge: 45, passive: true,
  desc: 'Passive. Once the meter is full, your next elimination is cancelled.',
  activate(g, p) { /* passive: handled in Game.eliminate */ } });

def({ id: 'gravity', name: 'Gravity Well', icon: '\u{1F300}', color: '#c06bff', charge: 26,
  desc: 'Drops a well that drags enemies toward it for 3 seconds.',
  activate(g, p) {
    const d = Math.min(240, Math.max(40, g.ray(p, p.aim, 240) - 12));
    const x = p.x + Math.cos(p.aim) * d, y = p.y + Math.sin(p.aim) * d;
    g.wells.push({ x, y, r: 230, until: g.t + 3.2, owner: p.id });
    g.fx('gravity', x, y);
  } });

def({ id: 'berserk', name: 'Berserk Mode', icon: '\u{1F621}', color: '#ff4d5e', charge: 30,
  desc: 'Faster, harder, louder for 6 seconds.',
  activate(g, p) { g.addStatus(p, 'bk', 6); g.fx('berserk', p.x, p.y); } });

def({ id: 'healing', name: 'Healing Aura', icon: '\u{1F49A}', color: '#58f0a0', charge: 24,
  desc: 'Heals you (and teammates nearby) over 5 seconds.',
  activate(g, p) { g.addStatus(p, 'au', 5); g.fx('healing', p.x, p.y); } });

def({ id: 'frost', name: 'Frost Prison', icon: '\u2744\uFE0F', color: '#aee8ff', charge: 24,
  desc: 'Trap an enemy in ice for 3 seconds. They can shoot, not walk.',
  activate(g, p) {
    const t = g.target(p, 480);
    if (!t) return g.refund(p, 55, 'Frost Prison hit nothing but vibes.');
    g.addStatus(t, 'fr', 3); g.fx('frost', t.x, t.y);
  } });

def({ id: 'portal', name: 'Void Portal', icon: '\u{1F573}\uFE0F', color: '#d36bff', charge: 18,
  desc: 'Teleport up to 380 units where you aim.',
  activate(g, p) {
    const d = Math.min(380, g.ray(p, p.aim, 380) - p.r - 4);
    if (d < 40) return g.refund(p, 60, 'Void Portal: there is a wall there.');
    g.fx('portal', p.x, p.y);
    p.x += Math.cos(p.aim) * d; p.y += Math.sin(p.aim) * d;
    g.settle(p);
    g.fx('portal', p.x, p.y);
  } });

def({ id: 'chaos', name: 'Chaos Gamble', icon: '\u{1F3B2}', color: '#ff6bd6', charge: 16,
  desc: 'Fires a completely random ability. May be great. May be silly.',
  activate(g, p) {
    const pool = Object.keys(ABILITIES).filter(id => id !== 'chaos' && id !== 'phoenix');
    const a = ABILITIES[pool[Math.floor(Math.random() * pool.length)]];
    g.ev('feed', { text: `\u{1F3B2} ${p.name}'s CHAOS GAMBLE rolled ${a.name}!` });
    a.activate(g, p);
  } });

const ABILITY_IDS = Object.keys(ABILITIES);
const ABILITY_INFO = ABILITY_IDS.map(id => {
  const a = ABILITIES[id];
  return { id, name: a.name, icon: a.icon, color: a.color, desc: a.desc, passive: !!a.passive };
});

module.exports = { ABILITIES, ABILITY_IDS, ABILITY_INFO };
