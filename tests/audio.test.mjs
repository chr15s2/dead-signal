import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../dist/audio.js';

// This fake records source starts/stops, not the shape of synthesized sounds.
// These regressions protect the event journal and user-gesture audio lifecycle.
class AudioParam {
  constructor() { this.value = 0; }
  setValueAtTime() {}
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
  cancelScheduledValues() {}
  setTargetAtTime() {}
}

class AudioNode {
  constructor() {
    for (const key of ['gain', 'frequency', 'Q', 'pan', 'threshold', 'knee', 'ratio', 'attack', 'release']) {
      this[key] = new AudioParam();
    }
  }
  connect() {}
  disconnect() {}
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 1;
    this.sampleRate = 8000;
    this.state = 'suspended';
    this.destination = new AudioNode();
    this.sources = [];
  }
  createGain() { return new AudioNode(); }
  createDynamicsCompressor() { return new AudioNode(); }
  createStereoPanner() { return new AudioNode(); }
  createBiquadFilter() { return new AudioNode(); }
  createBuffer(channels, length) { return {getChannelData: () => new Float32Array(length)}; }
  createOscillator() { return this.source(); }
  createBufferSource() { return this.source(); }
  source() {
    const source = new AudioNode();
    source.started = false;
    source.start = () => { source.started = true; };
    source.stop = time => { source.stoppedAt = time; };
    this.sources.push(source);
    return source;
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

function fixture(t, {available = true, webkit = false, blocked = false} = {}) {
  const originals = ['AudioContext', 'webkitAudioContext'].map(name =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const contexts = [], engines = [];
  class BrowserAudioContext extends FakeAudioContext {
    constructor() { super(); contexts.push(this); }
    resume() { return blocked ? Promise.reject(new Error('Audio is blocked')) : super.resume(); }
  }
  globalThis.AudioContext = available && !webkit ? BrowserAudioContext : undefined;
  globalThis.webkitAudioContext = available && webkit ? BrowserAudioContext : undefined;
  t.after(() => {
    for (const engine of engines) engine.destroy();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return {contexts, engine(options) {
    const engine = new AudioEngine(options);
    engines.push(engine);
    return engine;
  }};
}

const shot = (id, time = 1) => ({id, type: 'shot', time, x: 100, y: 100, team: 'player'});
const scene = events => ({events, time: 1, status: 'playing', leaderId: 1,
  soldiers: [{id: 1, alive: true, x: 100, y: 100, shootFlash: 1}]});
const starts = context => context.sources.filter(source => source.started).length;

test('constructing and consuming the muted game never creates an autoplay context', t => {
  const env = fixture(t);
  const audio = env.engine();
  audio.cue('deploy');
  audio.consume(scene([shot(1)]));
  assert.equal(audio.debug.enabled, false);
  assert.equal(audio.debug.contextState, 'uninitialized');
  assert.equal(audio.debug.lastEventId, 1);
  assert.equal(env.contexts.length, 0);
  // Even a saved enabled preference still needs an explicit gesture activation.
  env.engine({enabled: true}).cue('deploy');
  assert.equal(env.contexts.length, 0);
});

test('a persistent shoot flash and repeated frames never replay the same gunshot', async t => {
  const env = fixture(t), audio = env.engine();
  assert.equal(await audio.setEnabled(true), true);
  const context = env.contexts[0], state = scene([shot(1)]);
  audio.consume(state);
  const firstShot = starts(context);
  assert.ok(firstShot > 0);
  for (let frame = 0; frame < 10; frame++) {
    context.currentTime += 0.1;
    audio.consume(state);
  }
  assert.equal(starts(context), firstShot);
  state.events.push(shot(2));
  audio.consume(state);
  assert.ok(starts(context) > firstShot);
  assert.equal(audio.debug.lastEventId, 2);
});

test('pause and mute consume events silently so resume has no old gunfire backlog', async t => {
  const env = fixture(t), audio = env.engine();
  await audio.setEnabled(true);
  const context = env.contexts[0], state = scene([shot(1)]);
  audio.consume(state);
  const firstShot = starts(context);
  audio.pause(true);
  state.events.push(shot(2));
  audio.consume(state);
  assert.equal(audio.debug.voices, 0);
  assert.equal(audio.debug.lastEventId, 2);
  audio.pause(false);
  context.currentTime += 0.2;
  audio.consume(state);
  assert.equal(starts(context), firstShot);
  await audio.setEnabled(false);
  state.events.push(shot(3));
  audio.consume(state);
  assert.equal(audio.debug.lastEventId, 3);
  await audio.setEnabled(true);
  audio.consume(state);
  assert.equal(starts(context), firstShot);
  state.events.push(shot(4));
  audio.consume(state);
  assert.ok(starts(context) > firstShot);
});

test('a mission reset accepts the new journal starting again at event one', async t => {
  const env = fixture(t), audio = env.engine();
  await audio.setEnabled(true);
  const context = env.contexts[0];
  audio.consume(scene([shot(40)]));
  const previousMission = starts(context);
  audio.reset();
  assert.equal(audio.debug.lastEventId, 0);
  assert.equal(audio.debug.voices, 0);
  audio.consume(scene([shot(1)]));
  assert.ok(starts(context) > previousMission);
  assert.equal(audio.debug.lastEventId, 1);
});

test('dense feedback stays bounded and shutdown stops every source', async t => {
  const env = fixture(t), audio = env.engine();
  await audio.setEnabled(true);
  const context = env.contexts[0];
  for (let click = 0; click < 60; click++) audio.cue('select');
  assert.ok(audio.debug.voices > 0 && audio.debug.voices <= 18);
  audio.pause(true);
  assert.equal(audio.debug.voices, 0);
  assert.ok(context.sources.every(source => source.stoppedAt <= context.currentTime + 0.025));
  // Menus can still give a deliberate UI cue; simulation events stay suppressed.
  audio.cue('resume');
  assert.ok(audio.debug.voices > 0);
  audio.destroy();
  assert.equal(context.state, 'closed');
  assert.equal(audio.debug.voices, 0);
  assert.equal(await audio.setEnabled(true), false);
});

test('unsupported audio returns to silence without rejecting', async t => {
  const unsupported = fixture(t, {available: false}).engine();
  assert.equal(await unsupported.setEnabled(true), false);
  unsupported.consume(scene([shot(1)]));
  assert.equal(unsupported.debug.lastEventId, 1);
  assert.equal(unsupported.debug.voices, 0);
});

test('a browser blocking audio activation stays muted without rejecting', async t => {
  const blocked = fixture(t, {blocked: true}).engine();
  assert.equal(await blocked.setEnabled(true), false);
  blocked.cue('deploy');
  blocked.consume(scene([shot(1)]));
  assert.equal(blocked.debug.enabled, false);
  assert.equal(blocked.debug.voices, 0);
});

test('Safari webkit audio is activated only by the explicit enable call', async t => {
  const env = fixture(t, {webkit: true}), audio = env.engine();
  assert.equal(env.contexts.length, 0);
  assert.equal(await audio.setEnabled(true), true);
  assert.equal(env.contexts.length, 1);
  assert.equal(audio.debug.contextState, 'running');
  audio.cue('select');
  assert.ok(starts(env.contexts[0]) > 0);
});
