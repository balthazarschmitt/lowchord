// App entry: state, panels, wiring between input, performer, engine and UI.

import { SCALES, SHARP_NAMES, FLAT_NAMES, JOY_MODES, DIR_LABELS, mod12 } from './theory.js';
import { Engine } from './engine.js';
import { Clock } from './clock.js';
import { Midi, midiSupported } from './midi.js';
import { Out } from './out.js';
import { Looper, N_TRACKS } from './looper.js';
import { Performer, MODES, ARP_PATTERNS } from './modes.js';
import { PATTERNS, DRUMS, KITS } from './drums.js';
import { PRESETS, WAVES, LFO_TARGETS, DEFAULT_SOUND, DEFAULT_FX, presetSound } from './presets.js';
import { bindPads, Joystick, bindStrip, Tilt, bindKeyboard } from './input.js';
import { Display } from './ui/display.js';
import { buildPanel } from './ui/menus.js';
import * as store from './store.js';

const VERSION = '0.2.0';

const DEFAULTS = {
  key: 0, scale: 0, octave: 0, joyMode: 'default', voicing: 'lead', inversion: 0, bass: 'off',
  mode: 'play', bpm: 100, swing: 0, latch: false, chordGlide: 0.12, restrike: true,
  arpPattern: 'up', arpRate: '1/16', arpOct: 1, arpGate: 0.7, arpLatch: false,
  repeatRate: '1/8', strumSpeed: 0.03, seqRate: '1/4',
  beatOn: false, beatPattern: 0, drumKit: 0, drumVol: 0.8,
  preset: 0, sound: presetSound(0), fx: { ...DEFAULT_FX },
  loopBars: 2, loopQuant: true, midiMulti: false, midiCh: 0, midiClock: false, midiOutId: '',
  tilt: false, latchJoy: false, haptics: true,
  vocoder: false, vocMix: 1, micMon: 0, userPresets: [],
};

const DELAY_SYNC = { '1/2': 2, '3/8': 1.5, '1/4': 1, '3/16': 0.75, '1/8': 0.5, '1/8T': 1 / 3, '1/16': 0.25 };
const RATES = ['1/4', '1/8', '1/8T', '1/16', '1/16T', '1/32'].map((r) => [r, r]);

function loadSettings() {
  const saved = store.load() || {};
  const S = { ...structuredClone(DEFAULTS), ...saved };
  S.sound = { ...DEFAULT_SOUND, ...(saved.sound || DEFAULTS.sound) };
  S.fx = { ...DEFAULT_FX, ...(saved.fx || {}) };
  if (S.mode === 'hero' || S.mode === 'ear') S.mode = 'play';
  S.beatOn = false;
  return S;
}

const S = loadSettings();
const engine = new Engine();
const clock = new Clock(engine);
clock.bpm = S.bpm;
clock.swing = S.swing;
const midi = new Midi(engine);
midi.channel = S.midiCh;
const out = new Out(engine, midi);
const looper = new Looper(clock, out, engine);
looper.bars = S.loopBars;
looper.quantize = S.loopQuant;
looper.multiChannel = S.midiMulti;

const ui = { panel: null, bouncing: false, micOn: false, sampleReady: false, midiOn: false, recHeld: false };
const $ = (s) => document.querySelector(s);

const perf = new Performer({ S, out, clock, engine, onChange: () => refreshView() });
const app = { S, engine, clock, perf, looper, ui, midi, out };
const display = new Display($('#screen'), app);

// ---------- Engine params ----------

function fxParams() {
  const f = S.fx;
  return {
    chorus: f.chorus, chorusMode: f.chorusMode, trem: f.trem, tremRate: f.tremRate,
    delayTime: (DELAY_SYNC[f.delaySync] || 0.75) * (60 / S.bpm), delayFb: f.delayFb, delayMix: f.delayMix,
    revMix: f.revMix, revSize: f.revSize, bass: f.bass, drive: f.drive, volume: f.volume,
    drumVol: S.drumVol, drumKit: S.drumKit, vocoder: S.vocoder ? 1 : 0, vocMix: S.vocMix, micMon: S.micMon,
  };
}

function applyAll() {
  engine.setMany({ ...S.sound, ...fxParams() });
}

function persist() {
  store.save(S);
}

// ---------- Get/set used by panels ----------

const io = {
  get(k) {
    if (k.startsWith('sound.')) return S.sound[k.slice(6)];
    if (k.startsWith('fx.')) return S.fx[k.slice(3)];
    if (k === 'midiOn') return ui.midiOn;
    if (k === 'micOn') return ui.micOn;
    return S[k];
  },
  async set(k, v) {
    if (k.startsWith('sound.')) {
      const p = k.slice(6);
      S.sound[p] = v;
      engine.set(p, v);
    } else if (k.startsWith('fx.')) {
      S.fx[k.slice(3)] = v;
      engine.setMany(fxParams());
    } else {
      switch (k) {
        case 'mode': perf.setMode(v); break;
        case 'bpm': S.bpm = v; clock.bpm = v; engine.setMany(fxParams()); break;
        case 'swing': S.swing = v; clock.swing = v; break;
        case 'preset': S.preset = v; S.sound = v >= 100 ? { ...DEFAULT_SOUND, ...S.userPresets[v - 100].sound } : presetSound(v); applyAll(); refreshPanel(); break;
        case 'drumKit': case 'drumVol': case 'vocMix': case 'micMon': S[k] = v; engine.setMany(fxParams()); break;
        case 'vocoder':
          if (v && !(await ensureMic())) return;
          S.vocoder = v;
          engine.setMany(fxParams());
          break;
        case 'loopBars': if (!looper.setBars(v)) { perf.flashText('CLEAR LOOP FIRST'); return; } S.loopBars = v; break;
        case 'loopQuant': S.loopQuant = v; looper.quantize = v; break;
        case 'midiMulti': S.midiMulti = v; looper.multiChannel = v; break;
        case 'midiCh': S.midiCh = v; midi.channel = v; break;
        case 'midiOutId': S.midiOutId = v; midi.select(v); break;
        case 'midiOn':
          ui.midiOn = v ? await midi.enable() : false;
          if (ui.midiOn) { midi.select(S.midiOutId || (midi.outputs()[0] || {}).id); if (!S.midiOutId && midi.out) S.midiOutId = midi.out.id; }
          else midi.out = null;
          refreshPanel(true);
          return;
        case 'micOn':
          if (v) await ensureMic();
          else { engine.disableMic(); ui.micOn = false; S.vocoder = false; engine.setMany(fxParams()); }
          refreshPanel(true);
          return;
        case 'tilt':
          if (v) { if (!(await tilt.enable())) { perf.flashText('NO TILT'); return; } } else tilt.disable();
          S.tilt = v;
          break;
        case 'latchJoy': S.latchJoy = v; joystick.latch = v; break;
        case 'latch': S.latch = v; if (!v && !perf.held.length && S.mode !== 'drone') perf.releaseChord(); break;
        case 'beatOn': S.beatOn = v; if (v && !clock.running) startTransport(); if (!v) out.stopSrc('beat'); break;
        case 'voicing': case 'inversion': S[k] = v; perf.prevVoicing = null; break;
        default: S[k] = v;
      }
    }
    persist();
    refreshView();
  },
};

async function ensureMic() {
  if (ui.micOn) return true;
  ui.micOn = await engine.enableMic();
  if (!ui.micOn) perf.flashText('MIC BLOCKED');
  return ui.micOn;
}

// ---------- Transport ----------

function startTransport() {
  clock.startTransport();
  midi.startStop(true, clock.timeOfTick(clock.tick));
  refreshView();
}

function stopTransport() {
  if (looper.recording) looper.toggleRecord();
  clock.stopTransport();
  out.stopSrc('loop');
  out.stopSrc('beat');
  perf.seqStop();
  midi.startStop(false);
  refreshView();
}

function toggleTransport() {
  if (clock.running) stopTransport();
  else startTransport();
}

function toggleLoopRec() {
  looper.toggleRecord();
  refreshView();
}

clock.subscribe((tick, time) => {
  if (S.midiClock && clock.running) midi.clock(time);
});
setInterval(() => out.prune(), 2000);

// ---------- Bounce (record output to a file) ----------

async function toggleBounce() {
  if (!ui.bouncing) {
    ui.bouncing = engine.startBounce();
    if (!ui.bouncing) perf.flashText('NOT SUPPORTED');
    return;
  }
  ui.bouncing = false;
  const blob = await engine.stopBounce();
  if (!blob) return;
  const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
  const name = `lowchord-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'LowChord recording' }); return; } catch {}
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---------- Panels ----------

const keyNames = () => (([1, 3, 5, 6, 8, 10].includes(S.key) ? FLAT_NAMES : SHARP_NAMES)).map((n, i) => [i, n]);
const pct = (v) => Math.round(v * 100) + '%';
const sec = (v) => (v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's');

const PANELS = {
  key: () => [
    { type: 'seg', key: 'key', label: 'Key', grid: true, options: keyNames },
    { type: 'select', key: 'scale', label: 'Scale', options: SCALES.map((s, i) => [i, s.name]) },
    { type: 'seg', key: 'octave', label: 'Octave', options: [[-2, '-2'], [-1, '-1'], [0, '0'], [1, '+1'], [2, '+2']] },
    { type: 'seg', key: 'joyMode', label: 'Joystick', options: JOY_MODES.map((m) => [m, m[0].toUpperCase() + m.slice(1)]) },
    { type: 'note', label: () => Object.entries(DIR_LABELS[S.joyMode]).map(([d, l]) => `${arrow(d)} ${l}`).join('   ') },
    { type: 'seg', key: 'voicing', label: 'Voicing', options: [['lead', 'Smooth'], ['close', 'Close'], ['spread', 'Spread']] },
    { type: 'seg', key: 'inversion', label: 'Inversion', options: [[0, 'Root'], [1, '1st'], [2, '2nd'], [3, '3rd']], when: () => S.voicing === 'close' },
    { type: 'seg', key: 'bass', label: 'Bass note', options: [['off', 'Off'], ['root', 'Root -1'], ['root2', 'Root -2']] },
  ],
  sound: () => [
    {
      type: 'select', key: 'preset', label: 'Preset',
      options: () => [...PRESETS.map((p, i) => [i, p.name]), ...S.userPresets.map((p, i) => [100 + i, '★ ' + p.name])],
    },
    { type: 'button', label: 'Save as user preset', action: saveUserPreset },
    { type: 'range', key: 'chordGlide', label: 'Chord glide', min: 0, max: 0.6, fmt: (v) => (v < 0.005 ? 'Off' : sec(v)) },
    { type: 'toggle', key: 'restrike', label: 'Re-strike', when: () => S.chordGlide > 0.005 },
    { type: 'note', label: 'Voices slide into the next chord. Re-strike on: each change is articulated (best for bells, plucks, keys). Off: pure legato (best for pads and leads).' },
    { type: 'select', key: 'sound.wave', label: 'Wave', options: WAVES.map((w, i) => [i, w]) },
    { type: 'range', key: 'sound.detune', label: 'Detune / FM', min: 0, max: 1, fmt: pct },
    { type: 'range', key: 'sound.sub', label: 'Sub osc', min: 0, max: 1, fmt: pct },
    { type: 'range', key: 'sound.pw', label: 'Pulse width', min: 0.05, max: 0.95, fmt: pct, when: () => S.sound.wave === 3 },
    { type: 'range', key: 'sound.pluckDamp', label: 'Pluck damping', min: 0, max: 1, fmt: pct, when: () => S.sound.wave === 7 },
    { type: 'heading', label: 'Envelope' },
    { type: 'range', key: 'sound.attack', label: 'Attack', min: 0.001, max: 3, scale: 'log', fmt: sec },
    { type: 'range', key: 'sound.decay', label: 'Decay', min: 0.01, max: 4, scale: 'log', fmt: sec },
    { type: 'range', key: 'sound.sustain', label: 'Sustain', min: 0, max: 1, fmt: pct },
    { type: 'range', key: 'sound.release', label: 'Release', min: 0.01, max: 5, scale: 'log', fmt: sec },
    { type: 'heading', label: 'Filter' },
    { type: 'range', key: 'sound.cutoff', label: 'Cutoff', min: 60, max: 18000, scale: 'log', fmt: (v) => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v)) },
    { type: 'range', key: 'sound.reso', label: 'Resonance', min: 0, max: 1, fmt: pct },
    { type: 'range', key: 'sound.fenv', label: 'Env amount', min: 0, max: 5, fmt: (v) => v.toFixed(1) + ' oct' },
    { type: 'range', key: 'sound.fdecay', label: 'Env decay', min: 0.02, max: 3, scale: 'log', fmt: sec },
    { type: 'range', key: 'sound.keytrack', label: 'Key track', min: 0, max: 1, fmt: pct },
    { type: 'heading', label: 'LFO & glide' },
    { type: 'seg', key: 'sound.lfoTarget', label: 'LFO target', options: LFO_TARGETS.map((t, i) => [i, t]) },
    { type: 'range', key: 'sound.lfoRate', label: 'LFO rate', min: 0.05, max: 20, scale: 'log', fmt: (v) => v.toFixed(2) + 'Hz' },
    { type: 'range', key: 'sound.lfoDepth', label: 'LFO depth', min: 0, max: 1, fmt: pct },
    { type: 'range', key: 'sound.glide', label: 'Glide', min: 0, max: 0.6, fmt: sec },
  ],
  fx: () => [
    { type: 'range', key: 'fx.volume', label: 'Volume', min: 0, max: 1, fmt: pct },
    { type: 'range', key: 'fx.drive', label: 'Drive', min: 0, max: 1, fmt: pct },
    { type: 'range', key: 'fx.bass', label: 'Bass boost', min: 0, max: 12, fmt: (v) => '+' + v.toFixed(1) + 'dB' },
    { type: 'heading', label: 'Modulation' },
    { type: 'seg', key: 'fx.chorusMode', label: 'Type', options: [[0, 'Chorus'], [1, 'Flanger']] },
    { type: 'range', key: 'fx.chorus', label: 'Amount', min: 0, max: 1, fmt: pct },
    { type: 'range', key: 'fx.trem', label: 'Tremolo', min: 0, max: 1, fmt: pct },
    { type: 'range', key: 'fx.tremRate', label: 'Trem rate', min: 0.5, max: 15, fmt: (v) => v.toFixed(1) + 'Hz' },
    { type: 'heading', label: 'Delay' },
    { type: 'select', key: 'fx.delaySync', label: 'Time', options: Object.keys(DELAY_SYNC).map((k) => [k, k]) },
    { type: 'range', key: 'fx.delayMix', label: 'Mix', min: 0, max: 1, fmt: pct },
    { type: 'range', key: 'fx.delayFb', label: 'Feedback', min: 0, max: 0.9, fmt: pct },
    { type: 'heading', label: 'Reverb' },
    { type: 'range', key: 'fx.revMix', label: 'Mix', min: 0, max: 1, fmt: pct },
    { type: 'range', key: 'fx.revSize', label: 'Size', min: 0, max: 1, fmt: pct },
  ],
  mode: () => [
    { type: 'seg', key: 'mode', label: 'Mode', grid: true, options: MODES.map((m) => [m.id, m.name]) },
    { type: 'note', label: () => (MODES.find((m) => m.id === S.mode) || {}).help || '' },
    { type: 'toggle', key: 'latch', label: 'Hold chords', when: () => ['play', 'strum', 'repeat'].includes(S.mode) },
    { type: 'range', key: 'strumSpeed', label: 'Strum speed', min: 0.005, max: 0.12, fmt: sec, when: () => S.mode === 'strum' },
    { type: 'seg', key: 'arpPattern', label: 'Pattern', options: ARP_PATTERNS.map((p) => [p, p]), when: () => S.mode === 'arp' },
    { type: 'seg', key: 'arpRate', label: 'Rate', options: RATES, when: () => S.mode === 'arp' },
    { type: 'seg', key: 'arpOct', label: 'Octaves', options: [[1, '1'], [2, '2'], [3, '3']], when: () => S.mode === 'arp' },
    { type: 'range', key: 'arpGate', label: 'Gate', min: 0.1, max: 1, fmt: pct, when: () => S.mode === 'arp' },
    { type: 'toggle', key: 'arpLatch', label: 'Latch', when: () => S.mode === 'arp' },
    { type: 'seg', key: 'repeatRate', label: 'Rate', options: RATES, when: () => S.mode === 'repeat' },
    { type: 'seg', key: 'seqRate', label: 'Step', options: [['1/2', '1/2'], ['1/4', '1/4'], ['1/8', '1/8'], ['1/16', '1/16']], when: () => S.mode === 'seq' },
    { type: 'button', label: () => (perf.seq.rec ? '● Recording steps' : '○ Record steps'), cls: 'wide', action: () => { perf.seq.rec = !perf.seq.rec; refreshView(); }, when: () => S.mode === 'seq' },
    { type: 'button', label: 'Rest', action: () => perf.seqRest(), when: () => S.mode === 'seq' },
    { type: 'button', label: 'Clear', action: () => perf.seqClear(), when: () => S.mode === 'seq' },
    { type: 'button', label: () => (clock.running ? '■ Stop' : '▶ Play'), action: toggleTransport, when: () => S.mode === 'seq' },
    { type: 'note', label: 'Empty steps hold the previous chord. Stopped + record: pads enter steps one by one.', when: () => S.mode === 'seq' },
    { type: 'button', label: 'Restart game', cls: 'wide', action: () => perf.setMode('hero'), when: () => S.mode === 'hero' },
    { type: 'button', label: 'Replay chord', action: () => perf.earReplay(), when: () => S.mode === 'ear' },
    { type: 'button', label: 'New question', action: () => perf.earRound(), when: () => S.mode === 'ear' },
  ],
  beat: () => [
    { type: 'toggle', key: 'beatOn', label: 'Beat' },
    { type: 'button', label: () => (clock.running ? '■ Stop' : '▶ Play'), cls: 'wide', action: toggleTransport },
    { type: 'select', key: 'beatPattern', label: 'Pattern', options: PATTERNS.map((p, i) => [i, `${i + 1}. ${p.name}`]) },
    { type: 'seg', key: 'drumKit', label: 'Kit', options: KITS.map((k, i) => [i, k]) },
    { type: 'range', key: 'bpm', label: 'Tempo', min: 40, max: 220, step: 1, fmt: (v) => Math.round(v) + ' BPM' },
    { type: 'button', label: 'Tap tempo', action: tapTempo },
    { type: 'range', key: 'swing', label: 'Swing', min: 0, max: 0.5, fmt: pct },
    { type: 'range', key: 'drumVol', label: 'Drum volume', min: 0, max: 1, fmt: pct },
  ],
  loop: () => [
    { type: 'button', label: () => (looper.recording ? '● Stop recording' : '● Record'), cls: 'wide rec', action: toggleLoopRec },
    { type: 'button', label: () => (clock.running ? '■ Stop' : '▶ Play'), cls: 'wide', action: toggleTransport },
    { type: 'seg', key: 'loopBars', label: 'Length', options: [[1, '1 bar'], [2, '2'], [4, '4'], [8, '8']] },
    { type: 'toggle', key: 'loopQuant', label: 'Quantize 1/16' },
    { type: 'custom', render: renderTracks },
    { type: 'button', label: 'Clear all', action: () => { looper.clearAll(); refreshView(); } },
    { type: 'heading', label: 'Record audio' },
    { type: 'button', label: () => (ui.bouncing ? '■ Stop & save file' : '● Record to file'), cls: 'wide', action: toggleBounce },
    { type: 'note', label: 'The looper records notes, so loops follow tempo and sound changes.' },
  ],
  mic: () => [
    { type: 'toggle', key: 'micOn', label: 'Microphone' },
    { type: 'note', label: 'Use headphones to avoid feedback.' },
    { type: 'heading', label: 'Sampler' },
    { type: 'button', label: 'Hold to record sample', cls: 'wide rec', hold: true, action: holdRecord, when: () => ui.micOn },
    { type: 'button', label: () => (S.sound.wave === 8 ? 'Playing sample ✓' : 'Play sample on pads'), action: useSample, when: () => ui.sampleReady },
    { type: 'note', label: 'Record up to 6 s. The sample plays at C and is pitched across the pads.', when: () => ui.micOn },
    { type: 'heading', label: 'Vocoder' },
    { type: 'toggle', key: 'vocoder', label: 'Vocoder' },
    { type: 'range', key: 'vocMix', label: 'Vocoder mix', min: 0, max: 1, fmt: pct, when: () => S.vocoder },
    { type: 'note', label: 'Hold a chord and sing or talk. Bright presets (Supersaw, Vocoder Carrier) work best.', when: () => S.vocoder },
    { type: 'range', key: 'micMon', label: 'Mic monitor', min: 0, max: 1, fmt: pct, when: () => ui.micOn },
  ],
  midi: () =>
    midiSupported()
      ? [
          { type: 'toggle', key: 'midiOn', label: 'MIDI out' },
          { type: 'select', key: 'midiOutId', label: 'Output', options: () => midiOptions(), when: () => ui.midiOn },
          { type: 'select', key: 'midiCh', label: 'Channel', options: Array.from({ length: 16 }, (_, i) => [i, String(i + 1)]), when: () => ui.midiOn },
          { type: 'toggle', key: 'midiMulti', label: 'Loop tracks → ch 1-6', when: () => ui.midiOn },
          { type: 'toggle', key: 'midiClock', label: 'Send clock', when: () => ui.midiOn },
          { type: 'button', label: 'Panic (all notes off)', action: () => out.panic(), when: () => ui.midiOn },
          { type: 'note', label: 'Drums go out on channel 10. Connect a USB MIDI device or a synth app.' },
        ]
      : [{ type: 'note', label: 'This browser has no Web MIDI (iOS Safari doesn’t support it). Use Chrome on Android or desktop for MIDI out.' }],
  settings: () => [
    { type: 'toggle', key: 'tilt', label: 'Tilt = joystick' },
    { type: 'button', label: 'Recalibrate tilt', action: () => tilt.recalibrate(), when: () => S.tilt },
    { type: 'toggle', key: 'latchJoy', label: 'Joystick stays put' },
    { type: 'toggle', key: 'haptics', label: 'Vibrate on press' },
    { type: 'note', label: () => `Audio latency: ~${engine.latencyMs} ms (output) · ${engine.ctx ? engine.ctx.sampleRate : '-'} Hz` },
    { type: 'button', label: 'Reset all settings', action: resetAll },
    { type: 'note', label: `LowChord ${VERSION}. Keys 1-7 and arrows/WASD work on a keyboard.` },
  ],
};

function arrow(d) {
  return { u: '↑', ur: '↗', r: '→', dr: '↘', d: '↓', dl: '↙', l: '←', ul: '↖' }[d];
}

function midiOptions() {
  const outs = midi.outputs();
  return outs.length ? outs.map((o) => [o.id, o.name]) : [['', 'No outputs found']];
}

function renderTracks(box) {
  box.textContent = '';
  for (let i = 0; i < N_TRACKS; i++) {
    const t = looper.tracks[i];
    const row = document.createElement('div');
    row.className = 'track' + (i === looper.armed ? ' armed' : '');
    const mk = (label, fn, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = label;
      b.onclick = () => { fn(); refreshView(); };
      return b;
    };
    row.append(
      mk(`${i + 1}${t.events.length ? ' ●' : ''}`, () => { if (!looper.recording) looper.armed = i; }, 'arm'),
      mk(t.muted ? 'Muted' : 'Mute', () => (t.muted = !t.muted), t.muted ? 'sel' : ''),
      mk('Undo', () => looper.undo(i)),
      mk('Clear', () => looper.clearTrack(i)),
    );
    box.append(row);
  }
}

let tapTimes = [];
function tapTempo() {
  const now = performance.now();
  tapTimes = tapTimes.filter((t) => now - t < 2500);
  tapTimes.push(now);
  if (tapTimes.length >= 2) {
    const iv = (tapTimes[tapTimes.length - 1] - tapTimes[0]) / (tapTimes.length - 1);
    io.set('bpm', Math.max(40, Math.min(220, Math.round(60000 / iv))));
  }
}

function saveUserPreset() {
  const name = prompt('Preset name', `My sound ${S.userPresets.length + 1}`);
  if (!name) return;
  S.userPresets.push({ name, sound: { ...S.sound } });
  S.preset = 100 + S.userPresets.length - 1;
  persist();
  refreshPanel(true);
}

function holdRecord(down) {
  engine.recordSample(down);
}

function useSample() {
  io.set('sound.wave', 8);
  refreshPanel(true);
}

function resetAll() {
  if (!confirm('Reset all settings and presets?')) return;
  store.clear();
  location.reload();
}

engine.onMessage(async (m) => {
  if (m.t === 'recdone') {
    if (m.empty) { perf.flashText('TOO QUIET'); return; }
    ui.sampleReady = true;
    store.putBlob('sample', { buf: m.buf, rate: m.rate });
    perf.flashText('SAMPLED');
    refreshPanel(true);
  }
});

// ---------- Panel/sheet UI ----------

let panelRefresh = null;
function openPanel(name) {
  if (ui.panel === name) return closePanel();
  ui.panel = name;
  document.body.classList.add('sheet-open');
  for (const b of document.querySelectorAll('[data-panel]')) b.classList.toggle('sel', b.dataset.panel === name);
  $('#sheet-title').textContent = $(`[data-panel="${name}"]`).dataset.title || name;
  refreshPanel(true);
  display.dirty = true;
}

function closePanel() {
  ui.panel = null;
  document.body.classList.remove('sheet-open');
  for (const b of document.querySelectorAll('[data-panel]')) b.classList.remove('sel');
  display.dirty = true;
}

function refreshPanel(rebuild) {
  if (!ui.panel) return;
  if (rebuild || !panelRefresh) panelRefresh = buildPanel($('#sheet-body'), PANELS[ui.panel](), io);
  else panelRefresh();
}

// ---------- View ----------

const padEls = [...document.querySelectorAll('.pad[data-deg]')];

function refreshView() {
  display.dirty = true;
  const m = S.mode;
  padEls.forEach((el, deg) => {
    const big = el.querySelector('b');
    const small = el.querySelector('small');
    if (m === 'drums') {
      big.textContent = DRUMS[deg];
      small.textContent = '';
    } else if (m === 'lead') {
      const n = perf.leadNote(deg);
      big.textContent = String(deg + 1);
      small.textContent = (([1, 3, 5, 6, 8, 10].includes(S.key) ? FLAT_NAMES : SHARP_NAMES))[mod12(n)];
    } else {
      const c = perf.chordFor(deg);
      big.textContent = c.numeral;
      small.textContent = c.name;
    }
    el.classList.toggle('active', !!perf.active && perf.active.deg === deg && m !== 'drums');
  });
  $('#hold').classList.toggle('sel', !!S.latch);
  $('#play').classList.toggle('sel', clock.running);
  $('#rec').classList.toggle('sel', looper.recording);
  if (ui.panel) refreshPanel(false);
}

// ---------- Input wiring ----------

const padDown = (deg) => perf.padDown(deg);
const padUp = (deg) => perf.padUp(deg);
bindPads(padEls, { down: padDown, up: padUp });
const joystick = new Joystick($('#joy'), $('#knob'), (dir) => perf.setJoy(dir));
joystick.latch = S.latchJoy;
const tilt = new Tilt(joystick);
bindStrip($('#strip'), (i, n) => perf.strum(i, n), 18);
bindKeyboard({
  down: (d) => { padEls[d].classList.add('on'); padDown(d); },
  up: (d) => { padEls[d].classList.remove('on'); padUp(d); },
  joy: joystick,
});

for (const b of document.querySelectorAll('[data-panel]')) b.addEventListener('click', () => openPanel(b.dataset.panel));
$('#sheet-close').addEventListener('click', closePanel);
$('#hold').addEventListener('click', () => io.set('latch', !S.latch));
$('#play').addEventListener('click', toggleTransport);
$('#rec').addEventListener('click', toggleLoopRec);
$('#screen').addEventListener('click', () => { if (S.mode === 'ear') perf.earReplay(); });

// ---------- Startup ----------

let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !document.hidden) wakeLock = await navigator.wakeLock.request('screen');
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });

async function boot() {
  const btn = $('#start');
  btn.disabled = true;
  btn.textContent = 'Starting…';
  try {
    await engine.start();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Tap to retry';
    $('#splash-err').textContent = 'Audio failed to start: ' + (e && e.message ? e.message : e);
    return;
  }
  applyAll();
  clock.begin();
  const saved = await store.getBlob('sample');
  if (saved && saved.buf) {
    engine.loadSample(saved.buf, saved.rate);
    ui.sampleReady = true;
  }
  if (S.tilt) tilt.enable();
  keepAwake();
  document.body.classList.add('ready');
  window.__lowchord = app; // for debugging / tests
}

$('#start').addEventListener('click', boot);
refreshView();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
