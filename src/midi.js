// Web MIDI output. Available in Chrome on Android/desktop; not in iOS Safari.

export const midiSupported = () => typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;

export class Midi {
  constructor(engine) {
    this.engine = engine;
    this.access = null;
    this.out = null;
    this.channel = 0;
    this.onchange = null;
  }

  async enable() {
    if (!midiSupported()) return false;
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      return false;
    }
    this.access.onstatechange = () => this.onchange && this.onchange();
    return true;
  }

  outputs() {
    return this.access ? [...this.access.outputs.values()] : [];
  }

  select(id) {
    this.out = this.outputs().find((o) => o.id === id) || null;
  }

  /** Convert an AudioContext time to a performance.now() timestamp for MIDI scheduling. */
  stamp(when) {
    const ctx = this.engine.ctx;
    if (!when || !ctx) return undefined;
    let base;
    if (ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp();
      base = ts.performanceTime + (when - ts.contextTime) * 1000;
    } else {
      base = performance.now() + (when - ctx.currentTime) * 1000;
    }
    return Math.max(performance.now(), base);
  }

  send(bytes, when) {
    if (!this.out) return;
    try {
      this.out.send(bytes, this.stamp(when));
    } catch {}
  }

  noteOn(note, vel, when, ch = this.channel) {
    if (note < 0 || note > 127) return;
    this.send([0x90 | ch, note, Math.max(1, Math.round(vel * 127))], when);
  }

  noteOff(note, when, ch = this.channel) {
    if (note < 0 || note > 127) return;
    this.send([0x80 | ch, note, 0], when);
  }

  clock(when) {
    this.send([0xf8], when);
  }

  startStop(start, when) {
    this.send([start ? 0xfa : 0xfc], when);
  }

  panic() {
    if (!this.out) return;
    for (let ch = 0; ch < 16; ch++) this.send([0xb0 | ch, 123, 0]);
  }
}
