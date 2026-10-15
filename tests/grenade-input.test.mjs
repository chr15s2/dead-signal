import test from 'node:test';
import assert from 'node:assert/strict';
import { InputController } from '../dist/input.js';

// Event targets model capture/lifecycle, while tests exercise the public input
// contract. Native two-thumb touch delivery is checked separately in Chromium.
class Target {
  constructor(bounds = {left: 0, top: 0, width: 400, height: 700}) {
    this.listeners = new Map(); this.captures = new Set(); this.bounds = bounds;
    this.style = {}; this.attributes = new Map(); this.disabled = false;
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatch(type, values = {}) {
    const event = {button: 0, pointerId: 2, pointerType: 'touch', clientX: 330,
      clientY: 630, detail: 1, isTrusted: true, target: {closest: () => null},
      defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...values};
    if (type === 'lostpointercapture') this.captures.delete(event.pointerId);
    for (const fn of this.listeners.get(type) || []) fn(event);
    return event;
  }
  getBoundingClientRect() { return this.bounds; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  focus() {}
  querySelector() { return null; }
}

function fixture({button = true} = {}) {
  const document = new Target(), window = new Target(), canvas = new Target();
  const joystick = new Target({left: 50, top: 580, width: 100, height: 100});
  const grenade = new Target({left: 300, top: 600, width: 64, height: 64});
  const knob = new Target(), throws = [], moves = [];
  const view = {x: 0, y: 0, valid: true}, lifecycle = {playing: true};
  window.performance = {now: () => 1000};
  document.defaultView = window; canvas.ownerDocument = document;
  grenade.ownerDocument = document;
  const controller = new InputController({canvas, joystick, knob,
    grenadeButton: button ? grenade : undefined, isPlaying: () => lifecycle.playing,
    renderer: {screenToWorld: (x, y) => view.valid ? {x: x + view.x, y: y + view.y} : null},
    onGrenade: (...args) => throws.push(args), onMove: (x, y) => moves.push({x, y})});
  return {controller, grenade, joystick, canvas, document, window, throws, moves, view, lifecycle};
}

test('a quick touch grenade waits for release and suppresses its later pointer click', () => {
  const {controller, grenade, throws} = fixture();
  grenade.dispatch('pointerdown');
  assert.equal(throws.length, 0);
  assert.deepEqual(controller.grenadeAim, {aiming: true, point: null});
  assert.equal(grenade.hasPointerCapture(2), true);
  grenade.dispatch('pointerup', {clientX: 333, clientY: 632});
  assert.deepEqual(throws, [[]]);
  assert.equal(controller.grenadeAim, null);
  assert.equal(grenade.hasPointerCapture(2), false);
  assert.equal(grenade.dispatch('click').defaultPrevented, true);
  assert.deepEqual(throws, [[]]);
});

test('legacy Safari touch clicks are suppressed, while assistive activation remains available', () => {
  const {grenade, throws} = fixture();
  grenade.dispatch('pointerdown'); grenade.dispatch('pointerup');
  grenade.dispatch('click', {pointerId: undefined, pointerType: undefined});
  assert.deepEqual(throws, [[]]);
  grenade.dispatch('click', {detail: 0, pointerId: undefined, pointerType: undefined});
  assert.deepEqual(throws, [[], []]);
});

test('mouse and pen button gestures throw once rather than once on release and again on click', () => {
  for (const pointerType of ['mouse', 'pen']) {
    const {grenade, throws} = fixture();
    grenade.dispatch('pointerdown', {pointerType});
    grenade.dispatch('pointerup', {pointerType});
    grenade.dispatch('click', {pointerType});
    assert.deepEqual(throws, [[]], pointerType);
  }
  const {grenade, throws} = fixture();
  grenade.dispatch('pointerdown', {pointerType: 'mouse'});
  grenade.dispatch('pointerup', {pointerType: 'mouse'});
  grenade.dispatch('click', {pointerType: undefined, pointerId: undefined});
  assert.deepEqual(throws, [[]], 'older Safari mouse clicks lack a pointer id too');
});

test('dragged aiming and release use the current camera, including movement after the last pointer event', () => {
  const {controller, grenade, view, throws} = fixture();
  grenade.dispatch('pointerdown');
  grenade.dispatch('pointermove', {clientX: 260, clientY: 430});
  assert.deepEqual(controller.grenadeAim, {aiming: true, point: {x: 260, y: 430}});
  view.x = 800; view.y = -100;
  assert.deepEqual(controller.grenadeAim, {aiming: true, point: {x: 1060, y: 330}});
  grenade.dispatch('pointerup', {clientX: 260, clientY: 430});
  assert.deepEqual(throws, [[1060, 330]]);
  grenade.dispatch('click', {clientX: 260, clientY: 430});
  assert.equal(throws.length, 1);
});

test('the eight CSS pixel threshold separates a jittery tap from aimed release', () => {
  for (const [distance, expected] of [[7.99, [[]]], [8, []], [-31, [[299, 630]]]]) {
    const {grenade, throws} = fixture();
    grenade.dispatch('pointerdown');
    grenade.dispatch('pointerup', {clientX: 330 + distance});
    assert.deepEqual(throws, expected);
  }
});

test('an aimed gesture must leave the button bounds before it can spend a grenade', () => {
  for (const [x, expected] of [[364, []], [364.01, [[364.01, 630]]]]) {
    const {controller, grenade, throws} = fixture();
    grenade.dispatch('pointerdown'); grenade.dispatch('pointermove', {clientX: x});
    if (x === 364) assert.equal(controller.grenadeAim, null);
    grenade.dispatch('pointerup', {clientX: x}); grenade.dispatch('click', {clientX: x});
    assert.deepEqual(throws, expected, 'the visible button edge remains a cancellation area');
  }
  const {grenade, throws} = fixture();
  grenade.dispatch('pointerdown', {clientX: 302});
  grenade.dispatch('pointerup', {clientX: 294});
  assert.deepEqual(throws, [[294, 630]], 'eight pixels suffice when the target is outside the control');
});

test('returning a drag to its start cancels until lift and cannot rearm accidentally', () => {
  const {controller, grenade, throws} = fixture();
  grenade.dispatch('pointerdown');
  grenade.dispatch('pointermove', {clientX: 200, clientY: 400});
  grenade.dispatch('pointermove', {clientX: 334, clientY: 632});
  assert.equal(controller.grenadeAim, null);
  grenade.dispatch('pointermove', {clientX: 220, clientY: 420});
  grenade.dispatch('pointerup', {clientX: 220, clientY: 420});
  grenade.dispatch('click', {clientX: 220, clientY: 420});
  assert.deepEqual(throws, []);
});

test('returning an outside drag anywhere onto the button cancels the throw', () => {
  const {controller, grenade, throws} = fixture();
  grenade.dispatch('pointerdown', {clientX: 310, clientY: 610});
  grenade.dispatch('pointermove', {clientX: 200, clientY: 400});
  grenade.dispatch('pointermove', {clientX: 350, clientY: 645});
  assert.equal(controller.grenadeAim, null);
  grenade.dispatch('pointerup', {clientX: 350, clientY: 645});
  grenade.dispatch('click', {clientX: 350, clientY: 645});
  assert.deepEqual(throws, []);
});

test('grenade aiming is independent of a held joystick and ignores other pointer releases', () => {
  const {controller, grenade, joystick, throws, moves} = fixture();
  joystick.dispatch('pointerdown', {pointerId: 1, clientX: 145, clientY: 630});
  assert.equal(controller.sample().moveX, 1);
  grenade.dispatch('pointerdown', {pointerId: 2});
  grenade.dispatch('pointermove', {pointerId: 2, clientX: 250, clientY: 450});
  grenade.dispatch('pointerup', {pointerId: 1});
  grenade.dispatch('pointerup', {pointerId: 2, button: 2});
  assert.equal(controller.grenadeAim.aiming, true);
  assert.equal(controller.sample().moveX, 1);
  grenade.dispatch('pointerup', {pointerId: 2, clientX: 250, clientY: 450});
  assert.deepEqual(throws, [[250, 450]]);
  assert.equal(controller.sample().moveX, 1);
  joystick.dispatch('pointerup', {pointerId: 1, clientX: 145, clientY: 630});
  assert.deepEqual(controller.sample(), {moveX: 0, moveY: 0});
  assert.deepEqual(moves, [], 'dragging the action never orders a terrain move');
});

test('pointer cancellation, lost capture and every scene lifecycle reset discard the throw', () => {
  for (const reason of ['pointercancel', 'lostpointercapture', 'reset', 'blur', 'orientationchange', 'hidden', 'paused']) {
    const {controller, grenade, window, document, lifecycle, throws} = fixture();
    grenade.dispatch('pointerdown');
    grenade.dispatch('pointermove', {clientX: 250, clientY: 450});
    if (reason === 'reset') controller.reset();
    else if (reason === 'hidden') { document.hidden = true; document.dispatch('visibilitychange'); }
    else if (reason === 'paused') { lifecycle.playing = false; controller.sample(); lifecycle.playing = true; }
    else if (['blur', 'orientationchange'].includes(reason)) window.dispatch(reason);
    else grenade.dispatch(reason);
    assert.equal(controller.grenadeAim, null, reason);
    assert.equal(grenade.hasPointerCapture(2), false, reason);
    grenade.dispatch('pointerup', {clientX: 250, clientY: 450});
    grenade.dispatch('click', {clientX: 250, clientY: 450});
    assert.deepEqual(throws, [], reason);
  }
});

test('disabled or paused actions cancel existing captures and reject activation', () => {
  for (const unavailable of ['disabled', 'aria-disabled', 'playing']) {
    const {controller, grenade, lifecycle, throws} = fixture();
    grenade.dispatch('pointerdown');
    if (unavailable === 'disabled') grenade.disabled = true;
    if (unavailable === 'aria-disabled') grenade.attributes.set('aria-disabled', 'true');
    if (unavailable === 'playing') lifecycle.playing = false;
    assert.equal(controller.grenadeAim, null);
    grenade.dispatch('click', {detail: 0});
    assert.deepEqual(throws, []);
    grenade.disabled = false; grenade.attributes.clear(); lifecycle.playing = true;
    grenade.dispatch('pointerup'); grenade.dispatch('click');
    assert.deepEqual(throws, [], 'a cancelled pointer cannot spend supplies after reactivation');
  }
});

test('invalid initial pointers and an invalid projection never become an automatic throw', () => {
  for (const invalid of [{button: 2}, {clientX: 10}, {clientY: NaN}, {pointerId: NaN}]) {
    const {controller, grenade, throws} = fixture();
    grenade.dispatch('pointerdown', invalid); grenade.dispatch('pointerup', invalid);
    assert.equal(controller.grenadeAim, null);
    assert.deepEqual(throws, []);
  }
  const {controller, grenade, view, throws} = fixture();
  grenade.dispatch('pointerdown');
  grenade.dispatch('pointermove', {clientX: 250, clientY: 450});
  view.valid = false;
  assert.equal(controller.grenadeAim, null);
  grenade.dispatch('pointerup', {clientX: 250, clientY: 450}); grenade.dispatch('click');
  assert.deepEqual(throws, []);
});

test('keyboard G keeps projected canvas aim while a button tap uses automatic targeting', () => {
  const {controller, canvas, window, view, grenade, throws} = fixture();
  canvas.dispatch('pointermove', {pointerType: 'mouse', clientX: 150, clientY: 300});
  view.x = 200;
  window.dispatch('keydown', {key: 'g'});
  assert.deepEqual(throws, [[350, 300]]);
  window.dispatch('keydown', {key: 'g', repeat: true});
  window.dispatch('keydown', {key: 'g', ctrlKey: true});
  window.dispatch('keydown', {key: 'g', target: {closest: () => ({})}});
  assert.equal(throws.length, 1);
  grenade.dispatch('pointerdown', {pointerType: 'mouse'});
  grenade.dispatch('pointerup', {pointerType: 'mouse'});
  assert.deepEqual(throws, [[350, 300], []]);
  controller.destroy();
  assert.equal(grenade.hasPointerCapture(2), false);
  grenade.dispatch('click', {detail: 0});
  assert.equal(throws.length, 2);
});

test('old controller callers without a grenade button retain keyboard and joystick behavior', () => {
  const {controller, window, joystick, throws} = fixture({button: false});
  window.dispatch('keydown', {key: 'g'});
  joystick.dispatch('pointerdown', {clientX: 145, clientY: 630});
  assert.equal(controller.sample().moveX, 1);
  assert.deepEqual(throws, [[]]);
  assert.equal(controller.grenadeAim, null);
});
