import { Game, MISSIONS } from './engine.js';
import { Renderer } from './renderer.js';

const $ = id => document.getElementById(id);
const pauseIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke-width="3"/></svg>';
const resumeIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>';
const canvas = $('field');
const renderer = new Renderer(canvas);
let mission = 0, game = new Game({ mission }), mode = 'base', holdFire = false;
let lastTime = 0, lastHud = 0, lastStatus = 'ready', lastMessage = '', lastKills = 0;
const keys = new Set();
let joy = { x: 0, y: 0 }, mouseWorld = null, mouseFire = false, joyPointer = null;
let soundOn = false, audio = null, lastAudioShot = 0, hiddenPaused = false, manualPaused = false;
let hintTimeout;
const save = { completed: [], best: {} };
try { Object.assign(save, JSON.parse(localStorage.getItem('dead-signal-v1') || '{}')); } catch {}
if (!Array.isArray(save.completed)) save.completed = [];
if (!save.best || typeof save.best !== 'object') save.best = {};

function bindTouchAction(button, action) {
  let suppressClickUntil = 0;
  button.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' || button.disabled) return;
    event.preventDefault();
    suppressClickUntil = performance.now() + 750;
    action();
  });
  button.onclick = event => {
    if (event.detail !== 0 && performance.now() < suppressClickUntil) return;
    action();
  };
}

function persist() { try { localStorage.setItem('dead-signal-v1', JSON.stringify(save)); } catch {} }
function formatTime(t) { return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`; }
function missionLabel(m) { return MISSIONS[m]?.title || ['First Contact', 'Dead Air', 'Last Light'][m]; }
function toast(message) { const old = document.querySelector('.game-toast'); if (old) old.remove(); const el = document.createElement('div'); el.className='game-toast'; el.textContent=message; document.body.append(el); setTimeout(() => el.remove(),2600); }

function drawPortrait(canvas, index, alive = true) {
  canvas.width = canvas.height = 16; const ctx=canvas.getContext('2d');
  ctx.fillStyle=['#c4ccb1','#d1c9ac','#bfc9b2'][index%3];ctx.fillRect(0,0,16,16);
  if(!alive){ctx.fillStyle='#66715f';ctx.fillRect(5,4,6,6);ctx.fillRect(6,10,4,2);ctx.fillStyle='#d8d8bc';ctx.fillRect(6,6,1,2);ctx.fillRect(9,6,1,2);return;}
  ctx.fillStyle='#344b33';ctx.fillRect(3,12,10,4);ctx.fillRect(5,10,6,3);
  ctx.fillStyle=['#d2aa7a','#b88257','#e0ba8a'][index%3];ctx.fillRect(5,5,6,7);ctx.fillRect(4,6,1,4);ctx.fillRect(11,6,1,4);
  ctx.fillStyle='#4a5d39';ctx.fillRect(4,3,8,4);ctx.fillRect(3,6,10,1);ctx.fillStyle='#73804c';ctx.fillRect(5,3,5,2);
  ctx.fillStyle='#293b2d';ctx.fillRect(6,8,1,1);ctx.fillRect(9,8,1,1);ctx.fillRect(7,11,2,1);
}

function showMissions() {
  $('mission-grid').replaceChildren();
  MISSIONS.forEach((m,i) => {
    const btn=document.createElement('button');btn.className=`mission-card${i===mission?' active':''}`;btn.setAttribute('aria-pressed',String(i===mission));
    btn.innerHTML=`<span class="mission-number">${String(i+1).padStart(2,'0')}</span><div class="mission-info"><span>${i===0?'RECON & RESCUE':i===1?'DEEP ISLAND RECOVERY':'CLEAR & EXTRACT'}</span><h3></h3><p></p></div><span class="mission-state">${save.completed.includes(i)?'✓ COMPLETE':i===mission?'SELECTED':''}</span><span class="mission-arrow">↗</span>`;
    btn.querySelector('h3').textContent=m.title.toUpperCase();
    btn.querySelector('p').textContent=m.subtitle || ['Find the missing survivor. Reach the coast.','Two survivors. More hostiles. Less room for error.','Silence the outbreak. Make the final extraction.'][i];
    btn.addEventListener('click',()=>{mission=i;game=new Game({mission,difficulty:$('difficulty').value});showMissions();renderer.resize();$('start-btn').innerHTML=`DEPLOY MISSION ${String(i+1).padStart(2,'0')} <span>↗</span>`; $('footer-tip').textContent=(m.briefing || m.objective || 'Stay together. Reach the extraction zone.').toUpperCase();});
    $('mission-grid').append(btn);
  });
}

function squadCards() {
  $('squad-list').replaceChildren();
  game.state.soldiers.forEach((s,i)=>{
    const btn=document.createElement('button');btn.className='soldier-card';btn.dataset.id=s.id;btn.setAttribute('aria-label',`Select ${s.name} as squad leader`);
    const portrait=document.createElement('canvas');portrait.className='portrait';portrait.setAttribute('aria-hidden','true');drawPortrait(portrait,i,s.alive);btn.append(portrait);
    const info=document.createElement('div');info.className='soldier-info';info.innerHTML='<div class="soldier-name"><span></span><small></small></div><div class="health"><span></span></div>';
    info.querySelector('.soldier-name>span').textContent=s.name.toUpperCase();btn.append(info);btn.addEventListener('click',()=>{if(s.alive){game.selectSoldier(s.id);tone(510,.04,.025);}});$('squad-list').append(btn);
  });
}

function startMission() {
  game = new Game({mission,difficulty:$('difficulty').value}); game.start();mode='game';holdFire=false;game.setHoldFire(false);
  keys.clear();joy={x:0,y:0};mouseFire=false;lastStatus='playing';lastMessage='';lastKills=0;lastHud=0;
  document.body.classList.add('playing');$('intro').hidden=true;$('combat-panel').hidden=false;
  $('preview-caption').hidden=true;$('touch-controls').hidden=false;$('radio').hidden=false;$('pause-btn').hidden=false;
  $('pause-overlay').hidden=true;$('result-overlay').hidden=true;$('pause-btn').innerHTML=pauseIcon;$('pause-btn').setAttribute('aria-label','Pause game');$('live-title').textContent=missionLabel(mission).toUpperCase();
  $('field-status').textContent='LIVE FEED';$('hold-btn').setAttribute('aria-pressed','false');
  $('field-location').textContent=missionLabel(mission).toUpperCase();$('footer-tip').textContent='RESCUE YOUR PEOPLE. REACH EXTRACTION.';
  squadCards();renderer.resize();window.scrollTo(0,0);enableAudio();tone(300,.15,.07);setTimeout(()=>tone(450,.13,.05),120);
  if(matchMedia('(pointer:coarse)').matches){$('touch-hint').hidden=false;clearTimeout(hintTimeout);hintTimeout=setTimeout(()=>$('touch-hint').hidden=true,7000);}
  updateHud();
}

function backToBase() {
  mode='base';document.body.classList.remove('playing');$('intro').hidden=false;$('combat-panel').hidden=true;
  for(const id of ['touch-controls','radio','touch-hint','pause-overlay','result-overlay','pause-btn']) $(id).hidden=true;
  $('preview-caption').hidden=false;$('field-status').textContent='RECON FEED';$('field-location').textContent='ST. ORAN ISLAND';$('timer').textContent='00:00';
  $('footer-tip').textContent='KEEP YOUR SQUAD CLOSE. KEEP YOUR OPTIONS OPEN.';game=new Game({mission,difficulty:$('difficulty').value});keys.clear();resetJoy();mouseFire=false;showMissions();renderer.resize();
}

function pauseGame(paused) {
  if(mode!=='game'||['won','lost'].includes(game.state.status))return;
  game.pause(paused);$('pause-overlay').hidden=!paused;keys.clear();resetJoy();mouseFire=false;
  $('pause-btn').innerHTML=paused?resumeIcon:pauseIcon;$('pause-btn').setAttribute('aria-label',paused?'Resume game':'Pause game');
}

function toggleHold() { if(mode!=='game'||game.state.status!=='playing')return;holdFire=!holdFire;game.setHoldFire(holdFire);$('hold-btn').setAttribute('aria-pressed',String(holdFire));tone(holdFire?260:400,.06,.035); }
function throwGrenade() {
  if(mode!=='game'||game.state.status!=='playing')return;
  const fine=matchMedia('(pointer:fine)').matches;
  const did=fine&&mouseWorld?game.grenade(mouseWorld.x,mouseWorld.y):game.grenade();
  if(did){tone(130,.2,.09,'sawtooth');if(navigator.vibrate)navigator.vibrate(35);}else if(game.state.grenades===0)toast('No grenades remaining.');
}

function updateHud() {
  const s=game.state;if(mode!=='game')return;
  $('timer').textContent=formatTime(s.time);$('kills').textContent=String(s.kills).padStart(2,'0');$('rescues').textContent=`${s.rescueCount} / ${s.rescueTarget}`;
  $('grenade-count').textContent=s.grenades;$('grenade-btn').disabled=s.grenades<=0;
  const n=Math.max(0,Math.min(100,s.noise));$('noise-fill').style.width=n+'%';$('noise-fill').style.background=n>65?'#d46b43':n>30?'#b49b54':'#859b68';
  $('noise-label').textContent=n>65?'HORDE ALERT':n>30?'HEARD':'QUIET';$('noise-label').style.color=n>65?'#b55435':'#69795a';
  const alive=s.soldiers.filter(a=>a.alive);
  $('squad-list').querySelectorAll('.soldier-card').forEach((el,i)=>{
    const soldier=s.soldiers[i];if(!soldier)return;el.classList.toggle('selected',soldier.id===s.leaderId);el.classList.toggle('dead',!soldier.alive);el.disabled=!soldier.alive;el.setAttribute('aria-pressed',String(soldier.id===s.leaderId));
    const health=el.querySelector('.health>span');health.style.width=Math.max(0,soldier.hp/soldier.maxHp*100)+'%';health.classList.toggle('low',soldier.hp<soldier.maxHp*.35);el.querySelector('.soldier-name small').textContent=!soldier.alive?'KIA':soldier.id===s.leaderId?'LEAD':Math.ceil(soldier.hp)+' HP';
    if(!soldier.alive&&!el.dataset.dead){drawPortrait(el.querySelector('canvas'),i,false);el.dataset.dead='1';}
  });
  const remaining=s.enemies.filter(e=>e.alive).length;
  const objective=s.extraction.active?`Extraction open. Move to the green zone. ${Math.round((s.extraction.progress||0)*100)}%`:s.rescueCount<s.rescueTarget?`Find and rescue survivors: ${s.rescueCount}/${s.rescueTarget}.`:`Clear remaining hostiles (${remaining}).`;
  $('objective-text').textContent=objective;
  $('field-location').textContent=s.extraction.active?'REACH EXTRACTION':s.rescueCount<s.rescueTarget?`RESCUE ${s.rescueCount}/${s.rescueTarget}`:`CLEAR HOSTILES: ${remaining}`;
  if(s.message && s.message!==lastMessage){$('radio').querySelector('span').textContent=s.message;lastMessage=s.message;}
  if(s.kills>lastKills){tone(160,.045,.012,'triangle');lastKills=s.kills;}
  if(s.status!==lastStatus){lastStatus=s.status;if(s.status==='won'||s.status==='lost')showResult(s.status==='won');}
}

function showResult(won) {
  const s=game.state;const survivors=s.soldiers.filter(a=>a.alive).length;
  $('touch-controls').hidden=true;$('touch-hint').hidden=true;$('radio').hidden=true;$('result-overlay').hidden=false;
  $('result-label').textContent=won?(mission===2?'OPERATION COMPLETE':'MISSION COMPLETE'):'SQUAD LOST';
  $('result-title').innerHTML=won?(mission===2?'SIGNAL<br>RESTORED.':'MADE IT<br>OUT ALIVE.'):'NO ONE<br>LEFT BEHIND?';
  if(!won)$('result-title').innerHTML='RADIO<br>SILENCE.';
  $('result-copy').textContent=won?(mission===2?'The outbreak is contained. Your people are home. Take a breath, commander.':'Extraction confirmed. Regroup for the next operation.'):'The island claimed your squad. Try a quieter approach, use cover, or switch to Recruit difficulty.';
  $('result-stats').innerHTML=`<div><span>TIME</span><b>${formatTime(s.time)}</b></div><div><span>SQUAD ALIVE</span><b>${survivors} / 3</b></div><div><span>ELIMINATED</span><b>${s.kills}</b></div>`;
  const lost=s.soldiers.filter(a=>!a.alive).map(a=>a.name);$('memorial').replaceChildren();if(lost.length){const p=document.createElement('p');p.className='memorial';p.textContent='IN MEMORY: '+lost.join(' · ');$('memorial').append(p);}
  $('next-btn').innerHTML=won?(mission===2?'PLAY AGAIN <span>↗</span>':'NEXT MISSION <span>→</span>'):'TRY AGAIN <span>↗</span>';
  $('next-btn').onclick=()=>{if(won)mission=mission===2?0:mission+1;startMission();};
  if(won){if(!save.completed.includes(mission))save.completed.push(mission);save.best[mission]=Math.min(save.best[mission]||Infinity,s.time);persist();tone(440,.15,.05);setTimeout(()=>tone(550,.15,.05),140);setTimeout(()=>tone(660,.2,.05),280);}else{tone(160,.4,.07,'triangle');}
}

function enableAudio() { if(!soundOn)return;try{audio ||= new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume();}catch{} }
function tone(freq,duration,gain=.03,type='square') { if(!soundOn||!audio)return;try{const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,audio.currentTime);g.gain.setValueAtTime(gain,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+duration);}catch{} }
$('sound-btn').addEventListener('click',()=>{soundOn=!soundOn;$('sound-btn').setAttribute('aria-pressed',String(soundOn));$('sound-btn').setAttribute('aria-label',soundOn?'Mute sound':'Enable sound');$('sound-btn').querySelector('span').textContent=soundOn?'SOUND ON':'SOUND OFF';$('sound-btn').querySelector('svg').innerHTML=soundOn?'<path d="M3 9h4l5-4v14l-5-4H3zM16 8q5 4 0 8m3-11q8 7 0 14"/>':'<path d="M3 9h4l5-4v14l-5-4H3zM16 9l5 6m0-6-5 6"/>';enableAudio();tone(470,.07,.035);});

function openManual(){manualPaused=mode==='game'&&game.state.status==='playing';if(manualPaused)pauseGame(true);$('manual').showModal();}
function closeManual(){$('manual').close();if(manualPaused){pauseGame(false);manualPaused=false;}}
$('manual-btn').onclick=openManual;$('close-manual').onclick=closeManual;$('manual-done').onclick=closeManual;
$('manual').addEventListener('cancel',e=>{e.preventDefault();closeManual();});
$('manual').addEventListener('click',e=>{if(e.target===$('manual')){const r=$('manual').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeManual();}});
$('start-btn').onclick=startMission;bindTouchAction($('pause-btn'),()=>pauseGame(game.state.status!=='paused'));$('resume-btn').onclick=()=>pauseGame(false);$('restart-btn').onclick=startMission;
for(const id of ['return-btn','exit-btn','result-base-btn'])$(id).onclick=backToBase;
bindTouchAction($('hold-btn'),toggleHold);bindTouchAction($('grenade-btn'),throwGrenade);

function resetJoy(){joy={x:0,y:0};joyPointer=null;$('joystick-knob').style.transform='translate(0,0)';}
function updateJoy(e){const r=$('joystick').getBoundingClientRect();let dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2);const len=Math.hypot(dx,dy),max=r.width*.33;if(len>max){dx*=max/len;dy*=max/len;}joy={x:dx/max,y:dy/max};$('joystick-knob').style.transform=`translate(${dx}px,${dy}px)`;}
$('joystick').addEventListener('pointerdown',e=>{if(game.state.status!=='playing')return;e.preventDefault();joyPointer=e.pointerId;$('joystick').setPointerCapture(e.pointerId);updateJoy(e);$('touch-hint').hidden=true;});
$('joystick').addEventListener('pointermove',e=>{if(e.pointerId===joyPointer){e.preventDefault();updateJoy(e);}});
for(const type of ['pointerup','pointercancel','lostpointercapture'])$('joystick').addEventListener(type,e=>{if(e.pointerId===joyPointer)resetJoy();});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{if(mode!=='game'||game.state.status!=='playing')return;e.preventDefault();const p=renderer.screenToWorld(e.clientX,e.clientY);mouseWorld=p;if(e.button===2){mouseFire=true;canvas.setPointerCapture(e.pointerId);}else game.moveTo(p.x,p.y);canvas.focus({preventScroll:true});});
canvas.addEventListener('pointermove',e=>{mouseWorld=renderer.screenToWorld(e.clientX,e.clientY);});
for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,()=>mouseFire=false);
window.addEventListener('keydown',e=>{if(mode!=='game'||$('manual').open||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;const k=e.key.toLowerCase();if(['arrowup','arrowdown','arrowleft','arrowright',' ','w','a','s','d','g','h','escape'].includes(k))e.preventDefault();if(k==='escape'){if(!e.repeat)pauseGame(game.state.status!=='paused');return;}if(k==='g'&&!e.repeat)throwGrenade();if(k==='h'&&!e.repeat)toggleHold();keys.add(k);});
window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
window.addEventListener('blur',()=>{if(mode==='game'&&game.state.status==='playing')pauseGame(true);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&mode==='game'&&game.state.status==='playing'){hiddenPaused=true;pauseGame(true);}else if(!document.hidden&&hiddenPaused){hiddenPaused=false;}});
window.addEventListener('resize',()=>renderer.resize());
new ResizeObserver(()=>renderer.resize()).observe($('viewport'));

function frame(now) {
  const dt=Math.min((now-lastTime)/1000||0,0.05);lastTime=now;
  if(mode==='game'){
    const mx=joy.x+(keys.has('d')||keys.has('arrowright')?1:0)-(keys.has('a')||keys.has('arrowleft')?1:0);
    const my=joy.y+(keys.has('s')||keys.has('arrowdown')?1:0)-(keys.has('w')||keys.has('arrowup')?1:0);
    const input={moveX:mx,moveY:my};if(mouseFire||keys.has(' ')){input.fire=true;input.aim=mouseWorld;}
    game.update(dt,input);
    if(soundOn&&game.state.status==='playing'&&now-lastAudioShot>100&&game.state.soldiers.some(s=>s.shootFlash>0)){tone(75+Math.random()*90,.045,.017,'sawtooth');lastAudioShot=now;}
    if(now-lastHud>100){updateHud();lastHud=now;}
  }
  renderer.render(game.state,{preview:mode==='base'});requestAnimationFrame(frame);
}
showMissions();renderer.resize();requestAnimationFrame(frame);

// Read-only state hook for regression tests and community debugging.
window.deadSignal={get state(){return game.state;},get game(){return game;},get renderer(){return renderer;},start:startMission,back:backToBase,pause:pauseGame};
