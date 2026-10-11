/** Original pixel characters. Animation is a view of the simulation clock only. */
const TAU = Math.PI * 2;
const MAX_POSES = 128;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const ink = '#183e36';

export class ActorPainter {
  constructor() { this.poses = new Map(); }
  reset() { this.poses.clear(); }

  // A short shoulder/head turn adds weight; the rifle always shows the true aim.
  // No wall clock, gameplay random source, or actor property is changed here.
  facing(p, time, reducedMotion) {
    const target = Number.isFinite(p.angle) ? p.angle : Number.isFinite(p.moveAngle) ? p.moveAngle : -Math.PI / 2;
    if (reducedMotion) return target;
    const key = p.id ?? p;
    let pose = this.poses.get(key);
    if (!pose || time < pose.time) {
      if (!pose && this.poses.size >= MAX_POSES) this.poses.delete(this.poses.keys().next().value);
      pose = { angle: target, time };
      this.poses.set(key, pose);
    } else if (time > pose.time) {
      const dt = Math.min(time - pose.time, .1);
      // Clamp the visual lag to avoid obscuring a sharp reversal or a new target.
      const gap = wrap(target - pose.angle);
      pose.angle = target - clamp(gap * Math.exp(-dt * 18), -.55, .55);
      pose.time = time;
    }
    return pose.angle;
  }

  draw(c, p, type, state, leader, { scale = 1, reducedMotion = false } = {}) {
    const zombie = type === 'zombie', civilian = type === 'civilian', enemy = type === 'enemy';
    const time = state.time || 0;
    const aim = Number.isFinite(p.angle) ? p.angle : Number.isFinite(p.moveAngle) ? p.moveAngle : -Math.PI / 2;
    const angle = this.facing(p, time, reducedMotion), dx = Math.cos(angle), dy = Math.sin(angle);
    const moving = Boolean(p.moving) && !reducedMotion;
    const phase = Number.isFinite(p.walkPhase) ? p.walkPhase : time * (zombie ? 7 : 11) + (Number(p.id) || 0) * 2;
    const stride = moving ? Math.sin(phase) : 0;
    const moveAngle = Number.isFinite(p.moveAngle) ? p.moveAngle : angle;
    const footX = Math.cos(moveAngle) * stride * (zombie ? 1.6 : civilian ? 2 : 2.4);
    const footY = Math.sin(moveAngle) * stride * (zombie ? 1.6 : civilian ? 2 : 2.4);
    const lean = zombie && moving ? Math.round(Math.sin(phase * .5) * 1.2) : 0;
    const bob = moving ? Math.round(Math.abs(stride) * (zombie ? .5 : 1)) : 0;
    const idle = !reducedMotion && !moving ? Math.sin(time * 2.1 + (Number(p.id) || 0)) * .25 : 0;
    const hit = (p.hitFlash || 0) > 0;
    const skin = p.name === 'ROOK' ? '#b9865d' : p.name === 'JUNE' ? '#e4c398' : '#dcb588';
    const jacket = hit ? '#f1e5c4' : zombie ? '#737c70' : civilian ? '#d4b67d' : enemy ? '#bb8a55' : '#2e8074';
    const light = zombie ? '#949d80' : civilian ? '#f1d69a' : enemy ? '#deb477' : '#80bd9e';

    c.save(); c.translate(Math.round(p.x), Math.round(p.y)); c.scale(scale, scale);
    // A compact contact shadow anchors the feet, separate from the sunlight cast.
    c.fillStyle = 'rgba(22,49,33,.32)'; c.beginPath(); c.ellipse(1, 5, 8, 3.5, .08, 0, TAU); c.fill();
    c.fillStyle = 'rgba(22,49,33,.14)'; c.beginPath(); c.ellipse(6, 8, 8, 3, .3, 0, TAU); c.fill();
    if (type === 'squad') {
      c.lineWidth = leader ? 3 : 1.5; c.strokeStyle = leader ? '#194b3c' : '#3d8766';
      c.beginPath(); c.ellipse(0, 5, leader ? 10 : 8, leader ? 5 : 4, 0, 0, TAU); c.stroke();
      if (leader) {
        c.lineWidth = 1.2; c.strokeStyle = '#e7e0b0'; c.beginPath(); c.ellipse(0, 5, 10, 5, 0, 0, TAU); c.stroke();
        c.fillStyle = '#dc6544'; c.fillRect(-3, -25, 6, 2); c.fillRect(-2, -23, 4, 2); c.fillRect(-1, -21, 2, 1);
      }
    }
    if (enemy && p.reaction > 0) {
      c.strokeStyle = '#f0b277'; c.lineWidth = 1; c.beginPath();
      c.moveTo(0, -29); c.lineTo(3, -25); c.lineTo(0, -21); c.lineTo(-3, -25); c.closePath(); c.stroke();
    }

    // Alternating boots and knees follow travel, independently of the firing aim.
    const lx = Math.round(-5 + footX), ly = Math.round(3 + footY);
    const rx = Math.round(2 - footX * (zombie ? .65 : 1)), ry = Math.round(3 - footY * (zombie ? .65 : 1));
    c.fillStyle = ink; c.fillRect(lx, ly, 4, 5); c.fillRect(rx, ry, 4, 5);
    c.fillStyle = zombie ? '#6c7451' : civilian ? '#657758' : enemy ? '#8c7654' : '#6a8060';
    c.fillRect(lx, ly, 3, 2); c.fillRect(rx, ry, 3, 2);
    c.fillStyle = zombie ? '#83916b' : '#a4ae7c'; c.fillRect(lx, ly, 2, 1); c.fillRect(rx, ry, 2, 1);
    c.fillStyle = '#35513b'; c.fillRect(lx, ly + 4, 4, 1); c.fillRect(rx, ry + 4, 4, 1);
    c.translate(lean, -bob - idle);

    c.fillStyle = ink; c.fillRect(-7, -9, 14, 13);
    c.fillStyle = jacket; c.fillRect(-5, -8, 10, 11);
    c.fillStyle = light; c.fillRect(-5, -8, 3, 3); c.fillRect(-5, -5, 1, 5);
    c.fillStyle = zombie ? '#4d6551' : civilian ? '#9e8d61' : enemy ? '#765c40' : '#286452';
    c.fillRect(-4, 0, 8, 3); c.fillRect(4, -7, 1, 7);

    if (zombie) {
      this.drawZombie(c, p, dx, dy, moving ? phase : 0, hit);
    } else {
      if (!civilian) {
        // Shoulder straps, two canvas pouches, belt clasp and a shaded radio pack.
        c.fillStyle = enemy ? '#7b613f' : '#9b8b61'; c.fillRect(-3, -7, 2, 9); c.fillRect(2, -7, 2, 9);
        c.fillStyle = enemy ? '#dda466' : '#d4bf87'; c.fillRect(-3, -5, 3, 4); c.fillRect(2, -5, 3, 4);
        c.fillStyle = enemy ? '#a78453' : '#b6a376'; c.fillRect(-3, -3, 3, 1); c.fillRect(2, -3, 3, 1);
        c.fillStyle = '#e1d49b'; c.fillRect(-1, 1, 2, 1);
        c.fillStyle = '#214d3d'; c.fillRect(-7, -6, 2, 7); c.fillStyle = '#889d6e'; c.fillRect(-6, -5, 1, 4);
        c.fillStyle = enemy ? '#dc6544' : '#d9e2b0'; c.fillRect(-5, -8, 2, 2);
      } else {
        // The operator carries a diagonal satchel strap, keeping a distinct silhouette.
        c.fillStyle = '#8f7954'; c.fillRect(-4, -7, 2, 3); c.fillRect(-2, -4, 2, 3); c.fillRect(0, -1, 2, 3);
        c.fillStyle = '#aa9161'; c.fillRect(3, -1, 4, 5); c.fillStyle = '#e4ca93'; c.fillRect(3, -1, 4, 1);
      }
      this.drawHumanHead(c, p, dx, dy, skin, civilian, enemy, hit);
      if (civilian) {
        const swing = moving ? Math.round(stride * 1.2) : 0;
        c.fillStyle = '#9d865b'; c.fillRect(-8, -8 + swing, 3, 5); c.fillRect(5, -8 - swing, 3, 5);
        c.fillStyle = '#ebd3a0'; c.fillRect(-8, -4 + swing, 3, 3); c.fillRect(5, -4 - swing, 3, 3);
        if (!p.rescued) {
          c.fillStyle = '#e6efc2'; c.fillRect(-1, -30, 2, 6); c.fillRect(-1, -22, 2, 2);
        } else {
          c.fillStyle = '#d6e7ae'; c.fillRect(-2, -24, 5, 2); c.fillRect(1, -26, 2, 4);
        }
      } else this.drawRifle(c, p, aim, skin, enemy, reducedMotion);
    }

    if (p.hp !== undefined && p.maxHp && (p.hp < p.maxHp || leader)) {
      const health = clamp(p.hp / p.maxHp, 0, 1), critical = type === 'squad' && health <= .30;
      c.fillStyle = '#183d35'; c.fillRect(-8, 12, 16, 3);
      c.fillStyle = type === 'squad' ? critical ? '#dc6544' : '#b9dc9f' : zombie ? '#c9d3a0' : '#e3b67a';
      c.fillRect(-7, 13, Math.ceil(14 * health), 1);
      if (critical) { c.fillStyle = '#f6d0a2'; c.fillRect(10, 10, 1, 3); c.fillRect(10, 14, 1, 1); }
    }
    c.restore();
  }

  drawHumanHead(c, p, dx, dy, skin, civilian, enemy, hit) {
    const faceX = Math.round(dx * 1.5), back = dy < -.45;
    c.fillStyle = '#1c4236'; c.fillRect(-5 + faceX, -15, 10, 8);
    c.fillStyle = hit ? '#f1e5c4' : civilian ? '#e2c692' : enemy ? '#d9b985' : skin;
    c.fillRect(-4 + faceX, -14, 8, 6); c.fillRect(-2 + faceX, -8, 4, 1);
    c.fillStyle = civilian ? '#655034' : enemy ? '#826240' : '#28584b';
    c.fillRect(-5 + faceX, -18, 10, back ? 9 : 6); c.fillRect(-6 + faceX, -14, 12, 2);
    c.fillStyle = civilian ? '#a68550' : enemy ? '#c5a26a' : '#769c70';
    c.fillRect(-4 + faceX, -18, 7, 2); c.fillRect(-4 + faceX, -16, 2, 2);
    if (!civilian) {
      c.fillStyle = enemy ? '#e1c486' : '#d7d5a1'; c.fillRect(-5 + faceX, -14, 10, 1);
      c.fillStyle = enemy ? '#dd724b' : '#d9e2b0'; c.fillRect(-4 + faceX, -16, 2, 2);
      c.fillStyle = enemy ? '#655339' : '#284d3c'; c.fillRect(4 + faceX, -16, 1, 2);
      if (p.name === 'ROOK') { c.fillStyle = '#75936c'; c.fillRect(3 + faceX, -18, 1, 3); }
      if (p.name === 'JUNE') { c.fillStyle = '#d4d6a0'; c.fillRect(2 + faceX, -17, 2, 1); }
    }
    if (!back) {
      c.fillStyle = '#294a36'; c.fillRect((dx > .25 ? 2 : dx < -.25 ? -3 : -2) + faceX, -11, 1, 1);
      if (Math.abs(dx) < .6) c.fillRect(2 + faceX, -11, 1, 1);
      c.fillStyle = '#b08f67'; c.fillRect(Math.round(dx * 3) + faceX, -10, 1, 2);
      c.fillStyle = '#e8cca2'; c.fillRect(-3 + faceX, -12, 1, 1);
    }
  }

  drawZombie(c, p, dx, dy, phase, hit) {
    const reach = p.attackCooldown > .5 ? 1 : 0;
    const sway = Math.round(Math.sin(phase * .5));
    const fx = Math.round(dx * (6 + reach)), fy = Math.round(dy * (6 + reach));
    // Uneven reaching arms and a hanging head distinguish the shambling stride.
    c.fillStyle = '#20473a'; c.fillRect(fx - 3, fy - 7 + sway, 5, 7); c.fillRect(Math.round(dx * 4) - 7, Math.round(dy * 4) - 5 - sway, 4, 6);
    c.fillStyle = hit ? '#f1e5c4' : '#bdcfa8'; c.fillRect(fx - 2, fy - 6 + sway, 3, 5); c.fillRect(Math.round(dx * 4) - 6, Math.round(dy * 4) - 4 - sway, 2, 4);
    c.fillStyle = '#d6deaf'; c.fillRect(fx - 2, fy - 6 + sway, 1, 3);
    const faceX = Math.round(dx * 2), headY = dy > .4 ? 1 : 0;
    c.fillStyle = '#234b3b'; c.fillRect(-6 + faceX, -18 + headY, 12, 11);
    c.fillStyle = hit ? '#f1e5c4' : '#bfcea6'; c.fillRect(-5 + faceX, -17 + headY, 10, 9); c.fillRect(-3, -9, 6, 3);
    c.fillStyle = '#d8dfb2'; c.fillRect(-4 + faceX, -16 + headY, 7, 2);
    c.fillStyle = '#648768'; c.fillRect(-5 + faceX, -16 + headY, 2, 5); c.fillRect(3 + faceX, -15 + headY, 2, 2);
    c.fillStyle = '#254b39'; c.fillRect(-4 + faceX, -13 + headY, 3, 3); c.fillRect(2 + faceX, -13 + headY, 2, 3);
    c.fillStyle = '#758a67'; c.fillRect(-2 + faceX, -10 + headY, 4, 2);
    c.fillStyle = '#e6d5ab'; c.fillRect(-1 + faceX, -9 + headY, 2, 1);
    // Torn cuff, exposed knee and shirt patches replace any bright gore.
    c.fillStyle = '#835c49'; c.fillRect(3, -4, 2, 4);
    c.fillStyle = '#bfcea6'; c.fillRect(-4, 2, 2, 3);
    c.fillStyle = '#455b45'; c.fillRect(1, 1, 2, 3); c.fillRect(-1, -6, 2, 3);
    c.fillStyle = '#a3ad8a'; c.fillRect(-1, -6, 1, 1);
  }

  drawRifle(c, p, angle, skin, enemy, reducedMotion) {
    const flash = (p.shootFlash || 0) > 0;
    const recoil = flash && !reducedMotion ? clamp((p.shootFlash || 0) / .10, 0, 1) * 1.7 : 0;
    c.save(); c.translate(0, -4); c.rotate(angle); c.translate(-recoil, 0);
    // Sleeves and two hands brace the rifle instead of a floating skin rectangle.
    c.fillStyle = enemy ? '#8c6946' : '#286452'; c.fillRect(0, -3, 5, 5); c.fillRect(3, 2, 5, 3);
    c.fillStyle = enemy ? '#d9b985' : skin; c.fillRect(4, -2, 5, 3); c.fillRect(8, 1, 3, 2);
    c.fillStyle = '#193e35'; c.fillRect(5, -2, 13, 3); c.fillRect(4, -1, 3, 3);
    c.fillStyle = '#939d77'; c.fillRect(12, -2, 6, 1); c.fillRect(9, -3, 2, 1);
    c.fillStyle = '#1d352c'; c.fillRect(10, 0, 3, 4); c.fillRect(18, -1, 2, 1);
    c.fillStyle = '#b7bc8b'; c.fillRect(6, -2, 3, 1);
    if (flash) {
      // A short local warm glow stays subordinate to the crisp muzzle shape.
      c.save(); c.globalAlpha = .15; c.fillStyle = '#ffe4a3'; c.fillRect(17, -5, 11, 10); c.restore();
      c.fillStyle = '#dc8c48'; c.fillRect(19, -2, 8, 3);
      c.fillStyle = '#fff1c4'; c.fillRect(20, -2, 5, 3); c.fillRect(22, -4, 2, 7);
      c.fillStyle = '#fff9db'; c.fillRect(20, -1, 3, 1);
    }
    c.restore();
  }

  drawCorpse(c, p, state, { scale = 1, reducedMotion = false } = {}) {
    const age = Math.max(0, (state.time || 0) - (p.time ?? -10));
    const fall = reducedMotion ? 1 : clamp(age / .24, 0, 1);
    const zombie = p.type === 'zombie', enemy = p.type === 'soldier';
    c.save(); c.translate(Math.round(p.x), Math.round(p.y)); c.scale(scale, scale);
    c.rotate((Number.isFinite(p.angle) ? p.angle : 0) + .6);
    if (fall < 1) c.scale(.5 + fall * .5, 1 + (1 - fall) * .5);
    c.fillStyle = 'rgba(38,43,31,.2)'; c.beginPath(); c.ellipse(0, 3, 12, 4, 0, 0, TAU); c.fill();
    c.fillStyle = ink; c.fillRect(-7, -4, 14, 8);
    c.fillStyle = zombie ? '#687662' : enemy ? '#9b744d' : '#286f62'; c.fillRect(-6, -3, 12, 6);
    c.fillStyle = zombie ? '#a4af85' : p.name === 'ROOK' ? '#b9865d' : p.name === 'JUNE' ? '#d3b58e' : '#b8a985';
    c.fillRect(5, -4, 5, 5);
    c.fillStyle = '#354638'; c.fillRect(-11, -2, 5, 3); c.fillRect(-10, 3, 5, 2);
    c.fillStyle = zombie ? '#829076' : enemy ? '#b99762' : '#8eb494'; c.fillRect(-5, -3, 8, 1);
    if (!zombie) { c.fillStyle = enemy ? '#766446' : '#a7986d'; c.fillRect(-2, -2, 2, 4); }
    if (p.name) {
      c.strokeStyle = '#8cb7a0'; c.lineWidth = .8; c.beginPath();
      c.moveTo(-3, -1); c.lineTo(2, -1); c.moveTo(0, -3); c.lineTo(0, 2); c.stroke();
    }
    c.restore();
  }
}
