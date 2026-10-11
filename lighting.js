/** Cached, purely visual afternoon light. The simulation never reads this layer. */
const TAU = Math.PI * 2;

export function paintSunlight(c, state) {
  const {width, height} = state.world;
  c.save();
  const sun = c.createLinearGradient(40, 90, width, height);
  sun.addColorStop(0, 'rgba(255,226,166,.13)');
  sun.addColorStop(.45, 'rgba(239,216,156,.055)');
  sun.addColorStop(1, 'rgba(21,52,60,.085)');
  c.fillStyle = sun;
  c.fillRect(0, 0, width, height);
  // Broken, angled patches of sunlight remain baked into the ground texture.
  for (const tree of state.world.obstacles) {
    if (tree.type !== 'tree') continue;
    const x = tree.x - 34, y = tree.y - 26;
    c.fillStyle = 'rgba(232,221,157,.10)';
    c.beginPath();
    c.moveTo(x, y); c.lineTo(x + 23, y + 5);
    c.lineTo(x + 50, y + 37); c.lineTo(x + 30, y + 31);
    c.closePath(); c.fill();
    c.fillStyle = 'rgba(232,221,157,.075)';
    c.fillRect(x + 17, y + 13, 8, 3);
    c.fillRect(x + 25, y + 20, 6, 2);
  }
  c.restore();
}

export class GroundLighting {
  constructor() { this.reset(); }
  reset() { this.cover = new WeakMap(); this.equipment = new Map(); }

  draw(c, state, {visible = () => true} = {}) {
    for (const obstacle of state.world.obstacles) {
      if (obstacle.alive === false || !visible(obstacle.x - 30, obstacle.y - 30, obstacle.w + 115, obstacle.h + 115)) continue;
      let art = this.cover.get(obstacle);
      if (!art) {
        art = this.makeCover(obstacle);
        this.cover.set(obstacle, art);
      }
      c.drawImage(art.canvas, Math.round(obstacle.x - art.pad), Math.round(obstacle.y - art.pad));
    }
    const operation = state.objective;
    const devices = operation?.type === 'sabotage' ? operation.targets : operation?.type === 'holdout' ? [operation.zone] : [];
    for (const device of devices) {
      if (!visible(device.x - 30, device.y - 20, 100, 85)) continue;
      const key = device.alive === false ? 'wreck' : operation.type;
      let canvas = this.equipment.get(key);
      if (!canvas) {
        canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 100;
        const a = canvas.getContext('2d'); a.translate(35, 30);
        a.fillStyle = 'rgba(19,44,46,.16)';
        a.beginPath(); a.moveTo(-21, -7); a.lineTo(18, -7);
        a.lineTo(34, 16); a.lineTo(-5, 17); a.closePath(); a.fill();
        if (key !== 'wreck') {
          a.strokeStyle = 'rgba(19,44,46,.17)'; a.lineWidth = 3;
          a.beginPath(); a.moveTo(8, 0); a.lineTo(38, 29); a.stroke();
          a.lineWidth = 1.5; a.beginPath(); a.moveTo(29, 19); a.lineTo(42, 24); a.stroke();
        }
        this.equipment.set(key, canvas);
      }
      c.drawImage(canvas, Math.round(device.x - 35), Math.round(device.y - 30));
    }
  }

  makeCover(o) {
    const pad = 48, w = o.w || 28, h = o.h || 28;
    const canvas = document.createElement('canvas'); canvas.width = w + pad * 2 + 30; canvas.height = h + pad * 2 + 30;
    const c = canvas.getContext('2d'); c.translate(pad, pad);
    if (o.type === 'tree') {
      const cx = w / 2, cy = h / 2;
      c.fillStyle = 'rgba(18,46,47,.14)';
      c.beginPath(); c.ellipse(cx + 24, cy + 27, 30, 16, .48, 0, TAU); c.fill();
      c.save(); c.translate(cx + 25, cy + 29); c.scale(1, .53); c.rotate(.22);
      c.fillStyle = 'rgba(18,46,47,.10)';
      for (let i = 0; i < 7; i++) {
        c.save(); c.rotate(i * TAU / 7);
        c.beginPath(); c.moveTo(0, 0); c.lineTo(16, -5); c.lineTo(43, 0); c.lineTo(17, 5); c.closePath(); c.fill();
        c.restore();
      }
      c.restore();
      c.strokeStyle = 'rgba(18,46,47,.15)'; c.lineWidth = 4;
      c.beginPath(); c.moveTo(cx, cy + 5); c.lineTo(cx + 24, cy + 29); c.stroke();
    } else if (o.type === 'hut') {
      c.fillStyle = 'rgba(17,45,48,.19)';
      c.beginPath(); c.moveTo(6, 12); c.lineTo(w, 12);
      c.lineTo(w + 29, h + 21); c.lineTo(28, h + 21); c.closePath(); c.fill();
      c.fillStyle = 'rgba(17,45,48,.07)'; c.fillRect(w - 2, 18, 9, h - 12);
    } else {
      c.fillStyle = 'rgba(18,46,47,.13)';
      c.beginPath(); c.ellipse(w / 2 + 12, h / 2 + 10, w * .57, h * .43, .26, 0, TAU); c.fill();
    }
    return {canvas, pad};
  }
}
