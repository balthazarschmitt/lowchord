// Event-based 6-track looper. Records notes/drums as transport ticks, so loops stay
// in time when the tempo changes and cost nothing to store.

import { PPQ } from './clock.js';

export const N_TRACKS = 6;

export class Looper {
  constructor(clock, out, engine) {
    this.clock = clock;
    this.out = out;
    this.engine = engine;
    this.bars = 2;
    this.quantize = true;
    this.multiChannel = false;
    this.armed = 0;
    this.recording = false;
    this.tracks = Array.from({ length: N_TRACKS }, () => ({ events: [], muted: false, history: [], index: new Map() }));
    clock.subscribe((tick, time) => this.onTick(tick, time));
  }

  get len() {
    return this.bars * PPQ * 4;
  }

  hasContent() {
    return this.tracks.some((t) => t.events.length);
  }

  /** Transport position (float ticks, unwrapped) at an audio time. */
  posAt(time) {
    const c = this.clock;
    return c.pos(c.tick) + (time - c.nextTime) / c.tickDur;
  }

  toggleRecord() {
    if (this.recording) {
      this.recording = false;
      this.out.recorder = null;
      return;
    }
    if (!this.clock.running) this.clock.startTransport();
    const t = this.tracks[this.armed];
    t.history.push(t.events.slice());
    if (t.history.length > 10) t.history.shift();
    this.recording = true;
    this.out.recorder = this;
  }

  addEvent(ev) {
    const t = this.tracks[this.armed];
    t.events.push(ev);
    this.reindex(t);
  }

  q(pos) {
    const len = this.len;
    let p = this.quantize ? Math.round(pos / 6) * 6 : pos;
    return ((p % len) + len) % len;
  }

  recNoteOn(h, time) {
    const pos = this.posAt(time);
    h.rec = { looper: this, pos, time };
  }

  recNoteOff(h, time) {
    const r = h.rec;
    h.rec = null;
    const dur = Math.max(1, (time - r.time) / this.clock.tickDur);
    this.addEvent({ type: 'n', tick: this.q(r.pos), note: h.note, vel: h.vel, dur, skip: this.cycleOf(r.pos) });
  }

  recDrum(d, vel, time) {
    const pos = this.posAt(time);
    this.addEvent({ type: 'd', tick: this.q(pos), d, vel, skip: this.cycleOf(pos) });
  }

  /** Loop pass an event lands in (after quantizing), so it is not replayed during that pass. */
  cycleOf(pos) {
    const p = this.quantize ? Math.round(pos / 6) * 6 : pos;
    return Math.floor(p / this.len);
  }

  reindex(t) {
    t.index = new Map();
    for (const e of t.events) {
      const k = Math.floor(e.tick);
      if (!t.index.has(k)) t.index.set(k, []);
      t.index.get(k).push(e);
    }
  }

  onTick(tick, time) {
    if (!this.clock.running) return;
    const raw = this.clock.pos(tick);
    const len = this.len;
    const pos = ((raw % len) + len) % len;
    const cycle = Math.floor(raw / len);
    const td = this.clock.tickDur;
    this.tracks.forEach((t, ti) => {
      if (t.muted) return;
      const list = t.index.get(pos);
      if (!list) return;
      for (const e of list) {
        // Don't replay an event in the same pass it was recorded in (it was just played live).
        if (e.skip === cycle) continue;
        const when = time + (e.tick - pos) * td;
        if (e.type === 'd') this.out.drum(e.d, e.vel, { when, src: 'loop' });
        else {
          const ch = this.multiChannel ? ti : undefined;
          const h = this.out.noteOn(e.note, e.vel, { when, src: 'loop', ch });
          this.out.noteOff(h, when + e.dur * td);
        }
      }
    });
  }

  undo(i) {
    const t = this.tracks[i];
    if (!t.history.length) return;
    t.events = t.history.pop();
    this.reindex(t);
  }

  clearTrack(i) {
    const t = this.tracks[i];
    t.history.push(t.events);
    t.events = [];
    this.reindex(t);
    this.out.stopSrc('loop');
  }

  clearAll() {
    for (let i = 0; i < N_TRACKS; i++) this.clearTrack(i);
  }

  setBars(b) {
    if (this.hasContent()) return false;
    this.bars = b;
    return true;
  }
}
