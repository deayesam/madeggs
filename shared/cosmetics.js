(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MECOS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /* MAD EGGS cosmetics. One customisable egg for everybody.
   * To add a mask/top/bottom/shoe: add an entry here AND a builder case in public/view3d.js (makeEgg).
   * A "look" is { m: mask, t: top, b: bottom, s: shoes, tc/bc/sc: garment colour indexes, a: accent colour index }. */
  const MASKS = [
    { id: 'cracked', name: 'Cracked Classic', icon: '\u{1F95A}' },
    { id: 'scary', name: 'Nightmare Grin', icon: '\u{1F608}' },
    { id: 'funny', name: 'Goofy Googly', icon: '\u{1F92A}' },
    { id: 'clown', name: 'Clown Chaos', icon: '\u{1F921}' },
    { id: 'serious', name: 'Dead Serious', icon: '\u{1F610}' },
    { id: 'webhero', name: 'Web Hero', icon: '\u{1F577}\uFE0F' },
    { id: 'skull', name: 'Bone Zone', icon: '\u{1F480}' },
    { id: 'shadow', name: 'Shadow Hood', icon: '\u{1F977}' },
    { id: 'monkey', name: 'Monkey Business', icon: '\u{1F435}' },
    { id: 'spiky', name: 'Spike Rider', icon: '\u26A1' }
  ];
  const TOPS = [
    { id: 'tactical', name: 'Tactical Vest', icon: '\u{1FA96}' },
    { id: 'hoodie', name: 'Letter Hoodie', icon: '\u{1F9E5}' },
    { id: 'jacket', name: 'Open Jacket', icon: '\u{1F97C}' },
    { id: 'vest', name: 'Chevron Vest', icon: '\u{1F9BA}' },
    { id: 'armor', name: 'Battle Armor', icon: '\u{1F6E1}\uFE0F' },
    { id: 'tshirt', name: 'Plain Tee', icon: '\u{1F455}' }
  ];
  const BOTTOMS = [
    { id: 'pants', name: 'Pants', icon: '\u{1F456}' },
    { id: 'shorts', name: 'Shorts', icon: '\u{1FA73}' },
    { id: 'cargo', name: 'Cargo Pants', icon: '\u{1F392}' }
  ];
  const SHOES = [
    { id: 'boots', name: 'Combat Boots', icon: '\u{1F97E}' },
    { id: 'sneakers', name: 'Sneakers', icon: '\u{1F45F}' },
    { id: 'match', name: 'Matching Kicks', icon: '\u{1F45E}' },
    { id: 'bare', name: 'Barefoot', icon: '\u{1F9B6}' }
  ];
  // garment colours (top / bottoms / shoes)
  const GARMENT = ['#17131f', '#3a3550', '#c62828', '#1f6fe0', '#1f9e55', '#6a35c9', '#f2b705', '#eeeeee', '#ff7a1a', '#8a4b22'];
  // accent colour = index into MECHARS (8 neon colours): eyes, trim, bullets, name tag
  const ACCENTS = 8;

  const DEFAULT_LOOK = { m: 'cracked', t: 'tactical', b: 'pants', s: 'boots', tc: 0, bc: 0, sc: 0, a: 1 };
  const PRESETS = [
    { id: 'cracked', name: 'Mad Egg', icon: '\u{1F95A}', look: DEFAULT_LOOK },
    { id: 'shadow', name: 'Aye Sam: Shadow', icon: '\u{1F977}', look: { m: 'shadow', t: 'hoodie', b: 'pants', s: 'boots', tc: 0, bc: 0, sc: 0, a: 4 } },
    { id: 'monkey', name: 'BulalaMan: Monkey Business', icon: '\u{1F435}', look: { m: 'monkey', t: 'jacket', b: 'pants', s: 'boots', tc: 2, bc: 9, sc: 9, a: 0 } },
    { id: 'spiky', name: 'Lawrence: Spike Rider', icon: '\u26A1', look: { m: 'spiky', t: 'vest', b: 'cargo', s: 'match', tc: 3, bc: 0, sc: 3, a: 3 } }
  ];

  const ids = list => list.map(x => x.id);
  const pick = (v, list, d) => (typeof v === 'string' && ids(list).indexOf(v) >= 0 ? v : d);
  const idx = (v, max, d) => { v = +v; return Number.isInteger(v) && v >= 0 && v < max ? v : d; };
  function sanitizeLook(l) {
    l = l && typeof l === 'object' ? l : {};
    const D = DEFAULT_LOOK;
    return {
      m: pick(l.m, MASKS, D.m), t: pick(l.t, TOPS, D.t), b: pick(l.b, BOTTOMS, D.b), s: pick(l.s, SHOES, D.s),
      tc: idx(l.tc, GARMENT.length, D.tc), bc: idx(l.bc, GARMENT.length, D.bc), sc: idx(l.sc, GARMENT.length, D.sc), a: idx(l.a, ACCENTS, D.a)
    };
  }
  return { MASKS, TOPS, BOTTOMS, SHOES, GARMENT, ACCENTS, DEFAULT_LOOK, PRESETS, sanitizeLook };
});
