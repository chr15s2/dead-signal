/**
 * DEAD SIGNAL — original squad tactics simulation.
 * Dependency-free ES module. Coordinates and velocities are world pixels / second.
 * MIT licensed; see the project LICENSE.
 */
import { findRoute } from './navigation.js?v=0.5.0';

export const MISSIONS = Object.freeze([
  {
    id: 0,
    title: 'FIRST CONTACT',
    subtitle: 'The village has gone quiet.',
    briefing: 'Find the stranded radio operator, then get your squad to the evacuation flare. Your guns draw the dead. Keep moving and use the fighting to your advantage.',
    objective: 'Rescue 1 survivor and reach extraction',
  },
  {
    id: 1,
    title: 'BAD FREQUENCY',
    subtitle: 'Break the interference.',
    briefing: 'Two hostile jammers are blocking the evacuation frequency. Destroy both marked antennas with gunfire or grenades, then get your squad to the flare. Your squad fires at a jammer when nearby hostiles are dealt with.',
    objective: 'Destroy 2 jammers and reach extraction',
  },
  {
    id: 2,
    title: 'LAST TRANSMISSION',
    subtitle: 'Keep the signal alive.',
    briefing: 'Reach the radio relay and keep your selected soldier inside its marked perimeter for 25 seconds. Three infected waves will answer the signal. Step outside to dodge or regroup; transmission progress is saved. Then bring your squad to the flare.',
    objective: 'Transmit for 25 seconds and reach extraction',
  },
]);

const WIDTH = 1600;
const HEIGHT = 1200;
const CELL = 40;
const COLS = WIDTH / CELL;
const ROWS = HEIGHT / CELL;
const TAU = Math.PI * 2;
// Gameplay tuning lives together; all rates are per simulation second.
export const CONFIG = Object.freeze({
  step: 1 / 60, maxCatchup: 0.15, actorRadius: 11,
  squadSpeed: 142, followSpeed: 162, catchupSpeed: 205,
  weaponRange: 230, enemyRange: 225, activationRadius: 590,
  grenadeRadius: 112, grenadeRange: 330, grenadeFlight: 0.65,
  extractionSeconds: 2.2, eventLimit: 128,
});
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function makeRandom(seed) {
  let value = Number(seed) >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pointRect(x, y, r, o) {
  const dx = x - clamp(x, o.x, o.x + o.w);
  const dy = y - clamp(y, o.y, o.y + o.h);
  return dx * dx + dy * dy < r * r;
}

// Returns the fraction of a segment at its first intersection with a rectangle.
function segmentRect(ax, ay, bx, by, o) {
  let min = 0;
  let max = 1;
  const dx = bx - ax;
  const dy = by - ay;
  for (const [start, delta, low, high] of [
    [ax, dx, o.x, o.x + o.w],
    [ay, dy, o.y, o.y + o.h],
  ]) {
    if (Math.abs(delta) < 0.00001) {
      if (start < low || start > high) return null;
    } else {
      let t1 = (low - start) / delta;
      let t2 = (high - start) / delta;
      if (t1 > t2) [t1, t2] = [t2, t1];
      min = Math.max(min, t1);
      max = Math.min(max, t2);
      if (min > max) return null;
    }
  }
  return min;
}

function segmentCircle(ax, ay, bx, by, x, y, r) {
  const dx = bx - ax;
  const dy = by - ay;
  const a = dx * dx + dy * dy;
  if (a < 0.00001) return Math.hypot(ax - x, ay - y) < r ? 0 : null;
  const ox = ax - x;
  const oy = ay - y;
  const b = 2 * (ox * dx + oy * dy);
  const c = ox * ox + oy * oy - r * r;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : c <= 0 ? 0 : null;
}

function makeWorld(random) {
  const obstacles = [];
  const put = (type, x, y, w, h) => obstacles.push({
    x, y, w, h, type,
    hp: type === 'barrel' ? 24 : type === 'hut' ? 160 : Infinity,
    alive: true,
  });
  // Broad routes remain open across the map. Huts have traversable gaps.
  for (const [x, y] of [[525, 750], [710, 425], [1080, 710], [1140, 345], [865, 180]]) {
    put('hut', x, y, 116, 86);
  }
  for (const [x, y] of [[382, 800], [515, 475], [895, 675], [1070, 170], [1280, 600], [725, 960], [295, 420]]) {
    put('rock', x, y, 50, 36);
  }
  for (const [x, y] of [[642, 757], [679, 457], [845, 441], [1126, 721], [1263, 356], [856, 283], [955, 614]]) {
    put('barrel', x, y, 23, 27);
  }
  for (const [x, y] of [
    [105, 160], [171, 207], [214, 170], [319, 171], [362, 258], [220, 348],
    [157, 526], [199, 578], [302, 634], [421, 603], [457, 113], [512, 181],
    [569, 313], [636, 231], [752, 103], [982, 77], [1137, 89], [1254, 113],
    [1426, 425], [1463, 542], [1475, 647], [1406, 768], [1329, 927],
    [1420, 1047], [1167, 1047], [1049, 992], [973, 1078], [855, 1089],
    [584, 1067], [430, 1014], [310, 1098], [91, 1076], [107, 821],
  ]) put('tree', x, y, 25, 27);

  const decorations = [];
  for (let i = 0; i < 320; i++) {
    decorations.push({
      x: 30 + random() * (WIDTH - 60),
      y: 30 + random() * (HEIGHT - 60),
      type: i % 16 === 0 ? 'flower' : i % 7 === 0 ? 'dirt' : 'grass',
      variant: Math.floor(random() * 4),
    });
  }
  for (const [x, y] of [[577, 687], [819, 547], [1240, 480], [982, 893], [482, 918]]) {
    decorations.push({x, y, type: 'crater'});
  }
  // The same boundary is consumed by movement and rendering: water is solid.
  const coastline = [
    [-10, 102], [180, 47], [710, 76], [955, 54], [1160, 90], [1340, 60],
    [1490, 210], [1528, 495], [1482, 645], [1538, 780], [1513, 945],
    [1549, 1090], [1555, 1210],
  ].map(([x, y]) => ({x, y}));
  return {width: WIDTH, height: HEIGHT, obstacles, decorations, coastline};
}

export class Game {
  constructor({mission = 0, difficulty = 'normal', seed = 1989} = {}) {
    this.random = makeRandom(seed);
    this.seed = seed;
    this.difficulty = difficulty;
    this.hard = difficulty === 'hard';
    this.easy = difficulty === 'easy';
    this.nextId = 1;
    this.nextEventId = 1;
    this.accumulator = 0;
    this.holdFire = false;
    this.lastShot = {x: 220, y: 970};
    this.waveTimer = 0;
    this.waveCount = 0;
    this.navVersion = 0;
    this.messageTimer = 0;
    const index = clamp(Math.floor(Number(mission) || 0), 0, 2);
    this.state = {
      status: 'ready', mission: index, time: 0, noise: 0, kills: 0,
      grenades: this.easy ? 5 : 4, rescueCount: 0, rescueTarget: index === 0 ? 1 : 0,
      objective: index === 0 ? {type: 'rescue'} : index === 1
        ? {type: 'sabotage', targets: []}
        : {type: 'holdout', zone: {x: 1020, y: 520, r: 110}, duration: 25,
          held: 0, started: false, inside: false, elapsed: 0},
      message: MISSIONS[index].objective,
      extraction: {x: 1380, y: 220, r: 86, active: false, progress: 0},
      world: makeWorld(this.random),
      soldiers: [], leaderId: 1, enemies: [], civilians: [], bullets: [],
      particles: [], corpses: [], target: null, thrownGrenades: [],
      holdFire: false, wavesRemaining: index === 0 ? 1 : index === 1 ? 2 : 3,
      totalKills: 0,
      events: [],
    };
    ['FOX', 'ROOK', 'JUNE'].forEach((name, i) => {
      this.state.soldiers.push({
        id: this.nextId++, name, x: 220 - i * 28, y: 970 + i * 25,
        hp: 100, maxHp: 100, alive: true, angle: -Math.PI / 4,
        shootFlash: 0, cooldown: 0.1 + i * 0.13, invulnerable: 0,
        path: null, pathTimer: 0, stuck: 0,
        moveAngle: -Math.PI / 4, moving: false, vx: 0, vy: 0,
        speed: 0, walkPhase: i * 2, hitFlash: 0, targetId: null,
      });
    });
    const patrols = index === 0
      ? [[680, 685], [810, 570], [1005, 510], [1205, 665]]
      : index === 1
        ? [[505, 675], [765, 545], [900, 420], [1085, 550], [1240, 485], [1180, 840]]
        : [[510, 677], [640, 515], [885, 532], [985, 310], [1290, 462], [1190, 800], [970, 908], [1380, 650]];
    const infected = index === 0
      ? [[430, 905], [479, 947], [770, 810], [920, 815], [1130, 530], [1250, 790], [1310, 350]]
      : index === 1
        ? [[420, 910], [472, 840], [656, 900], [735, 795], [906, 793], [971, 605], [1135, 583], [1180, 937], [1320, 800], [1360, 460], [1030, 242]]
        : [[420, 913], [470, 856], [675, 860], [738, 685], [829, 867], [957, 745], [1095, 913], [1230, 860], [1300, 762], [1380, 541], [1200, 268], [1100, 480], [940, 142], [815, 371]];
    for (const [x, y] of patrols) this.spawnEnemy('soldier', x, y);
    for (const [x, y] of infected) this.spawnEnemy('zombie', x, y);
    if (index === 0) {
      for (const [x, y] of [[1030, 590]]) this.state.civilians.push({
        id: this.nextId++, x, y, rescued: false, alive: true,
        moveAngle: -Math.PI / 4, moving: false, vx: 0, vy: 0,
        speed: 0, walkPhase: 0, hitFlash: 0, pathTimer: 0,
      });
    }
    if (index === 1) {
      for (const [x, y] of [[829, 327], [1300, 570]]) this.state.objective.targets.push({
        id: this.nextId++, type: 'jammer', x, y, r: 18,
        hp: 90, maxHp: 90, alive: true, hitFlash: 0,
      });
    }
    this.rebuildNavigation();
    this.state.totalKills = this.state.enemies.length;
  }

  // Renderers may use the state object or these convenient aliases.
  get world() { return this.state.world; }
  get soldiers() { return this.state.soldiers; }
  get enemies() { return this.state.enemies; }
  get civilians() { return this.state.civilians; }
  get bullets() { return this.state.bullets; }
  get particles() { return this.state.particles; }
  get corpses() { return this.state.corpses; }
  get extraction() { return this.state.extraction; }
  get leaderId() { return this.state.leaderId; }
  get leader() { return this.soldiers.find(s => s.id === this.state.leaderId && s.alive) || this.soldiers.find(s => s.alive); }
  get mission() { return this.state.mission; }
  get target() { return this.state.target; }

  start() {
    if (this.state.status === 'ready') this.state.status = 'playing';
    return this;
  }

  pause(value = true) {
    this.accumulator = 0;
    if (value && this.state.status === 'playing') this.state.status = 'paused';
    else if (!value && this.state.status === 'paused') this.state.status = 'playing';
  }

  setHoldFire(value) {
    if (this.holdFire === Boolean(value)) return;
    this.holdFire = Boolean(value);
    this.state.holdFire = this.holdFire;
    this.say(this.holdFire ? 'HOLD FIRE · stay quiet' : 'WEAPONS FREE · watch the noise', 2);
    this.emit('holdfire', this.leader || this.lastShot, {enabled: this.holdFire, team: 'player'});
  }

  selectSoldier(id) {
    if (!this.soldiers.some(s => s.id === id && s.alive)) return false;
    this.state.leaderId = id;
    this.state.target = null;
    for (const soldier of this.soldiers) soldier.path = null;
    return true;
  }

  moveTo(x, y) {
    const leader = this.leader;
    if (!leader || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const destination = this.nearestOpen(clamp(x, 22, WIDTH - 22), clamp(y, 22, HEIGHT - 22));
    this.state.target = destination;
    leader.path = this.findPath(leader.x, leader.y, destination.x, destination.y);
    if (!leader.path.length) { this.state.target = null; return false; }
    leader.pathTimer = 1;
    leader.pathGoal = destination;
    this.emit('order', destination, {actorId: leader.id});
    return true;
  }

  grenade(x, y) {
    const leader = this.leader;
    if (!leader || this.state.status !== 'playing' || this.state.grenades <= 0) return false;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      const nearby = candidates => candidates.filter(e => e.alive && dist(e, leader) < CONFIG.grenadeRange)
        .sort((a, b) => dist(a, leader) - dist(b, leader))[0];
      const nearest = nearby(this.enemies) || nearby(this.state.objective.targets || []);
      x = nearest ? nearest.x : leader.x + Math.cos(leader.angle) * 180;
      y = nearest ? nearest.y : leader.y + Math.sin(leader.angle) * 180;
    }
    const distance = Math.hypot(x - leader.x, y - leader.y);
    const scale = distance > CONFIG.grenadeRange ? CONFIG.grenadeRange / distance : 1;
    const tx = clamp(leader.x + (x - leader.x) * scale, 15, WIDTH - 15);
    const ty = clamp(leader.y + (y - leader.y) * scale, 15, HEIGHT - 15);
    this.state.grenades--;
    this.state.thrownGrenades.push({
      x: leader.x, y: leader.y, sx: leader.x, sy: leader.y,
      tx, ty, time: 0, duration: CONFIG.grenadeFlight, life: CONFIG.grenadeFlight,
    });
    this.say('FRAG OUT!', 1.3);
    return true;
  }

  spawnEnemy(type, x, y) {
    const hp = type === 'soldier' ? (this.hard ? 78 : this.easy ? 48 : 60) : (this.hard ? 48 : this.easy ? 30 : 36);
    const point = this.nearestOpen(x, y, false);
    const enemy = {
      id: this.nextId++, type, x: point.x, y: point.y, hp, maxHp: hp,
      alive: true, angle: this.random() * TAU, shootFlash: 0,
      cooldown: this.random() * 0.8, attackCooldown: 0,
      path: null, pathTimer: this.random() * 0.8, targetId: null,
      wanderX: point.x + (this.random() - 0.5) * 160,
      wanderY: point.y + (this.random() - 0.5) * 160,
      invulnerable: 0,
      moveAngle: 0, moving: false, vx: 0, vy: 0, speed: 0,
      walkPhase: this.random() * TAU, hitFlash: 0,
      active: false, reaction: 0, sightLost: 0,
    };
    this.state.enemies.push(enemy);
    return enemy;
  }

  say(message, duration = 3) {
    this.state.message = message;
    this.messageTimer = duration;
  }

  // A bounded journal lets sound, effects and UI observe simulation facts once.
  emit(type, point, details = {}) {
    this.state.events.push({id: this.nextEventId++, type, time: this.state.time,
      x: point.x, y: point.y, ...details});
    if (this.state.events.length > CONFIG.eventLimit) this.state.events.shift();
  }

  blocked(x, y, radius = 12) {
    if (x < radius + 4 || y < radius + 4 || x > WIDTH - radius - 4 || y > HEIGHT - radius - 4) return true;
    const coast = this.world.coastline;
    if (coast) {
      // Each shoreline segment borders sea above (top) or right (east).
      for (let i = 1; i < coast.length; i++) {
        const a = coast[i - 1], b = coast[i];
        if (i <= 5 && x >= a.x && x <= b.x) {
          const shoreY = a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
          if (y < shoreY + radius) return true;
        } else if (i >= 6 && y >= a.y && y <= b.y) {
          const shoreX = a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y);
          if (x > shoreX - radius) return true;
        }
      }
      // The angled northeast corner has sea on its upper/right side.
      const a = coast[5], b = coast[6];
      if (x >= a.x && y <= b.y) {
        const shoreY = a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
        if (y < shoreY + radius * Math.SQRT2) return true;
      }
    }
    return this.world.obstacles.some(o => o.alive !== false && pointRect(x, y, radius, o));
  }

  nearestOpen(x, y, grid = true) {
    if (!this.blocked(x, y, 15)) return {x, y};
    for (let radius = 20; radius < 200; radius += 20) {
      for (let i = 0; i < 16; i++) {
        const nx = clamp(x + Math.cos(i * TAU / 16) * radius, 22, WIDTH - 22);
        const ny = clamp(y + Math.sin(i * TAU / 16) * radius, 22, HEIGHT - 22);
        if (!this.blocked(nx, ny, grid ? 16 : 12)) return {x: nx, y: ny};
      }
    }
    return {x: 220, y: 970};
  }

  hasLOS(a, b) {
    return !this.world.obstacles.some(o => o.alive !== false && segmentRect(a.x, a.y, b.x, b.y, o) !== null);
  }

  rebuildNavigation() {
    this.grid = new Uint8Array(COLS * ROWS);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        this.grid[y * COLS + x] = this.blocked(x * CELL + CELL / 2, y * CELL + CELL / 2, 17) ? 1 : 0;
      }
    }
    this.navVersion++;
  }

  findPath(sx, sy, ex, ey) {
    return findRoute(this, sx, sy, ex, ey);
  }

  walkableSegment(sx, sy, ex, ey, radius = 15) {
    const length = Math.hypot(ex - sx, ey - sy);
    const steps = Math.max(1, Math.ceil(length / 8));
    for (let i = 1; i <= steps; i++) {
      if (this.blocked(sx + (ex - sx) * i / steps, sy + (ey - sy) * i / steps, radius)) return false;
    }
    return true;
  }

  moveActor(actor, vx, vy, dt, radius = CONFIG.actorRadius) {
    const oldX = actor.x;
    const oldY = actor.y;
    const nx = clamp(actor.x + vx * dt, 18, WIDTH - 18);
    const ny = clamp(actor.y + vy * dt, 18, HEIGHT - 18);
    if (!this.blocked(nx, ny, radius)) {
      actor.x = nx;
      actor.y = ny;
    } else {
      // Separate axes give a forgiving slide along cover.
      if (!this.blocked(nx, actor.y, radius)) actor.x = nx;
      if (!this.blocked(actor.x, ny, radius)) actor.y = ny;
    }
    const travelled = Math.hypot(actor.x - oldX, actor.y - oldY);
    if (travelled > 0.001) {
      actor.vx += (actor.x - oldX) / dt;
      actor.vy += (actor.y - oldY) / dt;
      actor.speed = Math.hypot(actor.vx, actor.vy);
      actor.moveAngle = Math.atan2(actor.vy, actor.vx);
      actor.moving = true;
      actor.walkPhase += travelled * 0.17;
      if ((actor.aimTimer || 0) <= 0) actor.angle = actor.moveAngle;
    }
    return travelled;
  }

  navigate(actor, x, y, speed, dt) {
    // Joystick movement can stop within the smaller physical body margin.
    // Pursue a nearby clear approach point rather than requesting an impossible
    // route into that margin (and freezing a melee enemy beside its target).
    const destination = this.nearestOpen(x, y);
    const distance = Math.hypot(destination.x - actor.x, destination.y - actor.y);
    if (distance < 5) { actor.path = null; return; }
    actor.pathTimer -= dt;
    if (this.walkableSegment(actor.x, actor.y, destination.x, destination.y)) {
      // A visible moving destination should be followed now, not the position
      // it occupied when a cached route was planned up to .65 seconds ago.
      actor.path = [{x: destination.x, y: destination.y}];
      actor.pathGoal = destination;
      actor.pathTimer = 0.65;
      actor.navVersion = this.navVersion;
    } else if (actor.pathTimer <= 0 || !actor.path || actor.navVersion !== this.navVersion
      || !actor.pathGoal || dist(actor.pathGoal, destination) > 28) {
      actor.path = this.findPath(actor.x, actor.y, destination.x, destination.y);
      actor.pathTimer = actor.path.length ? 0.65 : 0.25;
      actor.pathGoal = destination;
      actor.navVersion = this.navVersion;
    }
    let point = actor.path && actor.path[0];
    while (point && Math.hypot(point.x - actor.x, point.y - actor.y) < (actor.path.length === 1 ? 5 : 7)) {
      actor.path.shift();
      point = actor.path[0];
    }
    // An unreachable destination means wait and replan, never walk through cover.
    if (!point) return;
    const dx = point.x - actor.x;
    const dy = point.y - actor.y;
    const length = Math.hypot(dx, dy);
    const pace = Math.min(speed, length / dt);
    const actual = this.moveActor(actor, dx / Math.max(1, length) * pace, dy / Math.max(1, length) * pace, dt);
    actor.stuck = actual < speed * dt * 0.1 ? (actor.stuck || 0) + dt : 0;
    if (actor.stuck > 0.55) actor.pathTimer = 0;
  }

  fire(shooter, target, team) {
    const angle = Math.atan2(target.y - shooter.y, target.x - shooter.x);
    shooter.angle = angle;
    shooter.shootFlash = 0.075;
    shooter.aimTimer = 0.55;
    // A squad can shoot on the move, but stopping behind cover earns precision.
    const spread = team === 'player' ? (shooter.moving ? 0.2 : 0.055) : 0.11;
    const actualAngle = angle + (this.random() - 0.5) * spread;
    this.state.bullets.push({
      x: shooter.x + Math.cos(angle) * 15, y: shooter.y + Math.sin(angle) * 15,
      vx: Math.cos(actualAngle) * 700, vy: Math.sin(actualAngle) * 700,
      team, shooterId: shooter.id, damage: team === 'player' ? 13 : (this.hard ? 12 : this.easy ? 4 : 8),
      life: (team === 'player' ? CONFIG.weaponRange + 30 : CONFIG.enemyRange + 25) / 700,
    });
    shooter.cooldown = team === 'player' ? (shooter.moving ? 0.38 : 0.30) + this.random() * 0.06 : 0.83 + this.random() * 0.25;
    this.state.noise = clamp(this.state.noise + (team === 'player' ? 2.8 : 0.4), 0, 100);
    if (team === 'player') this.lastShot = {x: shooter.x, y: shooter.y};
    this.emit('shot', shooter, {team, actorId: shooter.id, targetId: target.id, angle});
  }

  damage(actor, amount, source = 'player') {
    if (actor.type === 'jammer') { this.damageJammer(actor, amount, source); return; }
    if (!actor.alive || actor.invulnerable > 0) return;
    actor.hp = Math.max(0, actor.hp - amount);
    actor.hitFlash = 0.12;
    if (actor.name) actor.invulnerable = 0.13;
    this.puff(actor.x, actor.y, actor.type === 'zombie' ? '#a8bf54' : '#d77569', 3, 'hit');
    this.emit('hit', actor, {team: actor.name ? 'player' : actor.type === 'soldier' ? 'enemy' : 'zombie', actorId: actor.id, targetId: actor.id, source, damage: amount});
    if (actor.hp > 0) return;
    actor.alive = false;
    this.state.corpses.push({x: actor.x, y: actor.y, type: actor.type || 'squad', angle: actor.angle, name: actor.name, time: this.state.time});
    this.emit('death', actor, {team: actor.name ? 'player' : actor.type === 'soldier' ? 'enemy' : 'zombie', actorId: actor.id, targetId: actor.id, name: actor.name});
    if (!actor.name) {
      // The objective counts all eliminated hostiles, including faction fighting.
      this.state.kills++;
      if (source === 'player') this.state.playerKills = (this.state.playerKills || 0) + 1;
    } else {
      this.say(`${actor.name} IS DOWN · keep moving`, 3);
      if (actor.id === this.state.leaderId) {
        const next = this.soldiers.find(s => s.alive);
        if (next) this.state.leaderId = next.id;
      }
    }
  }

  damageJammer(target, amount, source = 'player') {
    // Objective props are not hostiles: faction combat cannot complete the
    // sabotage, and destroying equipment earns no kill, corpse or death event.
    if (!target.alive || source !== 'player' || !Number.isFinite(amount) || amount <= 0) return;
    target.hp = Math.max(0, target.hp - amount);
    target.hitFlash = 0.12;
    this.puff(target.x, target.y, '#e9b364', 3, 'hit');
    this.emit('hit', target, {team: 'objective', actorId: target.id, targetId: target.id, source, damage: amount});
    if (target.hp > 0) return;
    target.alive = false;
    this.emit('jammer-destroyed', target, {team: 'objective', actorId: target.id, targetId: target.id});
    this.puff(target.x, target.y, '#ad8959', 14, 'smoke');
    const destroyed = this.state.objective.targets.filter(device => !device.alive).length;
    this.say(`JAMMER DOWN · ${destroyed}/2 SILENCED`, 3);
  }

  puff(x, y, color, count = 8, type = 'spark') {
    for (let i = 0; i < count; i++) {
      const angle = this.random() * TAU;
      const speed = 20 + this.random() * 80;
      const life = 0.2 + this.random() * 0.4;
      this.state.particles.push({x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life, type, color});
    }
  }

  explode(x, y, radius = CONFIG.grenadeRadius, damage = 105, chain = false, source = 'player') {
    this.emit('explosion', {x, y}, {radius, chain, team: source});
    this.puff(x, y, '#ffcd62', 24, 'explosion');
    this.puff(x, y, '#b66739', 12, 'smoke');
    this.state.particles.push({x, y, life: 0.38, maxLife: 0.38, radius, type: 'ring', color: '#ffd26a'});
    this.state.noise = clamp(this.state.noise + 30, 0, 100);
    this.lastShot = {x, y};
    for (const enemy of this.enemies) {
      const distance = Math.hypot(enemy.x - x, enemy.y - y);
      if (enemy.alive && distance < radius) this.damage(enemy, damage * (1 - distance / (radius * 1.3)), source);
    }
    for (const target of this.state.objective.targets || []) {
      const distance = dist(target, {x, y});
      if (target.alive && distance < radius) this.damageJammer(target, damage * (1 - distance / (radius * 1.3)), source);
    }
    // Squad grenades are forgiving: no friendly damage, and civilians stay safe.
    let changed = false;
    const chains = [];
    for (const obstacle of this.world.obstacles) {
      if (obstacle.alive === false || !Number.isFinite(obstacle.hp)) continue;
      const distance = Math.hypot(obstacle.x + obstacle.w / 2 - x, obstacle.y + obstacle.h / 2 - y);
      if (distance >= radius + Math.max(obstacle.w, obstacle.h) / 2) continue;
      obstacle.hp -= damage * 1.8;
      if (obstacle.hp <= 0) {
        obstacle.alive = false;
        changed = true;
        this.world.decorations.push({x: obstacle.x + obstacle.w / 2, y: obstacle.y + obstacle.h / 2, type: 'crater'});
        if (obstacle.type === 'barrel') chains.push({x: obstacle.x + obstacle.w / 2, y: obstacle.y + obstacle.h / 2});
      }
    }
    if (changed) this.rebuildNavigation();
    for (const point of chains) this.explode(point.x, point.y, 88, 85, true, source);
  }

  update(dt, input = {}) {
    if (this.state.status !== 'playing') return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Physics, AI and random sampling share one clock at every display cadence.
    this.accumulator += Math.min(dt, CONFIG.maxCatchup);
    while (this.accumulator + 1e-10 >= CONFIG.step && this.state.status === 'playing') {
      this.accumulator = Math.max(0, this.accumulator - CONFIG.step);
      this.step(CONFIG.step, input || {});
    }
    if (this.state.status !== 'playing') this.accumulator = 0;
  }

  step(dt, input) {
    const state = this.state;
    state.time += dt;
    for (const actor of [...this.soldiers, ...this.enemies, ...this.civilians, ...(state.objective.targets || [])]) {
      actor.moving = false; actor.vx = 0; actor.vy = 0; actor.speed = 0;
      actor.hitFlash = Math.max(0, (actor.hitFlash || 0) - dt);
      actor.aimTimer = Math.max(0, (actor.aimTimer || 0) - dt);
    }
    state.noise = Math.max(0, state.noise - dt * 7);
    this.messageTimer -= dt;
    if (this.messageTimer <= 0) state.message = state.extraction.active ? 'EXTRACTION OPEN · follow the flare' : MISSIONS[state.mission].objective;
    const leader = this.leader;
    if (!leader) { state.status = 'lost'; state.message = 'SQUAD LOST · try a quieter approach'; return; }

    let mx = Number(input.moveX) || 0;
    let my = Number(input.moveY) || 0;
    const magnitude = Math.hypot(mx, my);
    if (magnitude > 1) { mx /= magnitude; my /= magnitude; }
    const moving = magnitude > 0.08;
    if (moving) {
      state.target = null;
      leader.path = null;
      this.moveActor(leader, mx * CONFIG.squadSpeed, my * CONFIG.squadSpeed, dt);
    } else if (state.target) {
      this.navigate(leader, state.target.x, state.target.y, CONFIG.squadSpeed, dt);
      if (dist(leader, state.target) < 14) state.target = null;
    }
    let followerIndex = 0;
    for (const soldier of this.soldiers) {
      if (!soldier.alive) continue;
      soldier.cooldown = Math.max(0, soldier.cooldown - dt);
      soldier.shootFlash = Math.max(0, soldier.shootFlash - dt);
      soldier.invulnerable = Math.max(0, soldier.invulnerable - dt);
      if (soldier !== leader) {
        followerIndex++;
        const side = followerIndex % 2 ? -1 : 1;
        const back = leader.moveAngle + Math.PI;
        const destination = this.nearestOpen(
          leader.x + Math.cos(back) * 32 + Math.cos(back + Math.PI / 2) * side * 24,
          leader.y + Math.sin(back) * 32 + Math.sin(back + Math.PI / 2) * side * 24,
        );
        const gap = dist(soldier, leader);
        if (dist(soldier, destination) > 9) this.navigate(soldier, destination.x, destination.y,
          gap > 130 ? CONFIG.catchupSpeed : CONFIG.followSpeed, dt);
      }
      const shouldFire = input.fire === true || (!this.holdFire && input.fire !== false);
      if (!shouldFire || soldier.cooldown > 0) continue;
      let target = null;
      if (input.aim && Number.isFinite(input.aim.x) && Number.isFinite(input.aim.y)) {
        // Manual aim remains usable even when no enemy is under the reticle.
        if (input.fire === true) target = input.aim;
        else target = this.acquireTarget(soldier, this.enemies, CONFIG.weaponRange,
          e => dist(e, input.aim) < 100 ? dist(e, input.aim) : Infinity);
      }
      if (!target) target = this.acquireTarget(soldier, this.enemies, CONFIG.weaponRange);
      if (!target) target = this.acquireTarget(soldier, state.objective.targets || [], CONFIG.weaponRange);
      if (target) this.fire(soldier, target, 'player');
    }

    this.updateEnemies(dt);
    this.resolveContacts();
    this.updateBullets(dt);
    this.updateGrenades(dt);
    this.updateObjective(dt);
    this.updateWaves(dt);
    this.updateRescue(dt);
    this.updateParticles(dt);
    this.checkObjective(dt);
  }

  acquireTarget(actor, candidates, range, score = candidate => dist(actor, candidate), requireLOS = true) {
    let best = null, bestScore = Infinity, retained = null, retainedScore = Infinity;
    for (const candidate of candidates) {
      if (!candidate.alive || candidate === actor || dist(actor, candidate) > range) continue;
      if (requireLOS && !this.hasLOS(actor, candidate)) continue;
      const value = score(candidate);
      if (!Number.isFinite(value)) continue;
      if (value < bestScore) { bestScore = value; best = candidate; }
      if (candidate.id === actor.targetId) { retained = candidate; retainedScore = value; }
    }
    // Keep tracking a viable enemy; a new target must be appreciably closer.
    const selected = retained && retainedScore <= bestScore * 1.25 + 12 ? retained : best;
    actor.targetId = selected?.id ?? null;
    return selected;
  }

  resolveContacts() {
    const leader = this.leader;
    const actors = [...this.soldiers, ...this.enemies, ...this.civilians.filter(c => c.rescued)].filter(a => a.alive);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < actors.length; i++) {
        for (let j = i + 1; j < actors.length; j++) {
          const a = actors[i], b = actors[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          const distance = Math.hypot(dx, dy);
          if (distance >= 22) continue;
          if (distance < 0.001) { dx = a.id < b.id ? 1 : -1; dy = 0; }
          else { dx /= distance; dy /= distance; }
          const amount = Math.min(3, (22 - distance) / 2);
          const companion = a === leader ? b : b === leader ? a : null;
          if (companion && (companion.name || companion.rescued)) {
            // Companions yield to the controlled soldier. A formation turn
            // should not shove the player sideways or out of the flare.
            // When cover prevents yielding, ordinary two-body separation
            // still applies; enemies keep their normal physical contact.
            const sign = a === leader ? 1 : -1;
            const cx = companion.x + dx * amount * 2 * sign;
            const cy = companion.y + dy * amount * 2 * sign;
            if (!this.blocked(cx, cy, CONFIG.actorRadius)) {
              companion.x = cx; companion.y = cy;
              continue;
            }
          }
          const ax = a.x - dx * amount, ay = a.y - dy * amount;
          const bx = b.x + dx * amount, by = b.y + dy * amount;
          if (!this.blocked(ax, ay, CONFIG.actorRadius)) { a.x = ax; a.y = ay; }
          if (!this.blocked(bx, by, CONFIG.actorRadius)) { b.x = bx; b.y = by; }
        }
      }
    }
  }

  updateEnemies(dt) {
    const leader = this.leader;
    if (!leader) return;
    const friendly = this.soldiers.filter(s => s.alive);
    const living = this.enemies.filter(e => e.alive);
    for (const enemy of living) {
      if (!enemy.alive) continue;
      enemy.cooldown = Math.max(0, enemy.cooldown - dt);
      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
      enemy.shootFlash = Math.max(0, enemy.shootFlash - dt);
      enemy.invulnerable = Math.max(0, enemy.invulnerable - dt);
      // Off-screen factions remain in place until the squad reaches their area.
      enemy.active ||= friendly.some(s => dist(s, enemy) < CONFIG.activationRadius);
      if (!enemy.active) continue;
      const opponents = enemy.type === 'zombie'
        ? [...friendly, ...living.filter(e => e.type === 'soldier' && e.active)]
        : [...friendly, ...living.filter(e => e.type === 'zombie' && e.active)];
      const previousTarget = enemy.targetId;
      const hearing = Math.max(0, 1 - dist(enemy, this.lastShot) / 650);
      const sense = enemy.type === 'zombie' ? 185 + this.state.noise * 2.4 * hearing : 275;
      const target = this.acquireTarget(enemy, opponents, sense,
        candidate => dist(enemy, candidate) * (enemy.type === 'soldier' && candidate.name ? 0.8 : 1),
        enemy.type === 'soldier');
      if (target && enemy.type === 'soldier') {
        if (target.id !== previousTarget) enemy.reaction = this.hard ? 0.18 : this.easy ? 0.75 : 0.35;
        enemy.reaction = Math.max(0, enemy.reaction - dt);
      }
      if (target) {
        const distance = dist(enemy, target);
        const aim = Math.atan2(target.y - enemy.y, target.x - enemy.x);
        enemy.angle = aim;
        if (enemy.type === 'soldier') {
          if (distance > 195) this.navigate(enemy, target.x, target.y, 61, dt);
          else if (distance < 82) this.moveActor(enemy, -Math.cos(aim) * 34, -Math.sin(aim) * 34, dt);
          enemy.angle = aim;
          if (distance < CONFIG.enemyRange && enemy.cooldown <= 0 && enemy.reaction <= 0 && this.hasLOS(enemy, target)) {
            this.fire(enemy, target, 'enemy');
          }
        } else if (distance > 25) {
          this.navigate(enemy, target.x, target.y, this.hard ? 69 : this.easy ? 43 : 52, dt);
        } else if (enemy.attackCooldown <= 0) {
          this.damage(target, target.name ? (this.hard ? 13 : this.easy ? 5 : 8) : 15, 'zombie');
          enemy.attackCooldown = 0.95;
        }
      } else if (enemy.waveSpawn || (enemy.type === 'zombie' && this.state.noise > 15 && dist(enemy, this.lastShot) < 650)) {
        const destination = enemy.waveSpawn ? leader : this.lastShot;
        this.navigate(enemy, destination.x, destination.y, enemy.type === 'zombie' ? 42 : 48, dt);
      } else {
        // Unaware patrols retain a short local route; quiet squads can slip past.
        if (Math.hypot(enemy.x - enemy.wanderX, enemy.y - enemy.wanderY) < 20) {
          const point = this.nearestOpen(
            clamp(enemy.x + (this.random() - 0.5) * 180, 60, WIDTH - 60),
            clamp(enemy.y + (this.random() - 0.5) * 180, 60, HEIGHT - 60));
          enemy.wanderX = point.x; enemy.wanderY = point.y; enemy.pathTimer = 0;
        }
        this.navigate(enemy, enemy.wanderX, enemy.wanderY, enemy.type === 'zombie' ? 14 : 23, dt);
      }
    }
  }

  updateBullets(dt) {
    for (const bullet of this.state.bullets) {
      if (bullet.life <= 0) continue;
      const nx = bullet.x + bullet.vx * dt;
      const ny = bullet.y + bullet.vy * dt;
      let hit = null;
      let nearest = Infinity;
      let obstacleHit = false;
      for (const obstacle of this.world.obstacles) {
        if (obstacle.alive === false) continue;
        const fraction = segmentRect(bullet.x, bullet.y, nx, ny, obstacle);
        if (fraction !== null && fraction < nearest) { nearest = fraction; hit = obstacle; obstacleHit = true; }
      }
      const targets = bullet.team === 'player'
        ? [...this.enemies, ...(this.state.objective.targets || [])]
        : [...this.soldiers, ...this.enemies.filter(e => e.type === 'zombie')];
      for (const target of targets) {
        if (!target.alive || target.id === bullet.shooterId) continue;
        const fraction = segmentCircle(bullet.x, bullet.y, nx, ny, target.x, target.y, target.r || (target.type === 'zombie' ? 12 : 11));
        if (fraction !== null && fraction < nearest) { nearest = fraction; hit = target; obstacleHit = false; }
      }
      if (hit) {
        bullet.x += (nx - bullet.x) * nearest;
        bullet.y += (ny - bullet.y) * nearest;
        bullet.life = 0;
        if (obstacleHit) {
          this.puff(bullet.x, bullet.y, '#dac893', 2);
          if (Number.isFinite(hit.hp)) {
            hit.hp -= bullet.damage;
            if (hit.hp <= 0) {
              hit.alive = false;
              this.rebuildNavigation();
              if (hit.type === 'barrel') this.explode(hit.x + hit.w / 2, hit.y + hit.h / 2, 95, 85, true, bullet.team);
              else this.puff(hit.x + hit.w / 2, hit.y + hit.h / 2, '#ad8959', 18, 'smoke');
            }
          }
        } else this.damage(hit, bullet.damage, bullet.team);
      } else {
        bullet.x = nx;
        bullet.y = ny;
        bullet.life -= dt;
        if (nx < 0 || ny < 0 || nx > WIDTH || ny > HEIGHT) bullet.life = 0;
      }
    }
    this.state.bullets = this.state.bullets.filter(b => b.life > 0);
  }

  updateGrenades(dt) {
    for (const grenade of this.state.thrownGrenades) {
      grenade.time += dt;
      grenade.life -= dt;
      const t = Math.min(1, grenade.time / grenade.duration);
      grenade.x = grenade.sx + (grenade.tx - grenade.sx) * t;
      grenade.y = grenade.sy + (grenade.ty - grenade.sy) * t;
      grenade.height = Math.sin(t * Math.PI) * 72;
      if (grenade.life <= 0) this.explode(grenade.tx, grenade.ty);
    }
    this.state.thrownGrenades = this.state.thrownGrenades.filter(g => g.life > 0);
  }

  updateObjective(dt) {
    const objective = this.state.objective;
    if (objective.type !== 'holdout' || this.state.extraction.active) return;
    const leader = this.leader;
    objective.inside = Boolean(leader && dist(leader, objective.zone) <= objective.zone.r);
    if (!objective.started && objective.inside) {
      objective.started = true;
      this.emit('holdout-start', objective.zone, {team: 'objective', duration: objective.duration});
      this.say('RELAY LIVE · hold the signal', 3);
    }
    if (!objective.started) return;
    objective.elapsed += dt;
    if (objective.inside) {
      objective.held = Math.min(objective.duration, objective.held + dt);
      if (objective.duration - objective.held < 1e-9) objective.held = objective.duration;
    }
  }

  safeWavePoint(x, y) {
    const squad = this.soldiers.filter(soldier => soldier.alive);
    const safe = point => !this.blocked(point.x, point.y, 16)
      && squad.every(soldier => dist(soldier, point) >= 330);
    const preferred = this.nearestOpen(clamp(x, 65, WIDTH - 65), clamp(y, 65, HEIGHT - 65));
    if (safe(preferred)) return preferred;
    // Clamping near the coast or cover can pull a spawn towards a soldier.
    // Search valid approaches, checking the final point against the whole squad.
    const leader = this.leader;
    const angle = Math.atan2(y - leader.y, x - leader.x);
    for (let i = 1; i <= 36; i++) {
      const direction = angle + i * TAU / 36;
      const point = this.nearestOpen(clamp(leader.x + Math.cos(direction) * 400, 65, WIDTH - 65),
        clamp(leader.y + Math.sin(direction) * 400, 65, HEIGHT - 65));
      if (safe(point)) return point;
    }
    // Three spread-out soldiers can cover every nearby approach. A finite grid
    // fallback guarantees that this never becomes an unsafe instant ambush.
    let best = null, closest = Infinity;
    for (let gy = 60; gy < HEIGHT - 60; gy += 40) {
      for (let gx = 60; gx < WIDTH - 60; gx += 40) {
        const point = {x: gx, y: gy};
        if (safe(point) && dist(point, preferred) < closest) {
          best = point; closest = dist(point, preferred);
        }
      }
    }
    return best;
  }

  updateWaves(dt) {
    if (this.state.wavesRemaining <= 0 || this.state.extraction.active) return;
    const objective = this.state.objective;
    const holdout = objective.type === 'holdout';
    if (holdout && !objective.started) return;
    if (!holdout) this.waveTimer += dt;
    const due = holdout ? objective.elapsed + 1e-9 >= this.waveCount * 8 : this.waveTimer > 8 && this.state.noise > 35;
    if (!due) return;
    this.waveTimer = 0;
    this.waveCount++;
    this.state.wavesRemaining--;
    const leader = this.leader;
    if (!leader) return;
    // Reinforcements emerge beyond the squad's immediate view.
    const angle = this.random() * TAU;
    const radius = holdout ? 400 : 470;
    const location = {x: leader.x + Math.cos(angle) * radius, y: leader.y + Math.sin(angle) * radius};
    const center = holdout ? this.safeWavePoint(location.x, location.y)
      : this.nearestOpen(clamp(location.x, 65, WIDTH - 65), clamp(location.y, 65, HEIGHT - 65));
    if (!center) {
      // An impossible spawn is postponed rather than appearing on a soldier.
      this.waveCount--; this.state.wavesRemaining++; return;
    }
    const count = this.hard ? 5 : holdout && !this.easy ? 4 : 3;
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const x = center.x + (this.random() - 0.5) * 100;
      const y = center.y + (this.random() - 0.5) * 100;
      const point = holdout ? this.safeWavePoint(x, y) : this.nearestOpen(x, y);
      if (!point) continue;
      const enemy = this.spawnEnemy('zombie', point.x, point.y);
      enemy.active = true; enemy.waveSpawn = true;
      spawned++;
    }
    this.state.totalKills += spawned;
    this.emit('wave', center, {count: spawned, remaining: this.state.wavesRemaining});
    this.say(holdout ? `${this.state.wavesRemaining === 0 ? 'FINAL WAVE' : 'SIGNAL ANSWERED'} · keep transmitting`
      : 'THE DEAD HEARD YOU · infected incoming', 3);
  }

  updateRescue(dt) {
    const leader = this.leader;
    if (!leader) return;
    for (const civilian of this.civilians) {
      if (!civilian.rescued && this.soldiers.some(s => s.alive && dist(s, civilian) < 67)) {
        civilian.rescued = true;
        this.state.rescueCount++;
        this.emit('rescue', civilian, {actorId: civilian.id, count: this.state.rescueCount});
        this.say(`SURVIVOR SAFE · ${this.state.rescueCount}/${this.state.rescueTarget}`, 3);
        // A survivor brings a small field supply to help a damaged squad recover.
        for (const soldier of this.soldiers) if (soldier.alive) soldier.hp = Math.min(soldier.maxHp, soldier.hp + 25);
        this.state.grenades = Math.min(6, this.state.grenades + 1);
      }
      if (civilian.rescued && dist(civilian, leader) > 85) {
        const point = this.nearestOpen(leader.x - 40, leader.y + 45);
        this.navigate(civilian, point.x, point.y, 175, dt);
      }
    }
  }

  updateParticles(dt) {
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.x += (particle.vx || 0) * dt;
      particle.y += (particle.vy || 0) * dt;
      if (particle.vx) particle.vx *= 0.97;
      if (particle.vy) particle.vy *= 0.97;
    }
    this.state.particles = this.particles.filter(p => p.life > 0).slice(-350);
  }

  checkObjective(dt) {
    const state = this.state;
    const leader = this.leader;
    if (!leader) { state.status = 'lost'; state.message = 'SQUAD LOST · try a quieter approach'; return; }
    const objective = state.objective;
    const complete = objective.type === 'rescue' ? state.rescueCount >= state.rescueTarget
      : objective.type === 'sabotage' ? objective.targets.every(target => !target.alive)
        : objective.held + 1e-9 >= objective.duration;
    if (complete && !state.extraction.active) {
      state.extraction.active = true;
      this.emit('objective', state.extraction, {mission: state.mission});
      this.say('OBJECTIVE COMPLETE · get to the flare', 4);
      // The marked objective is enough. No map cleanup or evacuation waves.
      state.wavesRemaining = 0;
    }
    const leaderAtFlare = dist(leader, state.extraction) < state.extraction.r;
    const squadTogether = this.soldiers.every(s => !s.alive || dist(s, state.extraction) < state.extraction.r + 28)
      && this.civilians.every(c => !c.rescued || dist(c, state.extraction) < state.extraction.r + 85);
    state.extraction.regrouping = state.extraction.active && leaderAtFlare && !squadTogether;
    if (state.extraction.regrouping) state.message = 'REGROUP AT THE FLARE · waiting for the squad';
    if (state.extraction.active && leaderAtFlare && squadTogether) {
      state.extraction.progress = Math.min(1, state.extraction.progress + dt / CONFIG.extractionSeconds);
      if (state.extraction.progress >= 1) {
        state.status = 'won';
        state.message = 'SQUAD EXTRACTED · signal received';
        this.emit('extracted', state.extraction, {survivors: this.soldiers.filter(s => s.alive).length});
        this.puff(state.extraction.x, state.extraction.y, '#d5f68c', 32, 'spark');
      }
    } else state.extraction.progress = Math.max(0, state.extraction.progress - dt * 0.4);
  }
}
