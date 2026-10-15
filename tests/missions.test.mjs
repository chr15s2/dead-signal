import test from 'node:test';
import assert from 'node:assert/strict';
import {Game, CONFIG} from '../dist/engine.js';

const advance = (game, seconds, input = {}) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) game.update(CONFIG.step, input);
};
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function isolated(mission) {
  const game = new Game({mission}).start();
  game.state.enemies = [];
  game.world.obstacles = [];
  game.rebuildNavigation();
  return game;
}

test('the three missions have distinct objectives and only First Contact has its two rescue civilians', () => {
  const games = [0, 1, 2].map(mission => new Game({mission}));
  assert.deepEqual(games.map(game => game.state.objective.type), ['operation', 'sabotage', 'holdout']);
  assert.deepEqual(games.map(game => game.civilians.length), [2, 0, 0]);
  assert.deepEqual(games.map(game => game.state.rescueTarget), [2, 0, 0]);
  const targets = games[1].state.objective.targets;
  assert.deepEqual(targets.map(({x, y, hp, maxHp, r}) => [x, y, hp, maxHp, r]), [[829, 327, 90, 90, 18], [1300, 570, 90, 90, 18]]);
  assert.ok(targets.every(target => !games[1].enemies.includes(target) && !games[1].world.obstacles.includes(target)));
});

test('sabotage cannot complete from enemy or zombie damage, and destroyed devices are not kills', () => {
  const game = isolated(1);
  const target = game.state.objective.targets[0];
  const kills = game.state.kills;
  const corpses = game.corpses.length;
  game.damage(target, 1000, 'enemy');
  game.damage(target, 1000, 'zombie');
  game.explode(target.x, target.y, 112, 1000, false, 'enemy');
  assert.equal(target.hp, 90);
  assert.equal(target.alive, true);
  game.damage(target, 1000, 'player');
  game.damage(target, 1000, 'player');
  assert.equal(target.alive, false);
  assert.equal(game.state.kills, kills);
  assert.equal(game.corpses.length, corpses);
  assert.ok(!game.state.events.some(event => event.type === 'death'));
  const events = game.state.events.filter(event => event.targetId === target.id);
  assert.deepEqual(events.map(event => [event.type, event.team]), [['hit', 'objective'], ['jammer-destroyed', 'objective']]);
  game.checkObjective(CONFIG.step);
  assert.equal(game.extraction.active, false, 'one device is not both devices');
});

test('barrel chain explosions preserve their firing team through sabotage damage', () => {
  for (const team of ['enemy', 'player']) {
    const game = isolated(1);
    const target = game.state.objective.targets[0];
    game.world.obstacles = [
      {type: 'barrel', x: 789, y: 317, w: 20, h: 20, hp: 1, alive: true},
      {type: 'barrel', x: 815, y: 317, w: 20, h: 20, hp: 24, alive: true},
    ];
    game.state.bullets.push({x: 765, y: 327, vx: 700, vy: 0, damage: 13, life: .3, team, shooterId: -1});
    game.updateBullets(.1);
    assert.ok(game.world.obstacles.every(obstacle => !obstacle.alive));
    assert.equal(target.alive, team === 'enemy');
    assert.ok(game.state.events.filter(event => event.type === 'explosion').every(event => event.team === team));
    assert.equal(game.state.kills, 0);
  }
});

test('autofire deals with nearby hostiles before acquiring a visible jammer', () => {
  const game = isolated(1);
  const target = game.state.objective.targets[0];
  for (const [index, soldier] of game.soldiers.entries()) {
    soldier.x = target.x - 150; soldier.y = target.y + index * 30; soldier.cooldown = 0;
  }
  const zombie = game.spawnEnemy('zombie', target.x - 70, target.y);
  game.update(CONFIG.step);
  const first = game.state.events.filter(event => event.type === 'shot' && event.team === 'player');
  assert.equal(first.length, 3);
  assert.ok(first.every(event => event.targetId === zombie.id));
  zombie.alive = false;
  for (const soldier of game.soldiers) soldier.cooldown = 0;
  game.update(CONFIG.step);
  const next = game.state.events.filter(event => event.type === 'shot' && event.team === 'player').slice(3);
  assert.equal(next.length, 3);
  assert.ok(next.every(event => event.targetId === target.id));
});

test('jammer autofire respects cover and weapon range, while explicit manual aim works', () => {
  const game = isolated(1);
  const target = game.state.objective.targets[0];
  game.leader.x = target.x - 200; game.leader.y = target.y; game.leader.cooldown = 0;
  game.world.obstacles = [{type: 'rock', x: target.x - 100, y: target.y - 30, w: 20, h: 60, hp: Infinity, alive: true}];
  assert.equal(game.acquireTarget(game.leader, game.state.objective.targets, CONFIG.weaponRange), null);
  game.world.obstacles = [];
  game.leader.x = target.x - CONFIG.weaponRange - 1;
  assert.equal(game.acquireTarget(game.leader, game.state.objective.targets, CONFIG.weaponRange), null);
  game.leader.x = target.x - 150;
  game.setHoldFire(true);
  advance(game, 1, {fire: true, aim: {x: target.x, y: target.y}});
  assert.ok(target.hp < target.maxHp, 'manual-aim bullets strike the prop');
});

test('smart grenade values a full-health jammer and honors a focused hostile', () => {
  const game = isolated(1);
  const target = game.state.objective.targets[0];
  game.leader.x = target.x - 250; game.leader.y = target.y;
  const zombie = game.spawnEnemy('zombie', game.leader.x + 80, game.leader.y + 30);
  assert.equal(game.grenade(), true);
  assert.deepEqual([game.state.thrownGrenades[0].tx, game.state.thrownGrenades[0].ty], [target.x, target.y], '90 useful device damage beats one isolated zombie');
  game.focusTarget(zombie.id);
  assert.equal(game.grenade(), true);
  assert.deepEqual([game.state.thrownGrenades[1].tx, game.state.thrownGrenades[1].ty], [zombie.x, zombie.y]);
  game.damage(zombie, 1000, 'player');
  assert.equal(game.grenade(), true);
  const thrown = game.state.thrownGrenades[2];
  assert.deepEqual([thrown.tx, thrown.ty], [target.x, target.y]);
  game.updateGrenades(CONFIG.grenadeFlight + .01);
  assert.equal(target.alive, false, 'a centered frag destroys the 90 HP device');
});

test('a dead or out-of-range jammer is not a mobile grenade target', () => {
  const game = isolated(1);
  const target = game.state.objective.targets[0];
  game.leader.x = target.x - 340; game.leader.y = target.y; game.leader.angle = Math.PI;
  game.grenade();
  assert.ok(game.state.thrownGrenades[0].tx < game.leader.x, 'outside330px uses forward throw');
  game.leader.x = target.x - 200;
  target.alive = false;
  game.grenade();
  assert.ok(game.state.thrownGrenades[1].tx < game.leader.x, 'destroyed device is ignored');
});

test('no relay progress or waves occur before the selected soldier first enters', () => {
  const game = isolated(2);
  game.setHoldFire(true);
  const objective = game.state.objective;
  // A follower inside cannot operate the relay instead of the selected leader.
  game.soldiers[1].x = objective.zone.x; game.soldiers[1].y = objective.zone.y;
  advance(game, 40);
  assert.equal(objective.started, false);
  assert.equal(objective.held, 0);
  assert.equal(objective.elapsed, 0);
  assert.equal(game.waveCount, 0);
  assert.equal(game.state.wavesRemaining, 3);
  assert.equal(game.extraction.active, false);
  game.leader.x = objective.zone.x; game.leader.y = objective.zone.y;
  game.update(CONFIG.step);
  assert.equal(objective.started, true);
  assert.equal(objective.inside, true);
  assert.equal(game.waveCount, 0, 'first entry announces a response before spawning it');
  assert.equal(objective.nextWaveIndex, 1);
  assert.ok(objective.pendingWave);
  assert.ok(game.state.events.some(event => event.type === 'reinforcement-warning'));
  assert.equal(objective.held, CONFIG.step);
});

test('relay progress is cumulative leader presence, saved outside and frozen while paused', () => {
  const game = isolated(2);
  const objective = game.state.objective;
  game.leader.x = objective.zone.x; game.leader.y = objective.zone.y;
  game.updateObjective(5);
  assert.equal(objective.held, 5);
  game.leader.x += objective.zone.r + 5;
  game.updateObjective(4);
  assert.equal(objective.inside, false);
  assert.equal(objective.held, 5);
  assert.equal(objective.elapsed, 9, 'mission encounter time continues while saved transmission progress is frozen');
  game.pause();
  const paused = structuredClone(objective);
  advance(game, 2);
  assert.deepEqual(objective, paused);
  game.pause(false);
  game.leader.x = objective.zone.x;
  game.updateObjective(20);
  assert.equal(objective.held, 25);
  game.checkObjective(CONFIG.step);
  assert.equal(game.extraction.active, true);
});

test('changing the selected soldier changes who operates the relay', () => {
  const game = isolated(2);
  const objective = game.state.objective;
  const operator = game.soldiers[1];
  operator.x = objective.zone.x; operator.y = objective.zone.y;
  game.updateObjective(1);
  assert.equal(objective.started, false);
  assert.equal(game.selectSoldier(operator.id), true);
  game.updateObjective(1);
  assert.equal(objective.started, true);
  assert.equal(objective.held, 1);
  game.selectSoldier(game.soldiers[0].id);
  game.updateObjective(1);
  assert.equal(objective.inside, false);
  assert.equal(objective.held, 1);
});

test('late mission time does not recall every distant hostile into the relay', () => {
  const game = isolated(2);
  const distant = game.spawnEnemy('soldier', 1370, 220);
  const original = {x: distant.x, y: distant.y};
  game.state.time = 100;
  game.updateEnemies(CONFIG.step);
  assert.equal(distant.active, false);
  assert.deepEqual({x: distant.x, y: distant.y}, original);
});

test('relay waves follow held progress milestones with warnings and cannot be burned while outside', () => {
  const game = isolated(2);
  const objective = game.state.objective;
  game.state.time = 100;
  game.updateWaves(100);
  assert.equal(game.waveCount, 0);
  game.leader.x = objective.zone.x; game.leader.y = objective.zone.y;
  game.updateObjective(CONFIG.step); game.updateWaves(CONFIG.step);
  assert.equal(game.waveCount, 0);
  assert.equal(objective.nextWaveIndex, 1);
  assert.ok(objective.pendingWave.dueAt >= game.state.time + 2 - 1e-8);
  game.leader.x += objective.zone.r + 10;
  game.updateObjective(40);
  game.state.time += 40; game.updateWaves(CONFIG.step);
  assert.equal(game.waveCount, 1, 'the announced wave arrives during a retreat');
  assert.equal(objective.nextWaveIndex, 1, 'future milestones wait for actual transmission');
  assert.equal(objective.held, CONFIG.step);
  for (const milestone of [8, 16]) {
    game.leader.x = objective.zone.x;
    game.updateObjective(milestone - objective.held); game.updateWaves(CONFIG.step);
    const countBefore = game.waveCount;
    assert.ok(objective.pendingWave);
    game.state.time = objective.pendingWave.dueAt - .01; game.updateWaves(CONFIG.step);
    assert.equal(game.waveCount, countBefore);
    game.state.time += .02; game.updateWaves(CONFIG.step);
    assert.equal(game.waveCount, countBefore + 1);
  }
  game.updateObjective(50); game.state.time += 50; game.updateWaves(50);
  assert.equal(game.waveCount, 3);
  assert.equal(game.state.wavesRemaining, 0);
  assert.equal(game.enemies.length, 12);
  assert.equal(objective.nextWaveIndex, 3);
  assert.equal(objective.pendingWave, null);
});

test('holdout announced spawn points remain330px from every living soldier after movement and cover correction', () => {
  for (const seed of [1, 42, 531, 1989, 2143]) {
    for (const location of [{x: 1020, y: 520}, {x: 1370, y: 220}, {x: 1410, y: 1080}]) {
      const game = new Game({mission: 2, seed}).start();
      const objective = game.state.objective;
      game.leader.x = objective.zone.x; game.leader.y = objective.zone.y;
      game.updateObjective(CONFIG.step); game.updateWaves(CONFIG.step);
      assert.ok(objective.pendingWave);
      for (const [index, soldier] of game.soldiers.entries()) {
        Object.assign(soldier, game.nearestOpen(location.x - index * 130, location.y + index * 30));
      }
      const before = game.enemies.length;
      for (let attempt = 0; attempt < 3 && game.waveCount === 0; attempt++) {
        const warning = objective.pendingWave;
        game.state.time = warning.dueAt + .01;
        game.updateWaves(CONFIG.step);
        if (game.waveCount === 0) {
          assert.ok(warning.pending && !warning.spawned);
          assert.ok(warning.dueAt >= game.state.time + .6 - 1e-8,
            'a changed sector must be announced before a postponed arrival');
          const revised = game.state.events.filter(event => event.type === 'reinforcement-warning').at(-1);
          assert.equal(revised.dueAt, warning.dueAt);
        }
      }
      const spawned = game.enemies.slice(before);
      assert.equal(spawned.length, 4);
      for (const enemy of spawned) {
        assert.equal(game.blocked(enemy.x, enemy.y, 16), false);
        assert.ok(game.soldiers.every(soldier => distance(soldier, enemy) >= 330), `unsafe wave seed${seed}`);
        assert.equal(enemy.waveSpawn, true);
      }
    }
  }
});

test('sabotage and relay completion still require the full living squad at extraction', () => {
  for (const mission of [1, 2]) {
    const game = isolated(mission);
    if (mission === 1) game.state.objective.targets.forEach(target => game.damage(target, 1000));
    else game.state.objective.held = game.state.objective.duration;
    game.leader.x = game.extraction.x; game.leader.y = game.extraction.y;
    game.checkObjective(.5);
    assert.equal(game.extraction.active, true);
    assert.equal(game.extraction.regrouping, true);
    assert.equal(game.extraction.progress, 0);
    for (const [index, soldier] of game.soldiers.entries()) {
      soldier.x = game.extraction.x - index * 26; soldier.y = game.extraction.y;
    }
    game.checkObjective(CONFIG.extractionSeconds);
    assert.equal(game.state.status, 'won');
  }
});
