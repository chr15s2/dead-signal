/** Renderer-only combat details. The simulation owns all damage and randomness. */
const TAU = Math.PI * 2;
const LIMIT = 96;
const SHOT_LIMIT = 28;
const BULLET_LIMIT = 128;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const palette = {
  earth: ['#b6a579', '#d2bf90', '#8a8462'],
  metal: ['#f0d28c', '#c39459', '#eee0ac'],
  zombie: ['#b8c782', '#7f935e', '#d0d79d'],
  tissue: ['#b67b66', '#896858', '#cda188'],
};

function randomFor(seed) {
  let value = seed >>> 0;
  return () => {
    value = Math.imul(value, 1664525) + 1013904223 | 0;
    return (value >>> 0) / 4294967296;
  };
}

function firstRect(ax, ay, bx, by, rect) {
  let near = 0, far = 1;
  for (const [start, delta, low, high] of [
    [ax, bx - ax, rect.x, rect.x + rect.w],
    [ay, by - ay, rect.y, rect.y + rect.h],
  ]) {
    if (Math.abs(delta) < 1e-6) {
      if (start < low || start > high) return null;
    } else {
      const a = (low - start) / delta, b = (high - start) / delta;
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
      if (near > far) return null;
    }
  }
  return near;
}

function firstCircle(ax, ay, bx, by, actor) {
  const dx = bx - ax, dy = by - ay, ox = ax - actor.x, oy = ay - actor.y;
  const rr = actor.r || (actor.type === 'zombie' ? 12 : 11);
  const a = dx * dx + dy * dy;
  if (a < 1e-6) return null;
  const b = 2 * (ox * dx + oy * dy), cc = ox * ox + oy * oy - rr * rr;
  if (cc < 0) return 0;
  const determinant = b * b - 4 * a * cc;
  if (determinant < 0) return null;
  const fraction = (-b - Math.sqrt(determinant)) / (2 * a);
  return fraction >= 0 && fraction <= 1 ? fraction : null;
}

// A tiny stepped silhouette is softer than a square without a radial blur.
function cloud(c, x, y, radius, color, alpha) {
  c.fillStyle = color; c.globalAlpha = alpha;
  const r = Math.max(2, Math.round(radius));
  x = Math.round(x); y = Math.round(y);
  c.fillRect(x - r, y - r / 2, r * 2, r);
  c.fillRect(x - r / 2, y - r, r, r * 2);
  c.fillRect(x - r * .75, y - r * .75, r * 1.5, r * 1.5);
}

export class CombatEffects {
  constructor() { this.reset(); }

  reset() {
    this.state = null; this.lastEventId = 0; this.lastTime = null;
    this.groups = []; this.bullets = new Map();
    this.obstacles = []; this.actors = [];
    this.preview = false; this.reducedMotion = false;
  }

  observe(state, {reducedMotion = false, preview = false} = {}) {
    if (!state?.world) return;
    if (this.state !== state) { this.reset(); this.state = state; }
    const time = Number.isFinite(state.time) ? state.time : 0;
    const gap = this.lastTime === null ? 0 : time - this.lastTime;
    // No replay after a background interval or a backwards simulation clock.
    if (gap < 0 || gap > .25 || preview !== this.preview) {
      this.groups.length = 0; this.bullets.clear();
    }
    this.reducedMotion = reducedMotion; this.preview = preview;
    let write = 0;
    for (const group of this.groups) {
      if (time >= group.time && time - group.time < group.duration) this.groups[write++] = group;
    }
    this.groups.length = write;

    const recentHits = [];
    for (const event of state.events || []) {
      if (event.id <= this.lastEventId) continue;
      this.lastEventId = event.id;
      const age = time - event.time;
      // Only fresh facts are visible; old journal entries are acknowledged once.
      if (preview || age < 0 || age > .12 || !Number.isFinite(event.x + event.y)) continue;
      if (event.type === 'hit') recentHits.push(event);
      if (event.type === 'shot' || event.type === 'hit' || event.type === 'explosion' || event.type === 'jammer-destroyed') {
        this.add(event.type, event, event.id * 977 + (Number(state.mission) || 0) * 113);
      }
    }

    // Bullets have stable object identities but no public impact event. Infer only
    // a vanished, unexpired bullet that demonstrably reached a solid surface.
    // Actor hits, range expiry and long frame gaps never become guessed dust.
    if (!preview && gap > 0 && gap <= .12) this.observeImpacts(state, time, gap, recentHits);
    this.snapshot(state, time);
  }

  add(type, event, seed) {
    const r = randomFor(seed);
    const group = {type, x: event.x, y: event.y, time: event.time,
      duration: type === 'explosion' ? 1.45 : type === 'jammer-destroyed' ? 1.1 : type === 'shot' ? .68 : .5,
      angle: event.angle || 0, radius: event.radius || 112,
      material: event.team === 'objective' ? 'metal' : event.team === 'zombie' ? 'zombie' : 'tissue',
      particles: []};
    if (type === 'surface') {
      group.material = event.material; group.duration = .62;
      group.angle = event.angle || 0;
    }
    const count = type === 'explosion' ? 12 : type === 'jammer-destroyed' ? 7 : type === 'shot' ? 3 : 5;
    for (let i = 0; i < count; i++) {
      const angle = type === 'surface' ? group.angle + Math.PI + (r() - .5) * 2.6 : r() * TAU;
      const speed = type === 'explosion' ? 38 + r() * 84 : type === 'shot' ? 8 + r() * 15 : 15 + r() * 35;
      group.particles.push({dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed,
        phase: r(), size: 2 + r() * 3, lift: 12 + r() * 24});
    }
    if (type === 'shot') {
      let shots = 0;
      for (const current of this.groups) if (current.type === 'shot') shots++;
      if (shots >= SHOT_LIMIT) {
        const index = this.groups.findIndex(current => current.type === 'shot');
        this.groups.splice(index, 1);
      }
    }
    if (this.groups.length >= LIMIT) {
      const shot = this.groups.findIndex(current => current.type === 'shot');
      this.groups.splice(shot < 0 ? 0 : shot, 1);
    }
    this.groups.push(group);
  }

  observeImpacts(state, time, gap, hits) {
    const active = new Set(state.bullets || []);
    for (const [bullet, previous] of this.bullets) {
      if (active.has(bullet) || previous.life <= gap + .005) continue;
      const bx = previous.x + previous.vx * gap, by = previous.y + previous.vy * gap;
      let fraction = Infinity, surface = null;
      for (const obstacle of this.obstacles) {
        const crossing = firstRect(previous.x, previous.y, bx, by, obstacle);
        if (crossing !== null && crossing < fraction) { fraction = crossing; surface = obstacle; }
      }
      if (!surface) continue;
      const actors = previous.team === 'player'
        ? [...(state.enemies || []), ...(state.objective?.targets || [])]
        : [...(state.soldiers || []), ...(state.enemies || []).filter(actor => actor.type === 'zombie')];
      // Retain previous actor positions as well, including a target just killed.
      // This errs toward no dust when motion makes the collision ambiguous.
      let actorFirst = false;
      for (const actor of [...actors, ...this.actors]) {
        if (actor.id === previous.shooterId) continue;
        if (actor.team === 'player' && previous.team === 'player') continue;
        if (actor.team === 'enemy' && previous.team !== 'player' && actor.type !== 'zombie') continue;
        const crossing = firstCircle(previous.x, previous.y, bx, by, actor);
        if (crossing !== null && crossing <= fraction) { actorFirst = true; break; }
      }
      if (actorFirst) continue;
      const x = previous.x + (bx - previous.x) * fraction;
      const y = previous.y + (by - previous.y) * fraction;
      if (hits.some(hit => Math.hypot(hit.x - x, hit.y - y) < 25)) continue;
      this.add('surface', {x, y, time, angle: Math.atan2(previous.vy, previous.vx),
        material: surface.type === 'barrel' ? 'metal' : 'earth'},
      Math.round(x * 13 + y * 47 + time * 1000));
    }
  }

  snapshot(state, time) {
    this.bullets.clear();
    for (const bullet of state.bullets || []) {
      if (this.bullets.size >= BULLET_LIMIT) break;
      this.bullets.set(bullet, {
        x: bullet.x, y: bullet.y, vx: bullet.vx, vy: bullet.vy, life: bullet.life,
        team: bullet.team, shooterId: bullet.shooterId,
      });
    }
    this.obstacles = (state.world.obstacles || []).filter(obstacle => obstacle.alive !== false)
      .map(obstacle => ({x: obstacle.x, y: obstacle.y, w: obstacle.w, h: obstacle.h, type: obstacle.type}));
    this.actors = [];
    for (const [actors, team] of [[state.soldiers, 'player'], [state.enemies, 'enemy'], [state.objective?.targets, 'objective']]) {
      for (const actor of actors || []) if (actor.alive) {
        const {x, y, id, type, r} = actor;
        this.actors.push({x, y, id, type, team, r});
      }
    }
    this.lastTime = time;
  }

  // Compatibility with the simulation's older particles. Keep wall/extraction
  // sparks and smoke from a broken hut; suppress only layers replaced here.
  handlesParticle(particle, state) {
    const type = particle.type || 'spark';
    if (this.reducedMotion) return true;
    if (type === 'hit' || type === 'explosion' || type === 'ring') return true;
    if (type !== 'smoke') return false;
    if (particle.color === '#b66739') return true;
    if (particle.color !== '#ad8959') return false;
    const age = Math.max(0, (particle.maxLife || 0) - (particle.life || 0));
    // Simulation particles move once per 1/60s tick, then damp velocity by .97.
    // Undo that known displacement to distinguish jammer smoke from hut smoke.
    const ticks = Math.round(age * 60), travel = (Math.pow(.97, -ticks) - 1) / 1.8;
    const originX = particle.x - (particle.vx || 0) * travel;
    const originY = particle.y - (particle.vy || 0) * travel;
    const time = state?.time || 0;
    for (const group of this.groups) {
      if (group.type !== 'jammer-destroyed' || Math.abs(time - group.time - age) > .05) continue;
      if (Math.hypot(originX - group.x, originY - group.y) < 12) return true;
    }
    return false;
  }

  drawGround(c, state, {visible = () => true, worldPixels = value => value, reducedMotion = this.reducedMotion} = {}) {
    if (this.preview) return;
    const time = state.time || 0;
    c.save();
    for (const group of this.groups) {
      const age = time - group.time;
      if (age < 0 || age >= group.duration) continue;
      const {x, y, type} = group;
      if (!visible(x - group.radius, y - group.radius, group.radius * 2, group.radius * 2)) continue;
      if (type === 'explosion') {
        if (reducedMotion) {
          if (age > .3) continue;
          c.globalAlpha = .18; c.strokeStyle = '#e6c88d'; c.lineWidth = worldPixels(1);
          c.beginPath(); c.arc(x, y, group.radius, 0, TAU); c.stroke();
          continue;
        }
        c.globalAlpha = (1 - age / group.duration) * .13;
        c.fillStyle = '#655b40'; c.beginPath(); c.ellipse(x, y + 3, 25, 13, 0, 0, TAU); c.fill();
        if (age < .34) {
          const t = age / .34;
          c.globalAlpha = (1 - t) * .28; c.strokeStyle = '#e4d29c'; c.lineWidth = worldPixels(1.1);
          c.beginPath(); c.arc(x, y, group.radius * (.17 + .83 * t), 0, TAU); c.stroke();
        }
      } else if (type === 'shot' && !reducedMotion) {
        const p = group.particles[0], a = group.angle;
        const bounce = Math.sin(Math.min(1, age / .2) * Math.PI) * 7;
        c.globalAlpha = Math.min(1, (group.duration - age) * 3) * .8;
        c.fillStyle = '#c8af6d';
        const sx = x - Math.sin(a) * (5 + age * p.dx), sy = y + Math.cos(a) * 5 + age * p.dy;
        c.fillRect(Math.round(sx), Math.round(sy - bounce), 2, 1);
        c.globalAlpha *= .3; c.fillStyle = '#343f2c'; c.fillRect(Math.round(sx + 1), Math.round(sy + 2), 2, 1);
      }
    }
    c.restore();
  }

  drawAir(c, state, {visible = () => true, personScale = 1, reducedMotion = this.reducedMotion} = {}) {
    if (this.preview) return;
    const time = state.time || 0;
    c.save();
    for (const group of this.groups) {
      const age = time - group.time;
      if (age < 0 || age >= group.duration || !visible(group.x - 100, group.y - 100, 200, 200)) continue;
      const {x, y, type} = group;
      if (reducedMotion) {
        if (age > .25 || type === 'shot') continue;
        cloud(c, x, y - 5, type === 'explosion' ? 12 : 3,
          type === 'explosion' ? '#b6a982' : palette[group.material || 'metal'][0], .22);
        continue;
      }
      if (type === 'shot') {
        if (age > .28) continue;
        const a = group.angle;
        for (let i = 1; i < 3; i++) {
          const p = group.particles[i], t = clamp(age / .28, 0, 1);
          cloud(c, x + Math.cos(a) * (21 * personScale + age * 18) + p.dx * age * .2,
            y + Math.sin(a) * 21 * personScale - 4 * personScale - age * 14 + p.dy * age * .2,
            2 + t * 3, '#c9cbb0', (1 - t) * .13);
        }
      } else if (type === 'explosion' || type === 'jammer-destroyed') {
        const blast = type === 'explosion';
        if (blast && age < .15) {
          const t = age / .15;
          cloud(c, x, y - 5, 11 + t * 15, '#df8246', (1 - t) * .9);
          cloud(c, x - 1, y - 7, 5 + t * 7, '#f6d886', (1 - t) * .7);
        }
        const count = blast ? 6 : 3;
        for (let i = 0; i < count; i++) {
          const p = group.particles[i], t = age / group.duration;
          const fadeIn = Math.min(1, age * 14), alpha = fadeIn * (1 - t) * (blast ? .15 : .12);
          cloud(c, x + p.dx * age * .28 + age * 7, y + p.dy * age * .13 - age * p.lift,
            5 + p.phase * 5 + t * (blast ? 12 : 7), i % 2 ? '#969784' : '#b7af90', alpha);
        }
        if (age < .58) this.drawFragments(c, group, age, blast ? 'earth' : 'metal');
      } else {
        if (type === 'surface' && age < .44) {
          cloud(c, x + age * 7, y - 2 - age * 12, 4 + age * 14,
            group.material === 'metal' ? '#aea994' : '#c4b48b', (1 - age / .44) * .17);
        }
        this.drawFragments(c, group, age, group.material);
      }
    }
    c.restore();
  }

  drawFragments(c, group, age, material) {
    const life = group.type === 'explosion' ? .58 : group.type === 'jammer-destroyed' ? .46 : .3;
    if (age >= life) return;
    const colors = palette[material] || palette.earth;
    const t = age / life;
    c.globalAlpha = (1 - t) * (material === 'metal' ? .9 : .78);
    for (let i = 0; i < group.particles.length; i++) {
      const p = group.particles[i], px = Math.round(group.x + p.dx * age),
        py = Math.round(group.y - 5 + p.dy * age - Math.sin(t * Math.PI) * p.lift * .35);
      c.fillStyle = group.type === 'explosion' && i < 4 ? ['#df8b4e', '#eab872'][i % 2] : colors[i % colors.length];
      c.fillRect(px, py, material === 'metal' ? 2 : i % 3 ? 2 : 3, material === 'metal' ? 1 : 2);
    }
  }
}
