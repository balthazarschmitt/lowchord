// Play modes: turns pad/joystick input into notes. Also owns the beat player,
// the chord sequencer, Chord Hero and the Ear Trainer.

import { buildChord, voiceChord, glideSources, pairVoices, scaleNote, closeVoicing, PROGRESSIONS, mod12 } from './theory.js';
import { TICKS, PPQ } from './clock.js';
import { PATTERNS, DRUMS } from './drums.js';

export const MODES = [
  { id: 'play', name: 'Play', help: 'Hold a pad to play its chord' },
  { id: 'strum', name: 'Strum', help: 'Pads strum the chord; swipe the strip too' },
  { id: 'lead', name: 'Lead', help: 'One scale note per pad. Joystick ↑↓ octave, ←→ semitone' },
  { id: 'drone', name: 'Drone', help: 'Tap a pad to hold its chord; tap again to stop' },
  { id: 'arp', name: 'Arpeggio', help: 'Hold a pad to arpeggiate' },
  { id: 'repeat', name: 'Repeat', help: 'Hold a pad to retrigger in time' },
  { id: 'seq', name: 'Sequencer', help: '▶ to play. REC + pads to write steps' },
  { id: 'drums', name: 'Drums', help: 'Pads play drums' },
  { id: 'hero', name: 'Chord Hero', help: 'Hit the pad as each chord reaches the line' },
  { id: 'ear', name: 'Ear Trainer', help: 'Name the chord by ear' },
];

export const ARP_PATTERNS = ['up', 'down', 'updown', 'converge', 'random'];
export const SEQ_STEPS = 16;

export class Performer {
  constructor({ S, out, clock, engine, onChange }) {
    this.S = S;
    this.out = out;
    this.clock = clock;
    this.engine = engine;
    this.onChange = onChange || (() => {});
    this.held = [];
    this.joy = 'c';
    this.active = null; // { deg, dir, chord, notes }
    this.last = null; // last chord shown/played (for the strum strip)
    this.handles = [];
    this.tail = null; // last released chord, still ringing: { handles, t }
    this.prevVoicing = null;
    this.leadHandles = new Map();
    this.arp = null;
    this.rep = null;
    this.flash = null; // { text, until }
    this.seq = { steps: new Array(SEQ_STEPS).fill(null), rec: false, cursor: 0, playStep: -1, handles: [], prev: null };
    this.hero = null;
    this.ear = null;
    this.beatStep = -1;
    clock.subscribe((tick, time) => this.onTick(tick, time));
  }

  get mode() {
    return this.S.mode;
  }

  setMode(id) {
    this.stopAll();
    this.S.mode = id;
    if (id === 'hero') this.heroStart();
    else this.hero = null;
    if (id === 'ear') this.earStart();
    else this.ear = null;
    this.onChange();
  }

  stopAll() {
    this.releaseChord(true);
    for (const h of this.leadHandles.values()) this.out.noteOff(h);
    this.leadHandles.clear();
    this.out.stopSrc('auto');
    this.held = [];
  }

  chordFor(deg, dir = this.joy) {
    return buildChord(this.S, deg, dir);
  }

  // ---------- Input ----------

  padDown(deg) {
    const m = this.mode;
    if (m === 'drums') {
      this.out.drum(deg, 0.95);
      this.flashText(DRUMS[deg]);
      return;
    }
    if (m === 'lead') {
      const note = this.leadNote(deg);
      const old = this.leadHandles.get(deg);
      if (old) this.out.noteOff(old);
      this.leadHandles.set(deg, this.out.noteOn(note, 0.85));
      this.last = { deg, dir: 'c', chord: this.chordFor(deg, 'c') };
      this.flashText(noteLabel(note, this.S.key));
      return;
    }
    if (m === 'hero' && this.hero) this.heroPress(deg);
    if (m === 'ear' && this.ear) this.earAnswer(deg);
    if (m === 'seq' && this.seq.rec) this.seqWrite(deg);
    if (m === 'drone' && this.active && this.active.deg === deg && this.active.dir === this.joy) {
      this.releaseChord();
      this.onChange();
      return;
    }
    this.held = this.held.filter((d) => d !== deg);
    this.held.push(deg);
    this.setChord(deg);
  }

  padUp(deg) {
    const m = this.mode;
    if (m === 'drums') return;
    if (m === 'lead') {
      const h = this.leadHandles.get(deg);
      if (h) this.out.noteOff(h);
      this.leadHandles.delete(deg);
      return;
    }
    const wasTop = this.held[this.held.length - 1] === deg;
    this.held = this.held.filter((d) => d !== deg);
    if (m === 'drone') return;
    const latched = this.S.latch || (m === 'arp' && this.S.arpLatch);
    if (!this.held.length) {
      if (!latched) this.releaseChord();
    } else if (wasTop) this.setChord(this.held[this.held.length - 1]);
    this.onChange();
  }

  setJoy(dir) {
    if (dir === this.joy) return;
    this.joy = dir;
    if (this.mode !== 'lead' && this.mode !== 'drums' && this.active && (this.held.length || this.mode === 'drone' || this.S.latch || this.arp)) {
      this.setChord(this.active.deg);
    }
    this.onChange();
  }

  leadNote(deg) {
    const oct = this.joy === 'u' ? 1 : this.joy === 'd' ? -1 : 0;
    const semi = this.joy === 'r' ? 1 : this.joy === 'l' ? -1 : 0;
    return scaleNote(this.S, deg, oct) + semi;
  }

  /** Strum strip: zone i of n plays one chord tone, laddered up ~2.5 octaves. */
  strum(i, n) {
    const src = this.active || this.last || { chord: this.chordFor(0, 'c') };
    const chord = src.chord;
    const lo = 48 + 12 * this.S.octave;
    const pcs = new Set(chord.intervals.map((x) => mod12(chord.rootPc + x)));
    const ladder = [];
    for (let m = lo; m < lo + 31; m++) if (pcs.has(mod12(m))) ladder.push(m);
    const note = ladder[Math.min(ladder.length - 1, Math.floor((i / n) * ladder.length))];
    this.out.play(note, 0.75, 0.12);
  }

  // ---------- Chords ----------

  setChord(deg) {
    const S = this.S;
    const chord = this.chordFor(deg);
    const notes = voiceChord(chord, S, this.prevVoicing);
    const glide = glideSources(notes, this.prevVoicing);
    const from = this.prevVoicing;
    this.active = { deg, dir: this.joy, chord, notes };
    this.last = this.active;
    this.prevVoicing = notes;
    const m = this.mode;
    if (m === 'arp') {
      this.stopHandles();
      this.arpSet(notes);
    } else if (m === 'repeat') {
      this.stopHandles();
      this.repeatStart(notes);
    } else if (m !== 'strum' && S.chordGlide > 0) {
      this.legatoTo(notes, from);
    } else {
      this.stopHandles();
      const now = this.engine.now;
      const spread = m === 'strum' ? S.strumSpeed : 0;
      const vel = 0.8;
      this.handles = notes.map((n, i) =>
        this.out.noteOn(n, vel, { when: spread ? now + i * spread : 0, glide: glide[i] ?? -1 }),
      );
    }
    if (S.haptics && navigator.vibrate) navigator.vibrate(8);
    this.onChange();
  }

  stopHandles() {
    if (this.handles.length) this.tail = { handles: this.handles, t: this.engine.now };
    for (const h of this.handles) this.out.noteOff(h);
    this.handles = [];
  }

  /**
   * Move the sounding chord to `notes` by sliding each voice to its nearest new note
   * (no retrigger), like the HiChord. Works from a held chord or one still ringing out.
   */
  legatoTo(notes, from) {
    const S = this.S;
    let prev = this.handles;
    if (!prev.length && this.tail && this.engine.now - this.tail.t < S.sound.release + 0.05) prev = this.tail.handles;
    prev = prev.slice().sort((a, b) => a.note - b.note);
    const pairs = pairVoices(notes, prev.map((h) => h.note));
    // Notes with no sounding voice still slide in from the last chord's pitches,
    // even after a pause (portamento always on, like a mono synth's "always" mode).
    const fromPairs = from && from.length ? pairVoices(notes, from) : null;
    const fromNearest = glideSources(notes, from);
    const used = new Set();
    const vel = 0.8;
    const next = notes.map((n, i) => {
      const j = pairs[i];
      if (j < 0) {
        const src = fromPairs && fromPairs[i] >= 0 ? from[fromPairs[i]] : fromNearest[i];
        return this.out.noteOn(n, vel, { glide: src ?? -1, glideTime: S.chordGlide });
      }
      used.add(j);
      return this.out.legato(prev[j], n, vel, S.chordGlide, S.restrike);
    });
    prev.forEach((h, j) => { if (!used.has(j)) this.out.noteOff(h); });
    this.handles = next;
    this.tail = null;
  }

  releaseChord(silent) {
    this.stopHandles();
    if (this.arp) { this.arp = null; this.out.stopSrc('auto'); }
    if (this.rep) { this.rep = null; this.out.stopSrc('auto'); }
    this.active = null;
    if (!silent) this.onChange();
  }

  /** First grid tick that is at least half a step in the future. */
  nextGrid(rate) {
    const c = this.clock;
    let g = Math.ceil(c.tick / rate) * rate;
    if (c.timeOfTick(g) - this.engine.now < rate * c.tickDur * 0.5) g += rate;
    return g;
  }

  // ---------- Arpeggio ----------

  arpSet(notes) {
    const S = this.S;
    const seq = [];
    for (let o = 0; o < S.arpOct; o++) for (const n of notes) seq.push(n + 12 * o);
    let order = seq;
    switch (S.arpPattern) {
      case 'down': order = seq.slice().reverse(); break;
      case 'updown': order = seq.concat(seq.slice(1, -1).reverse()); break;
      case 'converge': {
        order = [];
        let a = 0, b = seq.length - 1;
        while (a <= b) { order.push(seq[a++]); if (a <= b) order.push(seq[b--]); }
        break;
      }
    }
    const rate = TICKS[S.arpRate] || 6;
    if (!this.arp) {
      // Sound the first note immediately, then continue on the grid.
      this.arp = { order, i: 1, rate, next: this.nextGrid(rate) };
      this.arpNote(order[0], 0, rate);
    } else {
      this.arp.order = order;
      this.arp.rate = rate;
    }
  }

  arpNote(note, when, rate) {
    const dur = rate * this.clock.tickDur * this.S.arpGate;
    const start = when || this.engine.now;
    const h = this.out.noteOn(note, 0.8, { when, src: 'auto' });
    this.out.noteOff(h, start + dur);
  }

  // ---------- Repeat ----------

  repeatStart(notes) {
    const rate = TICKS[this.S.repeatRate] || 12;
    if (!this.rep) {
      this.rep = { notes, rate, next: this.nextGrid(rate) };
      this.repeatHit(notes, 0, rate);
    } else {
      this.rep.notes = notes;
      this.rep.rate = rate;
    }
  }

  repeatHit(notes, when, rate) {
    const dur = rate * this.clock.tickDur * 0.6;
    const start = when || this.engine.now;
    for (const n of notes) {
      const h = this.out.noteOn(n, 0.75, { when, src: 'auto' });
      this.out.noteOff(h, start + dur);
    }
  }

  // ---------- Sequencer ----------

  seqStepAt(time) {
    const rate = TICKS[this.S.seqRate] || 24;
    const c = this.clock;
    const pos = c.pos(c.tick) + (time - c.nextTime) / c.tickDur;
    return ((Math.round(pos / rate) % SEQ_STEPS) + SEQ_STEPS) % SEQ_STEPS;
  }

  seqWrite(deg) {
    const sq = this.seq;
    const step = this.clock.running ? this.seqStepAt(this.engine.now) : sq.cursor;
    sq.steps[step] = { deg, dir: this.joy };
    if (!this.clock.running) sq.cursor = (sq.cursor + 1) % SEQ_STEPS;
  }

  seqRest() {
    const sq = this.seq;
    sq.steps[sq.cursor] = { rest: true };
    sq.cursor = (sq.cursor + 1) % SEQ_STEPS;
    this.onChange();
  }

  seqClear() {
    this.seq.steps.fill(null);
    this.seq.cursor = 0;
    this.onChange();
  }

  seqTick(tick, time) {
    const rate = TICKS[this.S.seqRate] || 24;
    const pos = this.clock.pos(tick);
    if (pos % rate !== 0) return;
    const sq = this.seq;
    const step = (pos / rate) % SEQ_STEPS;
    sq.playStep = step;
    const s = sq.steps[step];
    if (!s) return; // empty = tie (keep holding)
    for (const h of sq.handles) this.out.noteOff(h, time);
    sq.handles = [];
    if (s.rest) return;
    const chord = buildChord(this.S, s.deg, s.dir);
    const notes = voiceChord(chord, this.S, sq.prev);
    sq.prev = notes;
    sq.handles = notes.map((n) => this.out.noteOn(n, 0.75, { when: time, src: 'seq' }));
    sq.lastChord = chord;
  }

  seqStop() {
    for (const h of this.seq.handles) this.out.noteOff(h);
    this.seq.handles = [];
    this.seq.playStep = -1;
    this.out.stopSrc('seq');
  }

  // ---------- Clock ----------

  onTick(tick, time) {
    const S = this.S;
    if (this.arp && tick >= this.arp.next && (tick - this.arp.next) % this.arp.rate === 0) {
      const a = this.arp;
      const note = S.arpPattern === 'random' ? a.order[(Math.random() * a.order.length) | 0] : a.order[a.i++ % a.order.length];
      this.arpNote(note, time, a.rate);
    }
    if (this.rep && tick >= this.rep.next && (tick - this.rep.next) % this.rep.rate === 0) {
      this.repeatHit(this.rep.notes, time, this.rep.rate);
    }
    if (!this.clock.running) return;
    const pos = this.clock.pos(tick);
    if (S.beatOn && pos % 6 === 0) {
      const step = (pos / 6) % 16;
      this.beatStep = step;
      const pat = PATTERNS[S.beatPattern] || PATTERNS[0];
      for (const [d, v] of pat.steps[step]) this.out.drum(d, v, { when: time, src: 'beat' });
    }
    if (S.mode === 'seq') this.seqTick(tick, time);
  }

  // ---------- Chord Hero ----------

  heroStart() {
    const S = this.S;
    const prog = [];
    while (prog.length < 16) prog.push(...PROGRESSIONS[(Math.random() * PROGRESSIONS.length) | 0]);
    const c = this.clock;
    if (!c.running) c.startTransport();
    if (!S.beatOn) { S.beatOn = true; this.heroBeat = true; }
    const bar = PPQ * 4;
    const nextBar = c.startTick + Math.ceil((c.tick - c.startTick) / bar) * bar + bar;
    const t0 = c.timeOfTick(nextBar);
    const beat = 60 / S.bpm;
    this.hero = {
      notes: prog.slice(0, 16).map((deg, i) => ({ deg, t: t0 + i * 2 * beat, hit: null })),
      score: 0, combo: 0, best: 0, done: false, judged: 0,
    };
  }

  heroPress(deg) {
    const h = this.hero;
    const now = this.engine.now - this.engine.latencyMs / 2000;
    let best = null;
    for (const n of h.notes) {
      if (n.hit) continue;
      const dt = Math.abs(n.t - now);
      if (dt < 0.35 && (!best || dt < Math.abs(best.t - now))) best = n;
    }
    if (!best) return;
    const dt = Math.abs(best.t - now);
    if (best.deg !== deg) { h.combo = 0; this.flashText('WRONG'); return; }
    best.hit = dt < 0.1 ? 'perfect' : dt < 0.22 ? 'good' : 'late';
    h.combo++;
    h.best = Math.max(h.best, h.combo);
    h.score += (best.hit === 'perfect' ? 100 : best.hit === 'good' ? 60 : 25) * Math.min(4, 1 + Math.floor(h.combo / 4));
    this.flashText(best.hit.toUpperCase());
  }

  heroUpdate() {
    const h = this.hero;
    if (!h || h.done) return;
    const now = this.engine.now;
    let judged = 0;
    for (const n of h.notes) {
      if (!n.hit && now - n.t > 0.35) { n.hit = 'miss'; h.combo = 0; }
      if (n.hit) judged++;
    }
    if (judged === h.notes.length) {
      h.done = true;
      if (this.heroBeat) { this.S.beatOn = false; this.heroBeat = false; }
    }
  }

  // ---------- Ear Trainer ----------

  earStart() {
    this.ear = { score: 0, streak: 0, rounds: 0, q: -1, state: 'idle', wrong: new Set() };
    this.earRound();
  }

  playChordAt(deg, when, dur, vel = 0.7) {
    const chord = buildChord(this.S, deg, 'c');
    for (const n of closeVoicing(chord.rootPc, chord.intervals, 62 + 12 * this.S.octave)) {
      const h = this.out.noteOn(n, vel, { when, src: 'auto' });
      this.out.noteOff(h, when + dur);
    }
  }

  earRound() {
    const e = this.ear;
    let q;
    do q = (Math.random() * 7) | 0; while (q === e.q);
    e.q = q;
    e.wrong = new Set();
    e.state = 'listen';
    const t = this.engine.now + 0.1;
    [0, 3, 4, 0].forEach((d, i) => this.playChordAt(d, t + i * 0.45, 0.4, 0.55));
    this.playChordAt(q, t + 2.1, 1.2, 0.8);
    this.onChange();
  }

  earReplay() {
    if (this.ear) this.playChordAt(this.ear.q, this.engine.now + 0.02, 1.2, 0.8);
  }

  earAnswer(deg) {
    const e = this.ear;
    if (e.state !== 'listen') return;
    if (deg === e.q) {
      e.rounds++;
      if (!e.wrong.size) { e.score++; e.streak++; } else e.streak = 0;
      e.state = 'correct';
      setTimeout(() => this.ear === e && this.earRound(), 1400);
    } else {
      e.wrong.add(deg);
      e.streak = 0;
    }
  }

  flashText(text) {
    this.flash = { text, until: performance.now() + 700 };
    this.onChange();
  }
}

function noteLabel(m, key) {
  const names = [1, 3, 5, 6, 8, 10].includes(mod12(key))
    ? ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
    : ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return names[mod12(m)] + (Math.floor(m / 12) - 1);
}
