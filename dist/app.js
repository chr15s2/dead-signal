import { Game, MISSIONS } from './engine.js?v=0.2.0';
import { Renderer } from './renderer.js?v=0.2.0';
import { InputController, bindAction } from './input.js?v=0.2.0';
import { AudioEngine } from './audio.js?v=0.2.0';
import { loadProgress, saveProgress, objectiveFor } from './session.js?v=0.2.0';

// The application owns scene lifecycle; simulation, input, rendering and sound
// each keep their own state. A restart resets every boundary together.
const $ = id => document.getElementById(id);
const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke-width="3"/></svg>';
const resumeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>';
const mutedIcon = '<path d="M3 9h4l5-4v14l-5-4H3zM16 9l5 6m0-6-5 6"/>';
const soundIcon = '<path d="M3 9h4l5-4v14l-5-4H3zM16 8q5 4 0 8m3-11q8 7 0 14"/>';
const progress = loadProgress();
const canvas = $('field');
const renderer = new Renderer(canvas);
const audio = new AudioEngine();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let mission = 0;
let game = new Game({ mission, difficulty: progress.difficulty });
let mode = 'base';
let previousFrame = null;
let lastHud = -Infinity;
let lastStatus = 'ready';
let lastMessage = '';
let radioUntil = 0;
let manualResume = false;
let sessionId = 0;
let hintUntil = 0;
let cards = [];
let cardCleanups = [];
const metrics = { updates: 0, frames: 0, updateMs: 0, renderMs: 0, updateSamples: [], renderSamples: [] };

const input = new InputController({
  canvas, joystick: $('joystick'), knob: $('joystick-knob'), renderer,
  isPlaying: () => mode === 'game' && game.state.status === 'playing' && !$('manual').open,
  onMove: (x, y) => { if (!game.moveTo(x, y)) radio('Route blocked. Choose open ground.'); },
  onGrenade: throwGrenade,
  onHold: toggleHold,
  onPause: () => { if (mode === 'game') pauseGame(game.state.status !== 'paused'); },
  onFirstInput: () => { hintUntil = 0; $('touch-hint').hidden = true; },
  onSelect: index => selectSoldier(game.state.soldiers[index]?.id),
});

function text(id, value) {
  const element = $(id);
  if (element && element.textContent !== String(value)) element.textContent = value;
}

function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function persist() { saveProgress(undefined, progress); }
function focusField() { canvas.focus({ preventScroll: true }); }

function radio(message, duration = 4) {
  if (mode !== 'game') return;
  text('radio-copy', message);
  radioUntil = game.state.time + duration;
  $('radio').hidden = false;
}

function toast(message) {
  document.querySelector('.game-toast')?.remove();
  const element = document.createElement('div');
  element.className = 'game-toast';
  element.textContent = message;
  document.body.append(element);
  setTimeout(() => element.remove(), 2800);
}

function updateSoundButton() {
  $('sound-btn').setAttribute('aria-pressed', String(progress.soundOn));
  $('sound-btn').setAttribute('aria-label', progress.soundOn ? 'Mute sound' : 'Enable sound');
  $('sound-btn').querySelector('span').textContent = progress.soundOn ? 'SOUND ON' : 'SOUND OFF';
  $('sound-btn').querySelector('svg').innerHTML = progress.soundOn ? soundIcon : mutedIcon;
}

async function enableSavedSound() {
  if (!progress.soundOn) return;
  const enabled = await audio.setEnabled(true);
  if (!enabled) {
    progress.soundOn = false;
    updateSoundButton();
    persist();
  }
}

async function toggleSound() {
  const desired = !progress.soundOn;
  progress.soundOn = desired;
  updateSoundButton();
  persist();
  const enabled = await audio.setEnabled(desired);
  // A later click may have changed the preference while resume was pending.
  if (desired && progress.soundOn && !enabled) {
    progress.soundOn = false;
    updateSoundButton();
    persist();
    toast('Sound is unavailable in this browser.');
  }
  if (enabled) audio.cue('select');
  if (mode === 'game' && !matchMedia('(pointer: coarse)').matches) focusField();
}

function drawPortrait(target, index, alive = true) {
  target.width = target.height = 16;
  const context = target.getContext('2d');
  context.fillStyle = ['#c4ccb1', '#d1c9ac', '#bfc9b2'][index % 3];
  context.fillRect(0, 0, 16, 16);
  if (!alive) {
    context.fillStyle = '#66715f'; context.fillRect(5, 4, 6, 6); context.fillRect(6, 10, 4, 2);
    context.fillStyle = '#d8d8bc'; context.fillRect(6, 6, 1, 2); context.fillRect(9, 6, 1, 2);
    return;
  }
  context.fillStyle = '#344b33'; context.fillRect(3, 12, 10, 4); context.fillRect(5, 10, 6, 3);
  context.fillStyle = ['#d2aa7a', '#b88257', '#e0ba8a'][index % 3]; context.fillRect(5, 5, 6, 7); context.fillRect(4, 6, 1, 4); context.fillRect(11, 6, 1, 4);
  context.fillStyle = '#4a5d39'; context.fillRect(4, 3, 8, 4); context.fillRect(3, 6, 10, 1);
  context.fillStyle = '#73804c'; context.fillRect(5, 3, 5, 2);
  context.fillStyle = '#293b2d'; context.fillRect(6, 8, 1, 1); context.fillRect(9, 8, 1, 1); context.fillRect(7, 11, 2, 1);
}

function showMissions() {
  $('mission-grid').replaceChildren();
  MISSIONS.forEach((definition, index) => {
    const button = document.createElement('button');
    button.className = `mission-card${index === mission ? ' active' : ''}`;
    button.setAttribute('aria-pressed', String(index === mission));
    button.innerHTML = `<span class="mission-number">${String(index + 1).padStart(2, '0')}</span><div class="mission-info"><span>${['RECON & RESCUE', 'DEEP ISLAND RECOVERY', 'CLEAR & EXTRACT'][index]}</span><h3></h3><p></p></div><span class="mission-state">${progress.completed.includes(index) ? '✓ COMPLETE' : index === mission ? 'SELECTED' : ''}</span><span class="mission-arrow">↗</span>`;
    button.querySelector('h3').textContent = definition.title;
    button.querySelector('p').textContent = definition.subtitle;
    button.addEventListener('click', () => {
      mission = index;
      game = new Game({ mission, difficulty: progress.difficulty });
      renderer.reset();
      showMissions();
      showBriefing();
    });
    $('mission-grid').append(button);
  });
}

function showBriefing() {
  text('briefing-title', `MISSION ${String(mission + 1).padStart(2, '0')} / ${MISSIONS[mission].title}`);
  text('briefing-copy', MISSIONS[mission].objective);
}

function createSquadCards() {
  for (const cleanup of cardCleanups) cleanup();
  cards = []; cardCleanups = [];
  $('squad-list').replaceChildren();
  game.state.soldiers.forEach((soldier, index) => {
    const button = document.createElement('button');
    button.className = 'soldier-card';
    const portrait = document.createElement('canvas');
    portrait.className = 'portrait'; portrait.setAttribute('aria-hidden', 'true');
    drawPortrait(portrait, index);
    const info = document.createElement('div'); info.className = 'soldier-info';
    info.innerHTML = '<div class="soldier-name"><span></span><small></small></div><div class="health"><span></span></div>';
    info.querySelector('.soldier-name > span').textContent = soldier.name;
    button.append(portrait, info);
    cardCleanups.push(bindAction(button, () => selectSoldier(soldier.id)));
    cards.push({ soldier, button, portrait, health: info.querySelector('.health > span'), hp: info.querySelector('small'), wasAlive: true });
    $('squad-list').append(button);
  });
}

function selectSoldier(id) {
  if (mode !== 'game' || game.state.status !== 'playing' || !game.selectSoldier(id)) return;
  audio.cue('select');
  updateHud();
  if (input.pointerType !== 'touch') focusField();
}

function clearScene() {
  sessionId++;
  input.reset();
  audio.reset();
  renderer.reset();
  manualResume = false;
  hintUntil = 0; radioUntil = 0;
  lastMessage = ''; lastHud = -Infinity; previousFrame = null;
  metrics.updateSamples.length = 0; metrics.renderSamples.length = 0;
  $('manual').close();
  document.querySelector('.game-toast')?.remove();
  $('touch-hint').hidden = true;
  $('radio').hidden = true;
  $('pause-overlay').hidden = true;
  $('result-overlay').hidden = true;
}

function startMission() {
  clearScene();
  game = new Game({ mission, difficulty: progress.difficulty }).start();
  mode = 'game'; lastStatus = 'playing';
  document.body.classList.add('playing');
  $('intro').hidden = true; $('combat-panel').hidden = false;
  $('preview-caption').hidden = true; $('mission-strip').hidden = false;
  $('touch-controls').hidden = false; $('pause-btn').hidden = false;
  $('pause-btn').innerHTML = pauseIcon;
  $('pause-btn').setAttribute('aria-label', 'Pause game');
  text('field-status', 'LIVE FEED');
  text('live-title', MISSIONS[mission].title);
  text('field-location', `MISSION ${String(mission + 1).padStart(2, '0')}`);
  createSquadCards();
  radio('Squad deployed. Move together. The dead are listening.', 4);
  hintUntil = matchMedia('(pointer: coarse)').matches ? 8 : 0;
  $('touch-hint').hidden = hintUntil === 0;
  const deploymentId = sessionId;
  void enableSavedSound().then(() => {
    if (deploymentId === sessionId && mode === 'game' && game.state.status === 'playing') audio.cue('deploy');
  });
  renderer.resize(); window.scrollTo(0, 0); focusField(); updateHud();
}

function backToBase() {
  clearScene();
  mode = 'base'; lastStatus = 'ready';
  game = new Game({ mission, difficulty: progress.difficulty });
  document.body.classList.remove('playing');
  $('intro').hidden = false; $('combat-panel').hidden = true;
  for (const id of ['touch-controls', 'pause-btn', 'mission-strip']) $(id).hidden = true;
  $('preview-caption').hidden = false;
  text('field-status', 'RECON FEED'); text('field-location', 'ST. ORAN ISLAND'); text('timer', '00:00');
  text('footer-tip', 'KEEP YOUR SQUAD CLOSE. KEEP YOUR OPTIONS OPEN.');
  audio.pause(true); showMissions(); showBriefing(); renderer.resize();
}

function pauseGame(paused, cue = true) {
  if (mode !== 'game' || !['playing', 'paused'].includes(game.state.status)) return;
  if ((game.state.status === 'paused') === paused) return;
  game.pause(paused); input.reset(); audio.pause(paused); previousFrame = null;
  $('pause-overlay').hidden = !paused;
  $('pause-btn').innerHTML = paused ? resumeIcon : pauseIcon;
  $('pause-btn').setAttribute('aria-label', paused ? 'Resume game' : 'Pause game');
  if (paused) {
    if (cue) audio.cue('pause');
  } else {
    // Mobile browsers can suspend Web Audio while the app is in the background.
    // Begin reactivation within the explicit resume gesture, before awaiting it.
    const resumedSession = sessionId;
    void enableSavedSound().then(() => {
      if (cue && resumedSession === sessionId && game.state.status === 'playing') audio.cue('resume');
    });
    focusField();
  }
}

function toggleHold() {
  if (mode !== 'game' || game.state.status !== 'playing') return;
  game.setHoldFire(!game.state.holdFire); updateHud();
  if (input.pointerType !== 'touch') focusField();
}

function throwGrenade() {
  if (mode !== 'game' || game.state.status !== 'playing') return;
  const target = input.aimPoint();
  const thrown = target ? game.grenade(target.x, target.y) : game.grenade();
  if (thrown) {
    audio.cue('grenade');
    if (!reducedMotion.matches && navigator.vibrate) navigator.vibrate(18);
  } else if (!game.state.grenades) radio('No grenades left. Rescue survivors for supplies.');
  if (input.pointerType !== 'touch') focusField();
  updateHud();
}

function updateHud() {
  if (mode !== 'game') return;
  const state = game.state;
  text('timer', formatTime(state.time)); text('kills', String(state.kills).padStart(2, '0'));
  text('rescues', `${state.rescueCount} / ${state.rescueTarget}`);
  text('grenade-count', state.grenades);
  $('grenade-btn').disabled = state.grenades === 0;
  $('grenade-btn').setAttribute('aria-label', `Throw grenade, ${state.grenades} remaining`);
  const hold = state.holdFire;
  $('hold-btn').setAttribute('aria-pressed', String(hold));
  $('hold-btn').setAttribute('aria-label', hold ? 'Resume automatic fire' : 'Hold fire and travel quietly');
  text('fire-label', hold ? 'FIRE OFF' : 'AUTO FIRE');
  text('weapon-status', hold ? 'QUIET' : 'WEAPONS FREE');
  $('weapon-status').classList.toggle('quiet', hold);
  const noise = Math.max(0, Math.min(100, state.noise));
  $('noise-fill').style.width = noise + '%';
  $('noise-fill').style.background = noise > 65 ? '#d46b43' : noise > 30 ? '#b49b54' : '#859b68';
  text('noise-label', noise > 65 ? 'HORDE ALERT' : noise > 30 ? 'HEARD' : 'QUIET');
  $('noise-fill').parentElement.setAttribute('aria-valuenow', Math.round(noise));
  for (const card of cards) {
    const { soldier, button, health, hp } = card;
    const leader = soldier.id === state.leaderId;
    button.classList.toggle('selected', leader);
    button.classList.toggle('dead', !soldier.alive);
    button.disabled = !soldier.alive;
    button.setAttribute('aria-pressed', String(leader));
    button.setAttribute('aria-label', `${soldier.name}, ${soldier.alive ? Math.ceil(soldier.hp) + ' health' + (leader ? ', squad leader' : ', select as leader') : 'killed in action'}`);
    health.style.width = Math.max(0, soldier.hp / soldier.maxHp * 100) + '%';
    health.classList.toggle('low', soldier.hp < soldier.maxHp * .35);
    hp.textContent = soldier.alive ? Math.ceil(soldier.hp) : 'KIA';
    if (card.wasAlive && !soldier.alive) { drawPortrait(card.portrait, cards.indexOf(card), false); card.wasAlive = false; }
  }
  const objective = objectiveFor(state);
  text('objective-text', objective.text);
  text('mission-goal', objective.label); text('mission-detail', objective.text); text('mission-counter', objective.counter);
  $('mission-progress').hidden = objective.progress === null;
  $('mission-progress').value = objective.progress ?? 0;
  text('footer-tip', hold ? 'HOLD FIRE ACTIVE · MOVE QUIETLY' : 'AUTO FIRE ACTIVE · USE COVER. STAY TOGETHER.');
  if (state.message && state.message !== lastMessage) {
    lastMessage = state.message;
    // Routine objective text has its own persistent HUD; radio is for events.
    if (state.message !== MISSIONS[mission].objective) radio(state.message);
  }
  if (state.status !== lastStatus) {
    lastStatus = state.status;
    if (state.status === 'won' || state.status === 'lost') showResult(state.status === 'won');
  }
}

function showResult(won) {
  const state = game.state;
  input.reset(); audio.pause(true);
  $('touch-controls').hidden = true; $('touch-hint').hidden = true; $('radio').hidden = true;
  $('result-overlay').hidden = false;
  text('result-label', won ? (mission === 2 ? 'OPERATION COMPLETE' : 'MISSION COMPLETE') : 'SQUAD LOST');
  $('result-title').innerHTML = won ? (mission === 2 ? 'SIGNAL<br>RESTORED.' : 'MADE IT<br>OUT ALIVE.') : 'RADIO<br>SILENCE.';
  text('result-copy', won ? (mission === 2 ? 'Your squad is home. The island is quiet again.' : 'Squad and survivors extracted. Regroup for the next operation.') : 'Use cover, move quietly, and save a grenade for close encounters. Recruit difficulty gives you more room to recover.');
  const alive = state.soldiers.filter(soldier => soldier.alive).length;
  $('result-stats').innerHTML = `<div><span>TIME</span><b>${formatTime(state.time)}</b></div><div><span>SQUAD ALIVE</span><b>${alive} / 3</b></div><div><span>ELIMINATED</span><b>${state.kills}</b></div>`;
  $('memorial').replaceChildren();
  const lost = state.soldiers.filter(soldier => !soldier.alive).map(soldier => soldier.name);
  if (lost.length) {
    const element = document.createElement('p'); element.className = 'memorial'; element.textContent = 'IN MEMORY: ' + lost.join(' · '); $('memorial').append(element);
  }
  $('next-btn').innerHTML = won ? (mission === 2 ? 'PLAY AGAIN <span>↗</span>' : 'NEXT MISSION <span>→</span>') : 'TRY AGAIN <span>↗</span>';
  if (won) {
    if (!progress.completed.includes(mission)) progress.completed.push(mission);
    progress.best[mission] = Math.min(progress.best[mission] ?? Infinity, state.time);
    persist();
  }
  audio.cue(won ? 'win' : 'lose');
}

function openManual() {
  manualResume = mode === 'game' && game.state.status === 'playing';
  if (manualResume) pauseGame(true, false);
  $('manual').showModal();
}

function closeManual() {
  $('manual').close();
  if (manualResume) pauseGame(false, false);
  manualResume = false;
}

bindAction($('sound-btn'), toggleSound);
bindAction($('start-btn'), startMission);
bindAction($('pause-btn'), () => pauseGame(game.state.status !== 'paused'));
bindAction($('resume-btn'), () => pauseGame(false));
bindAction($('restart-btn'), startMission);
bindAction($('hold-btn'), toggleHold);
bindAction($('grenade-btn'), throwGrenade);
bindAction($('next-btn'), () => {
  if (game.state.status === 'won') mission = mission === 2 ? 0 : mission + 1;
  startMission();
});
for (const id of ['return-btn', 'exit-btn', 'result-base-btn']) bindAction($(id), backToBase);
for (const id of ['manual-btn', 'pause-manual-btn']) bindAction($(id), openManual);
for (const id of ['close-manual', 'manual-done']) bindAction($(id), closeManual);
$('manual').addEventListener('cancel', event => { event.preventDefault(); closeManual(); });
$('manual').addEventListener('click', event => {
  if (event.target !== $('manual')) return;
  const box = $('manual').getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeManual();
});
$('difficulty').value = progress.difficulty;
$('difficulty').addEventListener('change', () => {
  progress.difficulty = $('difficulty').value; persist();
  if (mode === 'base') { game = new Game({ mission, difficulty: progress.difficulty }); renderer.reset(); }
});

function pauseWhenAway() {
  // Closing a manual after returning to the tab must never resume combat.
  manualResume = false;
  if (mode === 'game' && game.state.status === 'playing') {
    pauseGame(true, false);
  }
}
window.addEventListener('blur', pauseWhenAway);
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseWhenAway(); });
window.addEventListener('pagehide', () => { pauseWhenAway(); input.reset(); audio.pause(true); });
window.addEventListener('resize', () => renderer.resize());
const observer = new ResizeObserver(() => renderer.resize());
observer.observe($('viewport'));

function sampleMetric(key, value) {
  const samples = metrics[key];
  samples.push(value);
  if (samples.length > 240) samples.shift();
}

function frame(now) {
  const delta = previousFrame === null ? 0 : Math.max(0, (now - previousFrame) / 1000);
  previousFrame = now;
  const updateStart = performance.now();
  if (mode === 'game') {
    game.update(delta, input.sample());
    audio.consume(game.state);
    metrics.updates++;
    if (now - lastHud >= 80 || ['won', 'lost'].includes(game.state.status) && lastStatus !== game.state.status) {
      updateHud(); lastHud = now;
    }
    $('touch-hint').hidden = !hintUntil || game.state.time > hintUntil || game.state.status !== 'playing';
    $('radio').hidden = !radioUntil || game.state.time > radioUntil || game.state.status !== 'playing';
  }
  metrics.updateMs = performance.now() - updateStart;
  const renderStart = performance.now();
  renderer.render(game.state, { preview: mode === 'base', reducedMotion: reducedMotion.matches });
  metrics.renderMs = performance.now() - renderStart;
  if (mode === 'game' && game.state.status === 'playing') {
    sampleMetric('updateSamples', metrics.updateMs); sampleMetric('renderSamples', metrics.renderMs);
  }
  metrics.frames++;
  requestAnimationFrame(frame);
}

showMissions(); showBriefing(); updateSoundButton(); renderer.resize(); audio.pause(true);
requestAnimationFrame(frame);

// Community debugging and regression tests use the same running systems.
window.deadSignal = {
  get state() { return game.state; }, get game() { return game; },
  get renderer() { return renderer; }, get input() { return input; }, get audio() { return audio; },
  get metrics() { return metrics; }, start: startMission, back: backToBase, pause: pauseGame,
};
