import test from 'node:test';
import assert from 'node:assert/strict';
import {Game, CONFIG} from '../dist/engine.js';
import {CHECKPOINT_KEY, loadCheckpoint, saveCheckpoint, clearCheckpoint, restoreCheckpoint} from '../dist/checkpoint.js';

function memoryStorage() {
  const values = new Map();
  return {values, writes: 0,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); this.writes++; },
    removeItem(key) { values.delete(key); },
  };
}

function entryCheckpoint(difficulty = 'normal', seed = 1989) {
  const game = new Game({difficulty, seed}).start();
  const entrance = game.state.objective.stages[0];
  assert.equal(game.moveTo(entrance.x, entrance.y), true);
  for (let frame = 0; frame < 60 * 90 && !game.state.checkpointSequence && game.state.status === 'playing'; frame++) {
    game.update(CONFIG.step);
  }
  assert.equal(game.state.status, 'playing');
  assert.equal(game.state.checkpointSequence, 1);
  assert.equal(game.state.objective.phase, 1);
  return game;
}

function saved(game = entryCheckpoint()) {
  const storage = memoryStorage();
  assert.equal(saveCheckpoint(storage, game), true);
  const snapshot = loadCheckpoint(storage);
  assert.ok(snapshot);
  return {game, storage, snapshot};
}

// Later-stage fixtures retain the full authored actor roster and use ordinary
// damage, rescue and objective updates. Positioning isolates checkpoint behavior
// from the combat/pacing playthroughs in operation.test.mjs.
function positionSquad(game, point) {
  for (const [index, soldier] of game.soldiers.filter(actor => actor.alive).entries()) {
    Object.assign(soldier, game.nearestOpen(point.x - index * 28, point.y + index * 28));
    soldier.path = null;
  }
  for (const [index, civilian] of game.civilians.filter(actor => actor.rescued).entries()) {
    Object.assign(civilian, game.nearestOpen(point.x - 50 - index * 30, point.y + 50 + index * 30));
    civilian.path = null;
  }
  game.state.target = null;
}

function clearGroup(game, group) {
  for (const enemy of game.enemies) if (enemy.alive && enemy.operationGroup === group) game.damage(enemy, enemy.hp);
}

function rescueSite(game, siteId) {
  clearGroup(game, siteId);
  const civilian = game.civilians.find(actor => actor.siteId === siteId);
  positionSquad(game, {x: civilian.x - 24, y: civilian.y});
  game.update(CONFIG.step, {fire: false});
  assert.equal(civilian.rescued, true);
}

function harbourCheckpoint() {
  const game = entryCheckpoint();
  rescueSite(game, 'school');
  rescueSite(game, 'clinic');
  const harbour = game.state.objective.stages[2];
  clearGroup(game, harbour.group);
  positionSquad(game, harbour);
  game.update(CONFIG.step, {fire: false});
  assert.equal(game.state.objective.phase, 3);
  assert.equal(game.state.checkpointSequence, 4);
  assert.equal(game.state.objective.response.pending, true);
  return game;
}

function simulationFacts(game) {
  return {
    time: game.state.time, noise: game.state.noise, grenades: game.state.grenades,
    kills: game.state.kills, rescueCount: game.state.rescueCount,
    phase: game.state.objective.phase, rescuedIds: [...game.state.objective.rescuedIds],
    response: {...game.state.objective.response}, checkpointSequence: game.state.checkpointSequence,
    actors: [...game.soldiers, ...game.enemies, ...game.civilians].map(actor => ({
      id: actor.id, x: actor.x, y: actor.y, hp: actor.hp, alive: actor.alive,
      rescued: actor.rescued, cooldown: actor.cooldown, invulnerable: actor.invulnerable,
    })),
    cover: game.world.obstacles.map(cover => ({hp: cover.hp, alive: cover.alive})),
    bullets: structuredClone(game.bullets), thrownGrenades: structuredClone(game.state.thrownGrenades),
    corpses: game.corpses.map(({x, y, type, angle, name, time}) => ({x, y, type, angle, name, time})),
    nextId: game.nextId, nextEventId: game.nextEventId,
    randomState: game.random.getState(), holdFire: game.holdFire,
    lastShot: {...game.lastShot}, waveCount: game.waveCount, waveTimer: game.waveTimer,
    navVersion: game.navVersion, messageTimer: game.messageTimer,
  };
}

test('real opening combat creates restorable checkpoints at every difficulty', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const {game, snapshot} = saved(entryCheckpoint(difficulty));
    const restored = restoreCheckpoint(snapshot);
    assert.ok(restored);
    assert.equal(restored.state.status, 'paused');
    assert.deepEqual(simulationFacts(restored), simulationFacts(game));
    assert.equal(restored.state.target, null);
    assert.equal(restored.accumulator, 0);
    assert.deepEqual(restored.state.events, []);
    assert.ok(restored.soldiers.every(actor => actor.path === null && !actor.moving));
    const before = simulationFacts(restored);
    restored.update(2, {moveX: 1, fire: true});
    assert.deepEqual(simulationFacts(restored), before, 'a restore needs an explicit resume gesture');
  }
});

test('casualties, selected leader, damaged cover and in-flight combat survive without healing or revival', () => {
  const game = entryCheckpoint();
  game.damage(game.soldiers[1], 100);
  game.damage(game.soldiers[2], 14);
  assert.equal(game.selectSoldier(game.soldiers[2].id), true);
  const hut = game.world.obstacles.find(cover => cover.type === 'hut' && cover.alive);
  game.explode(hut.x + hut.w / 2, hut.y + hut.h / 2, CONFIG.grenadeRadius, 105);
  assert.equal(hut.alive, false);
  game.setHoldFire(true);
  game.grenade(game.leader.x + 120, game.leader.y + 80);
  game.fire(game.leader, {x: game.leader.x + 100, y: game.leader.y}, 'player');
  const {snapshot} = saved(game);
  const restored = restoreCheckpoint(snapshot);
  assert.deepEqual(simulationFacts(restored), simulationFacts(game));
  assert.equal(restored.soldiers[1].alive, false);
  assert.equal(restored.soldiers[1].hp, 0);
  assert.equal(restored.leaderId, game.soldiers[2].id);
  assert.equal(restored.world.obstacles.find(cover => cover.x === hut.x && cover.y === hut.y).alive, false);
  assert.deepEqual(restored.world.decorations, game.world.decorations);
  assert.equal(restored.world.obstacles.find(cover => cover.type === 'tree').hp, Infinity);
  assert.equal(restored.blocked(hut.x + hut.w / 2, hut.y + hut.h / 2), false);
});

test('each rescue updates the saved milestone and retains the chosen rescue order', () => {
  const game = entryCheckpoint();
  for (const [index, site] of ['school', 'clinic'].entries()) {
    rescueSite(game, site);
    const {snapshot} = saved(game);
    const restored = restoreCheckpoint(snapshot);
    assert.equal(restored.state.checkpointSequence, index + 2);
    assert.equal(restored.state.rescueCount, index + 1);
    assert.deepEqual(restored.state.objective.rescuedIds, ['school', 'clinic'].slice(0, index + 1));
    assert.equal(restored.civilians.filter(actor => actor.rescued).length, index + 1);
    assert.deepEqual(simulationFacts(restored), simulationFacts(game));
  }
});

test('a pending alarm resumes from its original due time and produces only one finite response', () => {
  const {game, snapshot} = saved(harbourCheckpoint());
  const originalDue = game.state.objective.response.dueAt;
  const first = restoreCheckpoint(snapshot), second = restoreCheckpoint(snapshot);
  assert.equal(first.state.objective.response.dueAt, originalDue);
  first.pause(false); second.pause(false);
  for (let frame = 0; frame < 60 * 5; frame++) {
    first.update(CONFIG.step, {fire: false});
    second.update(CONFIG.step, {fire: false});
  }
  assert.deepEqual(simulationFacts(first), simulationFacts(second));
  assert.equal(first.state.objective.response.spawned, true);
  assert.equal(first.state.objective.response.pending, false);
  const count = first.enemies.filter(actor => actor.operationResponse).length;
  assert.equal(count, first.operationResponseCount());
  assert.equal(first.waveCount, 1);
  const restoredAgain = restoreCheckpoint(saved(first).snapshot);
  assert.equal(restoredAgain.enemies.filter(actor => actor.operationResponse).length, count);
  restoredAgain.pause(false);
  for (let frame = 0; frame < 60 * 6 && restoredAgain.state.status === 'playing'; frame++) {
    restoredAgain.update(CONFIG.step, {fire: false});
  }
  assert.equal(restoredAgain.enemies.filter(actor => actor.operationResponse).length, count);
  assert.equal(restoredAgain.waveCount, 1);
});

test('restores are detached and do not replay the event journal or mutate the snapshot', () => {
  const {game, storage, snapshot} = saved();
  const serialized = JSON.stringify(snapshot);
  const first = restoreCheckpoint(snapshot), second = restoreCheckpoint(snapshot);
  assert.equal(JSON.stringify(snapshot), serialized);
  first.soldiers[0].hp = 1;
  first.world.obstacles[0].alive = false;
  assert.notEqual(second.soldiers[0].hp, 1);
  assert.equal(second.world.obstacles[0].alive, snapshot.world.obstacles[0].alive);
  game.soldiers[0].hp = 1;
  assert.notEqual(loadCheckpoint(storage).state.soldiers[0].hp, 1);
  assert.deepEqual(second.state.events, []);
  assert.equal(second.nextEventId, snapshot.meta.nextEventId);
  assert.equal(JSON.stringify(snapshot), serialized);
  const expectedRandom = game.random.getState();
  const randomCopy = restoreCheckpoint(snapshot);
  assert.equal(randomCopy.random.getState(), expectedRandom);
  assert.deepEqual(Array.from({length: 20}, () => randomCopy.random()),
    Array.from({length: 20}, () => game.random()));
});

test('corrupt or incompatible simulation records are rejected on both load and direct restore', () => {
  const {snapshot} = saved();
  const cases = [
    ['format', value => value.version++],
    ['mission revision', value => value.missionRevision++],
    ['authored definition', value => value.definition = 'old-map'],
    ['other mission', value => value.mission = 1],
    ['unknown difficulty', value => value.difficulty = 'nightmare'],
    ['wrong difficulty roster', value => value.difficulty = 'hard'],
    ['negative time', value => value.state.time = -1],
    ['unbounded time', value => value.state.time = 1e20],
    ['dead with HP', value => value.state.soldiers[0].alive = false],
    ['missing HP', value => delete value.state.soldiers[0].hp],
    ['missing movement timer', value => delete value.state.soldiers[0].pathTimer],
    ['duplicate actor ID', value => value.state.enemies[0].id = value.state.soldiers[0].id],
    ['missing enemy roster', value => value.state.enemies.pop()],
    ['invalid target reference', value => value.state.soldiers[0].targetId = 9000000],
    ['dead selected leader', value => value.state.leaderId = 9000000],
    ['actor in solid cover', value => {
      value.state.soldiers[0].x = 600; value.state.soldiers[0].y = 1510;
    }],
    ['nonfinite number', value => value.state.soldiers[0].x = Infinity],
    ['immutable cover destruction', value => {
      const game = new Game({seed: value.seed});
      value.world.obstacles[game.world.obstacles.findIndex(cover => cover.type === 'tree')].alive = false;
    }],
    ['alive destructible cover with zero HP', value => value.world.obstacles[0].hp = 0],
    ['invented crater', value => value.world.decorations.push({x: 200, y: 200, type: 'crater'})],
    ['incoherent phase', value => value.state.objective.phase = 3],
    ['incoherent stage completion', value => value.state.objective.stages[0].complete = false],
    ['incoherent rescue count', value => value.state.rescueCount = 1],
    ['invented rescue', value => value.state.objective.rescuedIds.push('clinic')],
    ['incoherent checkpoint sequence', value => value.state.checkpointSequence = 4],
    ['missing corpse', value => value.state.corpses.pop()],
    ['invalid next ID', value => value.meta.nextId = 3],
    ['invalid next event ID', value => value.meta.nextEventId = 1],
    ['incoherent hold fire', value => value.meta.holdFire = !value.state.holdFire],
    ['premature extraction', value => value.state.extraction.active = true],
    ['premature response', value => value.state.objective.response.pending = true],
    ['unbounded array', value => value.state.bullets = Array(2000).fill({})],
  ];
  for (const [name, mutate] of cases) {
    const corrupted = structuredClone(snapshot);
    mutate(corrupted);
    assert.equal(restoreCheckpoint(corrupted), null, name);
    const storage = memoryStorage();
    storage.setItem(CHECKPOINT_KEY, JSON.stringify(corrupted));
    assert.equal(loadCheckpoint(storage), null, `load: ${name}`);
  }
});

test('storage failures, invalid JSON, oversized saves and unsupported missions are graceful', () => {
  const game = entryCheckpoint();
  const denied = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('SecurityError'); },
  };
  assert.equal(loadCheckpoint(denied), null);
  assert.equal(saveCheckpoint(denied, game), false);
  assert.equal(clearCheckpoint(denied), false);
  const storage = memoryStorage();
  for (const json of ['{broken', 'null', '[]', 'true', '{"version":1}', 'x'.repeat(512 * 1024 + 1)]) {
    storage.setItem(CHECKPOINT_KEY, json);
    assert.equal(loadCheckpoint(storage), null);
  }
  const cyclic = {}; cyclic.state = cyclic;
  assert.equal(restoreCheckpoint(cyclic), null);
  assert.equal(restoreCheckpoint({state: '😀'.repeat(300000)}), null);
  assert.equal(saveCheckpoint(storage, new Game().start()), false, 'no milestone reached yet');
  assert.equal(saveCheckpoint(storage, new Game({mission: 1}).start()), false);
  assert.equal(saveCheckpoint(storage, new Game({mission: 2}).start()), false);
  assert.equal(saveCheckpoint(storage, null), false);
  assert.equal(restoreCheckpoint(undefined), null);
});

test('difficulty filtering preserves a valid checkpoint until fresh-start or victory explicitly clears it', () => {
  const {storage, snapshot} = saved();
  const original = storage.getItem(CHECKPOINT_KEY);
  assert.equal(loadCheckpoint(storage, {mission: 0, difficulty: 'hard'}), null);
  assert.equal(loadCheckpoint(storage, {mission: 1}), null);
  assert.equal(storage.getItem(CHECKPOINT_KEY), original);
  assert.deepEqual(loadCheckpoint(storage, {mission: 0, difficulty: 'normal'}), snapshot);
  assert.equal(clearCheckpoint(storage), true);
  assert.equal(loadCheckpoint(storage), null);
  assert.equal(clearCheckpoint(storage), true);
});

test('default browser storage is optional and a denied global getter is handled', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    const storage = memoryStorage(), game = entryCheckpoint();
    Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: storage});
    assert.equal(saveCheckpoint(undefined, game), true);
    assert.ok(loadCheckpoint(undefined));
    assert.equal(clearCheckpoint(undefined), true);
    Object.defineProperty(globalThis, 'localStorage', {configurable: true,
      get() { throw new Error('SecurityError'); }});
    assert.equal(saveCheckpoint(undefined, game), false);
    assert.equal(loadCheckpoint(undefined), null);
    assert.equal(clearCheckpoint(undefined), false);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

test('legacy format-one checkpoints default missing tactical fields without healing or losing progress', () => {
  const {game, snapshot} = saved();
  const legacy = structuredClone(snapshot);
  delete legacy.state.focusTargetId;
  delete legacy.state.focusUntil;
  for (const actor of [...legacy.state.soldiers, ...legacy.state.enemies, ...legacy.state.civilians]) {
    delete actor.biteTargetId; delete actor.biteTimer; delete actor.biteDuration;
  }
  const restored = restoreCheckpoint(legacy);
  assert.ok(restored);
  assert.equal(restored.state.focusTargetId, null);
  assert.equal(restored.state.focusUntil, 0);
  assert.ok(restored.enemies.filter(actor => actor.type === 'zombie').every(actor => actor.biteTargetId === null && actor.biteTimer === 0));
  assert.deepEqual(simulationFacts(restored), simulationFacts(game));
  assert.equal(restored.state.status, 'paused');
});

test('an active focus order and partially wound-up bite retain their exact simulation deadline and victim', () => {
  const game = entryCheckpoint();
  game.setHoldFire(true);
  const zombie = game.enemies.find(actor => actor.alive && actor.type === 'zombie');
  const leader = game.leader;
  const point = Array.from({length: 16}, (_, index) => {
    const angle = index * Math.PI / 8;
    return {x: leader.x + Math.cos(angle) * 24, y: leader.y + Math.sin(angle) * 24};
  }).find(point => !game.blocked(point.x, point.y, CONFIG.actorRadius) && game.hasLOS(point, leader));
  assert.ok(point);
  Object.assign(zombie, point, {cooldown: 0, attackCooldown: 0, active: true});
  game.focusTarget(zombie.id);
  game.updateEnemies(CONFIG.step);
  assert.equal(zombie.biteTargetId, leader.id);
  game.updateEnemies(.1);
  assert.ok(zombie.biteTimer > 0 && zombie.biteTimer < .3);
  const {snapshot} = saved(game);
  const restored = restoreCheckpoint(snapshot);
  assert.ok(restored);
  assert.equal(restored.state.focusTargetId, zombie.id);
  assert.equal(restored.state.focusUntil, game.state.focusUntil);
  const restoredZombie = restored.enemies.find(actor => actor.id === zombie.id);
  assert.deepEqual([restoredZombie.biteTargetId, restoredZombie.biteTimer, restoredZombie.biteDuration],
    [zombie.biteTargetId, zombie.biteTimer, zombie.biteDuration]);
  assert.equal(restored.random.getState(), game.random.getState());
  const before = restoredZombie.biteTimer;
  restored.update(10);
  assert.equal(restoredZombie.biteTimer, before, 'restored attack remains paused until explicit resume');
  const second = restoreCheckpoint(snapshot);
  restored.pause(false); second.pause(false);
  for (let frame = 0; frame < 30; frame++) { restored.update(CONFIG.step); second.update(CONFIG.step); }
  assert.deepEqual(simulationFacts(restored), simulationFacts(second));
  assert.equal(restored.state.focusTargetId, second.state.focusTargetId);
  assert.equal(restoredZombie.biteTimer, second.enemies.find(actor => actor.id === zombie.id).biteTimer);
  for (const invalid of [
    value => value.state.focusTargetId = 999999,
    value => value.state.focusUntil = value.state.time + 100,
    value => value.state.enemies.find(actor => actor.id === zombie.id).biteTargetId = 999999,
    value => value.state.enemies.find(actor => actor.id === zombie.id).biteTimer = 10,
  ]) {
    const corrupted = structuredClone(snapshot); invalid(corrupted);
    assert.equal(restoreCheckpoint(corrupted), null);
  }
});
