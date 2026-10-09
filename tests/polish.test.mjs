import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, CONFIG } from '../dist/engine.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const advance = (game, seconds, input = {}) => {
  for (let frame = 0; frame < seconds * 60; frame++) game.update(1 / 60, input);
};
function quietGame() {
  const game = new Game().start();
  game.state.enemies = [];
  game.setHoldFire(true);
  return game;
}

test('a moving squad follows current formation positions without a cached-destination gap', () => {
  const game = quietGame();
  advance(game, 2, {moveX: 1});
  for (const follower of game.soldiers.slice(1)) {
    assert.ok(distance(follower, game.leader) < 60, `${follower.name} fell behind in clear terrain`);
    assert.equal(game.blocked(follower.x, follower.y, CONFIG.actorRadius), false);
  }
});

test('a moving destination invalidates a stale detour while every route segment stays body-clear', () => {
  const game = quietGame();
  game.world.obstacles = [{type: 'hut', x: 500, y: 470, w: 120, h: 160, hp: 160, alive: true}];
  game.rebuildNavigation();
  const actor = game.leader;
  actor.x = 400; actor.y = 540;
  game.navigate(actor, 700, 540, CONFIG.squadSpeed, CONFIG.step);
  assert.ok(actor.path.length > 1, 'the initial destination should require a detour');
  assert.ok(actor.pathTimer > .5, 'the old route is still cached');
  game.navigate(actor, 700, 700, CONFIG.squadSpeed, CONFIG.step);
  assert.deepEqual(actor.pathGoal, {x: 700, y: 700});
  let previous = actor;
  for (const point of actor.path) {
    assert.equal(game.walkableSegment(previous.x, previous.y, point.x, point.y), true);
    previous = point;
  }
  for (let frame = 0; frame < 5 * 60; frame++) {
    game.navigate(actor, 700, 700, CONFIG.squadSpeed, CONFIG.step);
    assert.equal(game.blocked(actor.x, actor.y, CONFIG.actorRadius), false);
  }
  assert.ok(distance(actor, {x: 700, y: 700}) < 6);
});

for (const [side, player, spawn] of [
  ['left', {x: 513.5, y: 790}, {x: 460, y: 790}],
  ['right', {x: 652.5, y: 815}, {x: 720, y: 815}],
  ['bottom', {x: 580, y: 847.5}, {x: 580, y: 910}],
]) test(`a zombie can approach and attack a player hugging the ${side} side of existing cover`, () => {
  const game = quietGame();
  game.state.soldiers = game.soldiers.slice(0, 1);
  Object.assign(game.leader, player);
  assert.equal(game.blocked(player.x, player.y, CONFIG.actorRadius), false);
  assert.equal(game.blocked(player.x, player.y, 15), true);
  const zombie = game.spawnEnemy('zombie', spawn.x, spawn.y);
  const initial = {x: zombie.x, y: zombie.y};
  for (let frame = 0; frame < 5 * 60; frame++) {
    const before = {x: zombie.x, y: zombie.y};
    game.update(CONFIG.step);
    assert.ok(distance(zombie, before) < 10, 'pursuit must walk rather than snap to the target');
    for (const actor of [zombie, game.leader]) {
      assert.equal(game.blocked(actor.x, actor.y, CONFIG.actorRadius), false);
    }
  }
  assert.ok(distance(zombie, initial) > 10, 'the zombie remained stuck outside the navigation margin');
  assert.ok(game.leader.hp < 100, 'cover contact must not make the player immune to melee');
});

test('companions yield during a reversal without displacing the controlled leader', () => {
  const game = quietGame();
  advance(game, 2, {moveX: 1});
  const before = {x: game.leader.x, y: game.leader.y};
  advance(game, .75, {moveX: -1});
  assert.ok(Math.abs(game.leader.x - (before.x - CONFIG.squadSpeed * .75)) < 1e-8);
  assert.equal(game.leader.y, before.y, 'a formation change shoved the player sideways');
  for (const actor of game.soldiers) {
    assert.equal(game.blocked(actor.x, actor.y, CONFIG.actorRadius), false);
  }
  for (const follower of game.soldiers.slice(1)) {
    assert.ok(distance(follower, game.leader) >= 21.9, 'companions must retain physical separation');
  }
});

test('enemy contact keeps its physical effect on the controlled leader', () => {
  const game = quietGame();
  const leader = game.leader;
  const initial = {x: leader.x, y: leader.y};
  const zombie = game.spawnEnemy('zombie', leader.x + 10, leader.y);
  game.resolveContacts();
  assert.ok(distance(leader, initial) > 0);
  assert.ok(distance(leader, zombie) >= 21.9);
  assert.equal(game.blocked(leader.x, leader.y, CONFIG.actorRadius), false);
  assert.equal(game.blocked(zombie.x, zombie.y, CONFIG.actorRadius), false);
});

test('regrouping companions do not shove a waiting leader out of extraction', () => {
  const game = quietGame();
  game.state.rescueCount = game.state.rescueTarget;
  const leader = game.leader;
  leader.x = game.extraction.x + 80; leader.y = game.extraction.y;
  leader.moveAngle = 0;
  game.soldiers[1].x = leader.x - 12; game.soldiers[1].y = leader.y - 2;
  game.soldiers[2].x = leader.x - 12; game.soldiers[2].y = leader.y + 2;
  advance(game, 4);
  assert.equal(game.state.status, 'won');
  assert.ok(distance(leader, game.extraction) < game.extraction.r);
  assert.ok(game.soldiers.every(actor => !game.blocked(actor.x, actor.y, CONFIG.actorRadius)));
});

test('only accepted move orders emit an acknowledgement at the resolved destination', () => {
  const game = quietGame();
  const orders = () => game.state.events.filter(event => event.type === 'order');
  assert.equal(game.moveTo(NaN, 790), false);
  assert.equal(orders().length, 0);
  assert.equal(game.moveTo(540, 790), true); // Inside a hut: resolve to clear ground.
  assert.equal(orders().length, 1);
  const event = orders()[0];
  assert.equal(event.actorId, game.leader.id);
  assert.deepEqual({x: event.x, y: event.y}, game.target);
  assert.equal(game.blocked(event.x, event.y, 15), false);
  advance(game, .5);
  assert.equal(orders().length, 1, 'walking an order must not emit it again every frame');
});
