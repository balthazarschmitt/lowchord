// Canvas "OLED" screen. Redraws on animation frames only while something is changing.

import { SCALES, noteName, DIR_LABELS } from '../theory.js';
import { MODES, SEQ_STEPS } from '../modes.js';
import { N_TRACKS } from '../looper.js';
import { PPQ } from '../clock.js';

const FONT = '"SF Mono", "Roboto Mono", ui-monospace, Menlo, Consolas, monospace';

export class Display {
  constructor(canvas, app) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.app = app;
    this.dirty = true;
    this.w = 0;
    this.h = 0;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    const loop = () => {
      if (this.dirty || this.animating()) this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.c.width = Math.max(1, Math.round(r.width * dpr));
    this.c.height = Math.max(1, Math.round(r.height * dpr));
    this.w = r.width;
    this.h = r.height;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(this.c);
    this.colors = {
      fg: css.getPropertyValue('--oled').trim() || '#9fe8ff',
      dim: css.getPropertyValue('--oled-dim').trim() || '#3b6b7a',
      hot: css.getPropertyValue('--oled-hot').trim() || '#ff6b6b',
    };
    this.dirty = true;
  }

  animating() {
    const { perf, clock, ui } = this.app;
    return (
      clock.running ||
      !!perf.hero ||
      (perf.flash && performance.now() < perf.flash.until + 50) ||
      ui.panel === 'mic' ||
      !!perf.arp ||
      this.app.looper.recording
    );
  }

  text(s, x, y, size, color, align = 'left', weight = 600) {
    const g = this.g;
    g.font = `${weight} ${size}px ${FONT}`;
    g.fillStyle = color;
    g.textAlign = align;
    g.fillText(s, x, y);
  }

  draw() {
    this.dirty = false;
    const { g, w, h } = this;
    const { S, perf, clock, looper, engine } = this.app;
    const { fg, dim, hot } = this.colors;
    g.clearRect(0, 0, w, h);
    g.textBaseline = 'alphabetic';
    const pad = 10;
    const small = Math.max(10, Math.min(13, h / 12));

    // Header: key/scale, mode, tempo
    const keyName = noteName(S.key, S.key) + ' ' + SCALES[S.scale].name;
    this.text(keyName, pad, pad + small, small, fg);
    const mode = MODES.find((m) => m.id === S.mode);
    this.text(mode ? mode.name.toUpperCase() : '', w / 2, pad + small, small, fg, 'center');
    this.text(`${Math.round(S.bpm)} BPM`, w - pad, pad + small, small, fg, 'right');

    // Beat dots
    if (clock.running) {
      const pos = clock.displayPos();
      const beat = Math.floor(pos / PPQ) % 4;
      for (let i = 0; i < 4; i++) {
        g.fillStyle = i === beat ? (i === 0 ? hot : fg) : dim;
        g.fillRect(w - pad - 8 - (3 - i) * 9, pad + small + 5, 6, 3);
      }
    }

    const midY = h * 0.56;
    if (S.mode === 'hero' && perf.hero) this.drawHero(midY, fg, dim, hot);
    else if (S.mode === 'ear' && perf.ear) this.drawEar(midY, fg, dim, hot);
    else this.drawChord(midY, fg, dim);

    if (S.mode === 'seq') this.drawSeq(h - pad - small * 2.6, fg, dim, hot);

    // Flash message
    if (perf.flash && performance.now() < perf.flash.until) {
      this.text(perf.flash.text, w - pad, midY - h * 0.2, small * 1.1, hot, 'right', 700);
    }

    // Footer: joystick mode/dir, loop tracks, voices
    const fy = h - pad;
    const dirLabel = perf.joy === 'c' ? '·' : DIR_LABELS[S.joyMode][perf.joy];
    this.text(`${S.joyMode.slice(0, 3).toUpperCase()} ${dirLabel}  OCT ${S.octave >= 0 ? '+' : ''}${S.octave}`, pad, fy, small, fg);
    // Loop track boxes
    const bx = w / 2 - (N_TRACKS * 12) / 2;
    looper.tracks.forEach((t, i) => {
      const x = bx + i * 12;
      g.strokeStyle = i === looper.armed ? fg : dim;
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, fy - small + 2.5, 9, 9);
      if (t.events.length) {
        g.fillStyle = t.muted ? dim : looper.recording && i === looper.armed ? hot : fg;
        g.fillRect(x + 2, fy - small + 4, 6, 6);
      } else if (looper.recording && i === looper.armed) {
        g.fillStyle = hot;
        g.fillRect(x + 3, fy - small + 5, 4, 4);
      }
    });
    if (clock.running && looper.hasContent()) {
      const p = ((clock.displayPos() % looper.len) + looper.len) % looper.len;
      g.fillStyle = fg;
      g.fillRect(bx, fy + 2, (N_TRACKS * 12 - 3) * (p / looper.len), 2);
    }
    this.text(`${engine.meter.voices || 0}v`, w - pad, fy, small, dim, 'right');

    if (this.app.ui.panel === 'mic') {
      const lvl = Math.min(1, engine.meter.mic * 1.5);
      g.fillStyle = dim;
      g.fillRect(pad, h * 0.8, w - pad * 2, 4);
      g.fillStyle = lvl > 0.9 ? hot : fg;
      g.fillRect(pad, h * 0.8, (w - pad * 2) * lvl, 4);
      if (engine.meter.rec >= 0) this.text(`● REC ${engine.meter.rec.toFixed(1)}s`, w - pad, h * 0.8 - 6, small, hot, 'right');
    }
  }

  drawChord(midY, fg, dim) {
    const { w, h } = this;
    const { perf, S } = this.app;
    const cur = perf.active || perf.last;
    const big = Math.min(h * 0.34, w * 0.16);
    if (S.mode === 'drums') {
      this.text('DRUMS', w / 2, midY, big * 0.7, perf.active ? fg : dim, 'center', 700);
      return;
    }
    if (!cur) {
      this.text('LowChord', w / 2, midY, big * 0.7, dim, 'center', 700);
      return;
    }
    const name = cur.chord.name;
    const size = name.length > 8 ? big * 0.6 : name.length > 5 ? big * 0.8 : big;
    this.text(name, w / 2, midY, size, perf.active ? fg : dim, 'center', 700);
    this.text(cur.chord.numeral, w / 2, midY + big * 0.5, big * 0.32, dim, 'center');
  }

  drawSeq(y, fg, dim, hot) {
    const { w } = this;
    const sq = this.app.perf.seq;
    const cw = (w - 20) / SEQ_STEPS;
    for (let i = 0; i < SEQ_STEPS; i++) {
      const s = sq.steps[i];
      const x = 10 + i * cw;
      this.g.fillStyle = i === sq.playStep ? hot : s ? (s.rest ? dim : fg) : 'transparent';
      this.g.strokeStyle = !this.app.clock.running && i === sq.cursor && sq.rec ? hot : dim;
      this.g.lineWidth = 1;
      this.g.strokeRect(x + 1.5, y + 0.5, cw - 3, 8);
      if (s || i === sq.playStep) this.g.fillRect(x + 3, y + 2, cw - 6, 5);
    }
  }

  drawHero(midY, fg, dim, hot) {
    const { w, h, g } = this;
    const { perf, engine, S } = this.app;
    perf.heroUpdate();
    const hero = perf.hero;
    const now = engine.now;
    const hitX = w * 0.2;
    const pxPerSec = w * 0.32;
    const laneY = midY - 10;
    g.strokeStyle = dim;
    g.beginPath();
    g.moveTo(10, laneY + 0.5);
    g.lineTo(w - 10, laneY + 0.5);
    g.stroke();
    g.fillStyle = fg;
    g.fillRect(hitX - 1, laneY - 26, 2, 52);
    const small = Math.max(11, h / 10);
    for (const n of hero.notes) {
      const x = hitX + (n.t - now) * pxPerSec;
      if (x < -40 || x > w + 40) continue;
      const label = perf.chordFor(n.deg, 'c').numeral;
      const col = n.hit === 'miss' ? hot : n.hit ? dim : fg;
      g.strokeStyle = col;
      g.strokeRect(x - 18, laneY - 16, 36, 32);
      this.text(label, x, laneY + 6, small, col, 'center', 700);
    }
    this.text(`${hero.score}`, 10, h * 0.32, small, fg);
    this.text(`x${Math.min(4, 1 + Math.floor(hero.combo / 4))} combo ${hero.combo}`, w - 10, h * 0.32, small * 0.85, dim, 'right');
    if (hero.done) {
      const hits = hero.notes.filter((n) => n.hit !== 'miss').length;
      this.text(`DONE ${Math.round((100 * hits) / hero.notes.length)}%  best ${hero.best}`, w / 2, laneY + 46, small, fg, 'center', 700);
      this.text('Tap MODE ▸ Chord Hero to replay', w / 2, laneY + 46 + small * 1.3, small * 0.8, dim, 'center');
    } else if (hero.notes[0].t > now) {
      const beats = Math.ceil((hero.notes[0].t - now) / (60 / S.bpm));
      this.text(`get ready ${beats}`, w / 2, laneY + 46, small, dim, 'center');
    }
  }

  drawEar(midY, fg, dim, hot) {
    const { w, h } = this;
    const e = this.app.perf.ear;
    const big = Math.min(h * 0.3, w * 0.14);
    const small = Math.max(11, h / 11);
    if (e.state === 'correct') {
      const name = this.app.perf.chordFor(e.q, 'c');
      this.text(`${name.numeral}  ${name.name}`, w / 2, midY, big, fg, 'center', 700);
      this.text('correct', w / 2, midY + big * 0.6, small, dim, 'center');
    } else {
      this.text('?', w / 2, midY, big, fg, 'center', 700);
      const tried = [...e.wrong].map((d) => this.app.perf.chordFor(d, 'c').numeral).join(' ');
      this.text(tried ? `not ${tried}` : 'which chord?', w / 2, midY + big * 0.6, small, tried ? hot : dim, 'center');
    }
    this.text(`score ${e.score}/${e.rounds}  streak ${e.streak}`, w / 2, h * 0.3, small, dim, 'center');
  }
}
