/**
 * Original island set dressing. Decorations are deliberately low and open:
 * they never describe new cover, collide with actors, or alter simulation state.
 * Build once per state; bake ground wear into terrain; depth-sort the props by y.
 */
const TAU = Math.PI * 2;
const LIMIT = 22;
const COLORS = Object.freeze({
  dark: '#284b38', deep: '#244234', olive: '#788568', light: '#b5b78a',
  canvas: '#c6b183', paper: '#e5cf9e', teal: '#477b69', rust: '#9c694a',
  red: '#be7651', wood: '#867047', woodLight: '#b49661',
});
const VARIANTS = Object.freeze({sign: 3, handcart: 3, canvas: 3, toolroll: 2, fieldbag: 2, wire: 2, basin: 1});

function nearRect(x, y, radius, o) {
  const dx = x - Math.max(o.x, Math.min(o.x + o.w, x));
  const dy = y - Math.max(o.y, Math.min(o.y + o.h, y));
  return dx * dx + dy * dy < radius * radius;
}

// These positions sit beside existing routes/buildings, rather than across them.
// Signs use pictograms so they remain legible without tiny decorative lettering.
const COMMON = [
  ['sign', 388, 865, 0, 18],
  ['sign', 689, 681, 1, 18],
  ['sign', 1196, 304, 2, 18],
  ['handcart', 1000, 875, 0, 24],
  ['canvas', 505, 771, 0, 14],
  ['canvas', 665, 392, 1, 14],
  ['toolroll', 1121, 379, 0, 14],
  ['handcart', 1281, 491, 1, 24],
  ['canvas', 982, 949, 2, 14],
];
const MISSION_PROPS = [
  [
    ['fieldbag', 983, 673, 0, 14],
    ['canvas', 1079, 648, 2, 14],
    ['basin', 1046, 696, 0, 14],
    ['handcart', 442, 742, 2, 24],
  ],
  [
    ['wire', 812, 263, 0, 14],
    ['toolroll', 1298, 664, 1, 14],
    ['handcart', 1050, 421, 1, 24],
    ['wire', 776, 373, 1, 14],
    ['canvas', 1376, 552, 1, 14],
  ],
  [
    ['fieldbag', 876, 589, 1, 14],
    ['wire', 1157, 569, 1, 14],
    ['canvas', 931, 364, 2, 14],
    ['handcart', 1028, 689, 0, 24],
  ],
];

export function buildScenery(state) {
  const world = state?.world;
  if (!world) return [];
  const mission = Math.max(0, Math.min(2, Math.floor(Number(state.mission) || 0)));
  const protectedPoints = [{x: 220, y: 970, r: 70}];
  if (state.extraction) protectedPoints.push({...state.extraction, r: state.extraction.r + 20});
  for (const person of state.civilians || []) protectedPoints.push({x: person.x, y: person.y, r: 64});
  if (state.objective?.zone) protectedPoints.push({...state.objective.zone, r: state.objective.zone.r + 34});
  for (const device of state.objective?.targets || []) protectedPoints.push({x: device.x, y: device.y, r: 62});
  const props = [];
  for (const [type, x, y, variant, radius] of [...COMMON, ...MISSION_PROPS[mission]]) {
    if (x < 30 || y < 40 || x > world.width - 50 || y > world.height - 35) continue;
    if (protectedPoints.some(point => Math.hypot(x - point.x, y - point.y) < point.r)) continue;
    // Keep the sprite footprint clear of actual cover. Existing roof weathering
    // is handled separately, so destruction cannot leave floating decorations.
    if ((world.obstacles || []).some(o => nearRect(x, y, radius + 3, o))) continue;
    props.push({scenery: true, type, x, y, variant, radius, h: 0});
    if (props.length === LIMIT) break;
  }
  return props;
}

/** Call once on the terrain context after roads and existing static decorations. */
export function paintSceneryGround(c, state, props) {
  c.save();
  c.lineCap = 'round';
  for (const prop of props) {
    const {x, y, type, variant} = prop;
    if (type === 'handcart') {
      // A shallow, broken wheel rut leads only to the abandoned open frame.
      c.strokeStyle = 'rgba(80,89,57,.22)';c.lineWidth = 2;
      for (const side of [-9, 9]) {
        c.beginPath();c.moveTo(x + side - 4, y + 28);
        c.quadraticCurveTo(x + side - 3, y + 12, x + side, y + 5);c.stroke();
      }
      c.fillStyle = 'rgba(194,173,116,.25)';
      c.fillRect(x - 14, y + 8, 25, 2);c.fillRect(x - 12, y + 16, 16, 1);
    } else if (type === 'wire') {
      // A short slack cable stays local to its reel and never resembles a fence.
      c.strokeStyle = 'rgba(47,73,47,.43)';c.lineWidth = 1;
      c.beginPath();c.moveTo(x - 3, y + 3);
      c.bezierCurveTo(x - 16, y + 5, x - 7, y + 18, x - 22, y + 14);c.stroke();
      c.strokeStyle = 'rgba(194,184,136,.24)';
      c.beginPath();c.moveTo(x - 3, y + 4);
      c.bezierCurveTo(x - 16, y + 6, x - 7, y + 19, x - 22, y + 15);c.stroke();
    } else {
      c.fillStyle = 'rgba(143,151,98,.19)';
      c.beginPath();c.ellipse(x + 1, y + 2, type === 'sign' ? 10 : 17, 7, .13, 0, TAU);c.fill();
    }
    // Two or three tiny fragments suggest use without turning every margin busy.
    c.fillStyle = 'rgba(193,169,117,.45)';
    c.fillRect(x + 16, y + 8, 3, 1);c.fillRect(x + 12 + variant, y + 12, 2, 1);
    c.fillStyle = 'rgba(65,93,54,.3)';c.fillRect(x - 17, y + 7, 3, 1);
  }
  for (const hut of state.world?.obstacles || []) {
    if (hut.type !== 'hut') continue;
    const x = hut.x + hut.w / 2, y = hut.y + hut.h;
    // Worn foot traffic below the existing doorstep; no new geometry.
    c.fillStyle = 'rgba(194,170,117,.31)';
    c.beginPath();c.ellipse(x, y + 8, 17, 7, 0, 0, TAU);c.fill();
    c.fillStyle = 'rgba(90,104,61,.28)';
    c.fillRect(x - 12, y + 7, 4, 1);c.fillRect(x + 5, y + 11, 3, 1);
  }
  c.restore();
}

/**
 * Cache at most 16 authored sprite variants. paint() only draws the cached image.
 * Anchors are world ground points: add props to Renderer.objects, sort with y+h,
 * and call painter.paint(c, prop) when prop.scenery is true. No animation state.
 */
export class SceneryPainter {
  constructor() { this.cache = new Map(); }
  paint(c, prop, _options = {}) {
    const count = VARIANTS[prop.type];
    if (!count) return;
    const variant = Math.max(0, Math.min(count - 1, Math.floor(Number(prop.variant) || 0)));
    const key = `${prop.type}:${variant}`;
    let art = this.cache.get(key);
    if (!art) {
      art = document.createElement('canvas');art.width = 96;art.height = 80;
      const a = art.getContext('2d');a.imageSmoothingEnabled = false;
      a.translate(48, 60);paintProp(a, prop.type, variant);
      this.cache.set(key, art);
    }
    c.drawImage(art, Math.round(prop.x) - 48, Math.round(prop.y) - 60);
  }
}

function contact(c, width = 15, height = 4) {
  c.fillStyle = 'rgba(31,56,34,.22)';
  c.beginPath();c.ellipse(3, 3, width, height, .12, 0, TAU);c.fill();
}

function paintProp(c, type, variant) {
  const p = COLORS;
  contact(c, type === 'handcart' ? 23 : type === 'sign' ? 8 : 14);
  if (type === 'sign') {
    // A narrow timber marker, with a carved route arrow and familiar pictogram.
    c.fillStyle = p.dark;c.fillRect(-2, -25, 4, 30);
    c.fillStyle = p.wood;c.fillRect(-1, -25, 2, 28);
    c.fillStyle = p.woodLight;c.fillRect(-1, -24, 1, 26);
    c.fillStyle = '#4d563a';c.fillRect(-16, -28, 32, 12);
    c.fillStyle = '#b0a47a';c.fillRect(-15, -27, 29, 9);
    c.fillStyle = p.paper;c.fillRect(-15, -27, 27, 1);
    c.fillStyle = '#817b50';c.fillRect(-14, -20, 27, 2);
    c.fillStyle = p.dark;
    c.fillRect(1, -24, 8, 2);c.fillRect(7, -26, 2, 6);c.fillRect(9, -25, 2, 4);c.fillRect(11, -24, 2, 2);
    if (variant === 0) {
      c.fillStyle = p.teal;c.fillRect(-12, -24, 7, 5);c.fillRect(-10, -26, 3, 2);
      c.fillStyle = p.paper;c.fillRect(-10, -22, 2, 3);
    } else if (variant === 1) {
      c.fillStyle = p.teal;c.fillRect(-10, -24, 2, 5);c.fillRect(-12, -26, 2, 3);c.fillRect(-8, -26, 2, 3);
    } else {
      c.fillStyle = p.teal;c.fillRect(-11, -25, 2, 6);c.fillRect(-13, -23, 6, 2);
      c.fillRect(-12, -20, 4, 1);
    }
    c.fillStyle = '#a08c61';c.fillRect(-14, -25, 2, 1);c.fillRect(4, -19, 3, 1);
    c.fillStyle = '#5e6949';c.fillRect(-16, -17, 4, 1);c.fillRect(12, -27, 3, 2);
    c.fillStyle = p.paper;c.fillRect(-1, -25, 1, 1);c.fillRect(-1, -18, 1, 1);
  } else if (type === 'handcart') {
    // A collapsed/open wooden cart reads as shallow debris, never solid cover.
    // Grass remains visible between slats; the missing wheel is on the ground.
    c.fillStyle = '#45523b';c.fillRect(-19, -6, 35, 2);c.fillRect(-19, 5, 35, 2);
    c.fillStyle = p.wood;c.fillRect(-19, -7, 31, 1);c.fillRect(-19, 4, 33, 1);
    for (const x of [-17, -9, 0, 9]) {
      c.fillStyle = p.wood;c.fillRect(x, -5, 4, 11);
      c.fillStyle = p.woodLight;c.fillRect(x, -5, 1, 10);
      c.fillStyle = '#625b3b';c.fillRect(x + 1, 3, 2, 2);
    }
    c.strokeStyle = '#766643';c.lineWidth = 2;c.beginPath();
    c.moveTo(13, -5);c.lineTo(26, -10);c.moveTo(13, 5);c.lineTo(22, 10);c.stroke();
    c.strokeStyle = '#b19763';c.lineWidth = 1;c.beginPath();c.moveTo(14, -6);c.lineTo(26, -11);c.stroke();
    c.fillStyle = '#354635';c.fillRect(-16, -10, 6, 4);c.fillRect(-13, -11, 3, 6);
    c.fillStyle = '#9c9b70';c.fillRect(-15, -10, 3, 1);
    c.strokeStyle = '#3c4a34';c.lineWidth = 3;c.beginPath();c.ellipse(-22, 7, 5, 3, -.3, 0, TAU);c.stroke();
    c.strokeStyle = '#9b9062';c.lineWidth = 1;c.beginPath();c.ellipse(-22, 6, 4, 2, -.3, 0, TAU);c.stroke();
    c.fillStyle = p.rust;c.fillRect(-19, -6, 2, 2);c.fillRect(11, 3, 2, 2);
    if (variant === 0) {
      c.fillStyle = '#5b7b54';c.fillRect(-9, -6, 14, 5);
      c.fillStyle = '#8a9b68';c.fillRect(-9, -6, 12, 1);c.fillRect(-5, -5, 1, 3);
      c.fillStyle = '#a7ac75';c.fillRect(4, -6, 1, 4);
    } else if (variant === 1) {
      c.fillStyle = p.rust;c.fillRect(-11, -3, 4, 3);c.fillRect(2, -1, 6, 2);
      c.fillStyle = '#bb986b';c.fillRect(-10, -3, 2, 1);c.fillRect(4, -1, 3, 1);
    } else {
      c.fillStyle = p.canvas;c.fillRect(-11, -7, 16, 6);
      c.fillStyle = p.paper;c.fillRect(-11, -7, 14, 1);c.fillRect(-11, -6, 2, 4);
      c.fillStyle = '#8e895d';c.fillRect(-4, -6, 2, 5);c.fillRect(2, -5, 3, 4);
    }
  } else if (type === 'canvas') {
    const base = variant === 1 ? '#65846a' : variant === 2 ? '#b4a574' : '#849369';
    c.fillStyle = '#475c40';c.fillRect(-14, -7, 28, 10);
    c.fillStyle = base;c.fillRect(-13, -7, 25, 8);
    c.fillStyle = variant === 1 ? '#8da58a' : '#d2c498';c.fillRect(-12, -7, 22, 2);c.fillRect(-12, -5, 2, 5);
    c.fillStyle = '#5c704d';c.fillRect(-6, -6, 2, 7);c.fillRect(6, -6, 2, 7);
    c.fillStyle = '#a5a477';c.fillRect(-5, -6, 1, 4);c.fillRect(7, -6, 1, 4);
    c.fillStyle = '#889164';c.fillRect(-14, -6, 2, 5);c.fillRect(11, -5, 2, 4);
    c.fillStyle = '#c4bd8e';c.fillRect(10, -5, 1, 3);
  } else if (type === 'toolroll') {
    c.fillStyle = '#426448';c.fillRect(-13, -8, 27, 11);
    c.fillStyle = variant ? '#738966' : '#a79f73';c.fillRect(-12, -8, 24, 9);
    c.fillStyle = '#c9bf8a';c.fillRect(-11, -8, 21, 1);
    c.fillStyle = '#4c6546';c.fillRect(-11, -5, 21, 1);c.fillRect(-11, -2, 21, 1);
    c.fillStyle = '#8ca078';c.fillRect(-11, -4, 5, 2);c.fillRect(5, -4, 4, 2);
    c.fillStyle = '#35503b';c.fillRect(-2, -7, 4, 8);
    c.fillStyle = '#cbbd86';c.fillRect(-1, -6, 2, 2);
    c.fillStyle = '#a8aa7f';c.fillRect(-11, 1, 6, 1);c.fillRect(5, 1, 5, 1);
  } else if (type === 'fieldbag') {
    c.fillStyle = '#364f39';c.fillRect(-11, -8, 23, 11);
    c.fillStyle = variant ? '#768962' : '#a3a477';c.fillRect(-10, -7, 20, 9);
    c.fillStyle = '#c1c394';c.fillRect(-10, -7, 18, 2);
    c.fillStyle = '#4f6847';c.fillRect(-8, -4, 16, 1);c.fillRect(-8, -3, 2, 4);c.fillRect(6, -3, 2, 4);
    c.fillStyle = '#526847';c.fillRect(-4, -11, 8, 4);
    c.fillStyle = '#b7b487';c.fillRect(-3, -10, 6, 1);
    c.fillStyle = '#ded4a3';c.fillRect(-2, -5, 5, 5);
    // A worn manufacturer's tab, rather than the cross of a usable health kit.
    c.fillStyle = '#6b7d51';c.fillRect(-1, -4, 3, 1);c.fillRect(-1, -2, 2, 1);
  } else if (type === 'wire') {
    c.fillStyle = '#304b37';c.beginPath();c.ellipse(0, -3, 11, 5, 0, 0, TAU);c.fill();
    c.fillStyle = '#7e8661';c.beginPath();c.ellipse(0, -5, 11, 5, 0, 0, TAU);c.fill();
    c.fillStyle = '#b2ac7d';c.beginPath();c.ellipse(-1, -6, 10, 4, 0, 0, TAU);c.fill();
    c.strokeStyle = '#4a6550';c.lineWidth = 2;
    c.beginPath();c.ellipse(-1, -6, 6, 2, 0, 0, TAU);c.stroke();
    c.fillStyle = '#354d39';c.fillRect(-2, -7, 3, 2);
    c.fillStyle = '#918c63';c.fillRect(-9, -4, 2, 4);c.fillRect(7, -4, 2, 4);
    c.fillStyle = variant ? '#8da085' : '#b9a777';c.fillRect(-8, -4, 1, 2);
  } else if (type === 'basin') {
    c.fillStyle = '#456650';c.beginPath();c.ellipse(0, -1, 11, 5, 0, 0, TAU);c.fill();
    c.fillStyle = '#b4b9a0';c.beginPath();c.ellipse(0, -3, 11, 4, 0, 0, TAU);c.fill();
    c.fillStyle = '#648d7a';c.beginPath();c.ellipse(0, -3, 8, 2, 0, 0, TAU);c.fill();
    c.fillStyle = '#d2d5b5';c.fillRect(-7, -6, 13, 1);
    c.fillStyle = '#b5ab7e';c.fillRect(10, 1, 8, 2);c.fillStyle = '#d1c492';c.fillRect(10, 1, 7, 1);
  }
}

/** Call at the end of the existing centered hut sprite painter, before caching. */
export function paintBuildingWeathering(c, obstacle) {
  if (obstacle.type !== 'hut') return;
  const w = obstacle.w || 116, h = obstacle.h || 86;
  const left = -w / 2, right = w / 2, top = -h / 2, front = h / 2;
  const variant = Math.floor((obstacle.x + obstacle.y) / 31) % 3;
  c.save();
  // Small oxidised seams follow the established roof planes, preserving the
  // building silhouette and never pretending that a hole is traversable.
  const seams = variant === 0 ? [left + 28, right - 23] : variant === 1 ? [left + 42, right - 38] : [left + 19, right - 30];
  for (const [i, x] of seams.entries()) {
    const y = top + 8 + i * 27;
    c.fillStyle = '#8d7e53';c.fillRect(x, y, 4, 10);c.fillRect(x + 1, y + 7, 5, 5);
    c.fillStyle = '#ad8c59';c.fillRect(x + 1, y + 1, 2, 5);c.fillRect(x + 2, y + 9, 3, 1);
    c.fillStyle = '#66754e';c.fillRect(x + 5, y + 8, 2, 3);
  }
  // A short bent edge and a stitched patch give each roof its own history.
  const patchX = variant === 1 ? right - 45 : left + 9;
  const patchY = top + 27;
  c.fillStyle = '#627b55';c.fillRect(patchX, patchY, 19, 10);
  c.fillStyle = '#92a076';c.fillRect(patchX + 1, patchY, 17, 2);
  c.fillStyle = '#81916a';c.fillRect(patchX + 1, patchY + 2, 17, 6);
  c.fillStyle = '#b4b883';c.fillRect(patchX + 2, patchY + 1, 1, 1);c.fillRect(patchX + 15, patchY + 1, 1, 1);
  c.fillStyle = '#4c6442';c.fillRect(patchX + 3, patchY + 7, 12, 1);
  c.fillStyle = '#596d45';c.fillRect(right - 13, front - 21, 10, 2);
  c.fillStyle = '#b3ac75';c.fillRect(right - 13, front - 20, 8, 1);
  c.fillStyle = '#7d7650';c.fillRect(right - 6, front - 20, 2, 3);
  // Sun-worn siding and a loose shutter stay inside the existing facade.
  c.fillStyle = '#9b8d5e';c.fillRect(left + 31, front - 14, 10, 1);c.fillRect(left + 35, front - 8, 6, 1);
  c.fillStyle = '#736e48';c.fillRect(right - 10, front - 16, 2, 8);
  c.fillStyle = '#c6af7a';c.fillRect(right - 11, front - 16, 1, 7);
  c.restore();
}
