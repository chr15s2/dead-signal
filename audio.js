/**
 * DEAD SIGNAL — original, procedural combat and radio effects.
 * Audio is opt-in. Importing or constructing this class never starts Web Audio.
 */
const MAX_VOICES = 18;
const JOURNAL_LIMIT = 128;
const FLOOR = 0.0001;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export class AudioEngine {
  constructor({enabled = false} = {}) {
    this.enabled = Boolean(enabled);
    this.paused = false;
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.noise = null;
    this.voices = new Set();
    this.lastEventId = 0;
    this.cooldowns = new Map();
    this.destroyed = false;
  }

  get debug() {
    return Object.freeze({enabled: this.enabled,
      contextState: this.context?.state || 'uninitialized',
      voices: this.voices.size, lastEventId: this.lastEventId, paused: this.paused});
  }

  // Call directly from a click/pointer/key handler: resume begins before awaiting.
  // Browsers without Web Audio, or with blocked audio, simply return false.
  async setEnabled(enabled) {
    if (this.destroyed) return false;
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this._silence();
      this._masterVolume(0);
      return false;
    }
    try {
      if (!this.context) this._createContext();
      if (!this.context) {
        this.enabled = false;
        return false;
      }
      if (this.context.state !== 'running') await this.context.resume();
      // A second click can mute while the first resume promise is pending.
      if (this.destroyed || !this.enabled) return false;
      if (this.context.state !== 'running') {
        this.enabled = false;
        this._masterVolume(0);
        return false;
      }
      this._masterVolume(0.58);
      return true;
    } catch {
      this.enabled = false;
      this._silence();
      this._masterVolume(0);
      // Do not keep a half-built context if device setup failed.
      if (this.context && (!this.master || !this.compressor || !this.noise)) {
        try { this.context.close()?.catch(() => {}); } catch {}
        this.context = this.master = this.compressor = this.noise = null;
      }
      return false;
    }
  }

  _createContext() {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) return;
    const context = new Context();
    this.context = context;
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -16;
    this.compressor.knee.value = 10;
    this.compressor.ratio.value = 10;
    this.compressor.attack.value = 0.002;
    this.compressor.release.value = 0.1;
    this.master = context.createGain();
    this.master.gain.value = 0;
    this.compressor.connect(this.master);
    this.master.connect(context.destination);
    // One small reusable buffer replaces allocation on every gunshot.
    this.noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = this.noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }

  _masterVolume(volume) {
    if (!this.context || !this.master) return;
    try {
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(volume, now, 0.012);
    } catch { /* A closed/interrupted audio context is harmless. */ }
  }

  pause(paused) {
    this.paused = Boolean(paused);
    if (this.paused) this._silence();
    // UI pause/resume cues remain available; gameplay consumption stays silent.
  }

  reset() {
    this._silence();
    this.lastEventId = 0;
    this.cooldowns.clear();
    this.paused = false;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.enabled = false;
    this._silence();
    const context = this.context;
    if (context) {
      try {
        const closing = context.close();
        if (closing?.catch) closing.catch(() => {});
      } catch { /* Already closed, or unsupported in an older browser. */ }
    }
    this.context = this.master = this.compressor = this.noise = null;
    this.cooldowns.clear();
  }

  // Advance for every event, including while muted/paused. Resuming never replays
  // earlier shots. A new Game starts its journal at 1: call reset() for it.
  consume(state) {
    if (this.destroyed || !Array.isArray(state?.events)) return;
    const leader = state.soldiers?.find(actor => actor.id === state.leaderId && actor.alive)
      || state.soldiers?.find(actor => actor.alive);
    const squadIds = new Set((state.soldiers || []).map(actor => actor.id));
    const canPlay = this._canPlay() && !this.paused && state.status !== 'paused';
    let played = 0;
    for (const event of state.events.slice(-JOURNAL_LIMIT)) {
      if (!Number.isFinite(event?.id) || event.id <= this.lastEventId) continue;
      this.lastEventId = event.id;
      if (!canPlay || played >= MAX_VOICES) continue;
      // A frame delayed by a tab suspension must not turn into a burst of sound.
      if (Number.isFinite(state.time) && Number.isFinite(event.time)
        && state.time - event.time > 0.3) continue;
      const spatial = this._spatial(event, leader);
      const playerTarget = event.team === 'player'
        || squadIds.has(event.targetId ?? event.actorId);
      try {
        switch (event.type) {
          case 'shot':
            if (spatial.volume > 0.04) this._shot(event.team === 'player', spatial, event.id);
            break;
          case 'hit':
            this._hit(playerTarget, spatial, event.id);
            break;
          case 'death':
            if (playerTarget) this._radio('casualty');
            else this._impact(spatial, event.id, true);
            break;
          case 'explosion': this._explosion(spatial); break;
          case 'rescue': this._radio('rescue'); break;
          case 'wave': this._radio('wave'); break;
          case 'objective': this._radio('objective'); break;
          case 'jammer-destroyed': this._radio('objective'); break;
          case 'extracted': this._radio('extracted'); break;
          case 'holdfire': this.cue('select'); break;
          default: continue;
        }
      } catch {
        // Device interruption must not throw out of the game's animation frame.
        this._silence();
      }
      played++;
    }
  }

  cue(name) {
    if (!this._canPlay()) return;
    try {
      switch (name) {
        case 'deploy': this._radio('deploy'); break;
        case 'select': this._click(570, 760); break;
        case 'grenade': this._click(1050, 620, 0.07); break;
        case 'pause': this._click(430, 280, 0.045); break;
        case 'resume': this._click(280, 430, 0.045); break;
        case 'win': this._radio('win'); break;
        case 'lose': this._radio('lose'); break;
      }
    } catch { /* Feedback must never interrupt play on a failing audio device. */ }
  }

  _canPlay() {
    return this.enabled && !this.destroyed && this.context?.state === 'running';
  }

  _spatial(event, leader) {
    if (!leader || !Number.isFinite(event.x) || !Number.isFinite(event.y)) {
      return {volume: 1, pan: 0};
    }
    const dx = event.x - leader.x;
    const distance = Math.hypot(dx, event.y - leader.y);
    return {
      volume: clamp(1 - Math.max(0, distance - 90) / 760, 0, 1),
      pan: clamp(dx / 430, -0.8, 0.8),
    };
  }

  _ready(key, seconds) {
    const now = this.context.currentTime;
    if (now < (this.cooldowns.get(key) || 0)) return false;
    this.cooldowns.set(key, now + seconds);
    return true;
  }

  _voice(duration, {volume = 1, pan = 0, priority = 0} = {}) {
    if (!this._canPlay() || volume <= 0.02) return null;
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      if (voice.end <= now) this._release(voice);
    }
    if (this.voices.size >= MAX_VOICES) {
      const oldest = [...this.voices].find(voice => voice.priority <= priority);
      if (!oldest) return null;
      this._release(oldest, true);
    }
    const gain = this.context.createGain();
    gain.gain.value = clamp(volume, 0, 1);
    const voice = {gain, nodes: [gain], sources: [], end: now + duration,
      priority, released: false};
    if (this.context.createStereoPanner) {
      const panner = this.context.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner);
      panner.connect(this.compressor);
      voice.nodes.push(panner);
    } else gain.connect(this.compressor);
    this.voices.add(voice);
    return voice;
  }

  _envelope(voice, {delay = 0, duration, attack = 0.002, gain}) {
    const node = this.context.createGain();
    const start = this.context.currentTime + delay;
    node.gain.setValueAtTime(FLOOR, start);
    node.gain.linearRampToValueAtTime(Math.max(FLOOR, gain), start + attack);
    node.gain.exponentialRampToValueAtTime(FLOOR, start + duration);
    node.connect(voice.gain);
    voice.nodes.push(node);
    return {node, start, end: start + duration};
  }

  _tone(voice, {frequency, to = frequency, type = 'sine', ...shape}) {
    if (!voice) return;
    const envelope = this._envelope(voice, shape);
    const source = this.context.createOscillator();
    source.type = type;
    source.frequency.setValueAtTime(frequency, envelope.start);
    source.frequency.exponentialRampToValueAtTime(Math.max(20, to), envelope.end);
    source.connect(envelope.node);
    this._source(voice, source, envelope.start, envelope.end);
  }

  _noise(voice, {filter = 'lowpass', frequency = 2000, to = frequency, ...shape}) {
    if (!voice) return;
    const envelope = this._envelope(voice, shape);
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    const tone = this.context.createBiquadFilter();
    tone.type = filter;
    tone.frequency.setValueAtTime(frequency, envelope.start);
    tone.frequency.exponentialRampToValueAtTime(Math.max(40, to), envelope.end);
    tone.Q.value = 0.7;
    source.connect(tone);
    tone.connect(envelope.node);
    voice.nodes.push(tone);
    this._source(voice, source, envelope.start, envelope.end, 0.15 * Math.random());
  }

  _source(voice, source, start, end, offset) {
    voice.sources.push(source);
    source.onended = () => {
      try { source.disconnect(); } catch {}
      if (!voice.released && voice.sources.every(item => item._deadSignalEnded)) this._release(voice);
    };
    // Mark each completion before asking whether the whole layered voice ended.
    const done = source.onended;
    source.onended = () => { source._deadSignalEnded = true; done(); };
    if (offset === undefined) source.start(start);
    else source.start(start, offset);
    source.stop(end + 0.01);
  }

  _release(voice, fade = false) {
    if (voice.released) return;
    voice.released = true;
    this.voices.delete(voice);
    const now = this.context?.currentTime || 0;
    if (fade) {
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(0, now, 0.006);
      } catch {}
    }
    for (const source of voice.sources) {
      try { source.stop(now + (fade ? 0.025 : 0)); } catch {}
      // Native onended handles source disconnection after the short fade.
      if (!fade) { try { source.disconnect(); } catch {} }
    }
    const disconnect = () => {
      for (const node of voice.nodes) { try { node.disconnect(); } catch {} }
    };
    if (fade) setTimeout(disconnect, 35);
    else disconnect();
  }

  _silence() {
    for (const voice of this.voices) this._release(voice, true);
  }

  _shot(player, spatial, id) {
    if (!this._ready(player ? 'player-shot' : 'enemy-shot', 0.015)) return;
    const voice = this._voice(0.13, {...spatial, priority: 0});
    const pitch = 0.94 + (id % 9) * 0.014;
    // Squad rifles are dry and bright; hostile fire has a lower, hollow report.
    this._noise(voice, {filter: 'highpass', frequency: player ? 1100 : 640,
      gain: player ? 0.26 : 0.21, duration: player ? 0.045 : 0.065});
    this._tone(voice, {frequency: (player ? 185 : 128) * pitch, to: 55,
      type: 'triangle', gain: 0.14, duration: player ? 0.095 : 0.12});
    this._noise(voice, {frequency: player ? 1800 : 1250, to: 380,
      gain: 0.06, duration: 0.12, delay: 0.009});
  }

  _hit(player, spatial, id) {
    if (player) {
      if (!this._ready('squad-hit', 0.15)) return;
      const voice = this._voice(0.18, {volume: 0.85, pan: spatial.pan, priority: 2});
      this._noise(voice, {frequency: 650, gain: 0.12, duration: 0.075});
      this._tone(voice, {frequency: 270, to: 145, type: 'triangle', gain: 0.15,
        duration: 0.17, delay: 0.006});
    } else this._impact(spatial, id);
  }

  _impact(spatial, id, death = false) {
    if (!this._ready('impact', 0.045)) return;
    const voice = this._voice(death ? 0.16 : 0.09, {...spatial, priority: 0});
    this._noise(voice, {frequency: death ? 600 : 1050, to: 240,
      gain: death ? 0.105 : 0.07, duration: death ? 0.15 : 0.075});
    this._tone(voice, {frequency: 130 + (id % 5) * 13, to: 70,
      gain: 0.035, duration: 0.08});
  }

  _explosion(spatial) {
    const voice = this._voice(0.68, {...spatial, priority: 2});
    this._noise(voice, {frequency: 2600, to: 140, gain: 0.38, duration: 0.52});
    this._tone(voice, {frequency: 100, to: 30, gain: 0.36, duration: 0.64,
      attack: 0.003});
    this._noise(voice, {frequency: 420, to: 90, gain: 0.13, duration: 0.5,
      delay: 0.13, attack: 0.03});
  }

  _click(frequency, to, gain = 0.045) {
    const voice = this._voice(0.07, {volume: 0.85, priority: 3});
    this._tone(voice, {frequency, to, gain, type: 'triangle', duration: 0.055});
    this._noise(voice, {filter: 'highpass', frequency: 3400,
      gain: 0.024, duration: 0.025});
  }

  _radio(name) {
    if (!this._canPlay() || !this._ready(`radio-${name}`, 0.45)) return;
    const phrases = {
      deploy: [[430, 0], [650, 0.11]],
      rescue: [[620, 0], [830, 0.11], [1040, 0.23]],
      objective: [[520, 0], [780, 0.14]],
      extracted: [[650, 0], [870, 0.12]],
      wave: [[330, 0], [330, 0.16]],
      casualty: [[270, 0], [180, 0.17]],
      win: [[440, 0], [550, 0.14], [660, 0.28]],
      lose: [[240, 0], [180, 0.2]],
    };
    const notes = phrases[name];
    if (!notes) return;
    const voice = this._voice(0.62, {volume: 0.82, priority: 3});
    this._noise(voice, {filter: 'bandpass', frequency: 1700,
      gain: 0.027, duration: 0.055});
    for (const [frequency, delay] of notes) {
      this._tone(voice, {frequency, to: frequency * 0.99, delay,
        gain: 0.073, type: 'triangle', duration: 0.14, attack: 0.008});
    }
  }
}
