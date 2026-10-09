import test from 'node:test';
import assert from 'node:assert/strict';
import { joystickVector } from '../dist/input.js';

test('the joystick stays still inside its radial thumb deadzone', () => {
  for (const [x, y] of [[0, 0], [3, 0], [0, -3], [2, 2]]) {
    assert.deepEqual(joystickVector(x, y, 33), { x: 0, y: 0 });
  }
});

test('leaving the deadzone starts smoothly rather than jumping to full speed', () => {
  const nearCenter = joystickVector(33 * .14, 0, 33);
  const halfway = joystickVector(33 * .565, 0, 33);
  assert.ok(nearCenter.x > 0 && nearCenter.x < .02);
  assert.ok(Math.abs(halfway.x - .5) < 1e-12);
  assert.equal(nearCenter.y, 0);
});

test('the joystick caps speed and preserves direction when dragged beyond its rim', () => {
  const position = joystickVector(300, -400, 33);
  assert.ok(Math.abs(position.x - .6) < 1e-12);
  assert.ok(Math.abs(position.y + .8) < 1e-12);
  assert.ok(Math.abs(Math.hypot(position.x, position.y) - 1) < 1e-12);
});

test('diagonal steering has the same maximum speed as horizontal steering', () => {
  const diagonal = joystickVector(33, 33, 33);
  const horizontal = joystickVector(33, 0, 33);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - horizontal.x) < 1e-12);
});

test('an unmeasured or invalid joystick cannot inject nonfinite movement', () => {
  for (const args of [[0, 0, 0], [20, 10, -1], [NaN, 0, 33], [0, Infinity, 33]]) {
    assert.deepEqual(joystickVector(...args), { x: 0, y: 0 });
  }
});
