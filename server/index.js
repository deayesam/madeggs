'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game, TICK } = require('./game');
const { MAPS, MAP_LIST } = require('./data/maps');
const { WEAPON_INFO } = require('./data/weapons');
const { ABILITY_INFO } = require('./data/abilities');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let url = '/';
  try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { /* ignore */ }
  if (url === '/health') { res.writeHead(200); return res.end('ok'); }
  if (url === '/' || url === '') url = '/index.html';
  const file = path.normalize(url.startsWith('/shared/') ? path.join(ROOT, url) : path.join(ROOT, 'public', url));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('no'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 4096 });
const rooms = new Map();
const sessions = new Map(); // token -> { code, id }
let nextId = 1;

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() {
  for (let n = 0; n < 50; n++) {
    let c = ''; for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    c = 'MAD-' + c; if (!rooms.has(c)) return c;
  }
  return null;
}
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(typeof o === 'string' ? o : JSON.stringify(o)); };
const cleanName = s => String(s || '').replace(/[^\w \-.!?']/g, '').trim().slice(0, 14);

function cleanSettings(s, cur, count) {
  const out = Object.assign({}, cur);
  s = s || {};
  if (typeof s.roomName === 'string') out.roomName = cleanName(s.roomName).slice(0, 20) || cur.roomName;
  if (s.mode === 'ffa' || s.mode === 'tdm') out.mode = s.mode;
  if (Number.isFinite(+s.max)) out.max = Math.max(Math.max(2, count), Math.min(8, Math.round(+s.max)));
  if ([1, 2, 3, 5, 7, 10].includes(+s.duration)) out.duration = +s.duration;
  if (typeof s.map === 'string' && MAPS[s.map]) out.map = s.map;
  if (typeof s.abilities === 'boolean') out.abilities = s.abilities;
  if (typeof s.pickups === 'boolean') out.pickups = s.pickups;
  return out;
}

function roomState(r) {
  return {
    code: r.code, phase: r.phase, host: r.hostId, settings: r.settings,
    players: [...r.players.values()].map(p => ({ id: p.id, name: p.name, char: p.char, ready: p.id === r.hostId ? true : p.ready, team: p.team, ping: p.ping, on: p.connected }))
  };
}
const pushRoom = r => { const m = JSON.stringify({ t: 'room', r: roomState(r) }); for (const p of r.players.values()) send(p.ws, m); };
function balanceTeams(r) {
  const c = [0, 0]; const list = [...r.players.values()];
  list.forEach((p, i) => { p.team = i % 2; });
  list.forEach(p => c[p.team]++);
}
function addPlayer(r, ws, name, char) {
  const id = nextId++;
  const token = crypto.randomBytes(12).toString('hex');
  const lp = { id, token, ws, name: cleanName(name) || 'EGG' + id, char: Math.max(0, Math.min(3, char | 0)), ready: false, team: 0, ping: 0, connected: true, discAt: 0 };
  const c = [0, 0]; for (const p of r.players.values()) c[p.team]++;
  lp.team = c[0] <= c[1] ? 0 : 1;
  r.players.set(id, lp); sessions.set(token, { code: r.code, id });
  ws.lp = lp; ws.room = r;
  send(ws, { t: 'hello', id, token });
  return lp;
}
function startMsg(r, lp) {
  const m = MAPS[r.game.map.id];
  return {
    t: 'start', you: lp.id, mode: r.game.mode, abilitiesOn: r.game.abilitiesOn, pickupsOn: r.game.pickupsOn,
    map: { id: m.id, name: m.name, W: m.W, H: m.H, walls: m.walls, decor: m.decor },
    players: [...r.game.players.values()].map(p => ({ id: p.id, name: p.name, char: p.char, team: p.team })),
    abilities: ABILITY_INFO, weapons: WEAPON_INFO, duration: r.settings.duration
  };
}

function canStart(r) {
  const on = [...r.players.values()].filter(p => p.connected);
  if (on.length < 2) return 'Need at least 2 players.';
  if (on.some(p => p.id !== r.hostId && !p.ready)) return 'Everyone must be READY first.';
  if (r.settings.mode === 'tdm') {
    const c = [0, 0]; on.forEach(p => c[p.team]++);
    if (!c[0] || !c[1]) return 'Team Deathmatch needs players on both teams.';
  }
  return null;
}
function startMatch(r) {
  const lobby = [...r.players.values()].filter(p => p.connected);
  r.game = new Game(r.settings, lobby);
  r.phase = 'match';
  for (const p of lobby) send(p.ws, startMsg(r, p));
  pushRoom(r);
}
function removePlayer(r, lp) {
  r.players.delete(lp.id); sessions.delete(lp.token);
  if (r.game) r.game.removePlayer(lp.id);
  if (!r.players.size) { rooms.delete(r.code); return; }
  if (r.hostId === lp.id) r.hostId = [...r.players.values()].find(p => p.connected)?.id ?? [...r.players.values()][0].id;
  pushRoom(r);
}

wss.on('connection', ws => {
  ws.cnt = 0; ws.alive = true;
  const rl = setInterval(() => { ws.cnt = 0; }, 1000);
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    if (++ws.cnt > 240) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    handle(ws, m);
  });
  ws.on('close', () => {
    clearInterval(rl);
    const lp = ws.lp, r = ws.room;
    if (lp && r && lp.ws === ws) {
      lp.connected = false; lp.ws = null; lp.discAt = Date.now();
      if (r.game) r.game.setConnected(lp.id, false);
      pushRoom(r);
    }
  });
});

function handle(ws, m) {
  if (m.t === 'ping') return send(ws, { t: 'pong', c: m.c });
  if (m.t === 'create') {
    if (ws.lp) return;
    if (rooms.size > 300) return send(ws, { t: 'err', msg: 'Server is full. Try again soon.' });
    const code = newCode(); if (!code) return;
    const base = { roomName: 'MAD ROOM', mode: 'ffa', max: 4, duration: 3, map: 'factory', abilities: true, pickups: true };
    const r = { code, phase: 'lobby', hostId: 0, settings: base, players: new Map(), game: null };
    r.settings = cleanSettings(m.settings, base, 1);
    rooms.set(code, r);
    const lp = addPlayer(r, ws, m.name, m.char);
    r.hostId = lp.id;
    if (r.settings.mode === 'tdm') balanceTeams(r);
    return pushRoom(r);
  }
  if (m.t === 'join') {
    if (ws.lp) return;
    const code = String(m.code || '').toUpperCase().replace(/\s/g, '');
    const r = rooms.get(code.startsWith('MAD-') ? code : 'MAD-' + code.replace('MAD', '').replace('-', ''));
    if (!r) return send(ws, { t: 'err', msg: 'No room with that code. Check the letters and try again.' });
    if (r.phase === 'match') return send(ws, { t: 'err', msg: 'That match already started. Wait for the next round.' });
    if (r.players.size >= r.settings.max) return send(ws, { t: 'err', msg: 'Room is full.' });
    addPlayer(r, ws, m.name, m.char);
    if (r.settings.mode === 'tdm') { const c = [0, 0]; for (const p of r.players.values()) if (p !== ws.lp) c[p.team]++; ws.lp.team = c[0] <= c[1] ? 0 : 1; }
    return pushRoom(r);
  }
  if (m.t === 'resume') {
    const s = sessions.get(String(m.token || ''));
    const r = s && rooms.get(s.code); const lp = r && r.players.get(s.id);
    if (!lp) return send(ws, { t: 'err', msg: 'Session expired.', resume: false });
    if (lp.ws && lp.ws !== ws) { lp.ws.lp = null; try { lp.ws.close(); } catch (e) { /* ignore */ } }
    lp.ws = ws; lp.connected = true; lp.discAt = 0; ws.lp = lp; ws.room = r;
    send(ws, { t: 'hello', id: lp.id, token: lp.token });
    if (r.game) r.game.setConnected(lp.id, true);
    if (r.phase !== 'lobby' && r.game) send(ws, startMsg(r, lp));
    return pushRoom(r);
  }

  const lp = ws.lp, r = ws.room;
  if (!lp || !r) return;
  const isHost = r.hostId === lp.id;

  switch (m.t) {
    case 'in': if (r.game && r.phase === 'match') r.game.setInput(lp.id, m); break;
    case 'act': if (r.game && r.phase === 'match') r.game.action(lp.id, String(m.a)); break;
    case 'rtt': lp.ping = Math.max(0, Math.min(999, m.ms | 0)); break;
    case 'char': if (r.phase === 'lobby') { lp.char = Math.max(0, Math.min(3, m.char | 0)); pushRoom(r); } break;
    case 'ready': if (r.phase === 'lobby') { lp.ready = !!m.ready; pushRoom(r); } break;
    case 'team':
      if (r.phase === 'lobby' && r.settings.mode === 'tdm') { lp.team = m.team === 1 ? 1 : 0; pushRoom(r); } break;
    case 'settings':
      if (isHost && r.phase === 'lobby') {
        const prev = r.settings.mode;
        r.settings = cleanSettings(m.settings, r.settings, r.players.size);
        if (r.settings.mode === 'tdm' && prev !== 'tdm') balanceTeams(r);
        pushRoom(r);
      } break;
    case 'start':
      if (isHost && r.phase === 'lobby') {
        const why = canStart(r); if (why) return send(ws, { t: 'err', msg: why });
        startMatch(r);
      } break;
    case 'again':
      if (isHost && r.phase === 'results') {
        const why = canStart(Object.assign({}, r, { players: new Map([...r.players].map(([k, v]) => [k, Object.assign({}, v, { ready: true })])) }));
        if (why) return send(ws, { t: 'err', msg: why });
        startMatch(r);
      } break;
    case 'lobby':
      if (isHost && r.phase === 'results') {
        r.phase = 'lobby'; r.game = null;
        for (const p of r.players.values()) p.ready = false;
        pushRoom(r);
      } break;
    case 'leave':
      ws.lp = null; ws.room = null; removePlayer(r, lp); send(ws, { t: 'left' }); break;
    default: break;
  }
}

/* ---------- game loop (30 Hz, fixed timestep) ---------- */
const STEP = 1000 / TICK;
let last = Date.now(), acc = 0;
setInterval(() => {
  const now = Date.now(); acc += now - last; last = now;
  let n = 0;
  while (acc >= STEP && n < 4) {
    acc -= STEP; n++;
    for (const r of rooms.values()) {
      if (!r.game || r.phase === 'lobby') continue;
      const g = r.game;
      g.tick();
      const ended = g.phase === 'ended';
      if (ended && r.phase === 'match') { r.phase = 'results'; pushRoom(r); }
      if (ended && g.tickN % 10 !== 0 && g.events.length === 0) continue;
      const snaps = g.snapshots();
      for (const [id, str] of snaps) { const lp = r.players.get(id); if (lp && lp.ws) send(lp.ws, str); }
    }
  }
  if (acc > STEP * 8) acc = 0;
}, 8);

/* ---------- housekeeping ---------- */
setInterval(() => {
  const now = Date.now();
  for (const r of [...rooms.values()]) {
    for (const lp of [...r.players.values()]) {
      if (!lp.connected && now - lp.discAt > 90000) removePlayer(r, lp);
    }
  }
  for (const r of rooms.values()) if (r.phase === 'lobby') pushRoom(r); // refresh pings
  for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch (e) { /* ignore */ } }
}, 4000);

server.listen(PORT, () => console.log('MAD EGGS listening on :' + PORT));
