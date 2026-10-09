import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, CONFIG } from '../dist/engine.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const advance = (game, seconds, input = {}) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) game.update(1 / 60, input);
};
function isolatedGame() {
  const game = new Game().start();
  game.state.enemies = [];
  game.setHoldFire(true);
  return game;
}

test('30, 60, 120 and 144 Hz rendering produce identical simulation facts', () => {
  const run = hz => {
    const game = new Game({mission: 2, seed: 531}).start();
    for (const input of [{moveX: 1}, {moveY: -1}, {}, {moveX: .5, moveY: -.7}]) {
      for (let frame = 0; frame < hz * 1.5; frame++) game.update(1 / hz, input);
    }
    return game.state;
  };
  const reference = run(60);
  for (const hz of [30, 120, 144]) assert.deepEqual(run(hz), reference, `${hz} Hz diverged`);
});

test('pause discards a partial tick and a suspended tab catches up at most .15s', () => {
  const game = isolatedGame();
  game.update(1 / 120);
  assert.equal(game.state.time, 0);
  game.pause(); game.update(5); game.pause(false);
  game.update(1 / 120);
  assert.equal(game.state.time, 0);
  game.update(1 / 120);
  assert.equal(game.state.time, CONFIG.step);
  game.update(20);
  assert.ok(Math.abs(game.state.time - CONFIG.step - CONFIG.maxCatchup) < 1e-9);
});

test('shooting sideways does not rotate or flip a moving squad formation', () => {
  const quiet = isolatedGame(), firing = isolatedGame();
  quiet.world.obstacles = []; firing.world.obstacles = [];
  quiet.rebuildNavigation(); firing.rebuildNavigation();
  advance(quiet, 1.5, {moveX: 1});
  advance(firing, 1.5, {moveX: 1, fire: true, aim: {x: 300, y: 200}});
  for (let i = 0; i < quiet.soldiers.length; i++) {
    assert.ok(distance(quiet.soldiers[i], firing.soldiers[i]) < 1e-8);
    assert.ok(Math.abs(quiet.soldiers[i].moveAngle - firing.soldiers[i].moveAngle) < 1e-8);
  }
  assert.ok(Math.abs(firing.leader.angle - firing.leader.moveAngle) > .5);
});

test('squad and rescued survivors route around cover without teleporting', () => {
  const game = isolatedGame();
  game.world.obstacles = [{type: 'hut', x: 500, y: 470, w: 120, h: 160, hp: 160, alive: true}];
  game.rebuildNavigation();
  game.leader.x = 750; game.leader.y = 540; game.leader.moveAngle = 0;
  for (const [i, soldier] of game.soldiers.entries()) {
    if (!i) continue;
    soldier.x = 400; soldier.y = 510 + i * 28;
  }
  const civilian = game.civilians[0];
  civilian.rescued = true; civilian.x = 410; civilian.y = 590;
  const followers = [...game.soldiers.slice(1), civilian];
  for (let frame = 0; frame < 12 * 60; frame++) {
    const before = followers.map(actor => ({x: actor.x, y: actor.y}));
    game.update(1 / 60);
    followers.forEach((actor, i) => {
      assert.ok(distance(actor, before[i]) < 10, 'actor jumped instead of walking');
      assert.equal(game.blocked(actor.x, actor.y, CONFIG.actorRadius), false);
    });
  }
  assert.ok(followers.every(actor => distance(actor, game.leader) < 100));
});

test('a valid actor stopped against navigation padding can walk out again', () => {
  const game = isolatedGame();
  game.world.obstacles = [{type: 'hut', x: 500, y: 470, w: 120, h: 160, hp: 160, alive: true}];
  game.rebuildNavigation();
  game.leader.x = 488.5; game.leader.y = 540;
  assert.equal(game.blocked(game.leader.x, game.leader.y, CONFIG.actorRadius), false);
  assert.equal(game.blocked(game.leader.x, game.leader.y, 15), true);
  assert.equal(game.moveTo(700, 540), true);
  advance(game, 6);
  assert.ok(distance(game.leader, {x: 700, y: 540}) < 15);
});

test('hold fire prevents reinforcement noise, but marching through patrols remains dangerous', () => {
  const quiet = new Game({mission: 1}).start(), loud = new Game({mission: 1}).start();
  quiet.setHoldFire(true);
  for (const game of [quiet, loud]) { game.moveTo(900, 650); advance(game, 10); }
  assert.equal(quiet.waveCount, 0);
  assert.ok(!quiet.state.events.some(event => event.type === 'shot' && event.team === 'player'));
  assert.ok(loud.waveCount > 0);
  assert.ok(quiet.soldiers.some(soldier => soldier.hp < 100), 'quiet is a tactical choice, not invulnerability');
});

test('weapon targets remain stable when two enemies exchange near-equal distances', () => {
  const game = isolatedGame();
  game.world.obstacles = []; game.rebuildNavigation();
  const first = game.spawnEnemy('zombie', 420, 950);
  const second = game.spawnEnemy('zombie', 422, 975);
  assert.equal(game.acquireTarget(game.leader, game.enemies, 230), first);
  second.x -= 8;
  assert.equal(game.acquireTarget(game.leader, game.enemies, 230), first);
  second.x -= 90;
  assert.equal(game.acquireTarget(game.leader, game.enemies, 230), second);
});

test('distant faction fights wait until the squad enters that part of the map', () => {
  const game = new Game({mission: 0}).start();
  game.setHoldFire(true);
  const far = game.enemies.filter(enemy => distance(enemy, game.leader) > 850);
  const initial = far.map(enemy => ({x: enemy.x, y: enemy.y, hp: enemy.hp}));
  advance(game, 12);
  far.forEach((enemy, index) => {
    assert.deepEqual({x: enemy.x, y: enemy.y, hp: enemy.hp}, initial[index]);
    assert.equal(enemy.active, false);
  });
});

test('water collision uses the coastline supplied to the renderer', () => {
  const game = isolatedGame();
  assert.ok(game.world.coastline.length > 10);
  assert.equal(game.blocked(1500, 40), true);
  assert.equal(game.blocked(1540, 640), true);
  assert.equal(game.moveTo(1500, 40), true);
  assert.equal(game.blocked(game.target.x, game.target.y, 15), false);
  assert.equal(game.blocked(game.extraction.x, game.extraction.y, 15), false);
});

test('extraction waits for living squad and survivors to regroup', () => {
  const game = isolatedGame();
  game.state.rescueCount = game.state.rescueTarget;
  game.leader.x = game.extraction.x; game.leader.y = game.extraction.y;
  game.soldiers[1].x = 1080; game.soldiers[1].y = 300;
  game.soldiers[2].x = 1100; game.soldiers[2].y = 450;
  advance(game, .25);
  assert.equal(game.extraction.regrouping, true);
  assert.equal(game.extraction.progress, 0);
  advance(game, 7);
  assert.equal(game.state.status, 'won');
});

test('simulation events are monotonic, bounded and identify damage recipients', () => {
  const game = isolatedGame();
  game.damage(game.leader, 8, 'enemy');
  const hit = game.state.events.find(event => event.type === 'hit');
  assert.equal(hit.team, 'player');
  assert.equal(hit.targetId, game.leader.id);
  for (let i = 0; i < 150; i++) game.fire(game.leader, {x: 400, y: 970}, 'player');
  assert.equal(game.state.events.length, CONFIG.eventLimit);
  assert.ok(game.state.events.every((event, i, events) => !i || event.id > events[i - 1].id));
});

// A small commander exercises real missions through public actions only. No
// altered health, deleted enemies, moved actors or skipped objective conditions.
function jammerFiringPosition(game, target) {
  // Find an open firing position with a clear view, rather than walking onto a
  // device or stopping on the far side of a hut. These are read-only decisions;
  // the commander still issues the same movement orders a player can use.
  const leader = game.leader;
  const angle = Math.atan2(leader.y - target.y, leader.x - target.x);
  const positions = Array.from({length: 16}, (_, i) => {
    const bearing = angle + i * Math.PI / 8;
    return {x: target.x + Math.cos(bearing) * 170, y: target.y + Math.sin(bearing) * 170};
  }).filter(point => !game.blocked(point.x, point.y, 15) && game.hasLOS(point, target));
  return positions.sort((a, b) => distance(a, leader) - distance(b, leader))[0];
}

function playMission(mission, seed) {
  const game = new Game({mission, difficulty: 'normal', seed}).start();
  let decisionAt = 0, grenadeAt = -10;
  for (let frame = 0; frame < 120 * 60 && game.state.status === 'playing'; frame++) {
    if (game.state.time >= decisionAt) {
      decisionAt = game.state.time + .35;
      const leader = game.leader;
      const enemies = game.enemies.filter(enemy => enemy.alive).sort((a, b) => distance(a, leader) - distance(b, leader));
      const nearby = enemies.filter(enemy => distance(enemy, leader) < 220);
      if (nearby.length >= 2 && game.state.time - grenadeAt > 4 && game.grenade(nearby[0].x, nearby[0].y)) grenadeAt = game.state.time;
      let destination;
      if (game.extraction.active) destination = game.extraction;
      else if (mission === 0) destination = game.civilians.find(civilian => !civilian.rescued);
      else if (mission === 1) {
        const target = game.state.objective.targets.filter(target => target.alive)
          .sort((a, b) => distance(a, leader) - distance(b, leader))[0];
        if (target) destination = distance(leader, target) < CONFIG.weaponRange - 35 && game.hasLOS(leader, target)
          ? leader : jammerFiringPosition(game, target);
      } else destination = game.state.objective.zone;
      if (destination) game.moveTo(destination.x, destination.y);
    }
    game.update(1 / 60);
  }
  return game;
}

for (const seed of [1, 42, 531, 1989, 2143]) {
  for (const mission of [0, 1, 2]) test(`normal mission ${mission + 1} extracts through real squad actions (seed ${seed})`, () => {
    const game = playMission(mission, seed);
    assert.equal(game.state.status, 'won', `squad did not extract after ${game.state.time.toFixed(1)}s`);
    assert.ok(game.soldiers.filter(soldier => soldier.alive).every(soldier => distance(soldier, game.extraction) < game.extraction.r + 28));
    assert.ok(game.civilians.every(civilian => !civilian.rescued || distance(civilian, game.extraction) < game.extraction.r + 85));
    if (mission === 1) assert.ok(game.state.objective.targets.every(target => !target.alive));
    if (mission === 2) assert.equal(game.state.objective.held, game.state.objective.duration);
  });
}
