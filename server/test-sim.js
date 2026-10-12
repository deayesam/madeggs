'use strict';
// Headless smoke test: runs full matches with random inputs and fires every ability.
const { Game, TICK } = require('./game');
const { ABILITY_IDS } = require('./data/abilities');
const { PICKABLE } = require('./data/weapons');
const assert = require('assert');

function run(mode, map, secs) {
  const lobby = [0, 1, 2, 3].map(i => ({ id: i + 1, name: 'P' + i, char: i, team: i % 2 }));
  const g = new Game({ mode, map, duration: 1, abilities: true, pickups: true }, lobby);
  let revealedAb = null;
  for (let t = 0; t < secs * TICK; t++) {
    for (const p of g.players.values()) {
      g.setInput(p.id, { s: t, mx: Math.sin(t / 20 + p.id), my: Math.cos(t / 33 + p.id), a: (t / 15 + p.id) % 6.28, f: t % 3 !== 0 });
      if (t % 45 === p.id) g.action(p.id, 'jump');
      if (t % 60 === p.id) { p.meter = 100; g.action(p.id, 'ability'); }
      if (t % 70 === p.id) g.action(p.id, 'interact');
      if (t % 90 === p.id) g.action(p.id, 'reload');
    }
    g.tick();
    for (const e of g.events) if (e.k === 'reveal') revealedAb = e.ab;
    const s = g.snapshots();
    for (const str of s.values()) JSON.parse(str);
    if (g.phase === 'ended') break;
  }
  return { g, revealedAb };
}

for (const map of ['factory', 'alley']) for (const mode of ['ffa', 'tdm']) {
  const { g, revealedAb } = run(mode, map, 75);
  assert(revealedAb, 'abilities revealed');
  const ks = [...g.players.values()].reduce((a, p) => a + p.stats.kills, 0);
  console.log(map, mode, 'phase', g.phase, 'kills', ks, 'ab uses', [...g.players.values()].map(p => p.stats.abil).join(','), JSON.stringify(revealedAb));
  assert(g.phase === 'ended', 'match ended');
  assert(g.results && g.results.ranking.length === 4);
}

// Every ability activates without throwing, for every owner position.
for (const id of ABILITY_IDS) {
  const lobby = [0, 1].map(i => ({ id: i + 1, name: 'P' + i, char: i, team: i }));
  const g = new Game({ mode: 'ffa', map: 'factory', duration: 1, abilities: true, pickups: true }, lobby);
  for (let i = 0; i < 400; i++) g.tick();
  const p = g.players.get(1); p.ability = id; p.meter = 100; g.revealed = true;
  g.players.get(2).x = p.x + 150; g.players.get(2).y = p.y;
  g.action(1, 'ability');
  for (let i = 0; i < 150; i++) g.tick();
  console.log('ability ok:', id);
}
// Abilities are random per player, never tied to character
const seen = {};
for (let n = 0; n < 40; n++) {
  const g = new Game({ mode: 'ffa', map: 'factory', duration: 1, abilities: true, pickups: false }, [0, 1, 2, 3].map(i => ({ id: i + 1, name: 'P', char: i, team: 0 })));
  for (const p of g.players.values()) (seen[p.char] = seen[p.char] || new Set()).add(p.ability);
}
for (const c of Object.keys(seen)) { console.log('char', c, 'got', seen[c].size, 'different abilities over 40 matches'); assert(seen[c].size > 4); }
console.log('ALL OK');
