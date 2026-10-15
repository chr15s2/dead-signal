import test from 'node:test';
import assert from 'node:assert/strict';
import {Game, CONFIG} from '../dist/engine.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const advance = (game, seconds, input = {}) => {
  for (let frame = 0; frame < Math.round(seconds / CONFIG.step); frame++) game.update(CONFIG.step, input);
};
// Local combat fixtures isolate targeting and timing. Authored mission wins are
// covered separately by the public-action commander in foundations.test.mjs.
function arena(mission = 1) {
  const game = new Game({mission, seed: 1989}).start();
  game.state.enemies = [];
  game.world.obstacles = [];
  game.rebuildNavigation();
  for (const [index, soldier] of game.soldiers.entries()) {
    Object.assign(soldier, {x: 450 - index * 25, y: 700 + index * 28, path: null, cooldown: 0});
  }
  game.state.target = null;
  return game;
}
function parkFollowers(game) {
  for (const [index, soldier] of game.soldiers.slice(1).entries()) {
    Object.assign(soldier, {x: 220, y: 950 + index * 35, path: null});
  }
}

test('a six-second focus order prioritizes the marked hostile without issuing movement', () => {
  const game = arena();
  const closer = game.spawnEnemy('soldier', 525, 700);
  const marked = game.spawnEnemy('soldier', 610, 720);
  const targetBefore = game.target;
  assert.equal(game.focusTarget(marked.id), true);
  assert.equal(game.target, targetBefore);
  assert.equal(game.state.focusTargetId, marked.id);
  assert.equal(game.state.focusUntil, 6);
  game.update(CONFIG.step);
  const shots = game.state.events.filter(event => event.type === 'shot' && event.team === 'player');
  assert.equal(shots.length, 3);
  assert.ok(shots.every(event => event.targetId === marked.id));
  assert.equal(closer.hp, closer.maxHp);
});

test('focus respects Hold Fire, each soldier range and cover, and rejects invalid targets', () => {
  const game = arena();
  const focused = game.spawnEnemy('soldier', 610, 700);
  const fallback = game.spawnEnemy('zombie', 450, 790);
  game.setHoldFire(true);
  assert.equal(game.focusTargetAt(focused.x + 8, focused.y - 4), true);
  game.update(CONFIG.step);
  assert.equal(game.state.events.filter(event => event.type === 'shot' && event.team === 'player').length, 0);
  game.setHoldFire(false);
  game.world.obstacles = [{type: 'rock', x: 530, y: 660, w: 25, h: 80, hp: Infinity, alive: true}];
  assert.equal(game.hasLOS(game.leader, focused), false);
  game.update(CONFIG.step);
  assert.ok(game.state.events.filter(event => event.type === 'shot' && event.team === 'player').every(event => event.targetId === fallback.id));
  assert.equal(game.focusTarget(game.soldiers[0].id), false);
  assert.equal(game.focusTarget(-1), false);
  assert.equal(game.focusTargetAt(NaN, 1), false);
  assert.equal(game.focusTargetAt(30, 30), false);
});

test('focus lifetime uses simulation time and clears on death, expiration and new mission', () => {
  const game = arena();
  const marked = game.spawnEnemy('zombie', 750, 700);
  game.setHoldFire(true);
  game.focusTarget(marked.id);
  advance(game, 1);
  game.pause();
  const before = {time: game.state.time, until: game.state.focusUntil};
  game.update(20);
  assert.deepEqual({time: game.state.time, until: game.state.focusUntil}, before);
  game.pause(false);
  advance(game, 5.1);
  assert.equal(game.state.focusTargetId, null);
  assert.equal(game.state.focusUntil, 0);
  game.focusTarget(marked.id);
  game.damage(marked, 1000, 'player');
  game.update(CONFIG.step);
  assert.equal(game.state.focusTargetId, null);
  assert.equal(new Game({mission: 1}).state.focusTargetId, null);
  game.pause();
  assert.equal(game.focusTarget(marked.id), false);
});

test('focused jammers override automatic hostile selection while manual aim remains explicit', () => {
  const game = arena();
  const jammer = game.state.objective.targets[0];
  for (const [index, soldier] of game.soldiers.entries()) Object.assign(soldier, {x: jammer.x - 160 - index * 10, y: jammer.y + index * 24});
  const zombie = game.spawnEnemy('zombie', jammer.x - 90, jammer.y + 60);
  assert.equal(game.focusTarget(jammer.id), true);
  game.update(CONFIG.step);
  const auto = game.state.events.filter(event => event.type === 'shot' && event.team === 'player');
  assert.ok(auto.length && auto.every(event => event.targetId === jammer.id));
  for (const soldier of game.soldiers) soldier.cooldown = 0;
  game.update(CONFIG.step, {fire: true, aim: {x: zombie.x, y: zombie.y}});
  const manual = game.state.events.filter(event => event.type === 'shot' && event.team === 'player').slice(auto.length);
  assert.ok(manual.length && manual.every(event => event.targetId !== jammer.id));
});

test('hovering over another hostile cannot steal a focus order, but explicit manual fire can', () => {
  const game = arena();
  const focused = game.spawnEnemy('soldier', 610, 700);
  const hovered = game.spawnEnemy('soldier', 520, 770);
  game.focusTarget(focused.id);
  game.update(CONFIG.step, {aim: {x: hovered.x, y: hovered.y}});
  const focusedShots = game.state.events.filter(event => event.type === 'shot' && event.team === 'player');
  assert.ok(focusedShots.length && focusedShots.every(event => event.targetId === focused.id));
  for (const soldier of game.soldiers) soldier.cooldown = 0;
  game.update(CONFIG.step, {fire: true, aim: {x: hovered.x, y: hovered.y}});
  const manualShots = game.state.events.filter(event => event.type === 'shot' && event.team === 'player').slice(focusedShots.length);
  assert.ok(manualShots.length && manualShots.every(event => event.targetId !== focused.id));
});

test('grenade preview is pure, clamps manual range and matches the committed landing point', () => {
  const game = arena();
  const before = JSON.stringify(game.state), random = game.random.getState();
  const preview = game.grenadeTarget(1500, 100);
  assert.ok(Math.abs(distance(preview, game.leader) - 330) < 1e-8);
  assert.equal(JSON.stringify(game.state), before);
  assert.equal(game.random.getState(), random);
  assert.equal(game.grenade(1500, 100), true);
  const thrown = game.state.thrownGrenades.at(-1);
  assert.deepEqual({x: thrown.tx, y: thrown.ty}, preview);
  assert.equal(game.state.grenades, 3);
});

test('smart grenades prefer a valuable cluster over a lone near target and remain stable', () => {
  const game = arena();
  game.spawnEnemy('zombie', 500, 700);
  const cluster = [game.spawnEnemy('zombie', 675, 700), game.spawnEnemy('zombie', 695, 720), game.spawnEnemy('soldier', 700, 685)];
  const first = game.grenadeTarget();
  assert.ok(cluster.some(enemy => distance(enemy, first) < 1e-8));
  assert.deepEqual(game.grenadeTarget(), first);
  game.state.enemies.reverse();
  assert.deepEqual(game.grenadeTarget(), first, 'array order is not a target tiebreaker');
  const focused = game.enemies.find(enemy => enemy.x === 500);
  game.focusTarget(focused.id);
  assert.deepEqual(game.grenadeTarget(), {x: focused.x, y: focused.y});
  game.damage(focused, 1000, 'player');
  assert.ok(cluster.some(enemy => distance(enemy, game.grenadeTarget()) < 1e-8));
});

test('a grenade without nearby targets uses the facing direction and never throws beyond330px', () => {
  const game = arena();
  game.leader.angle = Math.PI;
  const target = game.grenadeTarget();
  assert.ok(target.x < game.leader.x);
  assert.ok(distance(target, game.leader) <= 330 + 1e-8);
  assert.ok(Number.isFinite(target.x) && Number.isFinite(target.y));
});

function biteArena() {
  const game = arena();
  parkFollowers(game);
  game.setHoldFire(true);
  const zombie = game.spawnEnemy('zombie', game.leader.x + 24, game.leader.y);
  zombie.cooldown = 0;
  return {game, zombie};
}

test('zombie bites announce a stationary locked-target windup before damage', () => {
  const {game, zombie} = biteArena();
  const hp = game.leader.hp;
  game.updateEnemies(CONFIG.step);
  assert.equal(game.leader.hp, hp, 'contact cannot inflict an instant bite');
  assert.equal(zombie.biteTargetId, game.leader.id);
  assert.ok(zombie.biteTimer > .28 && zombie.biteTimer <= .3);
  const position = {x: zombie.x, y: zombie.y};
  for (let frame = 0; frame < 16; frame++) game.updateEnemies(CONFIG.step);
  assert.equal(game.leader.hp, hp);
  assert.deepEqual({x: zombie.x, y: zombie.y}, position);
  for (let frame = 0; frame < 3; frame++) game.updateEnemies(CONFIG.step);
  assert.ok(game.leader.hp < hp);
  assert.equal(zombie.biteTargetId, null);
  assert.equal(zombie.biteTimer, 0);
});

test('moving out or breaking line of sight makes the committed bite miss', () => {
  for (const dodge of ['range', 'cover', 'death']) {
    const {game, zombie} = biteArena();
    const target = game.leader, hp = target.hp;
    game.updateEnemies(CONFIG.step);
    if (dodge === 'range') target.y += 80;
    else if (dodge === 'cover') game.world.obstacles = [{type: 'rock', x: target.x + 10, y: target.y - 10, w: 3, h: 20, hp: Infinity, alive: true}];
    else game.damage(target, 1000, 'enemy');
    const bystander = game.soldiers[1];
    Object.assign(bystander, {x: zombie.x, y: zombie.y + 24});
    const bystanderHp = bystander.hp;
    for (let frame = 0; frame < 20; frame++) game.updateEnemies(CONFIG.step);
    if (dodge !== 'death') assert.equal(target.hp, hp, dodge);
    assert.equal(bystander.hp, bystanderHp, 'a committed bite cannot retarget another nearby soldier');
    assert.equal(zombie.biteTargetId, null);
  }
});

test('bite windup freezes while paused and remains deterministic across frame rates', () => {
  const {game, zombie} = biteArena();
  game.update(CONFIG.step);
  assert.ok(zombie.biteTimer > 0);
  game.pause();
  const timer = zombie.biteTimer, hp = game.leader.hp;
  game.update(10);
  assert.equal(zombie.biteTimer, timer);
  assert.equal(game.leader.hp, hp);
  const run = hz => {
    const fixture = biteArena();
    for (let frame = 0; frame < hz * 2; frame++) fixture.game.update(1 / hz);
    return {state: fixture.game.state, random: fixture.game.random.getState()};
  };
  const reference = run(60);
  for (const hz of [30, 120]) assert.deepEqual(run(hz), reference);
});

test('each destroyed jammer schedules one warned response, preserving target order and extraction', () => {
  for (const order of [[0, 1], [1, 0]]) {
    const game = arena();
    const targets = game.state.objective.targets;
    game.damage(targets[order[0]], 1000, 'player');
    assert.equal(game.state.objective.reinforcements.length, 1);
    const first = game.state.objective.reinforcements[0];
    assert.equal(first.sourceId, targets[order[0]].id);
    assert.equal(first.route, 'jammer');
    assert.ok(first.pending && !first.spawned);
    assert.ok(Math.abs(first.dueAt - game.state.time - 2.5) < 1e-8);
    game.damage(targets[order[0]], 1000, 'player');
    assert.equal(game.state.objective.reinforcements.length, 1);
    game.damage(targets[order[1]], 1000, 'player');
    game.checkObjective(CONFIG.step);
    const second = game.state.objective.reinforcements[1];
    assert.equal(second.sourceId, targets[order[1]].id);
    assert.equal(second.route, 'extraction');
    assert.equal(game.extraction.active, true, 'pending responses never demand a map cleanup');
    assert.equal(game.state.events.filter(event => event.type === 'reinforcement-warning').length, 2);
    game.state.time = first.dueAt - .01; game.updateWaves(CONFIG.step);
    assert.equal(game.waveCount, 0);
    game.pause();
    const pending = structuredClone(game.state.objective.reinforcements);
    game.update(10);
    assert.deepEqual(game.state.objective.reinforcements, pending);
    game.pause(false);
    game.state.time = second.dueAt + .01; game.updateWaves(CONFIG.step);
    assert.equal(game.waveCount, 2);
    assert.equal(game.enemies.filter(enemy => enemy.waveSpawn).length, 8);
    assert.ok(game.state.objective.reinforcements.every(response => response.spawned && !response.pending));
    game.state.time += 200; game.state.noise = 100; game.updateWaves(200);
    assert.equal(game.waveCount, 2, 'no ambient or recurring sabotage waves remain');
  }
});

test('jammer responses correct unsafe warning locations without spawning inside the squad or cover', () => {
  for (const seed of [1, 42, 531, 1989, 2143]) {
    for (const difficulty of ['easy', 'normal', 'hard']) {
      const game = new Game({mission: 1, seed, difficulty}).start();
      const target = game.state.objective.targets[0];
      game.damage(target, 1000, 'player');
      const response = game.state.objective.reinforcements[0];
      for (const [index, soldier] of game.soldiers.entries()) {
        Object.assign(soldier, game.nearestOpen(response.x - index * 85, response.y + index * 30));
      }
      const before = game.enemies.length;
      game.state.time = response.dueAt + .01; game.updateWaves(CONFIG.step);
      const spawned = game.enemies.slice(before);
      assert.equal(spawned.length, {easy: 3, normal: 4, hard: 5}[difficulty]);
      for (const enemy of spawned) {
        assert.equal(game.blocked(enemy.x, enemy.y, 16), false);
        assert.ok(game.soldiers.every(soldier => distance(soldier, enemy) >= 330));
        assert.ok(enemy.waveSpawn);
      }
    }
  }
});

test('each squad member checks its own range before honoring the focus order', () => {
  const game = arena();
  const focused = game.spawnEnemy('soldier', 672, 700);
  const fallback = game.spawnEnemy('zombie', 450, 790);
  game.focusTarget(focused.id);
  game.update(CONFIG.step);
  const shots = game.state.events.filter(event => event.type === 'shot' && event.team === 'player');
  assert.equal(shots.find(event => event.actorId === game.leader.id)?.targetId, focused.id);
  assert.ok(shots.filter(event => event.actorId !== game.leader.id).every(event => event.targetId === fallback.id));
  assert.equal(shots.length, 3);
});

test('temporarily impossible spawn geometry postpones both mission responses without consuming the budget', () => {
  for (const mission of [1, 2]) {
    const game = arena(mission);
    if (mission === 1) game.damage(game.state.objective.targets[0], 1000, 'player');
    else {
      const zone = game.state.objective.zone;
      game.leader.x = zone.x; game.leader.y = zone.y;
      game.updateObjective(CONFIG.step); game.updateWaves(CONFIG.step);
    }
    const pending = mission === 1 ? game.state.objective.reinforcements[0] : game.state.objective.pendingWave;
    assert.ok(pending);
    game.world.obstacles = [{type: 'hut', x: 0, y: 0, w: game.world.width, h: game.world.height, hp: Infinity, alive: true}];
    game.rebuildNavigation();
    const count = game.enemies.length;
    game.state.time = pending.dueAt + 10;
    for (let attempt = 0; attempt < 3; attempt++) game.updateWaves(CONFIG.step);
    assert.equal(game.enemies.length, count);
    assert.equal(game.waveCount, 0);
    assert.ok(pending.pending && !pending.spawned);
    assert.equal(game.state.wavesRemaining, mission === 1 ? 2 : 3);
  }
});

test('a deferred relay wave can arrive outside without scheduling the next earned milestone until re-entry', () => {
  const game = arena(2);
  const objective = game.state.objective;
  game.leader.x = objective.zone.x; game.leader.y = objective.zone.y;
  game.updateObjective(CONFIG.step); game.updateWaves(CONFIG.step);
  assert.ok(objective.pendingWave);
  const originalObstacles = game.world.obstacles;
  game.world.obstacles = [{type: 'hut', x: 0, y: 0, w: game.world.width, h: game.world.height, hp: Infinity, alive: true}];
  game.rebuildNavigation();
  game.updateObjective(8);
  game.state.time = objective.pendingWave.dueAt + 10;
  game.updateWaves(CONFIG.step);
  assert.equal(game.waveCount, 0);
  assert.ok(objective.held >= 8);
  game.leader.x = objective.zone.x - objective.zone.r - 100;
  game.updateObjective(1);
  game.world.obstacles = originalObstacles; game.rebuildNavigation();
  game.updateWaves(CONFIG.step);
  assert.equal(game.waveCount, 1);
  assert.equal(objective.pendingWave, null);
  assert.equal(objective.nextWaveIndex, 1, 'earned future warning waits for the squad to return');
  game.leader.x = objective.zone.x;
  game.updateObjective(CONFIG.step); game.updateWaves(CONFIG.step);
  assert.equal(objective.nextWaveIndex, 2);
  assert.ok(objective.pendingWave);
});

test('an impossible announced sector gives a fresh warning before entering from a corrected approach', () => {
  const game = new Game({mission: 1, seed: 1989}).start();
  game.damage(game.state.objective.targets[0], 1000, 'player');
  const response = game.state.objective.reinforcements[0];
  const firstWarning = game.state.events.find(event => event.type === 'reinforcement-warning');
  for (const [index, soldier] of game.soldiers.entries()) {
    Object.assign(soldier, game.nearestOpen(1390 - index * 60, 1080 - index * 20));
  }
  game.state.time = response.dueAt + .01;
  const now = game.state.time;
  game.updateWaves(CONFIG.step);
  assert.equal(game.waveCount, 0);
  assert.ok(response.pending && !response.spawned);
  assert.ok(response.dueAt >= now + .6 - 1e-8);
  const revised = game.state.events.filter(event => event.type === 'reinforcement-warning').at(-1);
  assert.ok(revised.id > firstWarning.id);
  assert.equal(revised.reinforcementId, response.id, 'the same finite response receives a revised approach');
  assert.ok(game.state.events.every((event, index, events) => !index || event.id > events[index - 1].id));
  game.state.time = response.dueAt - .01; game.updateWaves(CONFIG.step);
  assert.equal(game.waveCount, 0);
  const before = game.enemies.length;
  game.state.time = response.dueAt + .01; game.updateWaves(CONFIG.step);
  assert.equal(game.waveCount, 1);
  for (const enemy of game.enemies.slice(before)) {
    const bearing = Math.atan2(enemy.y - game.leader.y, enemy.x - game.leader.x);
    const turn = Math.abs(Math.atan2(Math.sin(bearing - revised.direction), Math.cos(bearing - revised.direction)));
    assert.ok(turn <= Math.PI / 4 + 1e-8, 'actual arrival follows the visible revised warning');
    assert.ok(game.soldiers.every(soldier => distance(enemy, soldier) >= 330));
    assert.equal(game.blocked(enemy.x, enemy.y, 16), false);
  }
});
