import test from 'node:test';
import assert from 'node:assert/strict';
import {findRoute} from '../dist/navigation.js';

function world(obstacles) {
  const game = {
    obstacles,
    navVersion: 0,
    blocked(x, y, radius = 15) {
      if (x < radius + 4 || y < radius + 4 || x > 1600 - radius - 4 || y > 1200 - radius - 4) return true;
      return this.obstacles.some(obstacle => {
        const dx = x - Math.max(obstacle.x, Math.min(obstacle.x + obstacle.w, x));
        const dy = y - Math.max(obstacle.y, Math.min(obstacle.y + obstacle.h, y));
        return dx * dx + dy * dy < radius * radius;
      });
    },
    walkableSegment(sx, sy, ex, ey, radius = 15) {
      const steps = Math.max(1, Math.ceil(Math.hypot(ex - sx, ey - sy)));
      for (let i = 0; i <= steps; i++) {
        if (this.blocked(sx + (ex - sx) * i / steps, sy + (ey - sy) * i / steps, radius)) return false;
      }
      return true;
    },
    rebuild() {
      this.grid = new Uint8Array(40 * 30);
      for (let y = 0; y < 30; y++) {
        for (let x = 0; x < 40; x++) this.grid[y * 40 + x] = this.blocked(x * 40 + 20, y * 40 + 20, 17) ? 1 : 0;
      }
      this.navVersion++;
    },
  };
  game.rebuild();
  return game;
}

function assertSafe(game, start, destination, route) {
  assert.ok(route.length > 0, 'a reachable point must have a route');
  assert.deepEqual(route.at(-1), destination, 'preserve the requested precise destination');
  let previous = start;
  for (const point of route) {
    assert.ok(game.walkableSegment(previous.x, previous.y, point.x, point.y),
      `unsafe segment ${JSON.stringify(previous)} → ${JSON.stringify(point)}`);
    previous = point;
  }
}

test('an unobstructed command preserves the precise destination in one waypoint', () => {
  const game = world([]);
  assert.deepEqual(findRoute(game, 201, 441, 723, 853), [{x: 723, y: 853}]);
});

test('a route exits a U-shaped enclosure before approaching the other side', () => {
  const game = world([
    {x: 400, y: 300, w: 40, h: 400},
    {x: 760, y: 300, w: 40, h: 400},
    {x: 400, y: 660, w: 400, h: 40},
  ]);
  const start = {x: 600, y: 600};
  const end = {x: 600, y: 900};
  const route = findRoute(game, start.x, start.y, end.x, end.y);
  assertSafe(game, start, end, route);
  assert.ok(route.some(point => point.y <= 285), 'leave through the open end');
  assert.ok(route.some(point => point.x < 385 || point.x > 815), 'go around an arm of the U');
  assert.ok(route.length <= 6, 'smooth a long grid trail into readable movement legs');
});

test('an exact start cannot snap through cover to its own open grid centre', () => {
  const game = world([{x: 220, y: 439, w: 1, h: 2}]);
  const start = {x: 201, y: 441};
  const end = {x: 600, y: 500};
  assert.equal(game.blocked(start.x, start.y, 15), false);
  assert.equal(game.grid[11 * 40 + 5], 0, 'the start cell centre is nominally open');
  assert.equal(game.walkableSegment(start.x, start.y, 220, 460), false,
    'body clearance prevents reaching the centre from this exact point');
  assertSafe(game, start, end, findRoute(game, start.x, start.y, end.x, end.y));
});

test('an open actor position in a blocked grid cell connects without crossing cover', () => {
  const game = world([{x: 223, y: 440, w: 10, h: 80}]);
  const start = {x: 205, y: 460};
  const end = {x: 600, y: 480};
  assert.equal(game.blocked(start.x, start.y, 15), false);
  assert.equal(game.grid[11 * 40 + 5], 1, 'the containing cell centre is blocked');
  assertSafe(game, start, end, findRoute(game, start.x, start.y, end.x, end.y));
});

test('a joystick stop inside navigation padding can escape using its physical body', () => {
  const game = world([{x: 240, y: 360, w: 80, h: 200}]);
  const start = {x: 228, y: 460};
  const end = {x: 600, y: 460};
  assert.equal(game.blocked(start.x, start.y, 11), false, 'the physical body can stand here');
  assert.equal(game.blocked(start.x, start.y, 15), true, 'the navigation margin overlaps cover');
  const route = findRoute(game, start.x, start.y, end.x, end.y);
  assert.ok(route.length >= 2, 'keep the escape hop separate from route smoothing');
  const escape = route.shift();
  assert.equal(game.blocked(escape.x, escape.y, 15), false, 'escape to normal navigation clearance');
  assert.ok(game.walkableSegment(start.x, start.y, escape.x, escape.y, 11));
  assertSafe(game, escape, end, route);
});

test('a thin obstruction between open grid centres is never crossed by a graph edge', () => {
  const game = world([{x: 238, y: 381, w: 3, h: 38}]);
  const start = {x: 220, y: 400};
  const end = {x: 380, y: 400};
  assert.equal(game.grid[10 * 40 + 5], 0);
  assert.equal(game.grid[10 * 40 + 6], 0);
  assertSafe(game, start, end, findRoute(game, start.x, start.y, end.x, end.y));
});

test('blocked destinations and blocked starts do not produce movement fallbacks', () => {
  const game = world([{x: 400, y: 400, w: 100, h: 100}]);
  assert.deepEqual(findRoute(game, 220, 220, 450, 450), []);
  assert.deepEqual(findRoute(game, 450, 450, 220, 220), []);
  assert.deepEqual(findRoute(game, 220, 220, NaN, 500), []);
  assert.deepEqual(findRoute(game, 220, 220, 0, 500), []);
});

test('a fully separated destination remains unreachable after graph search', () => {
  const game = world([{x: 780, y: 0, w: 40, h: 1200}]);
  assert.deepEqual(findRoute(game, 500, 600, 1000, 600), []);
});

test('navigation rebuilds invalidate body-clear edge caches after cover changes', () => {
  const game = world([{x: 740, y: 400, w: 80, h: 300}]);
  assertSafe(game, {x: 500, y: 600}, {x: 1000, y: 600}, findRoute(game, 500, 600, 1000, 600));
  game.obstacles = [{x: 780, y: 0, w: 40, h: 1200}];
  game.rebuild();
  assert.deepEqual(findRoute(game, 500, 600, 1000, 600), []);
  game.obstacles = [];
  game.rebuild();
  assert.deepEqual(findRoute(game, 500, 600, 1000, 600), [{x: 1000, y: 600}]);
});
