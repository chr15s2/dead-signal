import test from 'node:test';
import assert from 'node:assert/strict';
import { SAVE_KEY, loadProgress, saveProgress, normalizeProgress, objectiveFor } from '../dist/session.js';

function memoryStorage(initial = null) {
  const values = new Map(initial === null ? [] : [[SAVE_KEY, initial]]);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

const emptyProgress = { completed: [], best: {}, difficulty: 'normal', soundOn: false };

test('missing, malformed and denied progress cannot prevent a clean deployment', () => {
  for (const raw of [null, '{broken', 'null', '[]', '"unexpected"', '42']) {
    assert.deepEqual(loadProgress(memoryStorage(raw)), emptyProgress);
  }
  const denied = { getItem() { throw new Error('Storage denied'); }, setItem() { throw new Error('Quota exceeded'); } };
  assert.deepEqual(loadProgress(denied), emptyProgress);
  assert.equal(saveProgress(denied, emptyProgress), false);
});

test('progress accepts only unique mission ids, finite times and valid preferences', () => {
  const input = {
    completed: [2, 0, 0, 1, 3, -1, 1.2, '1', null, {}, Infinity],
    best: { 0: 12.4, 1: -5, 2: '19', 3: 10, extra: 42 },
    difficulty: 'impossible', soundOn: 'true', unknown: 'discard',
  };
  assert.deepEqual(normalizeProgress(input), {
    completed: [0, 1, 2], best: { 0: 12.4 }, difficulty: 'normal', soundOn: false,
  });
  assert.deepEqual(input.completed.slice(0, 4), [2, 0, 0, 1]);
  for (const badBest of [[], null, 3, 'text', { 0: NaN, 1: Infinity, 2: 0 }]) {
    assert.deepEqual(normalizeProgress({ best: badBest }).best, {});
  }
});

test('successful save roundtrips clean completion, difficulty and opt-in audio', () => {
  const storage = memoryStorage();
  const progress = { completed: [2, 0, 2], best: { 0: 25.75, 2: 80.5 }, difficulty: 'hard', soundOn: true };
  assert.equal(saveProgress(storage, progress), true);
  assert.deepEqual(loadProgress(storage), { ...progress, completed: [0, 2] });
  assert.deepEqual(JSON.parse(storage.getItem(SAVE_KEY)), loadProgress(storage));
  assert.equal(normalizeProgress({ difficulty: 'easy' }).difficulty, 'easy');
});

test('malformed saves cannot introduce inherited progress fields', () => {
  const storage = memoryStorage('{"__proto__":{"completed":[0,1,2]},"best":{"__proto__":{"0":1}},"constructor":{"prototype":{"soundOn":true}}}');
  assert.deepEqual(loadProgress(storage), emptyProgress);
  assert.equal({}.soundOn, undefined);
});

function objectiveState(overrides = {}) {
  return {
    enemies: [{ alive: true }, { alive: false }],
    extraction: { active: false, progress: 0, regrouping: false },
    rescueCount: 0, rescueTarget: 2, wavesRemaining: 2,
    ...overrides,
  };
}

test('objective HUD distinguishes rescues, living hostiles and finite waves', () => {
  const rescue = objectiveFor(objectiveState({ rescueCount: 1 }));
  assert.equal(rescue.label, 'RESCUE');
  assert.equal(rescue.counter, '1 / 2 SAFE');
  assert.equal(rescue.progress, null);
  const clear = objectiveFor(objectiveState({ rescueTarget: 0, wavesRemaining: 1 }));
  assert.equal(clear.label, 'SECURE THE AREA');
  assert.equal(clear.counter, '1 HOSTILE');
  assert.match(clear.text, /1 infected wave remains/);
  const waiting = objectiveFor(objectiveState({ rescueTarget: 0, enemies: [], wavesRemaining: 2 }));
  assert.equal(waiting.label, 'HOLD THE PERIMETER');
  assert.match(waiting.text, /2 infected waves remain/);
});

test('extraction HUD gives explicit regrouping and hold-position feedback', () => {
  const regroup = objectiveFor(objectiveState({ extraction: { active: true, progress: .6, regrouping: true } }));
  assert.equal(regroup.label, 'REGROUP');
  assert.match(regroup.text, /squad and survivors/);
  assert.equal(regroup.counter, 'STAY TOGETHER');
  const extracting = objectiveFor(objectiveState({ extraction: { active: true, progress: .6, regrouping: false } }));
  assert.equal(extracting.label, 'EXTRACTING');
  assert.equal(extracting.counter, '60%');
  assert.equal(extracting.progress, .6);
  const open = objectiveFor(objectiveState({ extraction: { active: true, progress: 0, regrouping: false } }));
  assert.equal(open.label, 'EXTRACTION OPEN');
  assert.equal(open.counter, 'REACH THE FLARE');
});
