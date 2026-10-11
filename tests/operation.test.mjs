import test from 'node:test';
import assert from 'node:assert/strict';
import {Game, CONFIG} from '../dist/engine.js';
import {FIRST_CONTACT} from '../dist/mission-data.js';
import {Renderer} from '../dist/renderer.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const advance = (game, seconds) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) game.update(CONFIG.step);
};
// Explicit placement and damage fixtures isolate gates and event ordering.
// Unmodified, action-only mission wins live in foundations.test.mjs.
const operation = options => new Game({mission: 0, ...options}).start();
function place(actor, point) {
  actor.x = point.x; actor.y = point.y; actor.path = null; actor.pathTimer = 0;
}
function clearGroup(game, group, source = 'player') {
  for (const enemy of game.enemies.filter(enemy => enemy.operationGroup === group)) game.damage(enemy, 1000, source);
}
function secureEntry(game) {
  clearGroup(game, FIRST_CONTACT.entry.id);
  place(game.leader, FIRST_CONTACT.entry.zone);
  game.updateOperation();
  assert.equal(game.state.objective.phase, 1);
}
function rescueSite(game, site) {
  clearGroup(game, site.id);
  place(game.leader, site.point);
  game.updateRescue(0);
}
function secureHarbour(game) {
  secureEntry(game);
  for (const site of FIRST_CONTACT.rescues) rescueSite(game, site);
  clearGroup(game, FIRST_CONTACT.exit.id);
  place(game.leader, FIRST_CONTACT.exit.zone);
  game.updateOperation(); game.checkObjective(CONFIG.step);
  assert.equal(game.state.objective.phase, 3);
}

test('First Contact has an authored larger map and current objectives beyond the original bounds', () => {
  const first = operation({seed: 42}), second = operation({seed: 42});
  assert.deepEqual(first.state, second.state);
  assert.deepEqual([first.world.width, first.world.height], [2800, 2200]);
  assert.deepEqual(first.world.spawn, FIRST_CONTACT.start);
  assert.equal(first.grid.length, 70 * 55);
  assert.ok(first.extraction.x > 1600);
  assert.ok(first.civilians.some(civilian => civilian.x > 1600));
  assert.ok(first.civilians.every(civilian => !first.blocked(civilian.x, civilian.y, 15)));
  assert.ok(first.soldiers.every(soldier => !first.blocked(soldier.x, soldier.y, CONFIG.actorRadius)));
  assert.equal(first.moveTo(FIRST_CONTACT.rescues[0].point.x, FIRST_CONTACT.rescues[0].point.y), true);
  assert.ok(first.leader.path.some(point => point.x > 1600));
  let previous = first.leader;
  for (const point of first.leader.path) {
    assert.ok(first.walkableSegment(previous.x, previous.y, point.x, point.y)); previous = point;
  }
  first.moveTo(100000, 100000);
  assert.ok(first.target.x < first.world.width && first.target.y < first.world.height);
  assert.equal(first.blocked(first.target.x, first.target.y, 15), false);
});

test('rushing survivors or the flare cannot bypass local defenders or earlier stages', () => {
  const game = operation();
  for (const site of FIRST_CONTACT.rescues) {
    place(game.leader, site.point); game.updateRescue(0); game.checkObjective(CONFIG.step);
  }
  assert.equal(game.state.rescueCount, 0);
  assert.equal(game.state.objective.phase, 0);
  assert.equal(game.state.checkpointSequence, 0);
  place(game.leader, game.extraction); game.checkObjective(CONFIG.extractionSeconds * 2);
  assert.equal(game.extraction.active, false);
  assert.equal(game.extraction.progress, 0);
  assert.equal(game.state.status, 'playing');
  // Even the old rescue-only condition does not grant the new operation win.
  game.state.rescueCount = game.state.rescueTarget;
  game.checkObjective(CONFIG.extractionSeconds * 2);
  assert.equal(game.extraction.active, false);
});

test('secure checkpoints need their local group cleared and the selected leader inside', () => {
  const game = operation();
  place(game.leader, FIRST_CONTACT.entry.zone); game.updateOperation();
  assert.equal(game.state.objective.phase, 0, 'entering under fire is not clearance');
  clearGroup(game, FIRST_CONTACT.entry.id);
  place(game.leader, FIRST_CONTACT.start);
  place(game.soldiers[1], FIRST_CONTACT.entry.zone);
  game.updateOperation();
  assert.equal(game.state.objective.phase, 0, 'a follower does not secure the checkpoint');
  assert.equal(game.selectSoldier(game.soldiers[1].id), true);
  game.updateOperation();
  assert.equal(game.state.objective.phase, 1);
  assert.equal(game.state.checkpointSequence, 1);
  for (let i = 0; i < 20; i++) game.updateOperation();
  assert.equal(game.state.checkpointSequence, 1, 'entry emits exactly one checkpoint');
});

test('guard deaths from player and faction combat both satisfy local clearance', () => {
  for (const source of ['player', 'enemy', 'zombie']) {
    const game = operation();
    clearGroup(game, FIRST_CONTACT.entry.id, source);
    place(game.leader, FIRST_CONTACT.entry.zone); game.updateOperation();
    assert.equal(game.operationGuardsRemaining(FIRST_CONTACT.entry.id), 0);
    assert.equal(game.state.objective.phase, 1);
  }
});

for (const reverse of [false, true]) test(`both rescue orders preserve stage and checkpoint sequence (${reverse ? 'school first' : 'clinic first'})`, () => {
  const game = operation(); secureEntry(game);
  const sites = reverse ? [...FIRST_CONTACT.rescues].reverse() : FIRST_CONTACT.rescues;
  const first = sites[0];
  place(game.leader, first.point); game.updateRescue(0);
  assert.equal(game.state.rescueCount, 0, 'a guarded survivor waits for clearance');
  const grenades = game.state.grenades;
  rescueSite(game, first);
  assert.equal(game.state.objective.phase, 1);
  assert.equal(game.state.rescueCount, 1);
  assert.equal(game.state.checkpointSequence, 2);
  assert.deepEqual(game.state.objective.currentPoints.map(point => point.id), [sites[1].id]);
  game.updateRescue(0);
  assert.equal(game.state.grenades, grenades + 1, 'supplies occur once');
  assert.equal(game.state.checkpointSequence, 2);
  rescueSite(game, sites[1]);
  assert.equal(game.state.objective.phase, 2);
  assert.equal(game.state.rescueCount, 2);
  assert.equal(game.state.checkpointSequence, 3);
  assert.equal(game.extraction.active, false, 'both rescues still require the harbour');
  place(game.leader, FIRST_CONTACT.exit.zone); game.updateOperation();
  assert.equal(game.state.objective.phase, 2, 'the harbour detail still defends evacuation');
  clearGroup(game, FIRST_CONTACT.exit.id);
  game.updateOperation(); game.checkObjective(CONFIG.step);
  assert.equal(game.state.objective.phase, 3);
  assert.equal(game.state.checkpointSequence, 4);
  assert.equal(game.extraction.active, true);
  for (let i = 0; i < 20; i++) { game.updateOperation(); game.updateRescue(0); game.checkObjective(CONFIG.step); }
  assert.equal(game.state.checkpointSequence, 4);
  assert.deepEqual(game.state.events.filter(event => event.type === 'checkpoint').map(event => [event.sequence, event.stage]),
    [[1, 'entry'], [2, sites[0].id], [3, sites[1].id], [4, 'harbour']]);
  assert.deepEqual(game.state.events.filter(event => event.type === 'operation-stage').map(event => event.phase), [1, 2, 3]);
  assert.ok(game.enemies.some(enemy => enemy.alive && !enemy.operationGroup), 'ambient encounters need no map-wide cleanup');
});

test('a replacement leader can complete the operation without reviving cleared guards', () => {
  const game = operation(); secureEntry(game);
  const defeated = game.enemies.filter(enemy => enemy.operationGroup === FIRST_CONTACT.entry.id).map(enemy => enemy.id);
  game.damage(game.leader, 1000);
  assert.equal(game.leader, game.soldiers[1]);
  for (const site of FIRST_CONTACT.rescues) rescueSite(game, site);
  clearGroup(game, FIRST_CONTACT.exit.id); place(game.leader, FIRST_CONTACT.exit.zone);
  game.updateOperation(); game.checkObjective(CONFIG.step);
  for (const soldier of game.soldiers.filter(soldier => soldier.alive)) place(soldier, {x: game.extraction.x - (soldier.id % 3) * 26, y: game.extraction.y});
  game.checkObjective(CONFIG.extractionSeconds);
  assert.equal(game.state.status, 'playing', 'rescued civilians must regroup too');
  for (const [i, civilian] of game.civilians.entries()) place(civilian, {x: game.extraction.x - 35 - i * 26, y: game.extraction.y + 55});
  game.checkObjective(CONFIG.extractionSeconds);
  assert.equal(game.state.status, 'won');
  assert.equal(game.state.objective.completed, 4);
  assert.ok(game.state.objective.stages.every(stage => stage.complete));
  assert.ok(defeated.every(id => game.enemies.find(enemy => enemy.id === id).alive === false));
});

test('the finite evacuation response warns for four simulation seconds and survives opening extraction', () => {
  const game = operation(); secureHarbour(game); game.setHoldFire(true);
  const response = game.state.objective.response;
  assert.deepEqual([response.pending, response.spawned, response.dueAt - game.state.time], [true, false, 4]);
  assert.equal(game.state.events.filter(event => event.type === 'operation-response').length, 1);
  game.pause(); const paused = structuredClone(game.state); advance(game, 10);
  assert.deepEqual(game.state, paused, 'pause freezes the warning and guards');
  game.pause(false);
  game.state.time = response.dueAt - .01; game.updateWaves(CONFIG.step);
  assert.equal(response.spawned, false);
  game.state.time = response.dueAt; const before = game.enemies.length; game.updateWaves(CONFIG.step);
  assert.equal(game.extraction.active, true);
  assert.deepEqual([response.pending, response.spawned, response.count], [false, true, 6]);
  const spawned = game.enemies.slice(before);
  assert.equal(spawned.length, 6);
  for (const enemy of spawned) {
    assert.ok(enemy.waveSpawn && enemy.operationResponse);
    assert.equal(game.blocked(enemy.x, enemy.y, 16), false);
    assert.ok(game.soldiers.filter(soldier => soldier.alive).every(soldier => distance(soldier, enemy) >= 330));
  }
  game.state.time += 100; for (let i = 0; i < 20; i++) game.updateWaves(CONFIG.step);
  assert.equal(game.enemies.length, before + 6);
  assert.equal(game.waveCount, 1);
  assert.equal(game.state.events.filter(event => event.type === 'wave' && event.operation).length, 1);
});

test('approaching the defended harbour warns before clearance and the response persists into evacuation', () => {
  const game = operation(); secureEntry(game);
  for (const site of FIRST_CONTACT.rescues) rescueSite(game, site);
  assert.equal(game.state.objective.phase, 2);
  place(game.leader, {x: FIRST_CONTACT.exit.zone.x - 400, y: FIRST_CONTACT.exit.zone.y});
  game.updateOperation();
  const response = game.state.objective.response, dueAt = response.dueAt;
  assert.equal(response.pending, true);
  assert.equal(dueAt - game.state.time, 4);
  assert.ok(game.operationGuardsRemaining(FIRST_CONTACT.exit.id) > 0);
  assert.equal(game.extraction.active, false);
  game.state.time = dueAt; game.updateOperationResponse();
  assert.equal(response.spawned, true);
  const spawnedIds = game.enemies.filter(enemy => enemy.operationResponse).map(enemy => enemy.id);
  clearGroup(game, FIRST_CONTACT.exit.id); place(game.leader, FIRST_CONTACT.exit.zone);
  game.updateOperation(); game.checkObjective(CONFIG.step);
  assert.equal(game.extraction.active, true);
  assert.equal(response.dueAt, dueAt, 'opening evacuation does not reset the alarm');
  game.updateOperationResponse();
  assert.deepEqual(game.enemies.filter(enemy => enemy.operationResponse).map(enemy => enemy.id), spawnedIds);
  assert.equal(game.state.events.filter(event => event.type === 'operation-response').length, 1);
});

test('evacuation spawns stay safe for a spread squad across seeds and coast corrections', () => {
  for (const seed of [1, 42, 531, 1989, 2143]) {
    const game = operation({seed}); secureHarbour(game);
    for (const [i, soldier] of game.soldiers.entries()) place(soldier, game.nearestOpen(2350 - i * 280, 560 + i * 160));
    game.state.time = game.state.objective.response.dueAt;
    const before = game.enemies.length; game.updateOperationResponse();
    assert.equal(game.enemies.length - before, 6);
    for (const enemy of game.enemies.slice(before)) {
      assert.equal(game.blocked(enemy.x, enemy.y, 16), false);
      assert.ok(game.soldiers.every(soldier => distance(soldier, enemy) >= 330), `unsafe operation response seed ${seed}`);
    }
  }
});

test('an entirely unsafe map defers the response and never falls back to a colliding spawn', () => {
  const game = operation(); secureHarbour(game);
  const original = game.world.obstacles;
  game.world.obstacles = [{type: 'rock', x: 0, y: 0, w: game.world.width, h: game.world.height, hp: Infinity, alive: true}];
  game.rebuildNavigation(); game.state.time = game.state.objective.response.dueAt;
  const before = game.enemies.length; game.updateOperationResponse();
  assert.equal(game.enemies.length, before);
  assert.equal(game.state.objective.response.spawned, false);
  assert.equal(game.state.objective.response.pending, true);
  game.world.obstacles = original; game.rebuildNavigation(); game.updateOperationResponse();
  assert.equal(game.enemies.length, before + 6, 'restored safe ground allows the pending finite response');
});

test('objective bearings guide the nearest remaining local guard while preserving the stage marker and state', () => {
  const game = operation();
  const targets = [];
  const view = {width: 195, height: 220, transform: {x: 0, y: 0, zoom: 1},
    drawEdgeMarker(...args) { if (args[5]) targets.push(args[1]); }};
  const bearing = () => {
    targets.length = 0;
    const before = structuredClone(game.state);
    Renderer.prototype.drawObjectiveDirection.call(view, {}, game.state, game.leader);
    assert.deepEqual(game.state, before, 'direction painting must not alter simulation state');
    return targets[0];
  };
  assert.equal(bearing(), game.state.objective.currentPoints[0], 'from afar point at the checkpoint');
  place(game.leader, FIRST_CONTACT.entry.zone);
  const unrelated = game.spawnEnemy('zombie', game.leader.x + 25, game.leader.y + 25);
  unrelated.operationGroup = 'school';
  const nearestGuard = group => game.enemies.filter(enemy => enemy.alive && enemy.operationGroup === group)
    .sort((a, b) => distance(a, game.leader) - distance(b, game.leader))[0];
  assert.equal(bearing(), nearestGuard('entry'), 'near the defended checkpoint indicate a required guard');
  clearGroup(game, 'entry'); game.refreshOperationObjective();
  assert.equal(bearing(), game.state.objective.currentPoints[0], 'clearance returns guidance to the checkpoint');
  game.updateOperation();
  place(game.leader, FIRST_CONTACT.rescues[0].point);
  assert.equal(bearing(), nearestGuard('clinic'), 'rescue sites guide their own living guard detail');
  const clinicMarker = game.state.objective.currentPoints.find(point => point.id === 'clinic');
  assert.deepEqual([clinicMarker.x, clinicMarker.y], [FIRST_CONTACT.rescues[0].point.x, FIRST_CONTACT.rescues[0].point.y]);
  clearGroup(game, 'clinic'); game.refreshOperationObjective();
  assert.equal(bearing(), game.state.objective.currentPoints.find(point => point.id === 'clinic'), 'a ready survivor remains the target');
});
