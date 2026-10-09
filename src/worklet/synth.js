// LowChord audio engine. Runs entirely on the audio thread.
// Everything is preallocated in the constructor: process() never allocates.

const TWO_PI = Math.PI * 2;
const MAX_VOICES = 12;
const MAX_DRUMS = 10;
const KS_LEN = 4096;
const QUEUE = 2048;
const N_BANDS = 16;

function polyBlep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

// Coefficient for a one-pole approach to a target in roughly `sec` seconds.
function coef(sec, sr) {
  return sec <= 0.0005 ? 1 : 1 - Math.exp(-1 / (sec * sr * 0.2));
}

class Svf {
  constructor() { this.ic1 = 0; this.ic2 = 0; this.a1 = 0; this.a2 = 0; this.a3 = 0; this.k = 2; this.bp = 0; this.hp = 0; }
  set(fc, q, sr) {
    const f = Math.min(fc, sr * 0.45);
    const g = Math.tan((Math.PI * f) / sr);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  // Returns lowpass; band/high stored on the instance for callers that need them.
  tick(v0) {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.bp = v1;
    this.hp = v0 - this.k * v1 - v2;
    return v2;
  }
  reset() { this.ic1 = 0; this.ic2 = 0; }
}

class Voice {
  constructor() {
    this.active = false;
    this.id = -1;
    this.note = 60;
    this.freq = 261.6;
    this.target = 261.6;
    this.vel = 1;
    this.age = 0;
    this.stage = 0; // 0 off, 1 attack, 2 decay/sustain, 3 release
    this.env = 0;
    this.fenv = 0;
    this.fstage = 0;
    this.phases = new Float64Array(7);
    this.sub = 0;
    this.mod = 0;
    this.filt = new Svf();
    this.ks = new Float32Array(KS_LEN);
    this.ksLen = 0;
    this.ksIdx = 0;
    this.ksLast = 0;
    this.spos = 0;
    this.wait = 0;
    this.offWait = -1;
    this.gl = 0.7;
    this.gr = 0.7;
  }
}

class Drum {
  constructor() {
    this.active = false;
    this.type = 0;
    this.t = 0;
    this.vel = 1;
    this.phase = 0;
    this.wait = 0;
    this.f1 = new Svf();
    this.f2 = new Svf();
  }
}

class DelayLine {
  constructor(n) { this.buf = new Float32Array(n); this.n = n; this.w = 0; }
  write(x) { this.buf[this.w] = x; this.w = (this.w + 1) % this.n; }
  read(d) {
    let r = this.w - d;
    while (r < 0) r += this.n;
    const i = Math.floor(r);
    const f = r - i;
    const a = this.buf[i % this.n];
    const b = this.buf[(i + 1) % this.n];
    return a + (b - a) * f;
  }
  readInt(d) { let r = this.w - d; if (r < 0) r += this.n; return this.buf[r]; }
}

// Drum kits: [kickF0, kickF1, kickDecay, kickClick, snareTone, snareDecay, hatDecay, ohDecay, tomF, crush]
const KITS = [
  [48, 170, 0.45, 0.25, 185, 0.14, 0.04, 0.35, 110, 0],
  [58, 260, 0.28, 0.6, 210, 0.11, 0.03, 0.25, 140, 0],
  [52, 150, 0.35, 0.2, 170, 0.12, 0.05, 0.3, 100, 1],
];

class LowChordProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const sr = sampleRate;
    this.sr = sr;
    this.voices = [];
    for (let i = 0; i < MAX_VOICES; i++) this.voices.push(new Voice());
    this.drums = [];
    for (let i = 0; i < MAX_DRUMS; i++) this.drums.push(new Drum());
    this.queue = new Array(QUEUE).fill(null);
    this.qn = 0;
    this.ageCounter = 0;
    this.rng = 22222;

    this.P = {
      wave: 2, detune: 0.3, sub: 0, pw: 0.5,
      attack: 0.005, decay: 0.3, sustain: 0.7, release: 0.35,
      cutoff: 4000, reso: 0.15, fenv: 1.5, fdecay: 0.4, keytrack: 0.4,
      lfoRate: 5, lfoDepth: 0, lfoTarget: 0,
      glide: 0, synthVol: 0.8, volume: 0.8, drumVol: 0.8, drumKit: 0,
      chorus: 0, chorusMode: 0, trem: 0, tremRate: 5,
      delayTime: 0.375, delayFb: 0.35, delayMix: 0, revMix: 0.15, revSize: 0.6,
      bass: 0, drive: 0, vocoder: 0, vocMix: 1, micMon: 0, pluckDamp: 0.5,
    };
    this.cA = this.cD = this.cR = this.cFD = this.cGlide = 0;
    this.updateCoefs();

    // Mix buses
    this.bL = new Float32Array(128);
    this.bR = new Float32Array(128);
    this.dL = new Float32Array(128);
    this.mono = new Float32Array(128);

    // FX state
    this.lfoPhase = 0;
    this.tremPhase = 0;
    this.chPhase = 0;
    this.chL = new DelayLine(4096);
    this.chR = new DelayLine(4096);
    this.chFbL = 0;
    this.chFbR = 0;
    const maxDelay = Math.ceil(sr * 2.1);
    this.dlL = new DelayLine(maxDelay);
    this.dlR = new DelayLine(maxDelay);
    this.dTime = this.P.delayTime * sr;
    this.dDampL = 0;
    this.dDampR = 0;
    const scale = sr / 44100;
    this.fdn = [1557, 1617, 1491, 1422].map((n) => new DelayLine(Math.round(n * scale) + 1));
    this.fdnLen = [1557, 1617, 1491, 1422].map((n) => Math.round(n * scale));
    this.fdnDamp = new Float64Array(4);
    this.ap = [225, 556, 441].map((n) => new DelayLine(Math.round(n * scale) + 1));
    this.apLen = [225, 556, 441].map((n) => Math.round(n * scale));
    this.shelf = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, x1L: 0, x2L: 0, y1L: 0, y2L: 0, x1R: 0, x2R: 0, y1R: 0, y2R: 0 };
    this.updateShelf();
    this.limGain = 1;
    this.crushHold = 0;
    this.crushCount = 0;
    this.drumLp = new Svf();
    this.drumLp.set(3500, 0.7, sr);

    // Vocoder
    this.vcCar = [];
    this.vcMod = [];
    this.vcEnv = new Float64Array(N_BANDS);
    for (let b = 0; b < N_BANDS; b++) {
      const f = 110 * Math.pow(7500 / 110, b / (N_BANDS - 1));
      const c = new Svf();
      const m = new Svf();
      c.set(f, 6, sr);
      m.set(f, 6, sr);
      this.vcCar.push(c);
      this.vcMod.push(m);
    }
    this.vcAtk = coef(0.003, sr);
    this.vcRel = coef(0.04, sr);

    // Sampler + mic
    this.sample = new Float32Array(1);
    this.sampleLen = 0;
    this.sampleRateRatio = 1;
    this.recBuf = new Float32Array(Math.ceil(sr * 6));
    this.recPos = 0;
    this.recording = false;
    this.micPeak = 0;
    this.meterCount = 0;

    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  rand() {
    // xorshift32 → [-1, 1)
    let x = this.rng;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.rng = x;
    return (x | 0) / 2147483648;
  }

  updateCoefs() {
    const P = this.P;
    const sr = this.sr;
    this.cA = P.attack <= 0.002 ? 1 : 1 / (P.attack * sr);
    this.cD = coef(P.decay, sr);
    this.cR = coef(P.release, sr);
    this.cFD = coef(P.fdecay, sr);
    this.cGlide = P.glide > 0 ? coef(P.glide, sr) : 1;
  }

  updateShelf() {
    // RBJ low shelf at 110 Hz
    const A = Math.pow(10, this.P.bass / 40);
    const w = (TWO_PI * 110) / this.sr;
    const cs = Math.cos(w);
    const sn = Math.sin(w);
    const alpha = (sn / 2) * Math.sqrt(2);
    const sa = 2 * Math.sqrt(A) * alpha;
    const a0 = A + 1 + (A - 1) * cs + sa;
    const s = this.shelf;
    s.b0 = (A * (A + 1 - (A - 1) * cs + sa)) / a0;
    s.b1 = (2 * A * (A - 1 - (A + 1) * cs)) / a0;
    s.b2 = (A * (A + 1 - (A - 1) * cs - sa)) / a0;
    s.a1 = (-2 * (A - 1 + (A + 1) * cs)) / a0;
    s.a2 = (A + 1 + (A - 1) * cs - sa) / a0;
  }

  onMessage(m) {
    switch (m.t) {
      case 'p':
        this.P[m.k] = m.v;
        this.paramChanged(m.k);
        break;
      case 'ps':
        for (const k in m.p) { this.P[k] = m.p[k]; this.paramChanged(k); }
        break;
      case 'on': case 'off': case 'drum':
        if (m.w && m.w > currentTime) {
          if (this.qn < QUEUE) this.queue[this.qn++] = m;
        } else this.exec(m, 0);
        break;
      case 'alloff':
        this.qn = 0;
        for (const v of this.voices) if (v.active) { v.stage = 3; v.fstage = 0; }
        break;
      case 'cancel':
        // Drop scheduled events from a source (e.g. stopped loop or beat)
        for (let i = 0; i < this.qn; i++) {
          if (this.queue[i].src === m.src) { this.queue[i] = this.queue[--this.qn]; i--; }
        }
        break;
      case 'rec':
        if (m.on) { this.recording = true; this.recPos = 0; } else this.finishRec();
        break;
      case 'sample':
        this.sample = m.buf;
        this.sampleLen = m.buf.length;
        this.sampleRateRatio = (m.rate || this.sr) / this.sr;
        break;
    }
  }

  paramChanged(k) {
    if (k === 'attack' || k === 'decay' || k === 'release' || k === 'fdecay' || k === 'glide') this.updateCoefs();
    else if (k === 'bass') this.updateShelf();
  }

  finishRec() {
    this.recording = false;
    const buf = this.recBuf;
    const n = this.recPos;
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(buf[i]));
    if (peak < 0.003) { this.port.postMessage({ t: 'recdone', empty: true }); return; }
    // Trim leading/trailing silence below 6% of the peak
    const thr = peak * 0.06;
    let s = 0;
    while (s < n && Math.abs(buf[s]) < thr) s++;
    let e = n - 1;
    while (e > s && Math.abs(buf[e]) < thr) e--;
    s = Math.max(0, s - Math.round(this.sr * 0.005));
    const len = Math.min(n, e + Math.round(this.sr * 0.05)) - s;
    const out = new Float32Array(len);
    const g = 0.9 / peak;
    for (let i = 0; i < len; i++) out[i] = buf[s + i] * g;
    // Short fades to avoid clicks
    const fade = Math.min(64, len >> 2);
    for (let i = 0; i < fade; i++) { out[i] *= i / fade; out[len - 1 - i] *= i / fade; }
    this.sample = out;
    this.sampleLen = len;
    this.sampleRateRatio = 1;
    this.port.postMessage({ t: 'recdone', buf: out.slice(), rate: this.sr });
  }

  exec(m, offset) {
    if (m.t === 'on') this.noteOn(m, offset);
    else if (m.t === 'off') this.noteOff(m.id, offset);
    else if (m.t === 'drum') this.drumOn(m.d, m.v, offset);
  }

  allocVoice() {
    let best = null;
    for (const v of this.voices) if (!v.active) return v;
    // Steal: quietest releasing voice, else the oldest
    for (const v of this.voices) if (v.stage === 3 && (!best || v.env < best.env)) best = v;
    if (best) return best;
    for (const v of this.voices) if (!best || v.age < best.age) best = v;
    return best;
  }

  noteOn(m, offset) {
    const v = this.allocVoice();
    const P = this.P;
    const wasActive = v.active;
    v.active = true;
    v.id = m.id;
    v.note = m.n;
    v.vel = m.v;
    v.age = ++this.ageCounter;
    v.target = 440 * Math.pow(2, (m.n - 69) / 12);
    v.freq = m.g >= 0 && P.glide > 0 ? 440 * Math.pow(2, (m.g - 69) / 12) : v.target;
    v.stage = 1;
    if (!wasActive) v.env = 0;
    v.fenv = 0;
    v.fstage = 1;
    v.wait = offset;
    v.offWait = -1;
    v.spos = 0;
    v.mod = 0;
    if (!wasActive) { v.filt.reset(); for (let i = 0; i < 7; i++) v.phases[i] = Math.random(); }
    const pan = Math.max(-0.8, Math.min(0.8, (m.n - 64) / 30));
    v.gl = Math.cos((pan + 1) * Math.PI * 0.25);
    v.gr = Math.sin((pan + 1) * Math.PI * 0.25);
    if (P.wave === 7) {
      // Karplus-Strong excitation
      const len = Math.max(2, Math.min(KS_LEN - 1, Math.round(this.sr / v.target)));
      v.ksLen = len;
      v.ksIdx = 0;
      let lp = 0;
      const bright = 0.3 + 0.7 * Math.min(1, P.cutoff / 8000);
      for (let i = 0; i < len; i++) {
        lp += (this.rand() - lp) * bright;
        v.ks[i] = lp;
      }
      v.ksLast = 0;
    }
  }

  noteOff(id, offset) {
    for (const v of this.voices) {
      if (v.active && v.id === id && v.stage !== 3) {
        if (offset > 0 || v.wait > 0) v.offWait = Math.max(offset, v.wait);
        else v.stage = 3;
      }
    }
  }

  drumOn(type, vel, offset) {
    let d = null;
    // Closed hat chokes open hat
    if (type === 2) for (const x of this.drums) if (x.active && x.type === 3) x.active = false;
    for (const x of this.drums) if (!x.active) { d = x; break; }
    if (!d) {
      d = this.drums[0];
      for (const x of this.drums) if (x.t > d.t) d = x;
    }
    d.active = true;
    d.type = type;
    d.t = 0;
    d.vel = vel;
    d.phase = 0;
    d.wait = offset;
    const sr = this.sr;
    d.f1.reset();
    d.f2.reset();
    switch (type) {
      case 1: d.f1.set(1800, 0.8, sr); break; // snare noise
      case 2: case 3: d.f1.set(8000, 1.2, sr); break; // hats
      case 4: d.f1.set(1200, 2.5, sr); break; // clap
      case 6: d.f1.set(2200, 4, sr); break; // rim
    }
  }

  renderVoices(n) {
    const P = this.P;
    const sr = this.sr;
    const bL = this.bL;
    const bR = this.bR;
    const wave = P.wave | 0;
    const lfoVal = Math.sin(this.lfoPhase * TWO_PI) * P.lfoDepth;
    const pitchMod = P.lfoTarget === 0 ? Math.pow(2, (lfoVal * 0.6) / 12) : 1;
    const filtMod = P.lfoTarget === 1 ? lfoVal * 2 : 0;
    const ampMod = P.lfoTarget === 2 ? 1 - 0.5 * (lfoVal + P.lfoDepth) : 1;
    const gainBase = 0.2 * P.synthVol * ampMod;
    const sustain = P.sustain;
    const cA = this.cA;
    const cD = this.cD;
    const cR = this.cR;
    const cFD = this.cFD;
    const cG = this.cGlide;
    const detune = P.detune;
    const subLvl = P.sub;
    const pw = P.pw;
    const ksDamp = 0.5 * (0.985 + 0.0149 * (1 - P.pluckDamp));

    for (const v of this.voices) {
      if (!v.active) continue;
      // Filter cutoff per block (envelope + key tracking + LFO)
      const kt = Math.pow(2, ((v.note - 60) / 12) * P.keytrack);
      const fc = P.cutoff * kt * Math.pow(2, P.fenv * v.fenv + filtMod);
      v.filt.set(Math.max(30, Math.min(fc, 20000)), 0.5 + P.reso * 12, sr);
      const filt = v.filt;
      const ph = v.phases;
      const g = gainBase * (0.35 + 0.65 * v.vel);
      for (let i = 0; i < n; i++) {
        if (v.wait > 0) { v.wait--; continue; }
        if (v.offWait >= 0) { if (v.offWait-- === 0) v.stage = 3; }
        // Amp envelope
        if (v.stage === 1) { v.env += cA; if (v.env >= 1) { v.env = 1; v.stage = 2; } }
        else if (v.stage === 2) v.env += (sustain - v.env) * cD;
        else if (v.stage === 3) {
          v.env -= v.env * cR;
          if (v.env < 0.0001) { v.active = false; v.stage = 0; v.env = 0; break; }
        }
        // Filter envelope (attack ~3ms, then decay to 0)
        if (v.fstage === 1) { v.fenv += 0.015; if (v.fenv >= 1) { v.fenv = 1; v.fstage = 2; } }
        else v.fenv -= v.fenv * cFD;
        v.freq += (v.target - v.freq) * cG;
        const f = v.freq * pitchMod;
        const dt = f / sr;
        let s = 0;
        switch (wave) {
          case 0: s = Math.sin(ph[0] * TWO_PI); ph[0] += dt; break;
          case 1: { const t = ph[0]; s = 4 * Math.abs(t - 0.5) - 1; ph[0] += dt; break; }
          case 2: { const t = ph[0]; s = 2 * t - 1 - polyBlep(t, dt); ph[0] += dt; break; }
          case 3: {
            const t = ph[0];
            s = (t < pw ? 1 : -1) + polyBlep(t, dt) - polyBlep((t + 1 - pw) % 1, dt);
            ph[0] += dt;
            break;
          }
          case 4: {
            for (let k = 0; k < 7; k++) {
              const d = dt * (1 + (k - 3) * detune * 0.0045);
              const t = ph[k];
              s += 2 * t - 1 - polyBlep(t, d);
              ph[k] += d;
              if (ph[k] >= 1) ph[k] -= 1;
            }
            s *= 0.3;
            break;
          }
          case 5: {
            const idx = 0.4 + 3.5 * v.fenv * (0.5 + detune);
            v.mod += dt * 3.5;
            if (v.mod >= 1) v.mod -= 1;
            s = Math.sin((ph[0] + idx * Math.sin(v.mod * TWO_PI) / TWO_PI) * TWO_PI);
            ph[0] += dt;
            break;
          }
          case 6: {
            const a = ph[0] * TWO_PI;
            s = 0.55 * Math.sin(a) + 0.35 * Math.sin(2 * a) + 0.25 * Math.sin(3 * a) + 0.15 * Math.sin(4 * a) + 0.1 * Math.sin(6 * a);
            ph[0] += dt;
            break;
          }
          case 7: {
            const y = v.ks[v.ksIdx];
            v.ks[v.ksIdx] = (y + v.ksLast) * ksDamp;
            v.ksLast = y;
            v.ksIdx++;
            if (v.ksIdx >= v.ksLen) v.ksIdx = 0;
            s = y * 1.6;
            break;
          }
          case 8: {
            if (this.sampleLen > 1) {
              const p = v.spos;
              const ip = p | 0;
              if (ip < this.sampleLen - 1) {
                const fr = p - ip;
                s = this.sample[ip] + (this.sample[ip + 1] - this.sample[ip]) * fr;
                v.spos += Math.pow(2, (v.note - 60) / 12) * this.sampleRateRatio * (f / v.target);
              } else { v.stage = 3; v.env *= 0.9; }
            }
            break;
          }
        }
        if (ph[0] >= 1) ph[0] -= 1;
        if (subLvl > 0) {
          v.sub += dt * 0.5;
          if (v.sub >= 1) v.sub -= 1;
          s += (v.sub < 0.5 ? 1 : -1) * subLvl * 0.6;
        }
        const out = (wave === 7 || wave === 8 ? s : filt.tick(s)) * v.env * g;
        bL[i] += out * v.gl;
        bR[i] += out * v.gr;
      }
    }
  }

  renderDrums(n) {
    const kit = KITS[this.P.drumKit | 0] || KITS[0];
    const sr = this.sr;
    const out = this.dL;
    const vol = this.P.drumVol;
    for (const d of this.drums) {
      if (!d.active) continue;
      for (let i = 0; i < n; i++) {
        if (d.wait > 0) { d.wait--; continue; }
        const t = d.t / sr;
        let s = 0;
        let done = false;
        switch (d.type) {
          case 0: { // kick
            const f = kit[0] + (kit[1] - kit[0]) * Math.exp(-t / 0.035);
            d.phase += f / sr;
            s = Math.sin(d.phase * TWO_PI) * Math.exp(-t / kit[2]) * 1.1;
            s += this.rand() * kit[3] * Math.exp(-t / 0.0025);
            done = t > kit[2] * 6;
            break;
          }
          case 1: { // snare
            d.phase += kit[4] / sr;
            s = Math.sin(d.phase * TWO_PI) * Math.exp(-t / 0.06) * 0.6;
            d.f1.tick(this.rand());
            s += d.f1.hp * Math.exp(-t / kit[5]) * 0.8;
            done = t > 0.6;
            break;
          }
          case 2: case 3: { // hats
            d.f1.tick(this.rand());
            const dec = d.type === 2 ? kit[6] : kit[7];
            s = d.f1.hp * Math.exp(-t / dec) * 0.55;
            done = t > dec * 7;
            break;
          }
          case 4: { // clap
            d.f1.tick(this.rand());
            const burst = t < 0.03 ? Math.exp(-((t % 0.0105) / 0.004)) : Math.exp(-(t - 0.03) / 0.13);
            s = d.f1.bp * burst * 2.2;
            done = t > 0.8;
            break;
          }
          case 5: { // tom
            const f = kit[8] + kit[8] * 0.6 * Math.exp(-t / 0.05);
            d.phase += f / sr;
            s = Math.sin(d.phase * TWO_PI) * Math.exp(-t / 0.22) * 0.9;
            done = t > 1.4;
            break;
          }
          case 6: { // rim
            d.phase += 1700 / sr;
            d.f1.tick(this.rand());
            s = (Math.sin(d.phase * TWO_PI) * 0.5 + d.f1.bp * 1.5) * Math.exp(-t / 0.012);
            done = t > 0.12;
            break;
          }
        }
        out[i] += s * d.vel * vol;
        d.t++;
        if (done) { d.active = false; break; }
      }
    }
    if (kit[9]) {
      // Lo-fi kit: sample-rate reduction + low-pass
      for (let i = 0; i < n; i++) {
        if (this.crushCount++ % 4 === 0) this.crushHold = Math.round(out[i] * 24) / 24;
        out[i] = this.drumLp.tick(this.crushHold);
      }
    }
  }

  vocode(n, mic) {
    const bL = this.bL;
    const bR = this.bR;
    const mono = this.mono;
    const mix = this.P.vocMix;
    const atk = this.vcAtk;
    const rel = this.vcRel;
    for (let i = 0; i < n; i++) {
      const car = (bL[i] + bR[i]) * 0.5 + this.rand() * 0.004;
      const mod = mic ? mic[i] : 0;
      let y = 0;
      for (let b = 0; b < N_BANDS; b++) {
        const cf = this.vcCar[b];
        const mf = this.vcMod[b];
        cf.tick(car);
        mf.tick(mod);
        const a = Math.abs(mf.bp);
        const e = this.vcEnv[b];
        this.vcEnv[b] = e + (a - e) * (a > e ? atk : rel);
        y += cf.bp * this.vcEnv[b];
      }
      y *= 40;
      mono[i] = y;
    }
    for (let i = 0; i < n; i++) {
      bL[i] = bL[i] * (1 - mix) + mono[i] * mix;
      bR[i] = bR[i] * (1 - mix) + mono[i] * mix;
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] || out[0];
    const n = L.length;
    const sr = this.sr;
    const P = this.P;
    const bL = this.bL;
    const bR = this.bR;
    const dL = this.dL;
    bL.fill(0); bR.fill(0); dL.fill(0);

    // Scheduled events that fall in this block
    const blockEnd = currentTime + n / sr;
    for (let i = 0; i < this.qn; i++) {
      const m = this.queue[i];
      if (m.w < blockEnd) {
        const off = Math.max(0, Math.min(n - 1, Math.round((m.w - currentTime) * sr)));
        this.exec(m, off);
        this.queue[i] = this.queue[--this.qn];
        this.queue[this.qn] = null;
        i--;
      }
    }

    // Mic input
    const mic = inputs[0] && inputs[0][0] ? inputs[0][0] : null;
    if (mic) {
      let pk = 0;
      for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(mic[i]));
      this.micPeak = Math.max(pk, this.micPeak * 0.95);
      if (this.recording) {
        const room = this.recBuf.length - this.recPos;
        const c = Math.min(room, n);
        this.recBuf.set(c === n ? mic : mic.subarray(0, c), this.recPos);
        this.recPos += c;
        if (this.recPos >= this.recBuf.length) this.finishRec();
      }
    }
    if (++this.meterCount >= 16) {
      this.meterCount = 0;
      let act = 0;
      for (const v of this.voices) if (v.active) act++;
      this.port.postMessage({ t: 'meter', mic: this.micPeak, voices: act, rec: this.recording ? this.recPos / sr : -1 });
    }

    this.renderVoices(n);
    this.lfoPhase = (this.lfoPhase + (P.lfoRate * n) / sr) % 1;
    if (P.vocoder) this.vocode(n, mic);
    this.renderDrums(n);

    // Tremolo + chorus/flanger on the synth bus
    const tremD = P.trem;
    const chMix = P.chorus;
    const flanger = P.chorusMode === 1;
    const chBase = flanger ? 0.0015 * sr : 0.012 * sr;
    const chDepth = flanger ? 0.0013 * sr : 0.004 * sr;
    const chRate = flanger ? 0.25 : 0.8;
    const chFb = flanger ? 0.6 : 0.1;
    for (let i = 0; i < n; i++) {
      let l = bL[i];
      let r = bR[i];
      if (tremD > 0) {
        this.tremPhase += P.tremRate / sr;
        if (this.tremPhase >= 1) this.tremPhase -= 1;
        const tg = 1 - tremD * (0.5 + 0.5 * Math.sin(this.tremPhase * TWO_PI));
        l *= tg; r *= tg;
      }
      if (chMix > 0) {
        this.chPhase += chRate / sr;
        if (this.chPhase >= 1) this.chPhase -= 1;
        const a = this.chPhase * TWO_PI;
        const wl = this.chL.read(chBase + chDepth * Math.sin(a));
        const wr = this.chR.read(chBase + chDepth * Math.sin(a + 1.7));
        this.chL.write(l + wl * chFb);
        this.chR.write(r + wr * chFb);
        l = l * (1 - chMix * 0.5) + wl * chMix;
        r = r * (1 - chMix * 0.5) + wr * chMix;
      }
      // Mic monitor
      if (mic && P.micMon > 0) { l += mic[i] * P.micMon; r += mic[i] * P.micMon; }
      bL[i] = l;
      bR[i] = r;
    }

    // Delay (ping-pong, synth only), reverb send, drums, shelf, limiter
    const s = this.shelf;
    const dTarget = Math.min(2, P.delayTime) * sr;
    const dMix = P.delayMix;
    const dFb = P.delayFb;
    const rMix = P.revMix;
    const rG = 0.72 + 0.27 * P.revSize;
    const damp = 0.35;
    const vol = P.volume;
    const drive = 1 + P.drive * 6;
    for (let i = 0; i < n; i++) {
      let l = bL[i];
      let r = bR[i];
      const dr = dL[i];
      if (dMix > 0 || dFb > 0) {
        this.dTime += (dTarget - this.dTime) * 0.0005;
        const yl = this.dlL.read(this.dTime);
        const yr = this.dlR.read(this.dTime);
        this.dDampL += (yl - this.dDampL) * 0.6;
        this.dDampR += (yr - this.dDampR) * 0.6;
        this.dlL.write((l + r) * 0.5 * (dMix > 0 ? 1 : 0) + this.dDampR * dFb);
        this.dlR.write(this.dDampL * dFb);
        l += yl * dMix;
        r += yr * dMix;
      }
      l += dr;
      r += dr;
      if (rMix > 0) {
        // Allpass diffusion → 4-line FDN with Householder feedback
        let x = (l + r) * 0.5 - dr * 0.6;
        for (let k = 0; k < 3; k++) {
          const ap = this.ap[k];
          const dl = ap.readInt(this.apLen[k]);
          const v = x + dl * 0.6;
          ap.write(v);
          x = dl - v * 0.6;
        }
        const fd = this.fdn;
        const o0 = fd[0].readInt(this.fdnLen[0]);
        const o1 = fd[1].readInt(this.fdnLen[1]);
        const o2 = fd[2].readInt(this.fdnLen[2]);
        const o3 = fd[3].readInt(this.fdnLen[3]);
        const fdD = this.fdnDamp;
        fdD[0] += (o0 - fdD[0]) * (1 - damp);
        fdD[1] += (o1 - fdD[1]) * (1 - damp);
        fdD[2] += (o2 - fdD[2]) * (1 - damp);
        fdD[3] += (o3 - fdD[3]) * (1 - damp);
        const sum = (fdD[0] + fdD[1] + fdD[2] + fdD[3]) * 0.5;
        fd[0].write((fdD[0] - sum) * rG + x);
        fd[1].write((fdD[1] - sum) * rG + x);
        fd[2].write((fdD[2] - sum) * rG);
        fd[3].write((fdD[3] - sum) * rG);
        l += (o0 + o2) * rMix * 0.6;
        r += (o1 + o3) * rMix * 0.6;
      }
      // Low shelf
      if (P.bass !== 0) {
        const yl = s.b0 * l + s.b1 * s.x1L + s.b2 * s.x2L - s.a1 * s.y1L - s.a2 * s.y2L;
        s.x2L = s.x1L; s.x1L = l; s.y2L = s.y1L; s.y1L = yl;
        const yr = s.b0 * r + s.b1 * s.x1R + s.b2 * s.x2R - s.a1 * s.y1R - s.a2 * s.y2R;
        s.x2R = s.x1R; s.x1R = r; s.y2R = s.y1R; s.y1R = yr;
        l = yl; r = yr;
      }
      l *= vol * drive;
      r *= vol * drive;
      if (drive > 1) { l = Math.tanh(l) / Math.tanh(drive * 0.5 + 0.5); r = Math.tanh(r) / Math.tanh(drive * 0.5 + 0.5); }
      // Peak limiter
      const pk = Math.max(Math.abs(l), Math.abs(r));
      const want = pk > 0.92 ? 0.92 / pk : 1;
      this.limGain = want < this.limGain ? want : this.limGain + (1 - this.limGain) * 0.0002;
      l *= this.limGain;
      r *= this.limGain;
      L[i] = l > 1 ? 1 : l < -1 ? -1 : l;
      if (R !== L) R[i] = r > 1 ? 1 : r < -1 ? -1 : r;
    }
    return true;
  }
}

registerProcessor('lowchord', LowChordProcessor);
