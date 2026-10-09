import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCALES, DIRS, JOY_MODES, buildChord, voiceChord, voiceLead, closeVoicing, movementCost,
  chordSuffix, mod12, glideSources, scaleNote,
} from '../src/theory.js';

const st = (o = {}) => ({ key: 0, scale: 0, joyMode: 'default', octave: 0, voicing: 'close', inversion: 0, bass: 'off', ...o });

test('C major diatonic triads', () => {
  const names = [0, 1, 2, 3, 4, 5, 6].map((d) => buildChord(st(), d).name);
  assert.deepEqual(names, ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
  const nums = [0, 1, 2, 3, 4, 5, 6].map((d) => buildChord(st(), d).numeral);
  assert.deepEqual(nums, ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
});

test('A minor and flat-key spelling', () => {
  const names = [0, 1, 2, 3, 4, 5, 6].map((d) => buildChord(st({ key: 9, scale: 1 }), d).name);
  assert.deepEqual(names, ['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G']);
  assert.equal(buildChord(st({ key: 10 }), 0).name, 'Bb');
  assert.equal(buildChord(st({ key: 3 }), 3).name, 'Ab');
});

test('every key and scale yields 7 three-note chords inside the scale', () => {
  for (let key = 0; key < 12; key++) {
    for (let s = 0; s < SCALES.length; s++) {
      const pcs = SCALES[s].steps.map((x) => mod12(x + key));
      for (let d = 0; d < 7; d++) {
        const c = buildChord(st({ key, scale: s }), d);
        assert.equal(c.intervals.length, 3);
        for (const i of c.intervals) assert.ok(pcs.includes(mod12(c.rootPc + i)), `${key}/${s}/${d}`);
      }
    }
  }
});

test('default joystick qualities on C', () => {
  const n = (dir) => buildChord(st(), 0, dir).name;
  assert.equal(n('u'), 'Cm');
  assert.equal(n('ur'), 'C7');
  assert.equal(n('r'), 'Cmaj7');
  assert.equal(n('dr'), 'Cadd9');
  assert.equal(n('d'), 'Csus4');
  assert.equal(n('dl'), 'C6');
  assert.equal(n('l'), 'Cdim');
  assert.equal(n('ul'), 'Caug');
  assert.equal(buildChord(st(), 1, 'r').name, 'Dm7');
  assert.equal(buildChord(st(), 1, 'u').name, 'D');
  assert.equal(buildChord(st(), 6, 'l').name, 'Bdim7');
});

test('extension mode', () => {
  const n = (deg, dir) => buildChord(st({ joyMode: 'extension' }), deg, dir).name;
  assert.equal(n(0, 'u'), 'Cmaj9');
  assert.equal(n(1, 'u'), 'Dm9');
  assert.equal(n(4, 'u'), 'G9');
  assert.equal(n(1, 'ur'), 'Dm11');
  assert.equal(n(4, 'r'), 'G13');
  assert.equal(n(0, 'd'), 'Csus2');
  assert.equal(n(4, 'dr'), 'G7b9');
});

test('chromatic mode', () => {
  const c = (deg, dir) => buildChord(st({ joyMode: 'chromatic' }), deg, dir);
  assert.equal(c(5, 'u').name, 'Ab'); // bVI borrowed from C minor
  assert.equal(c(5, 'u').numeral, '♭VI');
  assert.equal(c(0, 'u').name, 'Cm');
  assert.equal(c(1, 'ur').name, 'A7'); // V7/ii
  assert.equal(c(1, 'ur').numeral, 'V7/ii');
  assert.equal(c(0, 'dl').name, 'Bdim7');
  assert.equal(c(0, 'dr').name, 'Db7');
});

test('every mode and direction produces a named chord', () => {
  for (const joyMode of JOY_MODES) {
    for (let d = 0; d < 7; d++) {
      for (const dir of DIRS) {
        const c = buildChord(st({ joyMode, key: 7, scale: 4 }), d, dir);
        assert.ok(c.name.length > 0 && !c.name.includes('undefined'));
        assert.ok(c.intervals.length >= 3);
      }
    }
  }
});

test('suffix lookup ignores octave', () => {
  assert.equal(chordSuffix([0, 4, 7, 14]), 'add9');
  assert.equal(chordSuffix([0, 3, 7, 10, 14]), 'm9');
});

test('close voicing and inversions', () => {
  assert.deepEqual(closeVoicing(0, [0, 4, 7], 62), [60, 64, 67]);
  assert.deepEqual(closeVoicing(0, [0, 4, 7], 62, 1), [64, 67, 72]);
  assert.deepEqual(closeVoicing(0, [0, 4, 7], 62, 2), [67, 72, 76]);
});

test('voice leading keeps movement small', () => {
  const C = [60, 64, 67];
  const F = voiceLead(5, [0, 4, 7], 62, C);
  assert.deepEqual(F, [60, 65, 69]); // C-F-A (second inversion)
  const G = voiceLead(7, [0, 4, 7], 62, C);
  assert.ok(movementCost(G, C) <= movementCost(closeVoicing(7, [0, 4, 7], 62), C));
  // Repeated motion does not drift out of range
  let prev = C;
  for (let i = 0; i < 50; i++) {
    const deg = [0, 4, 5, 3][i % 4];
    const chord = buildChord(st(), deg);
    prev = voiceChord(chord, st({ voicing: 'lead' }), prev);
    assert.ok(prev[0] > 48 && prev[prev.length - 1] < 80, String(prev));
  }
});

test('bass note is the chord root below the voicing', () => {
  const v = voiceChord(buildChord(st(), 3), st({ bass: 'root2' }), null);
  assert.equal(mod12(v[0]), 5);
  assert.ok(v[1] - v[0] >= 12);
});

test('glide sources pair nearest previous notes', () => {
  assert.deepEqual(glideSources([60, 65, 69], [60, 64, 67]), [60, 64, 67]);
  assert.deepEqual(glideSources([60], null), [null]);
});

test('lead mode scale notes', () => {
  assert.equal(scaleNote(st({ key: 2 }), 0), 62);
  assert.equal(scaleNote(st({ key: 0, octave: 1 }), 6), 83);
});
