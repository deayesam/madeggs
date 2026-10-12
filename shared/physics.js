/* Shared by server (authoritative) and client (prediction). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MEPhys = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Push a circle {x,y,r} out of any wall. Low cover is skipped while airborne.
  function resolve(c, rects, air) {
    for (let it = 0; it < 3; it++) {
      for (let i = 0; i < rects.length; i++) {
        const w = rects[i];
        if (air && w.t === 'low') continue;
        const nx = clamp(c.x, w.x, w.x + w.w);
        const ny = clamp(c.y, w.y, w.y + w.h);
        const dx = c.x - nx, dy = c.y - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 >= c.r * c.r) continue;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2), push = c.r - d;
          c.x += (dx / d) * push; c.y += (dy / d) * push;
        } else {
          const l = c.x - w.x, r = w.x + w.w - c.x, t = c.y - w.y, b = w.y + w.h - c.y;
          const m = Math.min(l, r, t, b);
          if (m === l) c.x = w.x - c.r; else if (m === r) c.x = w.x + w.w + c.r;
          else if (m === t) c.y = w.y - c.r; else c.y = w.y + w.h + c.r;
        }
      }
    }
  }

  function move(c, dx, dy, rects, air, W, H) {
    c.x += dx; c.y += dy;
    resolve(c, rects, air);
    c.x = clamp(c.x, c.r, W - c.r);
    c.y = clamp(c.y, c.r, H - c.r);
  }

  // One input step: mx,my in [-1,1]
  function step(c, mx, my, speed, dt, rects, air, W, H) {
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    const s = speed * (air ? 1.12 : 1) * dt;
    move(c, mx * s, my * s, rects, air, W, H);
  }

  function hitsWall(x, y, r, rects) {
    for (let i = 0; i < rects.length; i++) {
      const w = rects[i];
      const nx = clamp(x, w.x, w.x + w.w), ny = clamp(y, w.y, w.y + w.h);
      const dx = x - nx, dy = y - ny;
      if (dx * dx + dy * dy < r * r) return w;
    }
    return null;
  }

  // Distance along angle until a wall (low cover blocks shots too) or max.
  function ray(x, y, ang, max, rects) {
    const cx = Math.cos(ang), cy = Math.sin(ang);
    for (let d = 0; d < max; d += 6) {
      if (hitsWall(x + cx * d, y + cy * d, 2, rects)) return d;
    }
    return max;
  }

  return { clamp, resolve, move, step, hitsWall, ray };
});
