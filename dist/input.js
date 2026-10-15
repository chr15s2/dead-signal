/**
 * Browser input stays separate from the simulation. Pointer positions are kept
 * in client coordinates and projected through the current camera each frame.
 */

const MOVEMENT_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
const GAME_KEYS = new Set([...MOVEMENT_KEYS, ' ', 'g', 'h', 'escape', '1', '2', '3']);
const INTERACTIVE = 'input, select, textarea, button, a[href], [contenteditable]:not([contenteditable="false"]), [role="button"], dialog[open]';
const GRENADE_DRAG_THRESHOLD = 8;

/** Radial deadzone with a smooth 0–1 range and equal speed in every direction. */
export function joystickVector(dx, dy, radius, deadzone = .13) {
  if (![dx, dy, radius].every(Number.isFinite) || radius <= 0) return { x: 0, y: 0 };
  const length = Math.hypot(dx, dy);
  const threshold = Number.isFinite(deadzone) ? Math.max(0, Math.min(.95, deadzone)) : .13;
  const magnitude = Math.min(1, length / radius);
  if (!length || magnitude <= threshold) return { x: 0, y: 0 };
  const strength = (magnitude - threshold) / (1 - threshold);
  return { x: dx / length * strength, y: dy / length * strength };
}

/**
 * Touch actions happen on pointerdown so the second thumb can act while the
 * first holds the pad. Suppression is tied to that pointer's later click,
 * rather than a cooldown that would eat legitimate quick taps or mouse clicks.
 * Native keyboard / assistive clicks (detail === 0) remain available.
 */
export function bindAction(button, handler) {
  const pending = new Map();
  const removers = [];
  let latestPointerType = null;
  const now = () => button.ownerDocument?.defaultView?.performance?.now() ?? Date.now();
  const disabled = () => button.disabled || button.getAttribute('aria-disabled') === 'true';
  const prune = () => {
    const time = now();
    for (const [id, touch] of pending) if (time - touch.time > 1500) pending.delete(id);
  };
  const listen = (type, callback, options) => {
    button.addEventListener(type, callback, options);
    removers.push(() => button.removeEventListener(type, callback, options));
  };
  listen('pointerdown', event => {
    latestPointerType = event.pointerType;
    prune();
    if (event.pointerType !== 'touch' || disabled()) return;
    event.preventDefault();
    pending.set(event.pointerId, { x: event.clientX, y: event.clientY, time: now() });
    handler(event);
  }, { passive: false });
  listen('pointercancel', event => pending.delete(event.pointerId));
  listen('click', event => {
    if (disabled()) return;
    prune();
    if (event.detail === 0) {
      handler(event);
      return;
    }
    if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
      handler(event);
      return;
    }
    let duplicateId = pending.has(event.pointerId) ? event.pointerId : null;
    const touchClick = event.pointerType === 'touch' || event.sourceCapabilities?.firesTouchEvents;
    // Older Safari supplies a MouseEvent for touch clicks. A real mouse
    // pointerdown takes precedence; untrusted programmatic clicks also pass.
    const legacyTouchClick = !event.pointerType && latestPointerType === 'touch' && event.isTrusted;
    if (duplicateId === null && (touchClick || legacyTouchClick)) {
      for (const [id, touch] of pending) {
        if (Math.hypot(event.clientX - touch.x, event.clientY - touch.y) <= 24) {
          duplicateId = id;
          break;
        }
      }
    }
    if (duplicateId !== null) {
      pending.delete(duplicateId);
      event.preventDefault();
      return;
    }
    handler(event);
  });
  return () => { for (const remove of removers) remove(); pending.clear(); };
}

export class InputController {
  constructor({ canvas, joystick, knob, grenadeButton = null, renderer, isPlaying, onMove, onGrenade, onHold, onPause, onFirstInput, onSelect }) {
    this.canvas = canvas;
    this.joystick = joystick;
    this.knob = knob;
    this.grenadeButton = grenadeButton;
    this.renderer = renderer;
    this.isPlaying = isPlaying;
    this.onMove = onMove;
    this.onGrenade = onGrenade;
    this.onHold = onHold;
    this.onPause = onPause;
    this.onFirstInput = onFirstInput;
    this.onSelect = onSelect;
    this.lastPointerType = null;
    this._keys = new Set();
    this._joy = { x: 0, y: 0 };
    this._joyPointer = null;
    this._firePointer = null;
    this._clientAim = null;
    this._grenadeGesture = null;
    this._grenadeClicks = new Map();
    this._grenadePointerType = null;
    this._firstInput = false;
    this._removers = [];
    this._document = canvas.ownerDocument;
    this._window = this._document.defaultView;

    // Record the actual event device, including touch on an action button.
    // Media queries describe a device's capabilities, not its current input.
    this._listen(this._document, 'pointerdown', event => {
      this.lastPointerType = event.pointerType || 'mouse';
    }, true);
    this._listen(joystick, 'pointerdown', event => this._startJoystick(event), { passive: false });
    this._listen(joystick, 'pointermove', event => {
      if (event.pointerId !== this._joyPointer) return;
      event.preventDefault();
      this._updateJoystick(event);
    }, { passive: false });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this._listen(joystick, type, event => {
        if (event.pointerId === this._joyPointer) this._resetJoystick(type !== 'lostpointercapture');
      });
    }
    if (grenadeButton) {
      this._listen(grenadeButton, 'pointerdown', event => this._startGrenade(event), { passive: false });
      this._listen(grenadeButton, 'pointermove', event => this._updateGrenade(event), { passive: false });
      this._listen(grenadeButton, 'pointerup', event => this._finishGrenade(event), { passive: false });
      for (const type of ['pointercancel', 'lostpointercapture']) {
        this._listen(grenadeButton, type, event => {
          if (event.pointerId === this._grenadeGesture?.pointerId) this._cancelGrenade(type !== 'lostpointercapture');
        });
      }
      this._listen(grenadeButton, 'click', event => this._grenadeClick(event));
    }
    this._listen(canvas, 'contextmenu', event => event.preventDefault());
    this._listen(canvas, 'pointerdown', event => this._canvasDown(event), { passive: false });
    this._listen(canvas, 'pointermove', event => this._rememberAim(event));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this._listen(canvas, type, event => {
        if (event.pointerId !== this._firePointer) return;
        const id = this._firePointer;
        this._firePointer = null;
        if (type !== 'lostpointercapture') this._release(canvas, id);
      });
    }
    this._listen(this._window, 'keydown', event => this._keyDown(event));
    this._listen(this._window, 'keyup', event => this._keys.delete(event.key.toLowerCase()));
    this._listen(this._window, 'blur', () => this.reset());
    this._listen(this._window, 'orientationchange', () => this.reset());
    this._listen(this._document, 'visibilitychange', () => {
      if (this._document.hidden) this.reset();
    });
  }

  get pointerType() { return this.lastPointerType; }

  /** A transient view of the held gesture; projection follows the current camera. */
  get grenadeAim() {
    if (!this._grenadeAvailable()) this._cancelGrenade();
    const gesture = this._grenadeGesture;
    if (!gesture || gesture.cancelled) return null;
    if (!gesture.dragged) return { aiming: true, point: null };
    if (this._grenadeInsideButton(gesture)) return null;
    const point = this._projectGrenade(gesture);
    return point ? { aiming: true, point } : null;
  }

  _listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    this._removers.push(() => target.removeEventListener(type, callback, options));
  }

  _started(reason) {
    if (this._firstInput) return;
    this._firstInput = true;
    this.onFirstInput?.(reason);
  }

  _capture(element, id) {
    try { element.setPointerCapture(id); } catch { /* A canceled pointer may already have ended. */ }
  }

  _release(element, id) {
    if (id === null) return;
    try {
      if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
    } catch { /* Releasing an ended pointer is harmless. */ }
  }

  _grenadeAvailable() {
    return Boolean(this.grenadeButton && this.isPlaying() && !this.grenadeButton.disabled
      && this.grenadeButton.getAttribute?.('aria-disabled') !== 'true');
  }

  _grenadeNow() { return this._window.performance?.now() ?? Date.now(); }

  _pruneGrenadeClicks() {
    const time = this._grenadeNow();
    for (const [id, click] of this._grenadeClicks) {
      if (time - click.time > 1500) this._grenadeClicks.delete(id);
    }
  }

  _rememberGrenadeClick(gesture) {
    this._pruneGrenadeClicks();
    this._grenadeClicks.set(gesture.pointerId, {
      type: gesture.pointerType, startX: gesture.startX, startY: gesture.startY,
      x: gesture.clientX, y: gesture.clientY, time: this._grenadeNow(),
    });
    // A delayed browser click needs only a small, bounded recent journal.
    if (this._grenadeClicks.size > 16) this._grenadeClicks.delete(this._grenadeClicks.keys().next().value);
  }

  _startGrenade(event) {
    this._grenadePointerType = event.pointerType || 'mouse';
    if (!this._grenadeAvailable() || this._grenadeGesture || event.button !== 0
      || !Number.isInteger(event.pointerId) || !Number.isFinite(event.clientX + event.clientY)) return;
    const bounds = this.grenadeButton.getBoundingClientRect();
    if (!(bounds.width > 0 && bounds.height > 0) || event.clientX < bounds.left
      || event.clientX > bounds.left + bounds.width || event.clientY < bounds.top
      || event.clientY > bounds.top + bounds.height) return;
    event.preventDefault();
    this.lastPointerType = this._grenadePointerType;
    this._grenadeGesture = { pointerId: event.pointerId, pointerType: this._grenadePointerType,
      startX: event.clientX, startY: event.clientY, clientX: event.clientX, clientY: event.clientY,
      dragged: false, leftButton: false, cancelled: false };
    this._capture(this.grenadeButton, event.pointerId);
    this._started('action');
  }

  _updateGrenade(event) {
    const gesture = this._grenadeGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    if (!this._grenadeAvailable()) { this._cancelGrenade(); return; }
    if (!Number.isFinite(event.clientX + event.clientY)) { gesture.cancelled = true; return; }
    gesture.clientX = event.clientX;
    gesture.clientY = event.clientY;
    const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
    if (distance >= GRENADE_DRAG_THRESHOLD) gesture.dragged = true;
    else if (gesture.dragged) gesture.cancelled = true;
    const insideButton = this._grenadeInsideButton(gesture);
    if (!insideButton) gesture.leftButton = true;
    else if (gesture.dragged && gesture.leftButton) gesture.cancelled = true;
  }

  _grenadeInsideButton(gesture) {
    const bounds = this.grenadeButton.getBoundingClientRect();
    return gesture.clientX >= bounds.left && gesture.clientX <= bounds.left + bounds.width
      && gesture.clientY >= bounds.top && gesture.clientY <= bounds.top + bounds.height;
  }

  _projectGrenade(gesture) {
    const point = this.renderer.screenToWorld(gesture.clientX, gesture.clientY);
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
  }

  _finishGrenade(event) {
    if (event.button !== 0 || event.pointerId !== this._grenadeGesture?.pointerId) return;
    this._updateGrenade(event);
    const gesture = this._grenadeGesture;
    if (!gesture) return;
    const point = gesture.dragged && !gesture.cancelled && !this._grenadeInsideButton(gesture)
      ? this._projectGrenade(gesture) : null;
    const throwGrenade = this._grenadeAvailable() && !gesture.cancelled && (!gesture.dragged || point);
    this._rememberGrenadeClick(gesture);
    this._grenadeGesture = null;
    this._release(this.grenadeButton, gesture.pointerId);
    if (throwGrenade) {
      if (point) this.onGrenade?.(point.x, point.y);
      else this.onGrenade?.();
    }
  }

  _cancelGrenade(release = true) {
    const gesture = this._grenadeGesture;
    if (!gesture) return;
    this._rememberGrenadeClick(gesture);
    this._grenadeGesture = null;
    if (release) this._release(this.grenadeButton, gesture.pointerId);
  }

  _grenadeClick(event) {
    this._pruneGrenadeClicks();
    // Keyboard and assistive activation still work without pointer gestures.
    if (event.detail === 0) {
      if (this._grenadeAvailable()) this.onGrenade?.();
      return;
    }
    let duplicateId = this._grenadeClicks.has(event.pointerId) ? event.pointerId : null;
    // Legacy Safari sends a MouseEvent after a touch rather than a PointerEvent.
    const touchClick = event.pointerType === 'touch' || event.sourceCapabilities?.firesTouchEvents;
    const legacyPointerClick = !event.pointerType && event.isTrusted;
    if (duplicateId === null && (touchClick || legacyPointerClick)) {
      for (const [id, click] of this._grenadeClicks) {
        if (click.type === (touchClick ? 'touch' : this._grenadePointerType)
          && (Math.hypot(event.clientX - click.x, event.clientY - click.y) <= 24
          || Math.hypot(event.clientX - click.startX, event.clientY - click.startY) <= 24)) {
          duplicateId = id;
          break;
        }
      }
    }
    if (duplicateId !== null) {
      this._grenadeClicks.delete(duplicateId);
      event.preventDefault();
      return;
    }
    if (this._grenadeAvailable() && !this._grenadeGesture) this.onGrenade?.();
  }

  _startJoystick(event) {
    if (!this.isPlaying() || this._joyPointer !== null || event.button !== 0) return;
    event.preventDefault();
    this.lastPointerType = event.pointerType || 'mouse';
    this._joyPointer = event.pointerId;
    this._capture(this.joystick, event.pointerId);
    this._updateJoystick(event);
    this._started('movement');
  }

  _updateJoystick(event) {
    if (!this.isPlaying()) { this._resetJoystick(); return; }
    const bounds = this.joystick.getBoundingClientRect();
    const radius = Math.min(bounds.width, bounds.height) * .33;
    const dx = event.clientX - (bounds.left + bounds.width / 2);
    const dy = event.clientY - (bounds.top + bounds.height / 2);
    this._joy = joystickVector(dx, dy, radius);
    const length = Math.hypot(dx, dy);
    const scale = length && radius > 0 ? Math.min(1, radius / length) : 0;
    // The compact landscape pad can be CSS-scaled. Its pointer coordinates
    // are visual pixels; the knob transform uses the pad's local pixels.
    const localX = bounds.width ? (this.joystick.offsetWidth || bounds.width) / bounds.width : 1;
    const localY = bounds.height ? (this.joystick.offsetHeight || bounds.height) / bounds.height : 1;
    this.knob.style.transform = `translate(${dx * scale * localX}px, ${dy * scale * localY}px)`;
  }

  _resetJoystick(release = true) {
    const id = this._joyPointer;
    this._joyPointer = null;
    this._joy = { x: 0, y: 0 };
    this.knob.style.transform = 'translate(0px, 0px)';
    if (release) this._release(this.joystick, id);
  }

  _rememberAim(event) {
    if (event.pointerType === 'touch') return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    this.lastPointerType = event.pointerType || 'mouse';
    this._clientAim = { x: event.clientX, y: event.clientY };
  }

  _canvasDown(event) {
    if (!this.isPlaying()) return;
    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    this.lastPointerType = event.pointerType || 'mouse';
    this._rememberAim(event);
    this.canvas.focus({ preventScroll: true });
    if (event.button === 2 && event.pointerType !== 'touch') {
      if (this._firePointer !== null) return;
      this._firePointer = event.pointerId;
      this._capture(this.canvas, event.pointerId);
      this._started('aim');
    } else {
      const point = this.renderer.screenToWorld(event.clientX, event.clientY);
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      this.onMove?.(point.x, point.y);
      this._started('order');
    }
  }

  _keyDown(event) {
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
    if (event.target?.closest?.(INTERACTIVE) || this._document.querySelector('dialog[open]')) return;
    const key = event.key.toLowerCase();
    if (!GAME_KEYS.has(key)) return;
    if (key === 'escape') {
      // The root decides whether a paused mission can resume.
      event.preventDefault();
      if (!event.repeat) this.onPause?.();
      return;
    }
    if (!this.isPlaying()) return;
    event.preventDefault();
    if (MOVEMENT_KEYS.has(key) || key === ' ') {
      this._keys.add(key);
      this._started(key === ' ' ? 'aim' : 'movement');
    } else if (!event.repeat) {
      if (key === 'g') {
        const point = this.aimPoint();
        if (point) this.onGrenade?.(point.x, point.y);
        else this.onGrenade?.();
      }
      if (key === 'h') this.onHold?.();
      if (['1', '2', '3'].includes(key)) this.onSelect?.(Number(key) - 1);
      this._started('action');
    }
  }

  /** Returns null for touch, so mobile grenades can use tactical auto-targeting. */
  aimPoint() {
    if (!this._clientAim || this.lastPointerType === 'touch') return null;
    const point = this.renderer.screenToWorld(this._clientAim.x, this._clientAim.y);
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
  }

  sample() {
    if (!this._grenadeAvailable()) this._cancelGrenade();
    if (!this.isPlaying()) return { moveX: 0, moveY: 0 };
    let moveX = this._joy.x + (this._keys.has('d') || this._keys.has('arrowright') ? 1 : 0)
      - (this._keys.has('a') || this._keys.has('arrowleft') ? 1 : 0);
    let moveY = this._joy.y + (this._keys.has('s') || this._keys.has('arrowdown') ? 1 : 0)
      - (this._keys.has('w') || this._keys.has('arrowup') ? 1 : 0);
    const length = Math.hypot(moveX, moveY);
    if (length > 1) { moveX /= length; moveY /= length; }
    const sample = { moveX, moveY };
    if (this._firePointer !== null || this._keys.has(' ')) {
      sample.fire = true;
      sample.aim = this.aimPoint();
    }
    return sample;
  }

  reset() {
    this._cancelGrenade();
    this._keys.clear();
    this._resetJoystick();
    const id = this._firePointer;
    this._firePointer = null;
    this._release(this.canvas, id);
    this._clientAim = null;
    this._firstInput = false;
  }

  destroy() {
    this.reset();
    for (const remove of this._removers) remove();
    this._removers.length = 0;
    this._grenadeClicks.clear();
  }
}
