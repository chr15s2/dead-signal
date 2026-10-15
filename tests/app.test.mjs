import test from 'node:test';
import assert from 'node:assert/strict';
import { SAVE_KEY, MISSION_REVISION, loadProgress, saveProgress, normalizeProgress, objectiveFor } from '../dist/session.js';

function memoryStorage(initial = null) {
  const values = new Map(initial === null ? [] : [[SAVE_KEY, initial]]);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

const emptyProgress = { completed: [], best: {}, difficulty: 'normal', soundOn: false, missionRevision: MISSION_REVISION };

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
    difficulty: 'impossible', soundOn: 'true', unknown: 'discard', missionRevision: MISSION_REVISION,
  };
  assert.deepEqual(normalizeProgress(input), {
    completed: [0, 1, 2], best: { 0: 12.4 }, difficulty: 'normal', soundOn: false, missionRevision: MISSION_REVISION,
  });
  assert.deepEqual(input.completed.slice(0, 4), [2, 0, 0, 1]);
  for (const badBest of [[], null, 3, 'text', { 0: NaN, 1: Infinity, 2: 0 }]) {
    assert.deepEqual(normalizeProgress({ best: badBest }).best, {});
  }
});

test('successful save roundtrips clean completion, difficulty and opt-in audio', () => {
  const storage = memoryStorage();
  const progress = { completed: [2, 0, 2], best: { 0: 25.75, 2: 80.5 }, difficulty: 'hard', soundOn: true, missionRevision: MISSION_REVISION };
  assert.equal(saveProgress(storage, progress), true);
  assert.deepEqual(loadProgress(storage), { ...progress, completed: [0, 2] });
  assert.deepEqual(JSON.parse(storage.getItem(SAVE_KEY)), loadProgress(storage));
  assert.equal(normalizeProgress({ difficulty: 'easy' }).difficulty, 'easy');
});

test('revision two preserves the expanded First Contact time and retires rebuilt mission times once', () => {
  const storage = memoryStorage(JSON.stringify({completed: [0, 1, 2], best: {0: 65, 1: 30, 2: 40}, difficulty: 'hard', soundOn: true, missionRevision: 2}));
  const migrated = loadProgress(storage);
  assert.deepEqual(migrated, {completed: [0, 1, 2], best: {0: 65}, difficulty: 'hard', soundOn: true, missionRevision: MISSION_REVISION});
  migrated.best[1] = 75; migrated.best[2] = 90;
  assert.equal(saveProgress(storage, migrated), true);
  assert.deepEqual(loadProgress(storage), migrated, 'new mission times survive subsequent loads');
  assert.deepEqual(normalizeProgress(migrated), migrated, 'migration is idempotent');
});

test('revision one, legacy and unknown revisions retain progress and preferences without incomparable times', () => {
  for (const revision of [undefined, 0, 1, -1, 4, '3']) {
    const migrated = normalizeProgress({completed: [0, 1, 2], best: {0: 15, 1: 30, 2: 40}, difficulty: 'easy', soundOn: true, missionRevision: revision});
    assert.deepEqual(migrated, {completed: [0, 1, 2], best: {}, difficulty: 'easy', soundOn: true, missionRevision: MISSION_REVISION});
  }
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
    rescueCount: 0, rescueTarget: 1, wavesRemaining: 1, objective: {type: 'rescue'},
    ...overrides,
  };
}

test('objective HUD distinguishes rescue and sabotage instead of requesting a map cleanup', () => {
  const rescue = objectiveFor(objectiveState());
  assert.equal(rescue.label, 'RESCUE');
  assert.equal(rescue.counter, '0 / 1 SAFE');
  assert.equal(rescue.progress, null);
  const sabotage = objectiveFor(objectiveState({rescueTarget: 0, objective: {type: 'sabotage', targets: [{alive: false}, {alive: true}]}}));
  assert.equal(sabotage.label, 'SABOTAGE');
  assert.equal(sabotage.counter, '1 / 2 SILENCED');
  assert.match(sabotage.text, /Gunfire or grenades/);
  assert.equal(sabotage.progress, null);
});

test('relay HUD explains reaching, holding and returning to saved transmission progress', () => {
  const objective = {type: 'holdout', duration: 25, held: 7.5, started: false, inside: false};
  const state = objectiveState({rescueTarget: 0, objective});
  const reach = objectiveFor(state);
  assert.equal(reach.label, 'REACH THE RELAY');
  assert.equal(reach.counter, '25 SEC SIGNAL');
  assert.equal(reach.progress, 0);
  objective.started = true; objective.inside = true;
  const holding = objectiveFor(state);
  assert.equal(holding.label, 'HOLD THE SIGNAL');
  assert.equal(holding.counter, '18 SEC LEFT');
  assert.equal(holding.progress, .3);
  objective.inside = false;
  const returning = objectiveFor(state);
  assert.equal(returning.label, 'RE-ENTER THE SIGNAL');
  assert.equal(returning.counter, '18 SEC LEFT');
  assert.match(returning.text, /progress is saved/);
  assert.equal(returning.progress, .3);
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


test('operation HUD gives four distinct stages and local clearance instructions', () => {
  const objective = {type: 'operation', phase: 0, stageCount: 4, currentPoints: [{remaining: 3}]};
  const state = objectiveState({rescueTarget: 2, objective});
  const entry = objectiveFor(state);
  assert.deepEqual([entry.label, entry.counter, entry.stage, entry.stages], ['SECURE THE VILLAGE', '3 HOSTILES', 1, 4]);
  assert.match(entry.text, /marked defenders/);
  objective.currentPoints[0].remaining = 0;
  assert.equal(objectiveFor(state).counter, 'REACH CHECKPOINT');
  assert.match(objectiveFor(state).text, /leader/);
  objective.phase = 1; state.rescueCount = 1;
  objective.currentPoints = [{id: 'school', remaining: 2}];
  const rescue = objectiveFor(state);
  assert.deepEqual([rescue.label, rescue.counter, rescue.stage], ['RESCUE BOTH SURVIVORS', '1 / 2 SAFE', 2]);
  assert.match(rescue.text, /School: 2 hostiles/);
  objective.currentPoints = [{id: 'clinic', remaining: 0}, {id: 'school', remaining: 0}];
  assert.match(objectiveFor(state).text, /either marked survivor/);
  objective.phase = 2; objective.currentPoints[0].remaining = 1;
  assert.deepEqual([objectiveFor(state).label, objectiveFor(state).counter, objectiveFor(state).stage], ['SECURE THE HARBOUR', '1 HOSTILE', 3]);
  objective.phase = 3; state.extraction.active = true;
  assert.deepEqual([objectiveFor(state).label, objectiveFor(state).stage, objectiveFor(state).stages], ['EXTRACTION OPEN', 4, 4]);
});

test('incoming response HUD translates bearings, counts down with simulation time and clears after arrival', () => {
  const response = {id: 1, x: 800, y: 500, dueAt: 5, direction: 0, pending: true, spawned: false};
  const state = objectiveState({time: 2.1, rescueTarget: 0, objective: {type: 'sabotage', targets: [{alive: false}, {alive: true}], reinforcements: [response]}});
  const east = objectiveFor(state);
  assert.match(east.text, /counterattack/i);
  assert.match(east.text, /east/i);
  assert.match(east.text, /3s/);
  response.direction = Math.PI / 2;
  assert.match(objectiveFor(state).text, /south/i);
  response.direction = -Math.PI / 2;
  assert.match(objectiveFor(state).text, /north/i);
  response.direction = Math.PI;
  assert.match(objectiveFor(state).text, /west/i);
  assert.ok(!/3\.14159/.test(objectiveFor(state).text));
  state.time = 5.5;
  assert.match(objectiveFor(state).text, /approach/i);
  response.pending = false; response.spawned = true;
  assert.doesNotMatch(objectiveFor(state).text, /counterattack/i);
  assert.equal(objectiveFor(state).counter, '1 / 2 SILENCED');
});
