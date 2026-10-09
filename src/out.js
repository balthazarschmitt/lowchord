// Single place every note goes through: synth engine, MIDI out and looper recording.

import { DRUM_MIDI } from './drums.js';

export class Out {
  constructor(engine, midi) {
    this.engine = engine;
    this.midi = midi;
    this.recorder = null; // Looper while recording
    this.pending = new Map(); // id -> handle with a scheduled future note-off
    this.onNote = null; // UI hook (note, on)
  }

  noteOn(note, vel = 0.8, { when = 0, glide = -1, src = 'live', ch } = {}) {
    const id = this.engine.noteOn(note, vel, when, glide, src);
    const h = { id, note, vel, src, ch: ch ?? this.midi.channel, rec: null, offAt: Infinity };
    this.midi.noteOn(note, vel, when, h.ch);
    if (src === 'live' && this.recorder) this.recorder.recNoteOn(h, when || this.engine.now);
    return h;
  }

  /**
   * Slide an existing note's voice to a new pitch. The old handle is retired without a
   * note-off to the synth; MIDI and the looper see a normal off/on pair.
   */
  legato(old, note, vel, glideTime, restrike = true) {
    const id = this.engine.legato(old.id, note, vel, glideTime, restrike, old.src);
    const h = { id, note, vel, src: old.src, ch: old.ch, rec: null, offAt: Infinity };
    old.off = true;
    this.midi.noteOff(old.note, 0, old.ch);
    this.midi.noteOn(note, vel, 0, h.ch);
    if (old.rec) old.rec.looper.recNoteOff(old, this.engine.now);
    if (h.src === 'live' && this.recorder) this.recorder.recNoteOn(h, this.engine.now);
    return h;
  }

  noteOff(h, when = 0) {
    if (!h || h.off) return;
    h.off = true;
    this.engine.noteOff(h.id, when, h.src);
    this.midi.noteOff(h.note, when, h.ch);
    if (h.rec) h.rec.looper.recNoteOff(h, when || this.engine.now);
    if (when > this.engine.now) {
      h.offAt = when;
      this.pending.set(h.id, h);
    }
  }

  /** Note with a fixed duration (seconds). */
  play(note, vel, dur, opts = {}) {
    const start = opts.when || this.engine.now;
    const h = this.noteOn(note, vel, { ...opts, when: opts.when || 0 });
    this.noteOff(h, start + dur);
    return h;
  }

  drum(d, vel = 0.9, { when = 0, src = 'live' } = {}) {
    this.engine.drum(d, vel, when, src);
    this.midi.noteOn(DRUM_MIDI[d], vel, when, 9);
    this.midi.noteOff(DRUM_MIDI[d], (when || this.engine.now) + 0.05, 9);
    if (src === 'live' && this.recorder) this.recorder.recDrum(d, vel, when || this.engine.now);
  }

  /** Stop everything a source scheduled (loop, beat, sequencer...) without leaving hung notes. */
  stopSrc(src) {
    this.engine.cancel(src);
    const now = this.engine.now;
    for (const [id, h] of this.pending) {
      if (h.offAt <= now) this.pending.delete(id);
      else if (h.src === src) {
        this.engine.noteOff(h.id, 0, src);
        this.midi.noteOff(h.note, 0, h.ch);
        this.pending.delete(id);
      }
    }
  }

  prune() {
    const now = this.engine.now;
    for (const [id, h] of this.pending) if (h.offAt <= now) this.pending.delete(id);
  }

  panic() {
    this.engine.allOff();
    this.pending.clear();
    this.midi.panic();
  }
}
