import { Game, MISSIONS } from './engine.js?v=0.9.0';
import { Renderer } from './renderer.js?v=0.9.0';
import { InputController, bindAction } from './input.js?v=0.9.0';
import { AudioEngine } from './audio.js?v=0.9.0';
import { loadProgress, saveProgress, objectiveFor } from './session.js?v=0.9.0';
import { loadCheckpoint, saveCheckpoint, clearCheckpoint, restoreCheckpoint } from './checkpoint.js?v=0.9.0';

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
let lastSquadEvent = 0;
let radioUntil = 0;
let manualResume = false;
let sessionId = 0;
let hintUntil = 0;
let cards = [];
let cardCleanups = [];
let lastCheckpointSequence = 0;
let checkpointUsed = false;
let checkpointStorageWarning = false;
const metrics = { updates: 0, frames: 0, updateMs: 0, renderMs: 0, updateSamples: [], renderSamples: [] };

const input = new InputController({
  canvas, joystick: $('joystick'), knob: $('joystick-knob'), grenadeButton: $('grenade-btn'), renderer,
  isPlaying: () => mode === 'game' && game.state.status === 'playing' && !$('manual').open,
  onMove: orderAt,
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

function orderAt(x, y) {
  const box = canvas.getBoundingClientRect();
  const center = renderer.worldToScreen(x, y);
  const step = renderer.worldToScreen(x + 1, y);
  const scale = Math.abs(step.x - center.x);
  const radius = Math.min(45, 22 / Math.max(.01, scale));
  const targets = [...game.state.enemies, ...(game.state.objective?.targets || [])];
  const nearest = targets.filter(target => target.alive && Math.hypot(target.x - x, target.y - y) <= radius)
    .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
  const visible = nearest && renderer.worldToScreen(nearest.x, nearest.y);
  // A generous touch target still belongs to a visible actor. A tap beside the
  // canvas edge must not select a hidden enemy just outside the camera.
  if (visible && visible.x >= box.left && visible.x <= box.right && visible.y >= box.top && visible.y <= box.bottom
      && game.focusTargetAt(x, y, radius)) {
    radio(game.state.holdFire ? 'Target marked. Release Hold Fire when ready.' : 'Target marked. The squad will focus fire when in range.', 2.5);
    return;
  }
  if (!game.moveTo(x, y)) radio('Route blocked. Choose open ground.');
}

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
  target.width = target.height = 24;
  const context = target.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.fillStyle = ['#e5d8ae', '#dfcfac', '#e0dab6'][index % 3];
  context.fillRect(0, 0, 24, 24);
  // Hand-inked enlistment photographs: quiet paper grain, a sunlit face and
  // individual kit details that remain legible at the phone's 21px size.
  context.fillStyle = '#f4e8c5'; context.fillRect(1, 1, 22, 1); context.fillRect(1, 2, 1, 20);
  context.fillStyle = '#b9b891';
  context.fillRect(20, 2, 2, 20); context.fillRect(2, 21, 18, 1);
  context.fillStyle = '#d0c5a0';
  context.fillRect(3, 4, 3, 1); context.fillRect(18, 7, 2, 1); context.fillRect(3, 12, 2, 1);
  if (!alive) {
    context.fillStyle = '#66786a'; context.fillRect(4, 17, 16, 7);
    context.fillStyle = '#c2bda0'; context.fillRect(7, 7, 10, 9); context.fillRect(9, 16, 6, 3);
    context.fillStyle = '#485c50'; context.fillRect(8, 10, 3, 3); context.fillRect(14, 10, 3, 3);
    context.fillRect(11, 14, 2, 2); context.fillRect(9, 17, 1, 2); context.fillRect(12, 17, 1, 2); context.fillRect(15, 17, 1, 2);
    return;
  }
  // Tiny original enlistment portraits share the battlefield's squad palette.
  context.fillStyle = '#173e36'; context.fillRect(3, 18, 18, 6); context.fillRect(5, 16, 14, 4);
  context.fillStyle = '#2e8074'; context.fillRect(4, 19, 16, 5);
  context.fillStyle = '#72b89a'; context.fillRect(4, 18, 5, 2); context.fillRect(16, 18, 4, 2);
  context.fillStyle = '#bea875'; context.fillRect(7, 19, 2, 5); context.fillRect(16, 19, 2, 5);
  context.fillStyle = '#ecdbac'; context.fillRect(7, 19, 1, 4); context.fillRect(16, 19, 1, 4);
  context.fillStyle = '#183e36'; context.fillRect(11, 20, 3, 4);
  context.fillStyle = '#648b75'; context.fillRect(11, 20, 3, 1);
  context.fillStyle = ['#dcb588', '#b9865d', '#e4c398'][index % 3];
  context.fillRect(7, 8, 11, 9); context.fillRect(6, 10, 1, 4); context.fillRect(18, 10, 1, 4); context.fillRect(10, 17, 5, 2);
  context.fillStyle = ['#b28c65', '#986644', '#c49d73'][index % 3];
  context.fillRect(15, 9, 3, 7); context.fillRect(8, 16, 9, 1); context.fillRect(12, 12, 1, 2);
  context.fillStyle = ['#f0cc9e', '#d8a777', '#f5d6aa'][index % 3];
  context.fillRect(8, 9, 4, 1); context.fillRect(8, 12, 1, 2); context.fillRect(11, 14, 2, 1);
  context.fillStyle = '#233c32'; context.fillRect(8, 11, 2, 1); context.fillRect(15, 11, 2, 1);
  context.fillRect(11, 15, 3, 1);
  if (index === 0) { context.fillStyle = '#b47957'; context.fillRect(9, 13, 1, 2); }
  if (index === 1) { context.fillStyle = '#665c42'; context.fillRect(8, 15, 3, 2); context.fillRect(14, 15, 3, 2); context.fillRect(11, 17, 3, 1); }
  if (index === 2) { context.fillStyle = '#73553e'; context.fillRect(6, 9, 1, 7); context.fillRect(18, 9, 1, 7); }
  context.fillStyle = '#173e36'; context.fillRect(6, 6, 13, 3); context.fillRect(8, 3, 9, 3);
  context.fillStyle = '#28584b'; context.fillRect(7, 5, 11, 3); context.fillRect(9, 3, 7, 3);
  context.fillStyle = '#769c70'; context.fillRect(9, 4, 6, 1); context.fillRect(8, 5, 2, 1);
  context.fillStyle = '#d7d5a1'; context.fillRect(6, 8, 13, 1);
  context.fillStyle = ['#d86c49', '#d9cc96', '#9ec3a0'][index % 3];
  context.fillRect(14, 5, 2, 2);
}

function showMissions() {
  $('mission-grid').replaceChildren();
  MISSIONS.forEach((definition, index) => {
    const button = document.createElement('button');
    button.className = `mission-card${index === mission ? ' active' : ''}`;
    button.setAttribute('aria-pressed', String(index === mission));
    button.innerHTML = `<span class="mission-number">${String(index + 1).padStart(2, '0')}</span><div class="mission-info"><span>${['VILLAGE RESCUE OPERATION', 'INDUSTRIAL SABOTAGE', 'TWO POSITIONS. ONE SIGNAL.'][index]}</span><h3></h3><p></p></div><span class="mission-state">${progress.completed.includes(index) ? '✓ COMPLETE' : index === mission ? 'SELECTED' : ''}</span><span class="mission-arrow">↗</span>`;
    button.querySelector('h3').textContent = definition.title;
    button.querySelector('p').textContent = definition.subtitle;
    button.addEventListener('click', () => {
      clearScene();
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
  text('briefing-copy', mission === 0
    ? 'Secure the village. Rescue the clinic medic and school radio operator in either order, clear the harbour, then escort everyone to the flare. Choose the exposed road or a longer route through cover. The HUD counts defenders at each objective.'
    : mission === 1
      ? 'Infiltrate the island’s industrial yards. Destroy the jammers in two separate compounds, in either order: take the open service road or flank through cover. Each jammer triggers a warned counterattack. You only need the devices down; get everyone to the western beach flare.'
      : 'Rebuild the radio link in two positions: hold the village repeater for 12 seconds, then cross to the ridge mast for 13. Three infected waves follow your uplink progress; watch their approach warnings. Step out to regroup without losing progress. After both links, bring everyone to the coastal flare.');
  const checkpoint = loadCheckpoint(undefined, { mission, difficulty: progress.difficulty });
  $('start-btn').innerHTML = checkpoint ? 'CONTINUE CHECKPOINT <span>→</span>' : 'DEPLOY SQUAD <span>↗</span>';
  $('fresh-btn').hidden = !checkpoint;
  $('checkpoint-note').hidden = !checkpoint;
  if (checkpoint) {
    const state = checkpoint.state;
    text('checkpoint-note', `Saved at ${formatTime(state.time)} · Stage ${state.objective.phase + 1}/4 · ${state.rescueCount}/${state.rescueTarget} survivors. Continue in ${progress.difficulty === 'easy' ? 'Recruit' : progress.difficulty === 'hard' ? 'Veteran' : 'Standard'}.`);
  }
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
    cards.push({ soldier, button, portrait, health: info.querySelector('.health > span'), hp: info.querySelector('small'), wasAlive: true, hurtUntil: 0 });
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
  lastMessage = ''; lastSquadEvent = 0; lastHud = -Infinity; previousFrame = null;
  metrics.updateSamples.length = 0; metrics.renderSamples.length = 0;
  for (const cleanup of cardCleanups) cleanup();
  cards = []; cardCleanups = [];
  $('squad-list').replaceChildren();
  $('manual').close();
  document.querySelector('.game-toast')?.remove();
  $('touch-hint').hidden = true;
  $('radio').hidden = true;
  $('pause-overlay').hidden = true;
  $('result-overlay').hidden = true;
  delete $('mission-strip').dataset.phase;
  delete $('mission-strip').dataset.reveal;
  delete $('result-overlay').dataset.outcome;
}

function startMission({ continueCheckpoint = false } = {}) {
  const checkpoint = continueCheckpoint ? loadCheckpoint(undefined, { mission, difficulty: progress.difficulty }) : null;
  const restored = checkpoint ? restoreCheckpoint(checkpoint) : null;
  if (!restored && mission === 0) clearCheckpoint();
  clearScene();
  game = restored || new Game({ mission, difficulty: progress.difficulty }).start();
  if (restored) game.pause(false);
  checkpointUsed = !!restored;
  game.state.checkpointRestoreUsed = checkpointUsed;
  lastCheckpointSequence = game.state.checkpointSequence || 0;
  checkpointStorageWarning = false;
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
  radio(restored ? 'Checkpoint restored. Your squad is ready; follow the current objective.' : 'Squad deployed. Move together. The dead are listening.', 4);
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

function throwGrenade(x, y) {
  if (mode !== 'game' || game.state.status !== 'playing') return;
  const thrown = Number.isFinite(x) && Number.isFinite(y) ? game.grenade(x, y) : game.grenade();
  if (thrown) {
    audio.cue('grenade');
    if (!reducedMotion.matches && navigator.vibrate) navigator.vibrate(18);
  } else if (!game.state.grenades) radio(mission === 0 ? 'No grenades left. Rescue a survivor for supplies.' : 'No grenades left. Your rifles still work.');
  if (input.pointerType !== 'touch') focusField();
  updateHud();
}

function updateHud() {
  if (mode !== 'game') return;
  const state = game.state;
  // Observe each hit once, including a hit followed by healing between HUD frames.
  for (const event of state.events) {
    if (event.id <= lastSquadEvent) continue;
    lastSquadEvent = event.id;
    if (event.type !== 'hit' || event.team !== 'player') continue;
    const card = cards.find(entry => entry.soldier.id === event.targetId);
    if (card) card.hurtUntil = Math.max(card.hurtUntil, event.time + .5);
  }
  text('timer', formatTime(state.time)); text('kills', String(state.kills).padStart(2, '0'));
  const operation = state.objective;
  text('operation-stat-label', operation?.type === 'sabotage' ? 'JAMMERS DOWN' : operation?.type === 'holdout' ? 'UPLINK · 2 SITES' : 'SURVIVORS');
  text('rescues', operation?.type === 'sabotage'
    ? `${operation.targets.filter(target => !target.alive).length} / ${operation.targets.length}`
    : operation?.type === 'holdout' ? `${Math.floor(operation.held)} / ${operation.duration}s`
      : `${state.rescueCount} / ${state.rescueTarget}`);
  text('grenade-count', state.grenades);
  $('grenade-btn').disabled = state.grenades === 0;
  $('grenade-btn').setAttribute('aria-label', `Grenade, ${state.grenades} remaining. Tap for a quick throw; drag to aim and release to throw. Return to the button to cancel.`);
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
  $('noise-label').dataset.level = noise > 65 ? 'alert' : noise > 30 ? 'heard' : 'quiet';
  $('noise-fill').parentElement.setAttribute('aria-valuenow', Math.round(noise));
  for (const card of cards) {
    const { soldier, button, health, hp } = card;
    const leader = soldier.id === state.leaderId;
    const critical = soldier.alive && soldier.hp <= soldier.maxHp * .3;
    button.classList.toggle('selected', leader);
    button.classList.toggle('dead', !soldier.alive);
    button.classList.toggle('hurt', soldier.alive && state.time < card.hurtUntil);
    button.classList.toggle('critical', critical);
    button.disabled = !soldier.alive;
    button.setAttribute('aria-pressed', String(leader));
    button.setAttribute('aria-label', `${soldier.name}, ${soldier.alive ? Math.ceil(soldier.hp) + ' health' + (critical ? ', critical' : '') + (leader ? ', squad leader' : ', select as leader') : 'killed in action'}`);
    health.style.width = Math.max(0, soldier.hp / soldier.maxHp * 100) + '%';
    health.classList.toggle('low', soldier.hp < soldier.maxHp * .35);
    hp.textContent = soldier.alive ? (critical ? '! ' : '') + Math.ceil(soldier.hp) : 'KIA';
    if (card.wasAlive && !soldier.alive) { drawPortrait(card.portrait, cards.indexOf(card), false); card.wasAlive = false; }
  }
  const objective = objectiveFor(state);
  text('objective-text', objective.text);
  text('mission-goal', objective.label); text('mission-detail', objective.text); text('mission-counter', objective.counter);
  $('mission-stage').hidden = !objective.stage;
  if (objective.stage) {
    text('mission-stage', `${objective.stage}/${objective.stages}`);
    $('mission-stage').setAttribute('aria-label', `Stage ${objective.stage} of ${objective.stages}`);
  }
  const strip = $('mission-strip');
  const phase = `${mission}:${objective.label}`;
  if (strip.dataset.phase !== phase) {
    // Alternate two identical CSS reveals only on a new instruction. Counter
    // updates never restart the animation; hiding a scene cancels it naturally.
    if (strip.dataset.phase) strip.dataset.reveal = strip.dataset.reveal === 'a' ? 'b' : 'a';
    strip.dataset.phase = phase;
  }
  $('mission-progress').hidden = objective.progress === null;
  $('mission-progress').value = objective.progress ?? 0;
  $('mission-progress').setAttribute('aria-label', state.extraction.active ? 'Extraction progress' : objective.progressLabel || (operation?.type === 'holdout' ? 'Radio uplink progress' : 'Mission progress'));
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
  $('result-overlay').dataset.outcome = won ? 'won' : 'lost';
  text('result-label', won ? (mission === 2 ? 'OPERATION COMPLETE' : 'MISSION COMPLETE') : 'SQUAD LOST');
  $('result-title').innerHTML = won ? (mission === 2 ? 'SIGNAL<br>RESTORED.' : 'MADE IT<br>OUT ALIVE.') : 'RADIO<br>SILENCE.';
  text('result-copy', won ? [
    'The medic, radio operator and your surviving squad are home. The village route is secure. Regroup for the next operation.',
    'Both industrial jammers are down. Your squad made the western beach extraction and reopened the island’s radio corridor.',
    'Transmission received. You linked the village repeater to the ridge mast and brought your surviving squad to the coast. Help knows where to find the island.',
  ][mission] : 'Use cover, move quietly, and save a grenade for close encounters. Recruit difficulty gives you more room to recover.');
  const alive = state.soldiers.filter(soldier => soldier.alive).length;
  if (won && alive === 3) text('result-label', `${mission === 2 ? 'OPERATION' : 'MISSION'} COMPLETE · FULL SQUAD`);
  $('result-stats').innerHTML = `<div><span>TIME</span><b>${formatTime(state.time)}</b></div><div><span>SQUAD ALIVE</span><b>${alive} / 3</b></div><div><span>ELIMINATED</span><b>${state.kills}</b></div>`;
  $('memorial').replaceChildren();
  const lost = state.soldiers.filter(soldier => !soldier.alive).map(soldier => soldier.name);
  if (lost.length) {
    const element = document.createElement('p'); element.className = 'memorial'; element.textContent = 'IN MEMORY: ' + lost.join(' · '); $('memorial').append(element);
  }
  const retryCheckpoint = !won && !!loadCheckpoint(undefined, { mission, difficulty: progress.difficulty });
  $('next-btn').innerHTML = won ? (mission === 2 ? 'PLAY AGAIN <span>↗</span>' : 'NEXT MISSION <span>→</span>')
    : retryCheckpoint ? 'RETRY CHECKPOINT <span>↗</span>' : 'TRY AGAIN <span>↗</span>';
  if (retryCheckpoint) text('result-copy', 'Return to your last secured checkpoint with the squad, supplies and progress saved there. Use cover on the next approach.');
  if (won) {
    if (mission === 0) clearCheckpoint();
    if (!progress.completed.includes(mission)) progress.completed.push(mission);
    if (!checkpointUsed) progress.best[mission] = Math.min(progress.best[mission] ?? Infinity, state.time);
    persist();
    if (checkpointUsed) text('result-copy', 'The medic, radio operator and your surviving squad are home. Mission complete from a checkpoint; best times are recorded for fresh runs.');
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
bindAction($('start-btn'), () => startMission({ continueCheckpoint: true }));
bindAction($('fresh-btn'), () => startMission());
bindAction($('pause-btn'), () => pauseGame(game.state.status !== 'paused'));
bindAction($('resume-btn'), () => pauseGame(false));
bindAction($('restart-btn'), () => startMission());
bindAction($('hold-btn'), toggleHold);
bindAction($('next-btn'), () => {
  const won = game.state.status === 'won';
  if (won) mission = mission === 2 ? 0 : mission + 1;
  startMission({ continueCheckpoint: !won });
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
  if (mode === 'base') { clearScene(); game = new Game({ mission, difficulty: progress.difficulty }); renderer.reset(); showBriefing(); }
});

function pauseWhenAway() {
  // Closing a manual after returning to the tab must never resume combat.
  manualResume = false;
  if (mode === 'game' && game.state.status === 'playing') {
    pauseGame(true, false);
  }
}
// In-app mobile browsers can blur a visible page during ordinary interaction.
// Input still resets on blur; pause only when the page actually backgrounds.
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
    const sequence = game.state.checkpointSequence || 0;
    if (sequence > lastCheckpointSequence && game.state.status === 'playing') {
      lastCheckpointSequence = sequence;
      if (saveCheckpoint(undefined, game)) {
        lastMessage = game.state.message;
        radio(`Checkpoint saved. ${game.state.message || 'Your squad can return here after a loss.'}`, 4);
      } else if (!checkpointStorageWarning) {
        checkpointStorageWarning = true;
        toast('This browser could not save the checkpoint. Keep this tab open to continue playing.');
      }
    }
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
  const aim = input.grenadeAim;
  const grenadePreview = mode === 'game' && game.state.status === 'playing' && game.state.grenades > 0 && aim?.aiming
    ? game.grenadeTarget(aim.point?.x, aim.point?.y) : null;
  renderer.render(game.state, { preview: mode === 'base', reducedMotion: reducedMotion.matches, grenadePreview });
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
