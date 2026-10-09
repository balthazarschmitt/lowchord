// Multitouch input: chord pads, joystick, strum strip, tilt and keyboard.

function capture(el, e) {
  try {
    el.setPointerCapture(e.pointerId);
  } catch {}
}

const SECTORS = ['r', 'ur', 'u', 'ul', 'l', 'dl', 'd', 'dr'];

export function dirFromVector(x, y, dead = 0.35) {
  // x right, y up, both in -1..1
  if (Math.hypot(x, y) < dead) return 'c';
  const a = Math.atan2(y, x);
  const idx = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return SECTORS[idx];
}

export function bindPads(els, { down, up }) {
  els.forEach((el, deg) => {
    const pointers = new Set();
    const press = (e) => {
      e.preventDefault();
      capture(el, e);
      if (!pointers.size) {
        el.classList.add('on');
        down(deg);
      }
      pointers.add(e.pointerId);
    };
    const release = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (!pointers.size) {
        el.classList.remove('on');
        up(deg);
      }
    };
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  });
}

export class Joystick {
  constructor(base, knob, onDir) {
    this.base = base;
    this.knob = knob;
    this.onDir = onDir;
    this.dir = 'c';
    this.pointer = null;
    this.latch = false;
    this.moved = false;
    this.external = false; // tilt in control
    base.addEventListener('pointerdown', (e) => this.start(e));
    base.addEventListener('pointermove', (e) => this.move(e));
    base.addEventListener('pointerup', (e) => this.end(e));
    base.addEventListener('pointercancel', (e) => this.end(e));
    base.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  start(e) {
    if (this.pointer !== null) return;
    e.preventDefault();
    this.pointer = e.pointerId;
    capture(this.base, e);
    this.rect = this.base.getBoundingClientRect();
    this.moved = false;
    this.move(e);
  }

  move(e) {
    if (e.pointerId !== this.pointer) return;
    const r = this.rect;
    const rad = r.width / 2;
    let x = (e.clientX - (r.left + rad)) / rad;
    let y = -(e.clientY - (r.top + rad)) / rad;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    if (len > 0.35) this.moved = true;
    this.show(x, y);
    this.set(dirFromVector(x, y));
  }

  end(e) {
    if (e.pointerId !== this.pointer) return;
    this.pointer = null;
    if (this.latch && this.moved) return; // keep the latched direction
    this.show(0, 0);
    this.set('c');
  }

  show(x, y) {
    this.knob.style.transform = `translate(${x * 34}%, ${-y * 34}%)`;
  }

  set(dir) {
    if (dir === this.dir) return;
    this.dir = dir;
    this.base.dataset.dir = dir;
    this.onDir(dir);
  }

  /** Programmatic direction (tilt / keyboard). */
  setVector(x, y) {
    if (this.pointer !== null) return;
    this.show(x, y);
    this.set(dirFromVector(x, y, 0.5));
  }
}

export function bindStrip(el, onZone, zones = 16) {
  let last = -1;
  const pointers = new Set();
  const zoneAt = (e) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(zones - 1, Math.floor(((e.clientX - r.left) / r.width) * zones)));
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    capture(el, e);
    pointers.add(e.pointerId);
    last = zoneAt(e);
    onZone(last, zones);
  });
  el.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const z = zoneAt(e);
    if (z === last) return;
    // Fill skipped zones on fast swipes so every string sounds.
    const step = z > last ? 1 : -1;
    for (let i = last + step; i !== z + step; i += step) onZone(i, zones);
    last = z;
  });
  const end = (e) => pointers.delete(e.pointerId);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

export class Tilt {
  constructor(joy) {
    this.joy = joy;
    this.enabled = false;
    this.zero = null;
    this.handler = (e) => this.onOrient(e);
  }

  async enable() {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return false;
    if (typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    this.zero = null;
    window.addEventListener('deviceorientation', this.handler);
    this.enabled = true;
    return true;
  }

  disable() {
    window.removeEventListener('deviceorientation', this.handler);
    this.enabled = false;
    this.joy.setVector(0, 0);
  }

  recalibrate() {
    this.zero = null;
  }

  onOrient(e) {
    if (e.beta == null) return;
    if (!this.zero) this.zero = { b: e.beta, g: e.gamma };
    const x = Math.max(-1, Math.min(1, (e.gamma - this.zero.g) / 25));
    const y = Math.max(-1, Math.min(1, -(e.beta - this.zero.b) / 25));
    this.joy.setVector(x, y);
  }
}

/** Desktop testing: 1-7 pads, arrow keys / WASD joystick. */
export function bindKeyboard({ down, up, joy }) {
  const held = new Set();
  const keys = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, 1], s: [0, -1], a: [-1, 0], d: [1, 0] };
  const vec = () => {
    let x = 0, y = 0;
    for (const k of held) if (keys[k]) { x += keys[k][0]; y += keys[k][1]; }
    joy.setVector(Math.sign(x), Math.sign(y));
  };
  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input,select,textarea')) return;
    if (e.repeat) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 7) down(n - 1);
    else if (keys[e.key]) { held.add(e.key); vec(); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => {
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 7) up(n - 1);
    else if (keys[e.key]) { held.delete(e.key); vec(); }
  });
}
