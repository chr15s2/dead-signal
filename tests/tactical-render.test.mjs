import test from 'node:test';
import assert from 'node:assert/strict';
import {CONFIG} from '../dist/engine.js';
import {Renderer, activeFocusTarget, upcomingReinforcements} from '../dist/renderer.js';
import {ActorPainter} from '../dist/actors.js';

function recordingCanvas() {
  const calls = [];
  const context = new Proxy({}, {get(target, key) {
    if (key in target) return target[key];
    if (key === 'measureText') return text => ({width: text.length * 6});
    return (...args) => calls.push([key, ...args]);
  }});
  return {context, calls};
}

test('focus artwork follows the live order and never identifies a dead or expired target', () => {
  const enemy = {id: 8, alive: true, x: 100, y: 110};
  const jammer = {id: 'jammer-1', type: 'jammer', alive: true, x: 200, y: 300};
  const state = {time: 4, focusTargetId: 8, focusUntil: 10, enemies: [enemy],
    objective: {type: 'sabotage', targets: [jammer]}};
  const before = structuredClone(state);
  assert.equal(activeFocusTarget(state), enemy);
  assert.deepEqual(state, before);
  enemy.alive = false;
  assert.equal(activeFocusTarget(state), null);
  state.focusTargetId = jammer.id;
  assert.equal(activeFocusTarget(state), jammer);
  state.time = 10;
  assert.equal(activeFocusTarget(state), null);
});

test('incoming artwork remains during a deferred safe spawn, and disappears on actual arrival', () => {
  const warning = {id: 1, x: 200, y: 400, pending: true, spawned: false, dueAt: 5};
  const state = {time: 4, objective: {type: 'holdout', pendingWave: warning}};
  assert.deepEqual(upcomingReinforcements(state), [warning]);
  state.time = 8;
  assert.deepEqual(upcomingReinforcements(state), [warning], 'unsafe arrival may be deferred');
  warning.pending = false; warning.spawned = true;
  assert.deepEqual(upcomingReinforcements(state), []);
  const malformed = {...warning, pending: true, spawned: false, x: NaN};
  state.objective = {type: 'sabotage', reinforcements: [malformed, {...warning, spawned: false, pending: true}]};
  const before = structuredClone(state);
  assert.equal(upcomingReinforcements(state).length, 1);
  assert.deepEqual(state, before);
});

test('aim preview paints the actual landing radius without changing the landing point or soldier', () => {
  const leader = {x: 100, y: 100}, point = {x: 430, y: 100};
  const {context, calls} = recordingCanvas();
  const before = structuredClone({leader, point});
  Renderer.prototype.drawGrenadeAim.call({worldPixels: value => value}, context, leader, point);
  assert.ok(calls.some(([name, x, y, radius]) => name === 'arc'
    && x === point.x && y === point.y && radius === CONFIG.grenadeRadius));
  assert.ok(calls.some(([name, x, y]) => name === 'lineTo' && x === point.x && y === point.y));
  assert.deepEqual({leader, point}, before);
});

test('bite warning and reduced motion painting leave combat clocks and actor records untouched', () => {
  const painter = new ActorPainter(), {context, calls} = recordingCanvas();
  const zombie = {id: 12, type: 'zombie', x: 200, y: 200, angle: 0, alive: true,
    hp: 42, maxHp: 42, biteTargetId: 1, biteTimer: .2, biteDuration: .3};
  const state = {time: 6}, before = structuredClone({zombie, state});
  painter.draw(context, zombie, 'zombie', state, false, {reducedMotion: true});
  assert.ok(calls.some(([name, , , radius]) => name === 'arc' && radius === 18), 'windup is visible before damage');
  assert.deepEqual({zombie, state}, before);
});
