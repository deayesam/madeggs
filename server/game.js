'use strict';
const phys = require('../shared/physics');
const { WEAPONS, PICKABLE } = require('./data/weapons');
const { ABILITIES, ABILITY_IDS } = require('./data/abilities');
const { MAPS } = require('./data/maps');

const TICK = 30, DT = 1 / TICK;
const BASE_SPEED = 230, PLAYER_R = 18, MAX_HP = 100;
const RESPAWN = 3.5, SPAWN_INV = 2;
const REVEAL = { listen: 3.5, at: 6.5, end: 10, plain: 4 };
const ITEM_KINDS = { health: 3, shield: 2, speed: 2, damage: 2, charge: 2, mystery: 2 };

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function weighted(table) {
  const keys = Object.keys(table); let tot = 0; for (const k of keys) tot += table[k];
  let r = Math.random() * tot; for (const k of keys) { r -= table[k]; if (r <= 0) return k; }
  return keys[0];
}

const KILL_LINES = [
  (k, v) => `${k} scrambled ${v}`, (k, v) => `${k} hard-boiled ${v}`, (k, v) => `${k} turned ${v} sunny-side up`,
  (k, v) => `${k} cracked ${v} wide open`, (k, v) => `${v} got poached by ${k}`, (k, v) => `${k} made an omelette out of ${v}`,
  (k, v) => `${k} benedicted ${v}`, (k, v) => `${v} was egg-sterminated by ${k}`
];
const TAG_LINES = {
  hammer: (k, v) => `${k} shock-hammered ${v} into next week`, bow: (k, v) => `${k} Robin-Egged ${v}`,
  grenade: (k, v) => `${k} egg-ploded ${v}`, omelette: (k, v) => `${k} omelette-inated ${v}`,
  plasma: (k, v) => `${k} plasma-poached ${v}`, blades: (k, v) => `${k} sliced ${v} like fresh bread`,
  scatter: (k, v) => `${k} scattered ${v} across three zip codes`,
  thunder: (k, v) => `${v} got zapped by ${k}'s Thunder Crash`, boom: (k, v) => `${k} egg-sploded ${v}`
};
const ITEM_TEXT = {
  health: ['Free-Range First Aid', 'Emergency Chicken Soup', 'Yolk Medic'],
  shield: ['Eggshell Armor', 'Extra-Crispy Shell', 'Bubble-Wrap Yolk'],
  speed: ['Turbo Yolk', 'Caffeinated Albumen', 'Roadrunner Roe'],
  damage: ['Spicy Yolk Sauce', 'Hot Sauce Overdose', 'Angry Albumen'],
  charge: ['Ability Egg-nergy', 'Yolk Battery', 'Cosmic Cluck']
};

class Game {
  constructor(cfg, lobbyPlayers) {
    this.cfg = cfg;
    this.map = MAPS[cfg.map] || MAPS.factory;
    this.mode = cfg.mode === 'tdm' ? 'tdm' : 'ffa';
    this.abilitiesOn = !!cfg.abilities;
    this.pickupsOn = !!cfg.pickups;
    this.t = 0; this.tickN = 0;
    this.phase = 'reveal'; this.phaseT = 0; this.revealed = false;
    this.timeLeft = cfg.duration * 60;
    this.players = new Map();
    this.projs = []; this.clones = []; this.wells = []; this.pickups = []; this.timers = []; this.events = [];
    this.nid = 1; this.pkVersion = 1;
    this.score = [0, 0];
    this.results = null;

    // spawn slots
    let spawns = this.map.spawns.slice();
    if (this.mode === 'tdm') {
      spawns.sort((a, b) => a[0] - b[0]);
      this.spawnPool = [shuffle(spawns.slice(0, Math.ceil(spawns.length / 2))), shuffle(spawns.slice(Math.ceil(spawns.length / 2)))];
    } else shuffle(spawns);
    const abIds = shuffle(ABILITY_IDS.slice());
    let ai = 0; const used = [0, 0];
    for (const lp of lobbyPlayers) {
      const p = this.newPlayer(lp);
      const sp = this.mode === 'tdm' ? this.spawnPool[p.team][used[p.team]++ % this.spawnPool[p.team].length] : spawns[ai % spawns.length];
      p.x = sp[0]; p.y = sp[1];
      p.ability = this.abilitiesOn ? abIds[ai % abIds.length] : null;
      ai++;
      this.players.set(p.id, p);
    }
    if (this.pickupsOn) this.initPickups();
    this.ev('feed', { text: 'Match starting. Nobody knows what they are holding...' });
  }

  newPlayer(lp) {
    return {
      id: lp.id, name: lp.name, char: lp.char, team: this.mode === 'tdm' ? (lp.team || 0) : 0,
      x: 0, y: 0, r: PLAYER_R, hp: MAX_HP, maxHp: MAX_HP, alive: true, aim: 0, mx: 0, my: 0, fire: false, seq: 0,
      q: [], lastIn: { s: 0, mx: 0, my: 0, a: 0, f: false },
      weapon: 'pistol', ammo: WEAPONS.pistol.mag, reserve: 0, reloadT: 0, nextShot: 0,
      kx: 0, ky: 0, airT: 0, jumpCd: 0, ability: null, meter: 35, st: {}, shield: 0, shieldUntil: 0,
      respawnT: 0, spawnInv: 0, killedBy: null, killMsg: '', connected: true,
      stats: { kills: 0, deaths: 0, damage: 0, abil: 0, pickups: 0 }
    };
  }

  /* ---------- helpers used by abilities ---------- */
  ev(k, data, to) { const e = Object.assign({ k }, data || {}); if (to != null) e.to = to; this.events.push(e); }
  fx(a, x, y) { this.ev('fx', { a, x, y }); }
  later(sec, fn) { this.timers.push({ at: this.t + sec, fn }); }
  has(p, k) { return (p.st[k] || 0) > this.t; }
  addStatus(p, k, dur) { p.st[k] = Math.max(p.st[k] || 0, this.t + dur); }
  ray(p, ang, max) { return phys.ray(p.x, p.y, ang, max, this.map.walls); }
  same(a, b) { return this.mode === 'tdm' && a.team === b.team; }
  refund(p, meter, text) { p.meter = Math.max(p.meter, meter); this.ev('pick', { text }, p.id); }
  settle(p) { phys.move(p, 0, 0, this.map.walls, false, this.map.W, this.map.H); }
  enemies(p) { const out = []; for (const o of this.players.values()) if (o !== p && o.alive && o.connected && !this.same(p, o)) out.push(o); return out; }
  target(p, range) {
    let best = null, bs = 1e9;
    for (const o of this.enemies(p)) {
      const dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy);
      if (d > range) continue;
      let da = Math.abs(Math.atan2(dy, dx) - p.aim); da = Math.min(da, Math.PI * 2 - da);
      if (da > 0.7 && d > 280) continue;
      const score = da * 400 + d;
      if (score < bs) { bs = score; best = o; }
    }
    return best;
  }
  addClone(p) {
    const a = rnd(0, Math.PI * 2);
    this.clones.push({ id: 'c' + (this.nid++), owner: p.id, char: p.char, team: p.team, x: p.x, y: p.y, r: PLAYER_R,
      dir: a, turnAt: this.t + rnd(0.5, 1.2), until: this.t + 7, aim: p.aim });
  }
  areaDamage(src, x, y, rad, dmg, tag, falloff) {
    for (const o of this.enemies(src)) {
      const d = Math.hypot(o.x - x, o.y - y) - o.r;
      if (d < rad) this.dmg(o, falloff ? dmg * (1 - 0.5 * Math.max(0, d) / rad) : dmg, src, tag);
    }
    this.clones = this.clones.filter(c => {
      if (c.owner === src.id) return true;
      const own = this.players.get(c.owner); if (own && this.same(src, own)) return true;
      if (Math.hypot(c.x - x, c.y - y) - c.r < rad) { this.ev('poof', { x: c.x, y: c.y }); return false; }
      return true;
    });
  }

  /* ---------- setup ---------- */
  initPickups() {
    let id = 1;
    for (const [x, y] of this.map.weaponSpots) this.pickups.push({ id: id++, x, y, k: 'weapon', w: this.rollWeapon(), alive: true, at: 0 });
    const kinds = Object.assign({}, ITEM_KINDS); if (!this.abilitiesOn) delete kinds.charge;
    for (const [x, y] of this.map.itemSpots) this.pickups.push({ id: id++, x, y, k: weighted(kinds), alive: true, at: 0, rr: true });
  }
  rollWeapon() { const t = {}; for (const id of PICKABLE) t[id] = WEAPONS[id].weight; return weighted(t); }
  rollItem() { const kinds = Object.assign({}, ITEM_KINDS); if (!this.abilitiesOn) delete kinds.charge; return weighted(kinds); }

  /* ---------- input ---------- */
  setInput(id, m) {
    const p = this.players.get(id); if (!p) return;
    const n = v => (Number.isFinite(v) ? v : 0);
    const inp = { s: m.s | 0, mx: phys.clamp(n(m.mx), -1, 1), my: phys.clamp(n(m.my), -1, 1), a: n(m.a), f: !!m.f };
    p.q.push(inp); if (p.q.length > 8) p.q.shift();
  }
  action(id, a) {
    const p = this.players.get(id); if (!p || !p.alive || this.phase !== 'live') return;
    if (this.has(p, 'timelock')) return;
    if (a === 'jump') {
      if (p.jumpCd <= 0 && !this.has(p, 'fr')) { p.airT = 0.55; p.jumpCd = 1.1; this.ev('jump', { id: p.id, x: p.x, y: p.y }); }
    } else if (a === 'reload') this.startReload(p);
    else if (a === 'interact') this.interact(p);
    else if (a === 'ability') this.useAbility(p);
  }
  startReload(p) {
    const w = WEAPONS[p.weapon];
    if (w.kind === 'melee' || p.reloadT > 0 || p.ammo >= w.mag) return;
    if (!w.infinite && p.reserve <= 0) return;
    p.reloadT = w.reload; this.ev('reload', { id: p.id });
  }
  useAbility(p) {
    if (!this.abilitiesOn || !this.revealed || !p.ability) return;
    const ab = ABILITIES[p.ability];
    if (ab.passive) { this.ev('pick', { text: p.meter >= 100 ? 'Phoenix is ARMED. Go be reckless.' : 'Phoenix is charging...' }, p.id); return; }
    if (p.meter < 100) return;
    p.meter = 0; p.stats.abil++;
    this.ev('abil', { id: p.id, a: ab.id });
    ab.activate(this, p);
  }
  interact(p) {
    let best = null, bd = 60;
    for (const pk of this.pickups) {
      if (!pk.alive || pk.k !== 'weapon') continue;
      const d = Math.hypot(pk.x - p.x, pk.y - p.y);
      if (d < bd) { bd = d; best = pk; }
    }
    if (!best) return;
    this.equip(p, best.w); best.alive = false; best.at = this.t + 18; this.pkVersion++;
    p.stats.pickups++;
    this.ev('pick', { text: `Grabbed the ${WEAPONS[best.w].name}`, kind: 'weapon' }, p.id);
  }
  equip(p, wid) {
    const w = WEAPONS[wid];
    if (p.weapon === wid) { p.reserve += w.mag; return; }
    p.weapon = wid; p.ammo = w.mag; p.reserve = w.infinite ? 0 : w.mag * 2; p.reloadT = 0; p.nextShot = 0;
  }

  /* ---------- damage ---------- */
  dmgMul(p) { let m = 1; if (this.has(p, 'db')) m *= 1.5; if (this.has(p, 'bk')) m *= 1.6; if (this.has(p, 'gi')) m *= 1.2; return m; }
  speedMul(p) {
    if (this.phase !== 'live' || !p.alive || this.has(p, 'timelock') || this.has(p, 'fr')) return 0;
    let m = 1; if (this.has(p, 'sp')) m *= 1.4; if (this.has(p, 'bk')) m *= 1.3; if (this.has(p, 'sl')) m *= 0.55; if (this.has(p, 'ti')) m *= 1.15;
    return m;
  }
  dmg(target, amount, src, tag) {
    if (!target.alive || amount <= 0 || !target.connected) return 0;
    if (target.spawnInv > 0 || this.has(target, 'phantom')) return 0;
    if (src && (src === target || this.same(src, target))) return 0;
    let a = amount;
    if (target.shield > 0 && this.t < target.shieldUntil) { const ab = Math.min(target.shield, a); target.shield -= ab; a -= ab; }
    target.hp -= a;
    if (src) { src.stats.damage += Math.round(amount); src.meter = Math.min(100, src.meter + amount * 0.12); }
    this.ev('hit', { id: target.id, x: target.x, y: target.y, d: Math.round(amount), by: src ? src.id : null });
    if (target.hp <= 0) this.eliminate(target, src, tag);
    return amount;
  }
  eliminate(v, k, tag) {
    if (v.ability === 'phoenix' && this.revealed && v.meter >= 100) {
      v.hp = 55; v.meter = 0; v.spawnInv = 1.5; v.stats.abil++;
      this.ev('phoenix', { id: v.id, x: v.x, y: v.y });
      this.ev('feed', { text: `\u{1F525} ${v.name} rose from the ashes! Phoenix Rebirth!` });
      return;
    }
    v.alive = false; v.hp = 0; v.stats.deaths++; v.respawnT = RESPAWN; v.fire = false; v.st = {}; v.shield = 0;
    v.killedBy = k ? k.id : null;
    let text = `${v.name} got cracked`;
    if (k) {
      k.stats.kills++; if (this.mode === 'tdm') this.score[k.team]++;
      text = (TAG_LINES[tag] || pick(KILL_LINES))(k.name, v.name);
    }
    v.killMsg = text;
    this.ev('kill', { k: k ? k.id : null, v: v.id, m: text, x: v.x, y: v.y });
  }
  respawn(p) {
    const sp = this.safeSpawn(p);
    p.x = sp[0]; p.y = sp[1]; p.hp = p.maxHp; p.alive = true; p.spawnInv = SPAWN_INV; p.st = {};
    p.shield = 0; p.kx = p.ky = 0; p.fire = false; p.weapon = 'pistol'; p.ammo = WEAPONS.pistol.mag; p.reserve = 0; p.reloadT = 0;
    p.airT = 0; p.killedBy = null; p.q.length = 0;
    this.ev('respawn', { id: p.id, x: p.x, y: p.y });
  }
  safeSpawn(p) {
    let best = null, bs = -1;
    const foes = this.enemies(p);
    for (const s of this.map.spawns) {
      let md = 1e9; for (const o of foes) md = Math.min(md, Math.hypot(o.x - s[0], o.y - s[1]));
      md += Math.random() * 40;
      if (md > bs) { bs = md; best = s; }
    }
    return best || this.map.spawns[0];
  }

  /* ---------- pickups ---------- */
  collect(p, pk) {
    const text = k => pick(ITEM_TEXT[k]);
    switch (pk.k) {
      case 'health': if (p.hp >= p.maxHp) return false; p.hp = Math.min(p.maxHp, p.hp + 45); this.ev('pick', { text: `+HP: ${text('health')}` }, p.id); break;
      case 'shield': p.shield = Math.max(p.shield, 60); p.shieldUntil = this.t + 10; this.ev('pick', { text: text('shield') }, p.id); break;
      case 'speed': this.addStatus(p, 'sp', 7); this.ev('pick', { text: text('speed') }, p.id); break;
      case 'damage': this.addStatus(p, 'db', 8); this.ev('pick', { text: text('damage') }, p.id); break;
      case 'charge': p.meter = Math.min(100, p.meter + 50); this.ev('pick', { text: text('charge') }, p.id); break;
      case 'mystery': this.mystery(p); break;
      default: return false;
    }
    p.stats.pickups++; pk.alive = false; pk.at = this.t + 14; pk.k = this.rollItem(); this.pkVersion++;
    return true;
  }
  mystery(p) {
    const opts = ['heal', 'turbo', 'humpty', 'tiny', 'spicy', 'rotten', 'boom', 'gift'];
    if (this.abilitiesOn) opts.push('charge');
    const o = pick(opts); let t = '';
    switch (o) {
      case 'heal': p.hp = p.maxHp; t = 'Omelette Therapy: full HP!'; break;
      case 'turbo': this.addStatus(p, 'sp', 6); t = 'Turbo Yolk: gotta go fast!'; break;
      case 'humpty': this.addStatus(p, 'gi', 8); p.shield = Math.max(p.shield, 40); p.shieldUntil = this.t + 8; t = 'HUMPTY MODE: big egg, big problems!'; break;
      case 'tiny': this.addStatus(p, 'ti', 8); t = 'Tiny Egg Energy: they cannot hit you!'; break;
      case 'spicy': this.addStatus(p, 'db', 8); t = 'Spicy Yolk: 1.5x damage!'; break;
      case 'rotten': this.addStatus(p, 'sl', 4); p.hp = Math.max(1, p.hp - 15); t = 'ROTTEN EGG. Why would you pick that up?'; break;
      case 'boom': this.ev('boom', { x: p.x, y: p.y, r: 110, c: p.char }); this.areaDamage(p, p.x, p.y, 110, 40, 'boom'); t = 'EGG-SPLOSION!'; break;
      case 'gift': this.equip(p, this.rollWeapon()); t = 'Gift of the Hens: ' + WEAPONS[p.weapon].name; break;
      case 'charge': p.meter = 100; t = 'Cosmic Cluck: ability fully charged!'; break;
    }
    this.ev('pick', { text: 'MYSTERY EGG \u2192 ' + t, kind: 'mystery' }, p.id);
  }

  /* ---------- combat ---------- */
  tryFire(p) {
    const w = WEAPONS[p.weapon];
    if (this.t < p.nextShot || p.reloadT > 0) return;
    if (w.kind !== 'melee') {
      if (p.ammo <= 0) {
        if (w.infinite || p.reserve > 0) this.startReload(p);
        else { this.equip(p, 'pistol'); }
        return;
      }
      p.ammo--;
    }
    const rate = w.rate * (this.has(p, 'bk') ? 1.3 : 1);
    p.nextShot = this.t + 1 / rate;
    this.ev('shot', { i: p.id, w: w.id });
    const mul = this.dmgMul(p);
    if (w.kind === 'melee') return this.melee(p, w, mul);
    const n = w.pellets || 1;
    for (let i = 0; i < n; i++) {
      const ang = p.aim + (n > 1 ? rnd(-1, 1) * w.spread : rnd(-1, 1) * (w.spread || 0));
      const type = w.proj || 'bullet';
      const speed = w.speed * (n > 1 ? rnd(0.9, 1.1) : 1);
      const pr = {
        owner: p.id, team: p.team, c: p.char, type, w: w.id,
        x: p.x + Math.cos(ang) * (p.r + 6), y: p.y + Math.sin(ang) * (p.r + 6),
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
        dmg: w.dmg * mul, r: type === 'plasma' ? 9 : type === 'arrow' ? 5 : type === 'grenade' ? 8 : type === 'egg' ? 10 : 4,
        life: w.fuse ? w.fuse : w.range / speed, radius: w.radius || 0, bounce: type === 'grenade' || type === 'egg',
        explosive: !!w.radius
      };
      this.projs.push(pr);
    }
    if (p.ammo <= 0 && (w.infinite || p.reserve > 0)) this.startReload(p);
  }
  melee(p, w, mul) {
    this.ev('swing', { i: p.id, x: p.x, y: p.y, a: p.aim, r: w.range, w: w.id });
    const hit = o => {
      const dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy);
      if (d > w.range + o.r) return false;
      let da = Math.abs(Math.atan2(dy, dx) - p.aim); da = Math.min(da, Math.PI * 2 - da);
      return da <= w.arc / 2;
    };
    for (const o of this.enemies(p)) {
      if (!hit(o)) continue;
      if (this.dmg(o, w.dmg * mul, p, w.id) > 0 && w.knock) {
        const a = Math.atan2(o.y - p.y, o.x - p.x); o.kx += Math.cos(a) * w.knock; o.ky += Math.sin(a) * w.knock;
      }
    }
    this.clones = this.clones.filter(c => {
      const own = this.players.get(c.owner);
      if (c.owner === p.id || (own && this.same(p, own))) return true;
      if (hit(c)) { this.ev('poof', { x: c.x, y: c.y }); return false; }
      return true;
    });
  }
  explode(pr) {
    const src = this.players.get(pr.owner); pr.dead = true;
    this.ev('boom', { x: pr.x, y: pr.y, r: pr.radius, c: pr.c });
    if (!src) return;
    for (const o of this.enemies(src)) {
      const d = Math.hypot(o.x - pr.x, o.y - pr.y) - o.r;
      if (d < pr.radius) {
        if (this.dmg(o, pr.dmg * (1 - 0.5 * Math.max(0, d) / pr.radius), src, pr.w) > 0) {
          const a = Math.atan2(o.y - pr.y, o.x - pr.x); o.kx += Math.cos(a) * 220; o.ky += Math.sin(a) * 220;
        }
      }
    }
    this.clones = this.clones.filter(c => {
      const own = this.players.get(c.owner);
      if (c.owner === src.id || (own && this.same(src, own))) return true;
      if (Math.hypot(c.x - pr.x, c.y - pr.y) - c.r < pr.radius) { this.ev('poof', { x: c.x, y: c.y }); return false; }
      return true;
    });
  }
  updateProjectiles(dt) {
    const walls = this.map.walls, W = this.map.W, H = this.map.H;
    for (const pr of this.projs) {
      if (pr.dead) continue;
      const steps = Math.max(1, Math.ceil(Math.hypot(pr.vx, pr.vy) * dt / 8)), sdt = dt / steps;
      for (let s = 0; s < steps && !pr.dead; s++) {
        const ox = pr.x, oy = pr.y;
        pr.x += pr.vx * sdt; pr.y += pr.vy * sdt;
        if (pr.type === 'egg') { const a = (Math.random() - 0.5) * 0.04, c = Math.cos(a), sn = Math.sin(a); const vx = pr.vx * c - pr.vy * sn; pr.vy = pr.vx * sn + pr.vy * c; pr.vx = vx; }
        const hitW = phys.hitsWall(pr.x, pr.y, pr.r * 0.6, walls);
        const out = pr.x < 0 || pr.x > W || pr.y < 0 || pr.y > H;
        if (hitW || out) {
          if (pr.bounce) {
            const xOnly = !(phys.hitsWall(pr.x, oy, pr.r * 0.6, walls)) && !(pr.x < 0 || pr.x > W);
            const yOnly = !(phys.hitsWall(ox, pr.y, pr.r * 0.6, walls)) && !(pr.y < 0 || pr.y > H);
            if (xOnly || (!yOnly)) { pr.vy = -pr.vy; pr.y = oy; }
            if (yOnly || (!xOnly)) { pr.vx = -pr.vx; pr.x = ox; }
            if (!xOnly && !yOnly) { pr.x = ox; pr.y = oy; }
            continue;
          }
          if (pr.explosive) this.explode(pr); else pr.dead = true;
          break;
        }
        const owner = this.players.get(pr.owner);
        for (const o of this.players.values()) {
          if (!o.alive || o.id === pr.owner || !o.connected) continue;
          if (this.mode === 'tdm' && o.team === pr.team) continue;
          if (this.has(o, 'phantom') || o.spawnInv > 0) continue;
          if (Math.hypot(o.x - pr.x, o.y - pr.y) < o.r + pr.r) {
            if (pr.explosive) this.explode(pr); else { this.dmg(o, pr.dmg, owner, pr.w); pr.dead = true; }
            break;
          }
        }
        if (pr.dead) break;
        for (const c of this.clones) {
          if (c.owner === pr.owner) continue;
          const own = this.players.get(c.owner); if (own && this.mode === 'tdm' && own.team === pr.team) continue;
          if (Math.hypot(c.x - pr.x, c.y - pr.y) < c.r + pr.r) {
            c.until = 0; this.ev('poof', { x: c.x, y: c.y });
            if (pr.explosive) this.explode(pr); else pr.dead = true;
            break;
          }
        }
      }
      pr.life -= dt;
      if (!pr.dead && pr.life <= 0) { if (pr.explosive) this.explode(pr); else pr.dead = true; }
    }
    this.projs = this.projs.filter(p => !p.dead);
    this.clones = this.clones.filter(c => c.until > this.t);
  }

  /* ---------- per-player tick ---------- */
  applyInput(p, inp, canMove) {
    p.seq = inp.s; p.mx = inp.mx; p.my = inp.my; p.aim = inp.a; p.fire = inp.f; p.lastIn = inp;
    if (!canMove) return;
    const sp = BASE_SPEED * this.speedMul(p);
    if (sp > 0) phys.step(p, p.mx, p.my, sp, DT, this.map.walls, p.airT > 0, this.map.W, this.map.H);
  }
  updatePlayer(p) {
    // consume queued inputs (one per tick; two when backed up)
    const n = p.q.length > 3 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const inp = p.q.length ? p.q.shift() : (p.connected ? p.lastIn : { s: p.seq, mx: 0, my: 0, a: p.aim, f: false });
      this.applyInput(p, p.connected ? inp : { s: p.seq, mx: 0, my: 0, a: p.aim, f: false }, p.alive && this.phase === 'live');
    }
    if (!p.alive) {
      if (this.phase === 'live') { p.respawnT -= DT; if (p.respawnT <= 0) this.respawn(p); }
      return;
    }
    p.r = this.has(p, 'ti') ? 11 : this.has(p, 'gi') ? 25 : PLAYER_R;
    if (p.spawnInv > 0) p.spawnInv -= DT;
    if (p.airT > 0) p.airT -= DT;
    if (p.jumpCd > 0) p.jumpCd -= DT;
    if (p.shield > 0 && this.t >= p.shieldUntil) p.shield = 0;
    if (this.phase !== 'live') return;
    // knockback
    if (Math.abs(p.kx) + Math.abs(p.ky) > 5) {
      phys.move(p, p.kx * DT, p.ky * DT, this.map.walls, p.airT > 0, this.map.W, this.map.H);
      p.kx *= 0.86; p.ky *= 0.86;
    }
    // ability meter by time
    if (this.abilitiesOn && p.ability && p.meter < 100) p.meter = Math.min(100, p.meter + (100 / ABILITIES[p.ability].charge) * DT);
    // healing aura
    if (this.has(p, 'au')) {
      p.hp = Math.min(p.maxHp, p.hp + 14 * DT);
      if (this.mode === 'tdm') for (const o of this.players.values()) {
        if (o !== p && o.alive && o.team === p.team && Math.hypot(o.x - p.x, o.y - p.y) < 140) o.hp = Math.min(o.maxHp, o.hp + 10 * DT);
      }
    }
    // reload
    if (p.reloadT > 0) {
      p.reloadT -= DT;
      if (p.reloadT <= 0) {
        const w = WEAPONS[p.weapon]; const need = w.mag - p.ammo;
        const take = w.infinite ? need : Math.min(need, p.reserve);
        p.ammo += take; if (!w.infinite) p.reserve -= take; p.reloadT = 0;
      }
    }
    // fire
    if (p.fire && !this.has(p, 'timelock')) this.tryFire(p);
    // auto pickups
    for (const pk of this.pickups) {
      if (!pk.alive || pk.k === 'weapon') continue;
      if (Math.hypot(pk.x - p.x, pk.y - p.y) < p.r + 22) this.collect(p, pk);
    }
  }

  /* ---------- main tick ---------- */
  tick() {
    this.t += DT; this.tickN++;
    if (this.phase === 'ended') return;
    this.phaseT += DT;
    if (this.phase === 'reveal') {
      if (this.abilitiesOn) {
        if (!this.revealed && this.phaseT >= REVEAL.at) {
          this.revealed = true;
          const ab = {}; for (const p of this.players.values()) ab[p.id] = p.ability;
          this.ev('reveal', { ab });
        }
        if (this.phaseT >= REVEAL.end) this.goLive();
      } else if (this.phaseT >= REVEAL.plain) this.goLive();
    }
    for (const p of this.players.values()) this.updatePlayer(p);
    if (this.phase === 'live') {
      this.timeLeft -= DT;
      // timers
      if (this.timers.length) {
        const due = this.timers.filter(x => x.at <= this.t); this.timers = this.timers.filter(x => x.at > this.t);
        for (const d of due) d.fn();
      }
      this.updateProjectiles(DT);
      // clones
      for (const c of this.clones) {
        if (this.t >= c.turnAt) { c.dir = rnd(0, Math.PI * 2); c.turnAt = this.t + rnd(0.6, 1.4); }
        const ox = c.x, oy = c.y;
        phys.move(c, Math.cos(c.dir) * 140 * DT, Math.sin(c.dir) * 140 * DT, this.map.walls, false, this.map.W, this.map.H);
        if (Math.abs(c.x - ox) + Math.abs(c.y - oy) < 0.5) c.turnAt = 0;
        c.aim = c.dir;
      }
      // gravity wells
      this.wells = this.wells.filter(w => w.until > this.t);
      for (const w of this.wells) {
        const own = this.players.get(w.owner);
        for (const o of this.players.values()) {
          if (!o.alive || !o.connected || o.id === w.owner || (own && this.same(own, o))) continue;
          const dx = w.x - o.x, dy = w.y - o.y, d = Math.hypot(dx, dy);
          if (d < w.r && d > 8) {
            const pull = 170 * (1 - 0.5 * d / w.r) * DT;
            phys.move(o, (dx / d) * Math.min(pull, d), (dy / d) * Math.min(pull, d), this.map.walls, o.airT > 0, this.map.W, this.map.H);
          }
        }
      }
      // pickup respawn
      for (const pk of this.pickups) {
        if (!pk.alive && this.t >= pk.at) { pk.alive = true; if (pk.k === 'weapon') pk.w = this.rollWeapon(); this.pkVersion++; }
      }
      if (this.timeLeft <= 0) this.finish();
    }
  }
  goLive() { this.phase = 'live'; this.phaseT = 0; this.ev('go', {}); }

  finish() {
    this.phase = 'ended'; this.timeLeft = 0;
    for (const p of this.players.values()) { p.fire = false; }
    const list = [...this.players.values()].map(p => ({
      id: p.id, name: p.name, char: p.char, team: p.team, kills: p.stats.kills, deaths: p.stats.deaths,
      damage: p.stats.damage, abil: p.stats.abil, pickups: p.stats.pickups, ability: p.ability
    })).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.damage - a.damage);
    let draw = false, winTeam = null;
    if (this.mode === 'tdm') {
      if (this.score[0] === this.score[1]) draw = true; else winTeam = this.score[0] > this.score[1] ? 0 : 1;
    } else if (list.length > 1 && list[0].kills === list[1].kills && list[0].deaths === list[1].deaths && list[0].damage === list[1].damage) draw = true;
    this.results = { mode: this.mode, ts: this.mode === 'tdm' ? this.score.slice() : null, winTeam, draw, ranking: list };
    this.ev('end', {});
  }

  removePlayer(id) {
    this.players.delete(id);
    this.clones = this.clones.filter(c => c.owner !== id);
  }
  setConnected(id, on) { const p = this.players.get(id); if (p) { p.connected = on; if (!on) { p.q.length = 0; p.fire = false; } } }

  /* ---------- snapshots ---------- */
  stCodes(p) {
    const out = [];
    for (const k of ['phantom', 'timelock', 'fr', 'bk', 'au', 'sp', 'db', 'ti', 'gi', 'sl']) if (this.has(p, k)) out.push(k);
    if (p.ability === 'phoenix' && this.revealed && p.meter >= 100) out.push('pf');
    if (p.spawnInv > 0) out.push('inv');
    if (!p.connected) out.push('dc');
    return out;
  }
  buildBase() {
    const pl = [];
    for (const p of this.players.values()) {
      pl.push({ i: p.id, x: +p.x.toFixed(1), y: +p.y.toFixed(1), a: +p.aim.toFixed(2), h: Math.ceil(p.hp), al: p.alive ? 1 : 0,
        s: Math.ceil(p.shield), w: p.weapon, r: p.r, air: p.airT > 0 ? 1 : 0, st: this.stCodes(p) });
    }
    const base = {
      t: 's', n: this.tickN, ph: this.phase, rt: +this.phaseT.toFixed(2), tl: Math.max(0, Math.ceil(this.timeLeft)),
      rv: this.revealed ? 1 : 0, p: pl,
      cl: this.clones.map(c => ({ i: c.id, x: +c.x.toFixed(1), y: +c.y.toFixed(1), a: +c.aim.toFixed(2), c: c.char, t: c.team })),
      pr: this.projs.map(q => [Math.round(q.x), Math.round(q.y), Math.round(q.vx), Math.round(q.vy), q.type, q.c]),
      wl: this.wells.map(w => [Math.round(w.x), Math.round(w.y), w.r, +(w.until - this.t).toFixed(1)]),
      sc: [...this.players.values()].map(p => [p.id, p.stats.kills, p.stats.deaths]),
      ev: this.events.filter(e => e.to == null)
    };
    if (this.mode === 'tdm') base.ts = this.score;
    if (this.tickN % 15 === 0 || this.lastPkV !== this.pkVersion) {
      base.pk = this.pickups.map(k => [k.id, k.x, k.y, k.k, k.alive ? 1 : 0, k.w || '']);
      this.lastPkV = this.pkVersion;
    }
    if (this.results) base.res = this.results;
    return base;
  }
  meFor(p) {
    const w = WEAPONS[p.weapon];
    let near = null, bd = 60;
    if (p.alive) for (const pk of this.pickups) {
      if (!pk.alive || pk.k !== 'weapon') continue;
      const d = Math.hypot(pk.x - p.x, pk.y - p.y); if (d < bd) { bd = d; near = pk.w; }
    }
    const killer = p.killedBy != null ? this.players.get(p.killedBy) : null;
    return {
      x: +p.x.toFixed(1), y: +p.y.toFixed(1), hp: Math.ceil(p.hp), mh: p.maxHp, sh: Math.ceil(p.shield), w: p.weapon,
      am: p.ammo, rs: w.infinite ? -1 : p.reserve, rl: p.reloadT > 0 ? +(1 - p.reloadT / w.reload).toFixed(2) : 0,
      mt: Math.floor(p.meter), ab: this.revealed ? p.ability : null, ar: (p.ability === 'phoenix' && p.meter >= 100) ? 1 : 0,
      air: Math.max(0, +p.airT.toFixed(2)), jc: Math.max(0, +p.jumpCd.toFixed(2)), spd: this.speedMul(p), r: p.r,
      al: p.alive ? 1 : 0, rsp: p.alive ? 0 : Math.max(0, +p.respawnT.toFixed(1)),
      kb: killer ? killer.name : (p.alive ? '' : '???'), kc: killer ? killer.char : -1, km: p.alive ? '' : p.killMsg,
      near, ack: p.seq, ev: this.events.filter(e => e.to === p.id)
    };
  }
  // Build per-client JSON strings for this tick, then clear events.
  snapshots() {
    const base = JSON.stringify(this.buildBase());
    const out = new Map();
    for (const p of this.players.values()) out.set(p.id, base.slice(0, -1) + ',"me":' + JSON.stringify(this.meFor(p)) + '}');
    this.events = [];
    return out;
  }
}

module.exports = { Game, TICK, DT };
