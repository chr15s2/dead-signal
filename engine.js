/**
 * DEAD SIGNAL — original squad tactics simulation.
 * Dependency-free ES module. Coordinates and velocities are world pixels / second.
 * MIT licensed; see the project LICENSE.
 */

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
    subtitle: 'Two voices. One way out.',
    briefing: 'Two survivors are trapped beyond the road. Hostile patrols are holding the village, and every shot brings more infected. Rescue both survivors and extract.',
    objective: 'Rescue 2 survivors and reach extraction',
  },
  {
    id: 2,
    title: 'LAST TRANSMISSION',
    subtitle: 'Clear the signal. Bring them home.',
    briefing: 'The evacuation zone is overrun. Eliminate the patrol and the finite infected waves. When the area is secure, move any surviving squad members to the flare.',
    objective: 'Clear all hostiles and reach extraction',
  },
]);

const WIDTH = 1600;
const HEIGHT = 1200;
const CELL = 40;
const COLS = WIDTH / CELL;
const ROWS = HEIGHT / CELL;
const TAU = Math.PI * 2;
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
  return {width: WIDTH, height: HEIGHT, obstacles, decorations};
}

export class Game {
  constructor({mission = 0, difficulty = 'normal', seed = 1989} = {}) {
    this.random = makeRandom(seed);
    this.seed = seed;
    this.difficulty = difficulty;
    this.hard = difficulty === 'hard';
    this.easy = difficulty === 'easy';
    this.nextId = 1;
    this.holdFire = false;
    this.lastShot = {x: 220, y: 970};
    this.waveTimer = 0;
    this.waveCount = 0;
    this.navVersion = 0;
    this.messageTimer = 0;
    const index = clamp(Math.floor(Number(mission) || 0), 0, 2);
    this.state = {
      status: 'ready', mission: index, time: 0, noise: 0, kills: 0,
      grenades: this.easy ? 5 : 4, rescueCount: 0, rescueTarget: index === 0 ? 1 : index === 1 ? 2 : 0,
      message: MISSIONS[index].objective,
      extraction: {x: 1380, y: 220, r: 86, active: false, progress: 0},
      world: makeWorld(this.random),
      soldiers: [], leaderId: 1, enemies: [], civilians: [], bullets: [],
      particles: [], corpses: [], target: null, thrownGrenades: [],
      holdFire: false, wavesRemaining: index === 0 ? 1 : index === 1 ? 2 : 3,
      totalKills: 0,
    };
    ['FOX', 'ROOK', 'JUNE'].forEach((name, i) => {
      this.state.soldiers.push({
        id: this.nextId++, name, x: 220 - i * 28, y: 970 + i * 25,
        hp: 100, maxHp: 100, alive: true, angle: -Math.PI / 4,
        shootFlash: 0, cooldown: 0.1 + i * 0.13, invulnerable: 0,
        path: null, pathTimer: 0, stuck: 0,
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
    if (index < 2) {
      const locations = index === 0 ? [[1030, 590]] : [[829, 327], [1300, 570]];
      for (const [x, y] of locations) this.state.civilians.push({id: this.nextId++, x, y, rescued: false, alive: true});
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
    if (value && this.state.status === 'playing') this.state.status = 'paused';
    else if (!value && this.state.status === 'paused') this.state.status = 'playing';
  }

  setHoldFire(value) {
    this.holdFire = Boolean(value);
    this.state.holdFire = this.holdFire;
    this.say(this.holdFire ? 'HOLD FIRE · stay quiet' : 'WEAPONS FREE · watch the noise', 2);
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
    leader.pathTimer = 1;
    return true;
  }

  grenade(x, y) {
    const leader = this.leader;
    if (!leader || this.state.status !== 'playing' || this.state.grenades <= 0) return false;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      const nearest = this.enemies.filter(e => e.alive && dist(e, leader) < 330)
        .sort((a, b) => dist(a, leader) - dist(b, leader))[0];
      x = nearest ? nearest.x : leader.x + Math.cos(leader.angle) * 180;
      y = nearest ? nearest.y : leader.y + Math.sin(leader.angle) * 180;
    }
    const distance = Math.hypot(x - leader.x, y - leader.y);
    const scale = distance > 330 ? 330 / distance : 1;
    const tx = clamp(leader.x + (x - leader.x) * scale, 15, WIDTH - 15);
    const ty = clamp(leader.y + (y - leader.y) * scale, 15, HEIGHT - 15);
    this.state.grenades--;
    this.state.thrownGrenades.push({
      x: leader.x, y: leader.y, sx: leader.x, sy: leader.y,
      tx, ty, time: 0, duration: 0.65, life: 0.65,
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
    };
    this.state.enemies.push(enemy);
    return enemy;
  }

  say(message, duration = 3) {
    this.state.message = message;
    this.messageTimer = duration;
  }

  blocked(x, y, radius = 12) {
    if (x < radius + 4 || y < radius + 4 || x > WIDTH - radius - 4 || y > HEIGHT - radius - 4) return true;
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
    if (!this.grid) return [{x: ex, y: ey}];
    // Preserve precise destinations when a direct, body-width corridor is free.
    if (this.walkableSegment(sx, sy, ex, ey)) return [{x: ex, y: ey}];
    const toCell = (x, y) => clamp(Math.floor(y / CELL), 0, ROWS - 1) * COLS + clamp(Math.floor(x / CELL), 0, COLS - 1);
    const nearestCell = (index) => {
      if (!this.grid[index]) return index;
      const ix = index % COLS;
      const iy = Math.floor(index / COLS);
      for (let radius = 1; radius < 5; radius++) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const x = ix + dx;
            const y = iy + dy;
            if (x > 0 && y > 0 && x < COLS - 1 && y < ROWS - 1 && !this.grid[y * COLS + x]) return y * COLS + x;
          }
        }
      }
      return index;
    };
    const start = nearestCell(toCell(sx, sy));
    const end = nearestCell(toCell(ex, ey));
    if (start === end) return [{x: ex, y: ey}];
    const costs = new Float32Array(COLS * ROWS).fill(Infinity);
    const parents = new Int16Array(COLS * ROWS).fill(-1);
    const closed = new Uint8Array(COLS * ROWS);
    const heuristic = (i) => Math.hypot(i % COLS - end % COLS, Math.floor(i / COLS) - Math.floor(end / COLS));
    const open = [start];
    costs[start] = 0;
    let found = false;
    while (open.length) {
      let best = 0;
      for (let i = 1; i < open.length; i++) {
        if (costs[open[i]] + heuristic(open[i]) < costs[open[best]] + heuristic(open[best])) best = i;
      }
      const current = open.splice(best, 1)[0];
      if (current === end) { found = true; break; }
      if (closed[current]) continue;
      closed[current] = 1;
      const cx = current % COLS;
      const cy = Math.floor(current / COLS);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          const next = ny * COLS + nx;
          if (this.grid[next] || closed[next]) continue;
          // A diagonal cannot cut across the corner of cover.
          if (dx && dy && (this.grid[cy * COLS + nx] || this.grid[ny * COLS + cx])) continue;
          const cost = costs[current] + (dx && dy ? 1.4142 : 1);
          if (cost >= costs[next]) continue;
          costs[next] = cost;
          parents[next] = current;
          if (!open.includes(next)) open.push(next);
        }
      }
    }
    if (!found) return [];
    const path = [];
    for (let current = end; current !== start && current >= 0; current = parents[current]) {
      path.push({x: (current % COLS) * CELL + CELL / 2, y: Math.floor(current / COLS) * CELL + CELL / 2});
    }
    path.reverse();
    if (!this.blocked(ex, ey, 15)) path.push({x: ex, y: ey});
    return path;
  }

  walkableSegment(sx, sy, ex, ey) {
    const length = Math.hypot(ex - sx, ey - sy);
    const steps = Math.ceil(length / 15);
    for (let i = 1; i <= steps; i++) {
      if (this.blocked(sx + (ex - sx) * i / steps, sy + (ey - sy) * i / steps, 15)) return false;
    }
    return true;
  }

  moveActor(actor, vx, vy, dt, radius = 12) {
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
    if (Math.abs(vx) + Math.abs(vy) > 1) actor.angle = Math.atan2(vy, vx);
    return Math.hypot(actor.x - oldX, actor.y - oldY);
  }

  navigate(actor, x, y, speed, dt) {
    const distance = Math.hypot(x - actor.x, y - actor.y);
    if (distance < 10) { actor.path = null; return; }
    actor.pathTimer -= dt;
    if (actor.pathTimer <= 0 || !actor.path || actor.navVersion !== this.navVersion) {
      actor.path = this.findPath(actor.x, actor.y, x, y);
      actor.pathTimer = 0.75 + this.random() * 0.35;
      actor.navVersion = this.navVersion;
    }
    let point = actor.path && actor.path[0];
    while (point && Math.hypot(point.x - actor.x, point.y - actor.y) < 12) {
      actor.path.shift();
      point = actor.path[0];
    }
    if (!point) point = {x, y};
    const dx = point.x - actor.x;
    const dy = point.y - actor.y;
    const length = Math.hypot(dx, dy);
    const actual = this.moveActor(actor, dx / Math.max(1, length) * speed, dy / Math.max(1, length) * speed, dt);
    actor.stuck = actual < speed * dt * 0.1 ? (actor.stuck || 0) + dt : 0;
    if (actor.stuck > 0.55) actor.pathTimer = 0;
  }

  fire(shooter, target, team) {
    const angle = Math.atan2(target.y - shooter.y, target.x - shooter.x);
    shooter.angle = angle;
    shooter.shootFlash = 0.075;
    const spread = team === 'player' ? 0.018 : 0.07;
    const actualAngle = angle + (this.random() - 0.5) * spread;
    this.state.bullets.push({
      x: shooter.x + Math.cos(angle) * 15, y: shooter.y + Math.sin(angle) * 15,
      vx: Math.cos(actualAngle) * 700, vy: Math.sin(actualAngle) * 700,
      team, shooterId: shooter.id, damage: team === 'player' ? 13 : (this.hard ? 12 : this.easy ? 4 : 8),
      life: team === 'player' ? 0.56 : 0.45,
    });
    shooter.cooldown = team === 'player' ? 0.28 + this.random() * 0.04 : 0.83 + this.random() * 0.25;
    this.state.noise = clamp(this.state.noise + (team === 'player' ? 2.8 : 1.2), 0, 100);
    this.lastShot = {x: shooter.x, y: shooter.y};
  }

  damage(actor, amount, source = 'player') {
    if (!actor.alive || actor.invulnerable > 0) return;
    actor.hp = Math.max(0, actor.hp - amount);
    if (actor.name) actor.invulnerable = 0.13;
    this.puff(actor.x, actor.y, actor.type === 'zombie' ? '#a8bf54' : '#d77569', 3, 'hit');
    if (actor.hp > 0) return;
    actor.alive = false;
    this.state.corpses.push({x: actor.x, y: actor.y, type: actor.type || 'squad', angle: actor.angle, name: actor.name});
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

  puff(x, y, color, count = 8, type = 'spark') {
    for (let i = 0; i < count; i++) {
      const angle = this.random() * TAU;
      const speed = 20 + this.random() * 80;
      const life = 0.2 + this.random() * 0.4;
      this.state.particles.push({x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life, type, color});
    }
  }

  explode(x, y, radius = 112, damage = 105, chain = false) {
    this.puff(x, y, '#ffcd62', 24, 'explosion');
    this.puff(x, y, '#b66739', 12, 'smoke');
    this.state.particles.push({x, y, life: 0.38, maxLife: 0.38, radius, type: 'ring', color: '#ffd26a'});
    this.state.noise = clamp(this.state.noise + 30, 0, 100);
    this.lastShot = {x, y};
    for (const enemy of this.enemies) {
      const distance = Math.hypot(enemy.x - x, enemy.y - y);
      if (enemy.alive && distance < radius) this.damage(enemy, damage * (1 - distance / (radius * 1.3)), 'player');
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
    for (const point of chains) this.explode(point.x, point.y, 88, 85, true);
  }

  update(dt, input = {}) {
    if (this.state.status !== 'playing') return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Ignore time spent suspended in a background tab; small steps prevent tunnelling.
    let remaining = Math.min(dt, 0.15);
    while (remaining > 0.000001 && this.state.status === 'playing') {
      const step = Math.min(remaining, 1 / 30);
      this.step(step, input || {});
      remaining -= step;
    }
  }

  step(dt, input) {
    const state = this.state;
    state.time += dt;
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
      this.moveActor(leader, mx * 142, my * 142, dt);
    } else if (state.target) {
      this.navigate(leader, state.target.x, state.target.y, 142, dt);
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
        const back = leader.angle + Math.PI;
        const destination = this.nearestOpen(
          leader.x + Math.cos(back) * 32 + Math.cos(back + Math.PI / 2) * side * 24,
          leader.y + Math.sin(back) * 32 + Math.sin(back + Math.PI / 2) * side * 24,
        );
        const gap = dist(soldier, leader);
        if (gap > 45) this.navigate(soldier, destination.x, destination.y, gap > 180 ? 205 : 162, dt);
        // A trapped follower can regroup after an extended blockage.
        if (soldier.stuck > 4 && gap > 220) {
          soldier.x = destination.x;
          soldier.y = destination.y;
          soldier.stuck = 0;
        }
      }
      const shouldFire = input.fire === true || (!this.holdFire && input.fire !== false);
      if (!shouldFire || soldier.cooldown > 0) continue;
      let target = null;
      if (input.aim && Number.isFinite(input.aim.x) && Number.isFinite(input.aim.y)) {
        // Manual aim remains usable even when no enemy is under the reticle.
        if (input.fire === true) target = input.aim;
        else target = this.enemies.filter(e => e.alive && dist(e, soldier) < 350 && dist(e, input.aim) < 100 && this.hasLOS(soldier, e))
          .sort((a, b) => dist(a, input.aim) - dist(b, input.aim))[0];
      }
      if (!target) target = this.enemies.filter(e => e.alive && dist(e, soldier) < 350 && this.hasLOS(soldier, e))
        .sort((a, b) => dist(a, soldier) - dist(b, soldier))[0];
      if (target) this.fire(soldier, target, 'player');
    }

    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updateGrenades(dt);
    this.updateWaves(dt);
    this.updateRescue(dt);
    this.updateParticles(dt);
    this.checkObjective(dt);
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
      const opponents = enemy.type === 'zombie'
        ? [...friendly, ...living.filter(e => e.type === 'soldier')]
        : [...friendly, ...living.filter(e => e.type === 'zombie')];
      let target = null;
      let best = Infinity;
      let bestScore = Infinity;
      const sense = enemy.type === 'zombie' ? (320 + this.state.noise * 4) : 315;
      for (const candidate of opponents) {
        if (!candidate.alive) continue;
        const distance = dist(enemy, candidate);
        if (distance > sense) continue;
        if (enemy.type === 'soldier' && !this.hasLOS(enemy, candidate)) continue;
        // Patrols react to the player's squad unless an infected is at their heels.
        const score = distance * (enemy.type === 'soldier' && candidate.name ? 0.63 : 1);
        if (score >= bestScore) continue;
        best = distance;
        bestScore = score;
        target = candidate;
      }
      if (target) {
        enemy.angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
        if (enemy.type === 'soldier') {
          if (best > 235) this.navigate(enemy, target.x, target.y, 61, dt);
          else if (best < 82) {
            this.moveActor(enemy, -Math.cos(enemy.angle) * 34, -Math.sin(enemy.angle) * 34, dt);
          }
          if (best < 300 && enemy.cooldown <= 0 && this.hasLOS(enemy, target)) this.fire(enemy, target, 'enemy');
        } else if (best > 24) {
          this.navigate(enemy, target.x, target.y, this.hard ? 69 : this.easy ? 43 : 52, dt);
        } else if (enemy.attackCooldown <= 0) {
          this.damage(target, target.name ? (this.hard ? 13 : this.easy ? 5 : 8) : 15, 'zombie');
          enemy.attackCooldown = 0.95;
          this.puff(target.x, target.y, '#8eaf62', 2, 'hit');
        }
      } else if (enemy.type === 'zombie' && (this.state.noise > 15 || this.state.mission === 2)) {
        const destination = this.state.noise > 15 ? this.lastShot : leader;
        this.navigate(enemy, destination.x, destination.y, 42, dt);
      } else {
        // Slow patrols are predictable, and unaware infected don't swarm immediately.
        if (Math.hypot(enemy.x - enemy.wanderX, enemy.y - enemy.wanderY) < 20) {
          enemy.wanderX = clamp(enemy.x + (this.random() - 0.5) * 180, 60, WIDTH - 60);
          enemy.wanderY = clamp(enemy.y + (this.random() - 0.5) * 180, 60, HEIGHT - 60);
          enemy.pathTimer = 0;
        }
        this.navigate(enemy, enemy.wanderX, enemy.wanderY, enemy.type === 'zombie' ? 14 : 23, dt);
      }
      // Gentle separation keeps a horde readable and prevents perfect overlap.
      for (const other of living) {
        if (other === enemy || !other.alive) continue;
        const distance = dist(enemy, other);
        if (distance > 0 && distance < 18) {
          this.moveActor(enemy, (enemy.x - other.x) / distance * 12, (enemy.y - other.y) / distance * 12, dt, 10);
        }
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
        ? this.enemies
        : [...this.soldiers, ...this.enemies.filter(e => e.type === 'zombie')];
      for (const target of targets) {
        if (!target.alive || target.id === bullet.shooterId) continue;
        const fraction = segmentCircle(bullet.x, bullet.y, nx, ny, target.x, target.y, target.type === 'zombie' ? 12 : 11);
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
              if (hit.type === 'barrel') this.explode(hit.x + hit.w / 2, hit.y + hit.h / 2, 95, 85, true);
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

  updateWaves(dt) {
    if (this.state.wavesRemaining <= 0 || this.state.extraction.active) return;
    this.waveTimer += dt;
    const finalMission = this.state.mission === 2;
    const due = finalMission ? this.waveTimer > 11 : this.waveTimer > 8 && this.state.noise > 35;
    if (!due) return;
    this.waveTimer = 0;
    this.waveCount++;
    this.state.wavesRemaining--;
    const leader = this.leader;
    if (!leader) return;
    // Reinforcements emerge beyond the squad's immediate view.
    const angle = this.random() * TAU;
    const center = this.nearestOpen(
      clamp(leader.x + Math.cos(angle) * 470, 65, WIDTH - 65),
      clamp(leader.y + Math.sin(angle) * 470, 65, HEIGHT - 65),
    );
    const count = this.hard ? 5 : finalMission ? 4 : 3;
    for (let i = 0; i < count; i++) {
      const point = this.nearestOpen(center.x + (this.random() - 0.5) * 100, center.y + (this.random() - 0.5) * 100);
      this.spawnEnemy('zombie', point.x, point.y);
    }
    this.state.totalKills += count;
    this.say(finalMission && this.state.wavesRemaining === 0 ? 'FINAL WAVE · clear the area' : 'THE DEAD HEARD YOU · infected incoming', 3);
  }

  updateRescue(dt) {
    const leader = this.leader;
    if (!leader) return;
    for (const civilian of this.civilians) {
      if (!civilian.rescued && this.soldiers.some(s => s.alive && dist(s, civilian) < 67)) {
        civilian.rescued = true;
        this.state.rescueCount++;
        this.say(`SURVIVOR SAFE · ${this.state.rescueCount}/${this.state.rescueTarget}`, 3);
        // A survivor brings a small field supply to help a damaged squad recover.
        for (const soldier of this.soldiers) if (soldier.alive) soldier.hp = Math.min(soldier.maxHp, soldier.hp + 25);
        this.state.grenades = Math.min(6, this.state.grenades + 1);
      }
      if (civilian.rescued && dist(civilian, leader) > 85) {
        this.navigate(civilian, leader.x - 40, leader.y + 45, 175, dt);
        if (dist(civilian, leader) > 420) {
          const point = this.nearestOpen(leader.x - 40, leader.y + 45);
          civilian.x = point.x;
          civilian.y = point.y;
        }
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
    const complete = state.mission < 2
      ? state.rescueCount >= state.rescueTarget
      : state.wavesRemaining === 0 && !this.enemies.some(e => e.alive);
    if (complete && !state.extraction.active) {
      state.extraction.active = true;
      this.say('OBJECTIVE COMPLETE · get to the flare', 4);
      // The rescue itself is the objective. No extra waves appear during evacuation.
      state.wavesRemaining = 0;
    }
    if (state.extraction.active && dist(leader, state.extraction) < state.extraction.r) {
      state.extraction.progress = Math.min(1, state.extraction.progress + dt / 2.2);
      if (state.extraction.progress >= 1) {
        state.status = 'won';
        state.message = 'SQUAD EXTRACTED · signal received';
        this.puff(state.extraction.x, state.extraction.y, '#d5f68c', 32, 'spark');
      }
    } else state.extraction.progress = Math.max(0, state.extraction.progress - dt * 0.4);
  }
}
