'use strict';
// Add a weapon = add an entry here. kind: gun | launcher | melee
const WEAPONS = {
  pistol:  { id: 'pistol', name: 'Egg-ergy Pistol', kind: 'gun', dmg: 14, rate: 4, mag: 12, reload: 1.0, pellets: 1, spread: 0.03, speed: 950, range: 520, rarity: 'starter', weight: 0, infinite: true },
  rifle:   { id: 'rifle', name: 'Tactical Scrambler', kind: 'gun', dmg: 11, rate: 9, mag: 30, reload: 1.7, pellets: 1, spread: 0.06, speed: 1000, range: 640, rarity: 'rare', weight: 3 },
  scatter: { id: 'scatter', name: 'Scatter Blaster', kind: 'gun', dmg: 9, rate: 1.3, mag: 6, reload: 1.9, pellets: 7, spread: 0.28, speed: 850, range: 300, rarity: 'rare', weight: 3 },
  plasma:  { id: 'plasma', name: 'Plasma Launcher', kind: 'launcher', proj: 'plasma', dmg: 42, rate: 0.9, mag: 4, reload: 2.2, speed: 430, range: 700, radius: 80, rarity: 'epic', weight: 1.6 },
  hammer:  { id: 'hammer', name: 'Shock Hammer', kind: 'melee', dmg: 40, rate: 1.5, range: 80, arc: 1.4, knock: 420, rarity: 'epic', weight: 2 },
  blades:  { id: 'blades', name: 'Dual Blades', kind: 'melee', dmg: 17, rate: 4.2, range: 62, arc: 1.6, knock: 90, rarity: 'rare', weight: 3 },
  bow:     { id: 'bow', name: 'Energy Bow', kind: 'gun', proj: 'arrow', dmg: 52, rate: 1.0, mag: 5, reload: 1.8, pellets: 1, spread: 0, speed: 1150, range: 800, rarity: 'epic', weight: 2 },
  grenade: { id: 'grenade', name: 'Grenade Launcher', kind: 'launcher', proj: 'grenade', dmg: 50, rate: 0.8, mag: 4, reload: 2.4, speed: 380, fuse: 1.1, radius: 95, rarity: 'epic', weight: 1.6 },
  omelette:{ id: 'omelette', name: 'The Omelette-Inator', kind: 'launcher', proj: 'egg', dmg: 34, rate: 2.2, mag: 8, reload: 2.6, speed: 340, fuse: 2.0, radius: 70, rarity: 'legendary', weight: 0.6 }
};
const WEAPON_IDS = Object.keys(WEAPONS);
const PICKABLE = WEAPON_IDS.filter(id => WEAPONS[id].weight > 0);

// Compact info the client needs for HUD / pickups
const WEAPON_INFO = WEAPON_IDS.map(id => {
  const w = WEAPONS[id];
  return { id, name: w.name, kind: w.kind, mag: w.mag || 0, rarity: w.rarity, dmg: w.dmg, rate: w.rate, range: w.range, reload: w.reload || 0 };
});

module.exports = { WEAPONS, WEAPON_IDS, PICKABLE, WEAPON_INFO };
