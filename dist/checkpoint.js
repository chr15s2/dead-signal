/**
 * Milestone saves for First Contact. These are simulation snapshots, separate
 * from player preferences and records. Static map art is regenerated from its
 * seed; destructible cover, casualties and the evacuation response survive.
 * Original content, MIT licensed; see the project LICENSE.
 */
import { Game, CONFIG, FIRST_CONTACT_REVISION } from './engine.js?v=0.8.0';

export const CHECKPOINT_KEY = 'dead-signal-first-contact-checkpoint';
const FORMAT = 1;
const MAX_BYTES = 512 * 1024;
const MAX_TIME = 12 * 60 * 60;
const DIFFICULTIES = new Set(['easy', 'normal', 'hard']);
const META_KEYS = ['nextId', 'nextEventId', 'accumulator', 'holdFire', 'lastShot',
  'waveTimer', 'waveCount', 'navVersion', 'messageTimer'];
const STATE_KEYS = ['status', 'mission', 'time', 'noise', 'kills', 'grenades',
  'rescueCount', 'rescueTarget', 'checkpointSequence', 'objective', 'message',
  'extraction', 'soldiers', 'leaderId', 'enemies', 'civilians', 'bullets',
  'particles', 'corpses', 'target', 'thrownGrenades', 'holdFire', 'wavesRemaining',
  'totalKills', 'events', 'playerKills', 'focusTargetId', 'focusUntil'];
const ACTOR_KEYS = new Set(['id', 'name', 'type', 'x', 'y', 'hp', 'maxHp', 'alive',
  'angle', 'shootFlash', 'cooldown', 'invulnerable', 'pathTimer', 'stuck',
  'moveAngle', 'moving', 'vx', 'vy', 'speed', 'walkPhase', 'hitFlash', 'targetId',
  'aimTimer', 'attackCooldown', 'wanderX', 'wanderY', 'active', 'reaction',
  'sightLost', 'waveSpawn', 'operationGroup', 'operationHome', 'operationResponse',
  'rescued', 'siteId', 'label', 'navVersion', 'biteTargetId', 'biteTimer', 'biteDuration']);
const ACTOR_BOOLEANS = new Set(['alive', 'moving', 'active', 'waveSpawn',
  'operationResponse', 'rescued']);
const ACTOR_STRINGS = new Set(['name', 'type', 'operationGroup', 'siteId', 'label']);
const ACTOR_NUMBERS = new Set([...ACTOR_KEYS].filter(key => !ACTOR_BOOLEANS.has(key)
  && !ACTOR_STRINGS.has(key) && !['operationHome', 'targetId', 'biteTargetId'].includes(key)));

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const integer = (value, low, high) => Number.isInteger(value) && finite(value, low, high);
const bool = value => typeof value === 'boolean';
const text = (value, limit = 240) => typeof value === 'string' && value.length <= limit;
const array = (value, limit) => Array.isArray(value) && value.length <= limit;
const keys = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const point = (value, world) => keys(value, ['x', 'y'])
  && finite(value.x, 0, world.width) && finite(value.y, 0, world.height);

function encodedSize(value) {
  return new TextEncoder().encode(value).byteLength;
}

// Direct callers are checked too. Bound traversal before cloning an unknown
// object, and never retain its references or a storage provider's objects.
function boundedClone(value) {
  let nodes = 0;
  const seen = new Set();
  const visit = (item, depth) => {
    if (++nodes > 40000 || depth > 12) throw new Error('Checkpoint is too large');
    if (typeof item === 'string') {
      if (item.length > 8192) throw new Error('Checkpoint text is too large');
    } else if (item && typeof item === 'object') {
      if (seen.has(item)) throw new Error('Checkpoint must not contain cycles');
      seen.add(item);
      const children = Object.keys(item);
      if (children.length > 1024) throw new Error('Checkpoint collection is too large');
      for (const key of children) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Invalid checkpoint key');
        visit(item[key], depth + 1);
      }
      seen.delete(item);
    } else if (typeof item === 'number' && !Number.isFinite(item)) {
      throw new Error('Checkpoint numbers must be finite');
    } else if (!['undefined', 'boolean', 'number', 'string'].includes(typeof item) && item !== null) {
      throw new Error('Invalid checkpoint value');
    }
  };
  visit(value, 0);
  const json = JSON.stringify(value);
  if (typeof json !== 'string' || json.length > MAX_BYTES || encodedSize(json) > MAX_BYTES) return null;
  return JSON.parse(json);
}

// A revision is explicit, and this additional fingerprint also catches an
// authored map/roster change if someone forgets to increment that revision.
function definition(game) {
  const world = game.world;
  const authored = {
    revision: FIRST_CONTACT_REVISION, config: CONFIG,
    world: {width: world.width, height: world.height, coastline: world.coastline,
      roads: world.roads, clearings: world.clearings, landmarks: world.landmarks,
      obstacles: world.obstacles.map(({type, x, y, w, h, district}) => ({type, x, y, w, h, district}))},
    stages: game.state.objective.stages, sites: game.state.objective.rescueSites,
    response: {delay: game.state.objective.response.delay, count: game.operationResponseCount()},
    extraction: game.extraction,
    soldiers: game.soldiers.map(({id, name, x, y, maxHp}) => ({id, name, x, y, maxHp})),
    enemies: game.enemies.map(({id, type, x, y, maxHp, operationGroup, operationHome}) =>
      ({id, type, x, y, maxHp, operationGroup, operationHome})),
    civilians: game.civilians.map(({id, x, y, siteId, label, operationGroup}) =>
      ({id, x, y, siteId, label, operationGroup})),
  };
  let hash = 2166136261;
  for (const character of JSON.stringify(authored)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

function copyActor(actor) {
  const result = {};
  for (const key of ACTOR_KEYS) if (Object.hasOwn(actor, key)) result[key] = actor[key];
  return result;
}

function snapshotGame(game, fresh) {
  const state = {};
  for (const key of STATE_KEYS) if (Object.hasOwn(game.state, key)) state[key] = game.state[key];
  state.soldiers = game.soldiers.map(copyActor);
  state.enemies = game.enemies.map(copyActor);
  state.civilians = game.civilians.map(copyActor);
  // Orders are deliberately released: continuing requires a new player gesture.
  state.target = null;
  const meta = {};
  for (const key of META_KEYS) meta[key] = game[key];
  return boundedClone({version: FORMAT, missionRevision: FIRST_CONTACT_REVISION,
    mission: 0, difficulty: game.difficulty, seed: game.seed,
    randomState: game.random.getState(), definition: definition(fresh), meta, state,
    world: {
      obstacles: game.world.obstacles.map(obstacle => ({alive: obstacle.alive,
        hp: Number.isFinite(obstacle.hp) ? obstacle.hp : null})),
      decorations: game.world.decorations.slice(fresh.world.decorations.length),
    }});
}

function validActor(actor, world) {
  if (!record(actor) || Object.keys(actor).some(key => !ACTOR_KEYS.has(key))) return false;
  if (!integer(actor.id, 1, 10000000) || !finite(actor.x, 0, world.width)
    || !finite(actor.y, 0, world.height) || !bool(actor.alive)) return false;
  for (const key of ['moveAngle', 'vx', 'vy', 'speed', 'walkPhase', 'hitFlash', 'pathTimer']) {
    if (!Number.isFinite(actor[key])) return false;
  }
  if (!bool(actor.moving)) return false;
  if (actor.name !== undefined || actor.type !== undefined) {
    for (const key of ['hp', 'maxHp', 'angle', 'shootFlash', 'cooldown', 'invulnerable']) {
      if (!Number.isFinite(actor[key])) return false;
    }
    if (!Object.hasOwn(actor, 'targetId')) return false;
  }
  for (const [key, value] of Object.entries(actor)) {
    if (ACTOR_BOOLEANS.has(key) && !bool(value)) return false;
    if (ACTOR_STRINGS.has(key) && !text(value, 80)) return false;
    if (ACTOR_NUMBERS.has(key) && !finite(value, -1000000, 1000000)) return false;
  }
  if (actor.targetId !== undefined && actor.targetId !== null && !integer(actor.targetId, 1, 10000000)) return false;
  const biteKeys = ['biteTargetId', 'biteTimer', 'biteDuration'];
  if (biteKeys.some(key => Object.hasOwn(actor, key))) {
    if (!biteKeys.every(key => Object.hasOwn(actor, key)) || actor.biteDuration !== 0.3
      || !finite(actor.biteTimer, 0, actor.biteDuration)
      || (actor.biteTimer === 0 ? actor.biteTargetId !== null
        : !integer(actor.biteTargetId, 1, 10000000))
      || (actor.biteTimer > 0 && (actor.type !== 'zombie' || !actor.alive))) return false;
  }
  if (actor.operationHome !== undefined && (!keys(actor.operationHome, ['x', 'y', 'r'])
    || !point({x: actor.operationHome.x, y: actor.operationHome.y}, world)
    || !finite(actor.operationHome.r, 1, Math.max(world.width, world.height)))) return false;
  if (actor.hp !== undefined && (!finite(actor.maxHp, 1, 1000)
    || !finite(actor.hp, 0, actor.maxHp) || actor.alive !== (actor.hp > 0))) return false;
  for (const key of ['shootFlash', 'invulnerable', 'aimTimer', 'hitFlash', 'reaction', 'sightLost']) {
    if (actor[key] !== undefined && !finite(actor[key], 0, 10)) return false;
  }
  for (const key of ['cooldown', 'attackCooldown']) {
    if (actor[key] !== undefined && !finite(actor[key], 0, 10)) return false;
  }
  if (actor.speed !== undefined && !finite(actor.speed, 0, 1000)) return false;
  if (actor.pathTimer !== undefined && !finite(actor.pathTimer, -1, 10)) return false;
  if (actor.stuck !== undefined && !finite(actor.stuck, 0, MAX_TIME)) return false;
  if (actor.navVersion !== undefined && !integer(actor.navVersion, 1, 10000)) return false;
  return true;
}

function validObjective(objective, state, fresh) {
  const original = fresh.state.objective;
  if (!keys(objective, ['type', 'phase', 'completed', 'stageCount', 'stages', 'rescueSites',
    'rescuedIds', 'label', 'detail', 'currentPoints', 'response']) || objective.type !== 'operation'
    || !integer(objective.phase, 1, 3) || objective.completed !== objective.phase
    || objective.stageCount !== original.stageCount || !array(objective.stages, 4)
    || objective.stages.length !== 4 || !same(objective.rescueSites, original.rescueSites)
    || !array(objective.rescuedIds, 2) || new Set(objective.rescuedIds).size !== objective.rescuedIds.length
    || !array(objective.currentPoints, 2) || !text(objective.label) || !text(objective.detail)) return false;
  for (let i = 0; i < 4; i++) {
    if (!same(objective.stages[i], {...original.stages[i], complete: i < objective.phase})) return false;
  }
  if (objective.label !== original.stages[objective.phase].label
    || objective.detail !== original.stages[objective.phase].detail) return false;
  const rescuedSites = state.civilians.filter(civilian => civilian.rescued).map(civilian => civilian.siteId);
  if (rescuedSites.length !== state.rescueCount || objective.rescuedIds.length !== rescuedSites.length
    || !objective.rescuedIds.every(id => rescuedSites.includes(id))) return false;
  if ((objective.phase === 1 && rescuedSites.length >= 2) || (objective.phase >= 2 && rescuedSites.length !== 2)) return false;
  if (state.checkpointSequence !== 1 + rescuedSites.length + (objective.phase === 3 ? 1 : 0)) return false;
  const guards = group => state.enemies.filter(enemy => enemy.alive && enemy.operationGroup === group).length;
  if (guards(original.stages[0].group) !== 0) return false;
  if (objective.phase === 3 && guards(original.stages[2].group) !== 0) return false;
  for (const civilian of state.civilians) if (civilian.rescued && guards(civilian.operationGroup) !== 0) return false;
  const response = objective.response;
  const maxResponse = fresh.operationResponseCount();
  if (!keys(response, ['pending', 'dueAt', 'spawned', 'count', 'delay'])
    || !bool(response.pending) || !bool(response.spawned) || response.delay !== original.response.delay
    || !integer(response.count, 0, maxResponse)) return false;
  const extra = state.enemies.filter(enemy => enemy.operationResponse === true);
  if (objective.phase < 2) {
    if (response.pending || response.spawned || response.dueAt !== null || response.count !== 0 || extra.length) return false;
  } else if (!response.pending && !response.spawned) {
    if (objective.phase === 3 || response.dueAt !== null || response.count !== 0 || extra.length) return false;
  } else {
    if (!finite(response.dueAt, 0, state.time + response.delay + 1e-8)
      || response.pending === response.spawned || response.count !== extra.length) return false;
    if (response.pending && (response.count !== 0 || response.dueAt > state.time + response.delay + 1e-8)) return false;
    if (response.spawned && (response.count < 1 || response.dueAt > state.time + 1e-8)) return false;
  }
  if (state.wavesRemaining !== (response.spawned ? 0 : 1)) return false;
  return true;
}

function validCombat(state, fresh, ids) {
  const world = fresh.world;
  for (const bullet of state.bullets) {
    if (!keys(bullet, ['x', 'y', 'vx', 'vy', 'team', 'shooterId', 'damage', 'life'])
      || !point({x: bullet.x, y: bullet.y}, world) || !finite(bullet.vx, -701, 701)
      || !finite(bullet.vy, -701, 701) || Math.abs(Math.hypot(bullet.vx, bullet.vy) - 700) > 0.001
      || !finite(bullet.life, Number.EPSILON, 1) || !ids.has(bullet.shooterId)
      || !['player', 'enemy'].includes(bullet.team)) return false;
    const shooter = [...state.soldiers, ...state.enemies].find(actor => actor.id === bullet.shooterId);
    if (!shooter || (bullet.team === 'player' ? !shooter.name : shooter.type !== 'soldier')
      || bullet.damage !== (bullet.team === 'player' ? 13 : fresh.hard ? 12 : fresh.easy ? 4 : 8)) return false;
  }
  for (const grenade of state.thrownGrenades) {
    if (!keys(grenade, ['x', 'y', 'sx', 'sy', 'tx', 'ty', 'time', 'duration', 'life', 'height'])
      || !point({x: grenade.x, y: grenade.y}, world)
      || !point({x: grenade.sx, y: grenade.sy}, world) || !point({x: grenade.tx, y: grenade.ty}, world)
      || grenade.duration !== CONFIG.grenadeFlight || !finite(grenade.time, 0, grenade.duration)
      || !finite(grenade.life, Number.EPSILON, grenade.duration)
      || Math.abs(grenade.time + grenade.life - grenade.duration) > 1e-7
      || (grenade.height !== undefined && !finite(grenade.height, 0, 73))) return false;
    const fraction = grenade.time / grenade.duration;
    if (Math.abs(grenade.x - (grenade.sx + (grenade.tx - grenade.sx) * fraction)) > 1e-7
      || Math.abs(grenade.y - (grenade.sy + (grenade.ty - grenade.sy) * fraction)) > 1e-7) return false;
  }
  for (const particle of state.particles) {
    if (!keys(particle, ['x', 'y', 'vx', 'vy', 'life', 'maxLife', 'type', 'color', 'radius'])
      || !finite(particle.x, -500, world.width + 500) || !finite(particle.y, -500, world.height + 500)
      || !finite(particle.life, Number.EPSILON, 10) || !finite(particle.maxLife, particle.life, 10)
      || !text(particle.type, 24) || !/^#[0-9a-f]{6}$/i.test(particle.color)) return false;
    for (const key of ['vx', 'vy', 'radius']) if (particle[key] !== undefined && !finite(particle[key], -1000, 1000)) return false;
  }
  let previousEvent = 0;
  for (const event of state.events) {
    if (!record(event) || Object.keys(event).length > 18 || !integer(event.id, previousEvent + 1, 10000000)
      || !text(event.type, 32) || !finite(event.time, 0, state.time + 1e-7)
      || !finite(event.x, 0, world.width) || !finite(event.y, 0, world.height)) return false;
    for (const [key, value] of Object.entries(event)) {
      if (!text(key, 32) || !(text(value, 240) || bool(value) || finite(value, -1000000, 10000000)
        || value === null)) return false;
    }
    previousEvent = event.id;
  }
  const dead = [...state.soldiers, ...state.enemies].filter(actor => !actor.alive);
  if (state.corpses.length !== dead.length) return false;
  const unused = [...dead];
  for (const corpse of state.corpses) {
    if (!keys(corpse, ['x', 'y', 'type', 'angle', 'name', 'time'])
      || !point({x: corpse.x, y: corpse.y}, world) || !finite(corpse.angle, -1000000, 1000000)
      || !finite(corpse.time, 0, state.time + 1e-7) || !['squad', 'soldier', 'zombie'].includes(corpse.type)) return false;
    const match = unused.findIndex(actor => actor.x === corpse.x && actor.y === corpse.y
      && (actor.type || 'squad') === corpse.type && actor.name === corpse.name);
    if (match < 0) return false;
    unused.splice(match, 1);
  }
  return true;
}

function hydrate(snapshot, suppliedFresh) {
  if (!keys(snapshot, ['version', 'missionRevision', 'mission', 'difficulty', 'seed', 'randomState',
    'definition', 'meta', 'state', 'world']) || snapshot.version !== FORMAT
    || snapshot.missionRevision !== FIRST_CONTACT_REVISION || snapshot.mission !== 0
    || !DIFFICULTIES.has(snapshot.difficulty) || !integer(snapshot.seed, 0, 0xffffffff)
    || !integer(snapshot.randomState, 0, 0xffffffff)) return null;
  const game = suppliedFresh || new Game({mission: 0, difficulty: snapshot.difficulty, seed: snapshot.seed});
  if (snapshot.definition !== definition(game)) return null;
  const state = snapshot.state, meta = snapshot.meta, world = snapshot.world;
  if (!keys(state, STATE_KEYS) || !keys(meta, META_KEYS) || !keys(world, ['obstacles', 'decorations'])
    || !['playing', 'paused'].includes(state.status) || state.mission !== 0 || state.target !== null
    || !finite(state.time, 0, MAX_TIME) || !finite(state.noise, 0, 100)
    || !integer(state.kills, 0, 128) || !integer(state.grenades, 0, 6)
    || !integer(state.rescueCount, 0, 2) || state.rescueTarget !== game.state.rescueTarget
    || !integer(state.checkpointSequence, 1, 4) || !text(state.message)
    || !integer(state.totalKills, 1, 128) || !bool(state.holdFire)
    || (state.playerKills !== undefined && !integer(state.playerKills, 0, state.kills))) return null;
  if (!array(state.soldiers, 3) || state.soldiers.length !== 3 || !array(state.enemies, 128)
    || !array(state.civilians, 2) || state.civilians.length !== 2 || !array(state.bullets, 128)
    || !array(state.thrownGrenades, 16) || !array(state.particles, 350)
    || !array(state.corpses, 131) || !array(state.events, CONFIG.eventLimit)
    || !array(world.obstacles, 256) || world.obstacles.length !== game.world.obstacles.length
    || !array(world.decorations, game.world.obstacles.length)) return null;
  if (!integer(meta.nextId, 1, 10000000) || !integer(meta.nextEventId, 1, 10000000)
    || !finite(meta.accumulator, 0, CONFIG.maxCatchup) || meta.holdFire !== state.holdFire
    || !point(meta.lastShot, game.world) || !finite(meta.waveTimer, 0, MAX_TIME)
    || !integer(meta.waveCount, 0, 1) || !integer(meta.navVersion, 1, 10000)
    || !finite(meta.messageTimer, -MAX_TIME, 60)) return null;
  for (let i = 0; i < world.obstacles.length; i++) {
    const saved = world.obstacles[i], original = game.world.obstacles[i];
    if (!keys(saved, ['alive', 'hp']) || !bool(saved.alive)) return null;
    if (Number.isFinite(original.hp)) {
      if (!finite(saved.hp, -1000, original.hp) || saved.alive !== (saved.hp > 0)) return null;
      original.hp = saved.hp; original.alive = saved.alive;
    } else if (saved.hp !== null || saved.alive !== true) return null;
  }
  const craterCover = new Set();
  for (const decoration of world.decorations) {
    if (!keys(decoration, ['x', 'y', 'type']) || decoration.type !== 'crater'
      || !point({x: decoration.x, y: decoration.y}, game.world)) return null;
    const obstacle = game.world.obstacles.find(cover => !cover.alive && cover.x + cover.w / 2 === decoration.x
      && cover.y + cover.h / 2 === decoration.y);
    if (!obstacle || craterCover.has(obstacle)) return null;
    craterCover.add(obstacle);
    game.world.decorations.push({...decoration});
  }
  const actors = [...state.soldiers, ...state.enemies, ...state.civilians];
  if (actors.some(actor => !validActor(actor, game.world))) return null;
  const ids = new Set(actors.map(actor => actor.id));
  if (ids.size !== actors.length || meta.nextId !== Math.max(...ids) + 1
    || actors.some(actor => actor.targetId !== undefined && actor.targetId !== null && !ids.has(actor.targetId))) return null;
  for (const actor of actors) if (actor.biteTargetId !== undefined && actor.biteTargetId !== null) {
    const victim = actors.find(candidate => candidate.id === actor.biteTargetId);
    if (!victim || victim === actor || !(victim.name || victim.type === 'soldier')) return null;
  }
  // Version 0.7 saves predate tactical focus and committed bites. Both sets of
  // fields are optional together, and absent fields resume in their idle state.
  const hasFocus = Object.hasOwn(state, 'focusTargetId') || Object.hasOwn(state, 'focusUntil');
  if (hasFocus) {
    if (!Object.hasOwn(state, 'focusTargetId') || !Object.hasOwn(state, 'focusUntil')
      || !finite(state.focusUntil, 0, state.time + 6 + 1e-7)) return null;
    if (state.focusTargetId === null) {
      if (state.focusUntil !== 0) return null;
    } else if (!integer(state.focusTargetId, 1, 10000000) || state.focusUntil <= state.time
      || !state.enemies.some(enemy => enemy.id === state.focusTargetId && enemy.alive)) return null;
  }
  for (let i = 0; i < 3; i++) {
    const saved = state.soldiers[i], original = game.soldiers[i];
    if (saved.id !== original.id || saved.name !== original.name || saved.maxHp !== original.maxHp
      || saved.type !== undefined || saved.rescued !== undefined || saved.operationGroup !== undefined) return null;
  }
  const initial = game.enemies;
  if (state.enemies.length < initial.length || state.totalKills !== state.enemies.length
    || state.kills !== state.enemies.filter(enemy => !enemy.alive).length) return null;
  for (let i = 0; i < state.enemies.length; i++) {
    const saved = state.enemies[i], original = initial[i];
    if (!['soldier', 'zombie'].includes(saved.type) || saved.name !== undefined
      || saved.maxHp !== (saved.type === 'soldier' ? game.hard ? 78 : game.easy ? 48 : 60 : game.hard ? 48 : game.easy ? 30 : 36)
      || !bool(saved.active) || !finite(saved.wanderX, -200, game.world.width + 200)
      || !finite(saved.wanderY, -200, game.world.height + 200)
      || !finite(saved.attackCooldown, 0, 10) || !finite(saved.reaction, 0, 10)
      || !finite(saved.sightLost, 0, 10)) return null;
    if (original) {
      if (saved.id !== original.id || saved.type !== original.type || saved.operationGroup !== original.operationGroup
        || !same(saved.operationHome, original.operationHome) || saved.operationResponse !== undefined) return null;
    } else if (saved.type !== 'zombie' || saved.operationResponse !== true || saved.waveSpawn !== true
      || !saved.active || saved.operationGroup !== undefined || saved.operationHome !== undefined) return null;
  }
  for (let i = 0; i < 2; i++) {
    const saved = state.civilians[i], original = game.civilians[i];
    if (saved.id !== original.id || saved.siteId !== original.siteId || saved.label !== original.label
      || saved.operationGroup !== original.operationGroup || !saved.alive || !bool(saved.rescued)
      || saved.hp !== undefined || saved.type !== undefined || saved.name !== undefined) return null;
    if (!saved.rescued && (saved.x !== original.x || saved.y !== original.y)) return null;
  }
  if (!state.soldiers.some(soldier => soldier.id === state.leaderId && soldier.alive)
    || !validObjective(state.objective, state, game) || !validCombat(state, game, ids)) return null;
  if (meta.waveCount !== (state.objective.response.spawned ? 1 : 0)
    || state.events.some(event => event.id >= meta.nextEventId)) return null;
  const extraction = state.extraction, originalExtraction = game.extraction;
  if (!keys(extraction, ['x', 'y', 'r', 'active', 'progress', 'regrouping'])
    || extraction.x !== originalExtraction.x || extraction.y !== originalExtraction.y
    || extraction.r !== originalExtraction.r || extraction.active !== (state.objective.phase === 3)
    || !finite(extraction.progress, 0, 1 - Number.EPSILON)
    || (extraction.regrouping !== undefined && !bool(extraction.regrouping))
    || (!extraction.active && extraction.progress !== 0)) return null;
  if (actors.some(actor => actor.alive && game.blocked(actor.x, actor.y, CONFIG.actorRadius))) return null;
  const savedPoints = state.objective.currentPoints;
  game.state = {...state, world: game.world, focusTargetId: state.focusTargetId ?? null,
    focusUntil: state.focusUntil ?? 0};
  game.refreshOperationObjective();
  // The evacuation point contains a copy of extraction's presentation state;
  // that copy can trail checkObjective by one physics tick. Its location and
  // readiness must match; the live extraction record is validated above.
  const stablePoints = points => points.map(({active, progress, regrouping, ...location}) => location);
  if (!same(stablePoints(savedPoints), stablePoints(game.state.objective.currentPoints))) return null;
  if (savedPoints.some(location => (location.active !== undefined && !bool(location.active))
    || (location.progress !== undefined && !finite(location.progress, 0, 1))
    || (location.regrouping !== undefined && !bool(location.regrouping)))) return null;
  for (const key of META_KEYS) game[key] = meta[key];
  // Rebuild from restored cover before accepting any new movement orders.
  game.rebuildNavigation();
  game.navVersion = meta.navVersion;
  game.random.setState(snapshot.randomState);
  game.state.status = 'paused';
  game.accumulator = 0;
  game.state.target = null;
  game.state.events = [];
  for (const actor of actors) {
    actor.path = null; actor.pathGoal = null; actor.pathTimer = 0;
    actor.moving = false; actor.vx = 0; actor.vy = 0; actor.speed = 0;
    if (actor.type === 'zombie' && actor.biteTargetId === undefined) {
      actor.biteTargetId = null; actor.biteTimer = 0; actor.biteDuration = 0.3;
    }
  }
  return game;
}

export function loadCheckpoint(storage, {mission, difficulty} = {}) {
  try {
    if ((mission !== undefined && mission !== 0) || (difficulty !== undefined && !DIFFICULTIES.has(difficulty))) return null;
    const targetStorage = storage ?? globalThis.localStorage;
    const json = targetStorage.getItem(CHECKPOINT_KEY);
    if (typeof json !== 'string' || json.length > MAX_BYTES || encodedSize(json) > MAX_BYTES) return null;
    const snapshot = boundedClone(JSON.parse(json));
    if (!snapshot || (difficulty !== undefined && snapshot.difficulty !== difficulty)) return null;
    return hydrate(boundedClone(snapshot)) ? snapshot : null;
  } catch { return null; }
}

export function saveCheckpoint(storage, game) {
  try {
    if (!record(game) || game.mission !== 0 || typeof game.random?.getState !== 'function' || !DIFFICULTIES.has(game.difficulty)
      || !integer(game.seed, 0, 0xffffffff)) return false;
    const fresh = new Game({mission: 0, difficulty: game.difficulty, seed: game.seed});
    const snapshot = snapshotGame(game, fresh);
    if (!snapshot || !hydrate(boundedClone(snapshot), fresh)) return false;
    const targetStorage = storage ?? globalThis.localStorage;
    targetStorage.setItem(CHECKPOINT_KEY, JSON.stringify(snapshot));
    return true;
  } catch { return false; }
}

export function clearCheckpoint(storage) {
  try { const targetStorage = storage ?? globalThis.localStorage; targetStorage.removeItem(CHECKPOINT_KEY); return true; }
  catch { return false; }
}

export function restoreCheckpoint(snapshot) {
  try {
    const copy = boundedClone(snapshot);
    return copy ? hydrate(copy) : null;
  } catch { return null; }
}
