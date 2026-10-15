import test from 'node:test';
import assert from 'node:assert/strict';
import {Game, CONFIG} from '../dist/engine.js';
import {SABOTAGE, TRANSMISSION, createFieldMissionWorld} from '../dist/field-missions.js';
import {objectiveFor} from '../dist/session.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const place = (actor, point) => Object.assign(actor, {x: point.x, y: point.y, path: null, pathTimer: 0});
const advance = (game, seconds) => {
  for (let frame = 0; frame < Math.round(seconds / CONFIG.step); frame++) game.update(CONFIG.step);
};
const locations = definition => definition.targets || definition.relays;
const pointFor = location => location.point || location.zone;
function assertRoute(game, from, to) {
  const route = game.findPath(from.x, from.y, to.x, to.y);
  assert.ok(route.length, `no route ${JSON.stringify(from)} → ${JSON.stringify(to)}`);
  assert.deepEqual(route.at(-1), {x: to.x, y: to.y});
  let previous = from;
  for (const point of route) {
    assert.ok(game.walkableSegment(previous.x, previous.y, point.x, point.y, 15), 'route cuts through body clearance');
    previous = point;
  }
  return route;
}
function relayFixture() {
  const game = new Game({mission: 2}).start();
  game.state.enemies = [];
  game.setHoldFire(true);
  return game;
}

// These regressions exercise authored contracts and mission gates. Explicit
// placement/damage isolates logic; ordinary action-only wins live in foundations.
test('field definitions are recursively immutable and every new world owns mutable geometry', () => {
  const frozen = value => {
    if (value && typeof value === 'object') {
      assert.ok(Object.isFrozen(value));
      Object.values(value).forEach(frozen);
    }
  };
  frozen(SABOTAGE); frozen(TRANSMISSION);
  for (const mission of [1, 2]) {
    const first = createFieldMissionWorld(mission), second = createFieldMissionWorld(mission);
    assert.deepEqual(first, second);
    first.obstacles[0].alive = false; first.obstacles[0].hp = 0;
    first.roads[0].points[0][0] += 500;
    first.coastline[0].x += 500;
    first.clearings[0][0] += 500;
    first.scenery[0].x += 500;
    first.landmarks[0].name = 'changed';
    first.decorations[0].x += 500;
    assert.deepEqual(second, createFieldMissionWorld(mission), 'one run mutated another authored world');
    assert.ok(!Object.isFrozen(second.obstacles[0]), 'cover remains destructible');
  }
});

for (const [mission, definition] of [[1, SABOTAGE], [2, TRANSMISSION]]) {
  test(`mission ${mission + 1} uses its own complete authored map, exact spawns and connected objectives`, () => {
    for (const seed of [1, 42, 1989]) {
      const game = new Game({mission, seed});
      assert.deepEqual([game.world.width, game.world.height], [definition.width, definition.height]);
      assert.deepEqual(game.world.spawn, definition.start);
      assert.equal(game.grid.length, Math.ceil(definition.width / 40) * Math.ceil(definition.height / 40));
      assert.ok(game.world.roads.length >= 6 && game.world.landmarks.length >= 4);
      const authored = [...locations(definition).flatMap(location => location.enemies), ...definition.ambient];
      assert.equal(game.enemies.length, authored.length);
      authored.forEach((spec, index) => {
        assert.deepEqual([game.enemies[index].type, game.enemies[index].x, game.enemies[index].y], [spec.type, spec.x, spec.y], 'spawn needed an emergency cover correction');
      });
      const points = [definition.start, ...locations(definition).map(pointFor), definition.extraction, ...authored];
      for (const point of [...points, ...game.soldiers]) {
        assert.equal(game.blocked(point.x, point.y, 15), false, 'authored point has inadequate body clearance');
      }
      const objectives = [definition.start, ...locations(definition).map(pointFor), definition.extraction];
      for (const from of objectives) for (const to of objectives) if (from !== to) assertRoute(game, from, to);
    }
  });

  test(`mission ${mission + 1} streets preserve broad clearance for a three-person squad`, () => {
    const game = new Game({mission});
    for (const road of game.world.roads) {
      for (let index = 1; index < road.points.length; index++) {
        const [sx, sy] = road.points[index - 1], [ex, ey] = road.points[index];
        assert.ok(game.walkableSegment(sx, sy, ex, ey, 30), `blocked street ${sx},${sy} → ${ex},${ey}`);
      }
    }
    // A navigation fixture preserves the real terrain, movement and contacts.
    // Objective/wave logic is deliberately replaced so only formation is measured.
    game.start(); game.state.enemies = []; game.state.objective = {type: 'rescue'};
    game.state.rescueTarget = 999; game.setHoldFire(true);
    for (const destination of [...locations(definition).map(pointFor), definition.extraction]) {
      const route = assertRoute(game, game.leader, destination);
      let previous = game.leader, length = 0;
      for (const point of route) {length += distance(previous, point); previous = point;}
      assert.equal(game.moveTo(destination.x, destination.y), true);
      for (let frame = 0; frame < (length / CONFIG.squadSpeed + 10) / CONFIG.step; frame++) {
        const before = game.soldiers.map(soldier => ({x: soldier.x, y: soldier.y}));
        game.update(CONFIG.step);
        game.soldiers.forEach((soldier, index) => {
          assert.equal(game.blocked(soldier.x, soldier.y, CONFIG.actorRadius), false);
          assert.ok(distance(soldier, before[index]) < 10, 'formation teleported through an authored lane');
        });
        if (distance(game.leader, destination) < 14 && game.soldiers.every(soldier => distance(soldier, destination) < 100)) break;
      }
      assert.ok(distance(game.leader, destination) < 14, `leader stopped ${distance(game.leader, destination)}px from destination`);
      assert.ok(game.soldiers.every(soldier => distance(soldier, destination) < 100), 'a follower became stranded');
    }
  });

  test(`mission ${mission + 1} garrisons retain their own compound instead of abandoning it for remote noise`, () => {
    const game = new Game({mission}).start();
    game.setHoldFire(true);
    const guards = game.enemies.filter(enemy => enemy.operationHome);
    assert.equal(guards.length, locations(definition).reduce((total, site) => total + site.enemies.length, 0));
    game.state.enemies = guards;
    for (const enemy of guards) enemy.active = true;
    game.state.noise = 100; game.lastShot = {...definition.extraction};
    for (let frame = 0; frame < 30 / CONFIG.step; frame++) game.updateEnemies(CONFIG.step);
    for (const guard of guards) {
      assert.ok(distance(guard, guard.operationHome) <= guard.operationHome.r + 35);
      assert.equal(game.blocked(guard.x, guard.y, CONFIG.actorRadius), false);
    }
  });
}

test('both sabotage orders unlock the western flare while compound guards are still alive', () => {
  for (const order of [[0, 1], [1, 0]]) {
    const game = new Game({mission: 1}).start();
    const targets = game.state.objective.targets;
    const guards = game.enemies.filter(enemy => enemy.operationHome);
    assert.deepEqual(targets.map(target => target.siteId), SABOTAGE.targets.map(site => site.id));
    assert.ok(game.extraction.x < Math.min(...targets.map(target => target.x)));
    game.damage(targets[order[0]], 1000, 'player'); game.checkObjective(CONFIG.step);
    assert.equal(game.extraction.active, false);
    game.damage(targets[order[1]], 1000, 'player'); game.checkObjective(CONFIG.step);
    assert.equal(game.extraction.active, true);
    assert.ok(guards.every(guard => guard.alive), 'sabotage accidentally requires clearing compounds');
    assert.equal(game.state.objective.reinforcements.length, 2);
    assert.equal(game.state.wavesRemaining, 2);
  }
});

test('relay handoff caps the repeater, changes the active site once and never credits the old circle', () => {
  const game = relayFixture(), objective = game.state.objective;
  assert.deepEqual(objective.sites.map(site => site.duration), [12, 13]);
  assert.equal(objective.duration, 25);
  const first = {...objective.zone};
  const second = objective.sites[1];
  place(game.leader, second); game.updateObjective(50);
  assert.equal(objective.held, 0, 'visiting the ridge first must not skip the repeater');
  assert.equal(objective.started, false);
  place(game.soldiers[1], first); game.updateObjective(5);
  assert.equal(objective.held, 0, 'a follower cannot silently start the repeater');
  place(game.leader, first); game.updateObjective(20);
  assert.deepEqual(objective.sites.map(site => site.held), [12, 0]);
  assert.equal(objective.held, 12);
  assert.equal(objective.siteIndex, 1);
  assert.equal(objective.siteStarted, false);
  assert.equal(objective.inside, false);
  assert.deepEqual(objective.zone, {x: second.x, y: second.y, r: second.r});
  assert.equal(game.state.events.filter(event => event.type === 'relay-stage').length, 1);
  game.updateObjective(100);
  assert.equal(objective.held, 12, 'standing at the completed site cannot transmit the second half');
  assert.equal(game.extraction.active, false);
  place(game.leader, second); game.updateObjective(6);
  assert.deepEqual(objective.sites.map(site => site.held), [12, 6]);
  place(game.leader, first); game.updateObjective(100);
  assert.equal(objective.held, 18);
  place(game.leader, second); game.updateObjective(50); game.checkObjective(CONFIG.step);
  assert.deepEqual(objective.sites.map(site => site.held), [12, 13]);
  assert.equal(objective.held, 25);
  assert.equal(game.extraction.active, true);
  assert.equal(game.state.events.filter(event => event.type === 'relay-stage').length, 1);
});

test('the announced relay wave survives handoff and arrives in transit without earning the third wave', () => {
  const game = relayFixture(), objective = game.state.objective;
  place(game.leader, objective.zone);
  game.updateObjective(CONFIG.step); game.updateWaves(CONFIG.step);
  const firstWarning = objective.pendingWave;
  game.state.time = firstWarning.dueAt + .01; game.updateWaves(CONFIG.step);
  assert.equal(game.waveCount, 1);
  game.updateObjective(8 - objective.held); game.updateWaves(CONFIG.step);
  const warning = objective.pendingWave;
  assert.ok(warning && objective.nextWaveIndex === 2);
  game.updateObjective(12 - objective.held);
  assert.equal(objective.siteIndex, 1);
  assert.equal(objective.pendingWave, warning, 'handoff erased the pending second wave');
  const held = objective.held;
  game.state.time = warning.dueAt + .01; game.updateWaves(CONFIG.step);
  assert.equal(game.waveCount, 2);
  game.updateObjective(100); game.state.time += 100; game.updateWaves(CONFIG.step);
  assert.equal(objective.held, held);
  assert.equal(objective.nextWaveIndex, 2);
  assert.equal(game.waveCount, 2, 'travel time cannot consume the final milestone');
  place(game.leader, objective.zone); game.updateObjective(4); game.updateWaves(CONFIG.step);
  assert.equal(objective.held, 16);
  assert.equal(objective.nextWaveIndex, 3);
  assert.ok(objective.pendingWave);
  game.pause(); const paused = structuredClone(game.state); advance(game, 10);
  assert.deepEqual(game.state, paused);
});

test('two-site relay HUD uses active-site progress, named stages and preserved return instructions', () => {
  const game = relayFixture(), objective = game.state.objective;
  let hud = objectiveFor(game.state);
  assert.deepEqual([hud.label, hud.counter, hud.stage, hud.stages, hud.progress], ['REACH REPEATER', '12 SEC SIGNAL', 1, 2, 0]);
  assert.match(hud.progressLabel, /Village repeater/);
  place(game.leader, objective.zone); game.updateObjective(12);
  hud = objectiveFor(game.state);
  assert.deepEqual([hud.label, hud.counter, hud.stage, hud.stages, hud.progress], ['REACH RIDGE MAST', '13 SEC SIGNAL', 2, 2, 0]);
  assert.match(hud.text, /First link complete/);
  place(game.leader, objective.zone); game.updateObjective(6.5);
  hud = objectiveFor(game.state);
  assert.deepEqual([hud.label, hud.counter, hud.progress], ['HOLD RIDGE MAST', '7 SEC LEFT', .5]);
  place(game.leader, TRANSMISSION.start); game.updateObjective(2);
  hud = objectiveFor(game.state);
  assert.deepEqual([hud.label, hud.progress, hud.stage], ['REACH RIDGE MAST', .5, 2]);
  assert.match(hud.text, /Progress saved.*Return/);
  assert.match(hud.progressLabel, /Ridge mast/);
});
