import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, CONFIG } from '../dist/engine.js';

function advance(game, seconds, input = {}) {
  for (let remaining = seconds; remaining > 1e-9; remaining -= 1 / 60) {
    game.update(Math.min(remaining, 1 / 60), input);
  }
}

function quietGame(options = {}) {
  const game = new Game(options).start();
  game.state.enemies = [];
  game.setHoldFire(true);
  return game;
}

test('a seed reproduces the world, combat, and input-driven simulation', () => {
  const first = new Game({ seed: 42 }).start();
  const second = new Game({ seed: 42 }).start();
  assert.deepEqual(first.state, second.state);
  for (const input of [{ moveX: 1 }, { moveY: -1 }, {}, { moveX: 1, moveY: -1 }]) {
    advance(first, 2, input);
    advance(second, 2, input);
  }
  first.grenade(); second.grenade();
  advance(first, 1); advance(second, 1);
  assert.deepEqual(first.state, second.state);
  assert.notDeepEqual(first.world.decorations, new Game({ seed: 43 }).world.decorations);
});

test('pause freezes the simulation and resuming accepts movement', () => {
  const game = quietGame();
  game.pause();
  const paused = structuredClone(game.state);
  advance(game, 2, { moveX: 1 });
  assert.deepEqual(game.state, paused);
  game.pause(false);
  advance(game, .5, { moveX: 1 });
  assert.equal(game.state.status, 'playing');
  assert.ok(game.leader.x > paused.soldiers[0].x + 60);
});

test('hold fire suppresses squad shots and lets noise decay; weapons free shoots', () => {
  const game = quietGame();
  const zombie = game.spawnEnemy('zombie', game.leader.x + 200, game.leader.y);
  game.state.noise = 12;
  advance(game, .6);
  assert.equal(zombie.hp, zombie.maxHp);
  assert.equal(game.state.bullets.filter(b => b.team === 'player').length, 0);
  assert.ok(game.state.noise < 8);
  assert.ok(game.soldiers.every(s => s.shootFlash === 0));
  game.setHoldFire(false);
  advance(game, .6);
  assert.ok(zombie.hp < zombie.maxHp);
  assert.ok(game.state.noise > 8);
});

test('survivor rescue occurs once, supplies squad, and unlocks extraction', () => {
  const game = quietGame();
  const civilian = game.civilians[0];
  game.leader.x = civilian.x - 20;
  game.leader.y = civilian.y;
  game.soldiers.forEach(s => s.hp = 60);
  const grenades = game.state.grenades;
  advance(game, .1);
  assert.equal(game.state.rescueCount, 1);
  assert.equal(civilian.rescued, true);
  assert.equal(game.state.grenades, grenades + 1);
  assert.ok(game.soldiers.every(s => s.hp === 85));
  assert.equal(game.extraction.active, true);
  assert.equal(game.state.wavesRemaining, 0);
  advance(game, .5);
  assert.equal(game.state.rescueCount, 1);
  assert.equal(game.state.grenades, grenades + 1);
  assert.equal(game.state.status, 'playing');
});

test('mission two requires both jammers destroyed before extraction', () => {
  const game = quietGame({ mission: 1 });
  assert.equal(game.civilians.length, 0);
  for (let i = 0; i < 2; i++) {
    const target = game.state.objective.targets[i];
    game.damage(target, 1000, 'player');
    advance(game, .1);
    assert.equal(game.state.objective.targets.filter(target => !target.alive).length, i + 1);
    assert.equal(game.extraction.active, i === 1);
  }
});

test('an extraction requires staying in the zone, loses progress outside, and wins', () => {
  const game = quietGame();
  game.state.rescueCount = game.state.rescueTarget;
  advance(game, .1);
  game.leader.x = game.extraction.x;
  game.leader.y = game.extraction.y;
  for (const [index, soldier] of game.soldiers.entries()) {
    soldier.x = game.extraction.x - index * 26;
    soldier.y = game.extraction.y;
    soldier.path = null;
    soldier.pathTimer = 0;
  }
  advance(game, 1);
  const halfway = game.extraction.progress;
  assert.ok(halfway > .4 && halfway < .5);
  assert.equal(game.state.status, 'playing');
  game.leader.x -= game.extraction.r + 20;
  advance(game, .25);
  assert.ok(game.extraction.progress < halfway);
  game.leader.x = game.extraction.x;
  advance(game, 2.3);
  assert.equal(game.state.status, 'won');
  assert.equal(game.extraction.progress, 1);
  const wonState = structuredClone(game.state);
  advance(game, 3);
  assert.deepEqual(game.state, wonState);
});

test('mission three has three relay-triggered waves and opens extraction with hostiles alive', () => {
  const game = quietGame({ mission: 2 });
  advance(game, 12);
  assert.equal(game.extraction.active, false);
  assert.equal(game.enemies.length, 0);
  game.leader.x = game.state.objective.zone.x;
  game.leader.y = game.state.objective.zone.y;
  for (const seconds of [1 / 60, 8, 8]) advance(game, seconds);
  assert.equal(game.state.wavesRemaining, 0);
  assert.equal(game.waveCount, 3);
  assert.equal(game.state.events.filter(event => event.type === 'wave').length, 3);
  assert.equal(game.extraction.active, false, '16 seconds is not a full transmission');
  game.state.objective.held = 25;
  game.checkObjective(.1);
  assert.equal(game.extraction.active, true);
  assert.ok(game.enemies.some(enemy => enemy.alive), 'hostiles need not be cleared');
  const count = game.enemies.length;
  game.updateWaves(30);
  assert.equal(game.enemies.length, count, 'there is no fourth or evacuation wave');
});

test('leader death selects a living replacement, and a dead soldier cannot be selected', () => {
  const game = quietGame();
  const first = game.leader;
  game.damage(first, 1000);
  assert.equal(first.alive, false);
  assert.equal(game.leader, game.soldiers[1]);
  assert.equal(game.leaderId, game.soldiers[1].id);
  assert.equal(game.selectSoldier(first.id), false);
  const x = game.leader.x;
  advance(game, .5, { moveX: 1 });
  assert.ok(game.leader.x > x + 60);
});

test('losing all soldiers ends the mission and freezes further updates', () => {
  const game = quietGame();
  for (const soldier of game.soldiers) game.damage(soldier, 1000);
  advance(game, .1);
  assert.equal(game.state.status, 'lost');
  assert.equal(game.corpses.length, 3);
  const lost = structuredClone(game.state);
  advance(game, 5, { moveX: 1, fire: true });
  assert.deepEqual(game.state, lost);
  assert.equal(game.grenade(), false);
});

test('grenades consume inventory, respect range, detonate, and never harm the squad', () => {
  const game = quietGame();
  game.state.world.obstacles = [];
  game.rebuildNavigation();
  game.leader.x = 400; game.leader.y = 450;
  const zombie = game.spawnEnemy('zombie', 450, 450);
  const health = game.soldiers.map(s => s.hp);
  assert.equal(game.grenade(450, 450), true);
  assert.equal(game.state.grenades, 3);
  assert.equal(game.state.thrownGrenades.length, 1);
  game.updateGrenades(.3);
  assert.equal(zombie.alive, true);
  game.updateGrenades(.36);
  assert.equal(zombie.alive, false);
  assert.equal(game.state.thrownGrenades.length, 0);
  assert.deepEqual(game.soldiers.map(s => s.hp), health);
  assert.ok(game.state.noise >= 30);
  assert.equal(game.grenade(1600, 1200), true);
  const thrown = game.state.thrownGrenades[0];
  assert.ok(Math.hypot(thrown.tx - thrown.sx, thrown.ty - thrown.sy) <= 330.000001);
  game.state.grenades = 0;
  assert.equal(game.grenade(), false);
});

test('a grenade destroys huts and chained barrels, making cover traversable', () => {
  const game = quietGame();
  game.state.world.obstacles = [
    { type: 'hut', x: 420, y: 420, w: 50, h: 50, hp: 160, alive: true },
    { type: 'barrel', x: 490, y: 430, w: 23, h: 27, hp: 24, alive: true },
    { type: 'barrel', x: 570, y: 430, w: 23, h: 27, hp: 24, alive: true },
  ];
  game.rebuildNavigation();
  assert.equal(game.blocked(445, 445), true);
  const version = game.navVersion;
  game.explode(445, 445);
  assert.ok(game.world.obstacles.every(o => o.alive === false));
  assert.equal(game.blocked(445, 445), false);
  assert.ok(game.navVersion > version);
});

test('a clicked destination routes around a hut without entering solid cover', () => {
  const game = quietGame();
  game.state.world.obstacles = [{ type: 'hut', x: 500, y: 500, w: 120, h: 86, hp: 160, alive: true }];
  game.rebuildNavigation();
  game.leader.x = 400; game.leader.y = 540;
  assert.equal(game.walkableSegment(400, 540, 700, 540), false);
  assert.equal(game.moveTo(700, 540), true);
  assert.ok(game.leader.path.length > 2);
  for (let i = 0; i < 600; i++) {
    game.update(1 / 60);
    assert.equal(game.blocked(game.leader.x, game.leader.y), false);
  }
  assert.ok(Math.hypot(game.leader.x - 700, game.leader.y - 540) < 15);
  assert.equal(game.state.target, null);
});

test('large update intervals cannot tunnel a moving soldier through cover', () => {
  const game = quietGame();
  game.state.world.obstacles = [{ type: 'rock', x: 300, y: 900, w: 50, h: 40, hp: Infinity, alive: true }];
  game.rebuildNavigation();
  game.leader.x = 270; game.leader.y = 920;
  for (let i = 0; i < 20; i++) {
    game.update(10, { moveX: 1 });
    assert.ok(game.leader.x <= 300 - CONFIG.actorRadius + 0.000001);
    assert.equal(game.blocked(game.leader.x, game.leader.y, CONFIG.actorRadius), false);
  }
  assert.ok(game.state.time < 3.01);
});

test('solid cover intercepts bullets before an enemy behind it', () => {
  const game = quietGame();
  game.state.world.obstacles = [{ type: 'rock', x: 300, y: 900, w: 50, h: 40, hp: Infinity, alive: true }];
  game.rebuildNavigation();
  const target = game.spawnEnemy('zombie', 400, 920);
  game.leader.x = 220; game.leader.y = 920;
  assert.equal(game.hasLOS(game.leader, target), false);
  game.fire(game.leader, target, 'player');
  for (let i = 0; i < 30; i++) game.updateBullets(1 / 60);
  assert.equal(target.hp, target.maxHp);
  assert.equal(game.bullets.length, 0);
});
