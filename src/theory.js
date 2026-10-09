// Pure music theory: scales, diatonic chords, joystick transforms, voicing.
// No DOM or audio here so it can be unit-tested under node.

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const FLAT_KEYS = new Set([1, 3, 5, 6, 8, 10]);

export const SCALES = [
  { id: 'major', name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', name: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'harmonic', name: 'Harm Minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'melodic', name: 'Mel Minor', steps: [0, 2, 3, 5, 7, 9, 11] },
  { id: 'dorian', name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'phrygian', name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'lydian', name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'mixolydian', name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'locrian', name: 'Locrian', steps: [0, 1, 3, 5, 6, 8, 10] },
  { id: 'phrygdom', name: 'Phryg Dom', steps: [0, 1, 4, 5, 7, 8, 10] },
];

export const JOY_MODES = ['default', 'extension', 'chromatic'];
export const DIRS = ['c', 'u', 'ur', 'r', 'dr', 'd', 'dl', 'l', 'ul'];

/** Short description of what each direction does, per joystick mode (shown in the UI). */
export const DIR_LABELS = {
  default: { u: 'maj/min', ur: '7', r: 'diat 7', dr: 'add9', d: 'sus4', dl: '6', l: 'dim', ul: 'aug' },
  extension: { u: '9', ur: '11', r: '13', dr: '7b9', d: 'sus2', dl: '7sus4', l: 'dim7', ul: '7#9' },
  chromatic: { u: 'borrow', ur: 'V7/x', r: '+1', dr: 'subV7', d: 'ii7/x', dl: 'vii°7/x', l: '-1', ul: 'IV/x' },
};

export const mod12 = (n) => ((n % 12) + 12) % 12;

export function noteName(pc, key = 0) {
  return (FLAT_KEYS.has(mod12(key)) ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
}

export function midiName(m, key = 0) {
  return noteName(m, key) + (Math.floor(m / 12) - 1);
}

/** Interval (semitones above the chord root) of scale tone `deg + i`. */
function stackTone(steps, deg, i) {
  const idx = deg + i;
  return steps[idx % 7] + 12 * Math.floor(idx / 7) - steps[deg];
}

export function stack(steps, deg, idxs) {
  return idxs.map((i) => stackTone(steps, deg, i));
}

/** Classify a triad (first three intervals) as maj/min/dim/aug/other. */
export function triadQuality(iv) {
  const third = mod12(iv[1]);
  const fifth = mod12(iv[2]);
  if (third === 4 && fifth === 7) return 'maj';
  if (third === 3 && fifth === 7) return 'min';
  if (third === 3 && fifth === 6) return 'dim';
  if (third === 4 && fifth === 8) return 'aug';
  return 'other';
}

// Chord suffixes keyed by the sorted, de-duplicated pitch-class set relative to the root.
const SUFFIX = {
  '0,4,7': '', '0,3,7': 'm', '0,3,6': 'dim', '0,4,8': 'aug', '0,5,7': 'sus4', '0,2,7': 'sus2',
  '0,4,7,10': '7', '0,4,7,11': 'maj7', '0,3,7,10': 'm7', '0,3,6,10': 'm7b5', '0,3,6,9': 'dim7',
  '0,3,7,11': 'mMaj7', '0,4,8,11': 'maj7#5', '0,4,8,10': '7#5', '0,4,6,10': '7b5', '0,4,6,11': 'maj7b5',
  '0,2,4,7': 'add9', '0,2,3,7': 'madd9', '0,1,4,7': 'addb9', '0,1,3,7': 'm(addb9)', '0,2,3,6': 'dim(add9)',
  '0,1,3,6': 'dim(addb9)', '0,2,4,8': 'aug(add9)', '0,4,7,9': '6', '0,3,7,9': 'm6', '0,3,6,8': 'dim(b6)',
  '0,5,7,10': '7sus4', '0,2,7,10': '7sus2', '0,4,5,7': 'add4', '0,3,5,7': 'm(add4)',
  '0,2,4,7,10': '9', '0,2,4,7,11': 'maj9', '0,2,3,7,10': 'm9', '0,1,4,7,10': '7b9', '0,3,4,7,10': '7#9',
  '0,2,3,7,11': 'mMaj9', '0,1,3,7,10': 'm7b9', '0,2,3,6,10': 'm9b5', '0,1,3,6,10': 'm7b5b9',
  '0,2,4,8,11': 'maj9#5', '0,1,4,8,11': 'maj7#5b9', '0,1,4,7,11': 'maj7b9', '0,2,4,6,11': 'maj9b5',
  '0,1,3,6,9': 'dim7(b9)', '0,2,3,6,9': 'dim9', '0,2,4,8,10': '9#5', '0,1,4,8,10': '7#5b9',
  '0,2,4,5,7,10': '11', '0,2,3,5,7,10': 'm11', '0,2,4,5,7,11': 'maj11', '0,2,4,6,7,11': 'maj9#11',
  '0,1,3,5,7,10': 'm11b9', '0,1,3,5,6,10': 'm11b5b9', '0,2,3,5,7,11': 'mMaj11', '0,2,3,5,6,10': 'm11b5',
  '0,1,4,5,7,10': '11b9', '0,2,4,6,8,11': 'maj9#5#11', '0,1,4,5,8,10': '11#5b9', '0,2,3,5,7,9': 'm6/9(11)',
  '0,2,4,7,9,10': '13', '0,2,4,7,9,11': 'maj13', '0,2,3,7,9,10': 'm13', '0,1,3,7,8,10': 'm7b9b13',
  '0,1,3,6,8,10': 'm7b5b9b13', '0,2,3,7,9,11': 'mMaj13', '0,1,4,7,9,10': '13b9', '0,2,4,7,8,10': '9b13',
  '0,2,3,6,8,10': 'm9b5b13', '0,2,4,8,9,11': 'maj13#5', '0,1,4,7,8,10': '7b9b13', '0,2,3,7,8,10': 'm9b13',
  '0,1,3,6,9,10': 'dim7(b9,13)', '0,2,4,6,9,11': 'maj13b5', '0,2,4,7,9': '6/9', '0,2,3,7,9': 'm6/9',
};

export function chordSuffix(intervals) {
  const set = [...new Set(intervals.map(mod12))].sort((a, b) => a - b);
  const s = SUFFIX[set.join(',')];
  if (s !== undefined) return s;
  return '(' + set.slice(1).join(',') + ')';
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const CHROMA_NUMERAL = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];

function caseNumeral(base, intervals) {
  const q = triadQuality(intervals);
  const hasM3 = intervals.some((i) => mod12(i) === 4);
  const hasm3 = intervals.some((i) => mod12(i) === 3);
  let n = base;
  const minorish = q === 'min' || q === 'dim' || (!hasM3 && hasm3);
  if (minorish) n = base.replace(/[IV]+/, (m) => m.toLowerCase());
  if (q === 'dim') n += '°';
  if (q === 'aug') n += '+';
  return n;
}

/** Roman numeral for a chord whose root is `rootPc` in `key`/`steps`. */
export function numeral(rootPc, intervals, key, steps) {
  const rel = mod12(rootPc - key);
  const deg = steps.indexOf(rel);
  const base = deg >= 0 ? ROMAN[deg] : CHROMA_NUMERAL[rel];
  return caseNumeral(base, intervals);
}

function triadOf(steps, deg) {
  return stack(steps, deg, [0, 2, 4]);
}

/**
 * Build the chord for a pad (scale degree 0..6) given the joystick direction.
 * Returns { rootPc, intervals, name, numeral }.
 * @param {{key:number, scale:number, joyMode:string}} st
 */
export function buildChord(st, deg, dir = 'c') {
  const steps = SCALES[st.scale].steps;
  const key = mod12(st.key);
  const diatonicRoot = mod12(key + steps[deg]);
  const triad = triadOf(steps, deg);
  const q = triadQuality(triad);
  let root = diatonicRoot;
  let iv = triad;
  let label = null;
  const mode = st.joyMode || 'default';

  if (dir !== 'c') {
    if (mode === 'default') {
      switch (dir) {
        case 'u':
          iv = q === 'maj' || q === 'aug' ? [0, 3, 7] : [0, 4, 7];
          break;
        case 'ur': iv = [0, 4, 7, 10]; break;
        case 'r': iv = stack(steps, deg, [0, 2, 4, 6]); break;
        case 'dr': iv = [...triad, 14]; break;
        case 'd': iv = [0, 5, 7]; break;
        case 'dl': iv = [...triad, 9]; break;
        case 'l': iv = q === 'dim' ? [0, 3, 6, 9] : [0, 3, 6]; break;
        case 'ul': iv = [0, 4, 8]; break;
      }
    } else if (mode === 'extension') {
      switch (dir) {
        case 'u': iv = stack(steps, deg, [0, 2, 4, 6, 8]); break;
        case 'ur': iv = stack(steps, deg, [0, 2, 4, 6, 8, 10]); break;
        case 'r': iv = stack(steps, deg, [0, 2, 4, 6, 8, 12]); break;
        case 'dr': iv = [0, 4, 7, 10, 13]; break;
        case 'd': iv = [0, 2, 7]; break;
        case 'dl': iv = [0, 5, 7, 10]; break;
        case 'l': iv = [0, 3, 6, 9]; break;
        case 'ul': iv = [0, 4, 7, 10, 15]; break;
      }
    } else if (mode === 'chromatic') {
      const target = numeral(diatonicRoot, triad, key, steps);
      switch (dir) {
        case 'u': {
          // Modal interchange: same degree from the parallel major/minor scale.
          const parallel = steps[2] === 4 ? SCALES[1].steps : SCALES[0].steps;
          root = mod12(key + parallel[deg]);
          iv = triadOf(parallel, deg);
          label = numeral(root, iv, key, CHROMATIC_REF);
          break;
        }
        case 'ur': root = mod12(diatonicRoot + 7); iv = [0, 4, 7, 10]; label = 'V7/' + target; break;
        case 'r': root = mod12(diatonicRoot + 1); break;
        case 'dr': root = mod12(diatonicRoot + 1); iv = [0, 4, 7, 10]; label = 'subV7/' + target; break;
        case 'd': root = mod12(diatonicRoot + 2); iv = [0, 3, 7, 10]; label = 'ii7/' + target; break;
        case 'dl': root = mod12(diatonicRoot - 1); iv = [0, 3, 6, 9]; label = 'vii°7/' + target; break;
        case 'l': root = mod12(diatonicRoot - 1); break;
        case 'ul': root = mod12(diatonicRoot + 5); iv = [0, 4, 7]; label = 'IV/' + target; break;
      }
    }
  }

  return {
    rootPc: root,
    intervals: iv,
    name: spellRoot(root, key, steps) + chordSuffix(iv),
    numeral: label || numeral(root, iv, key, steps),
  };
}

/** Out-of-scale roots (borrowed/chromatic chords) are spelled with flats. */
function spellRoot(pc, key, steps) {
  return steps.includes(mod12(pc - key)) ? noteName(pc, key) : FLAT_NAMES[mod12(pc)];
}

// Sentinel scale with no members, so `numeral` falls back to chromatic numerals.
const CHROMATIC_REF = [-1, -1, -1, -1, -1, -1, -1];

/** Single scale note for Lead mode. */
export function scaleNote(st, deg, octaveShift = 0) {
  const steps = SCALES[st.scale].steps;
  return 60 + mod12(st.key) + steps[deg] + 12 * (st.octave + octaveShift);
}

// ---------- Voicing ----------

/** Close-position voicing with the root nearest `center`, then rotated `inversion` times. */
export function closeVoicing(rootPc, intervals, center, inversion = 0) {
  let root = center - 6 + mod12(rootPc - (center - 6));
  let notes = intervals.map((i) => root + i);
  // Compress wide stacks (9ths and up) into roughly two octaves around the root.
  notes = notes.map((n, i) => (i > 0 && n - root >= 24 ? n - 12 : n)).sort((a, b) => a - b);
  for (let k = 0; k < inversion % notes.length; k++) {
    const lo = notes.shift();
    notes.push(lo + 12);
  }
  return dedupe(notes);
}

function dedupe(notes) {
  const out = [];
  for (const n of notes.sort((a, b) => a - b)) if (out[out.length - 1] !== n) out.push(n);
  return out;
}

/** Spread (drop-2 style) voicing. */
export function spreadVoicing(rootPc, intervals, center) {
  const n = closeVoicing(rootPc, intervals, center + 6);
  if (n.length < 3) return n;
  if (n.length === 3) return dedupe([n[0] - 12, n[2] - 12, n[1]]);
  const out = n.slice();
  out[out.length - 2] -= 12;
  return dedupe(out);
}

/** Cost of moving between two voicings: each note's distance to the nearest note of the other. */
export function movementCost(a, b) {
  if (!a.length || !b.length) return 0;
  let c = 0;
  for (const x of a) c += Math.min(...b.map((y) => Math.abs(x - y)));
  for (const y of b) c += Math.min(...a.map((x) => Math.abs(x - y)));
  return c;
}

/** Pick the inversion/octave closest to the previous voicing while staying near `center`. */
export function voiceLead(rootPc, intervals, center, prev) {
  if (!prev || !prev.length) return closeVoicing(rootPc, intervals, center);
  let best = null;
  let bestCost = Infinity;
  for (let inv = 0; inv < intervals.length; inv++) {
    for (const shift of [-12, 0, 12]) {
      const v = closeVoicing(rootPc, intervals, center, inv).map((n) => n + shift);
      const mid = (v[0] + v[v.length - 1]) / 2;
      const cost = movementCost(v, prev) + 0.6 * Math.abs(mid - center);
      if (cost < bestCost) {
        bestCost = cost;
        best = v;
      }
    }
  }
  return best;
}

/**
 * Full voicing for a chord given settings.
 * @param {{octave:number, voicing:string, inversion:number, bass:string}} st
 */
export function voiceChord(chord, st, prev) {
  const center = 62 + 12 * st.octave;
  let notes;
  if (st.voicing === 'spread') notes = spreadVoicing(chord.rootPc, chord.intervals, center);
  else if (st.voicing === 'close') notes = closeVoicing(chord.rootPc, chord.intervals, center, st.inversion);
  else notes = voiceLead(chord.rootPc, chord.intervals, center, prev);
  if (st.bass && st.bass !== 'off') {
    const drop = st.bass === 'root2' ? 24 : 12;
    const b = notes[0] - mod12(notes[0] - chord.rootPc) - drop;
    notes = dedupe([b, ...notes]);
  }
  return notes;
}

/**
 * Legato voice assignment between two chords. Both lists are sorted; returns, for each
 * index of `next`, the index in `prev` whose voice should glide to it (or -1 for a new voice).
 * Order-preserving minimum-movement matching, so voices never cross.
 */
export function pairVoices(next, prev) {
  const out = next.map(() => -1);
  if (!prev || !prev.length || !next.length) return out;
  const swap = next.length > prev.length;
  const A = swap ? prev : next; // shorter list: every element gets a partner
  const B = swap ? next : prev;
  const n = A.length;
  const m = B.length;
  const f = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  for (let j = 0; j <= m; j++) f[0][j] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = i; j <= m; j++) {
      f[i][j] = Math.min(f[i][j - 1], f[i - 1][j - 1] + Math.abs(A[i - 1] - B[j - 1]));
    }
  }
  // Backtrack
  let i = n;
  let j = m;
  while (i > 0) {
    if (j > i && f[i][j] === f[i][j - 1]) j--;
    else {
      if (swap) out[j - 1] = i - 1;
      else out[i - 1] = j - 1;
      i--;
      j--;
    }
  }
  return out;
}

/** Pair each new note with the nearest previous note (for chord-to-chord glide). */
export function glideSources(next, prev) {
  if (!prev || !prev.length) return next.map(() => null);
  return next.map((n) => prev.reduce((best, p) => (Math.abs(p - n) < Math.abs(best - n) ? p : best), prev[0]));
}

export function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** Common progressions (scale degrees) used by Chord Hero and Ear Trainer. */
export const PROGRESSIONS = [
  [0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 4, 0], [1, 4, 0, 0], [0, 3, 0, 4],
  [0, 5, 1, 4], [0, 2, 3, 4], [3, 4, 2, 5], [0, 4, 5, 2, 3, 0, 3, 4], [5, 4, 3, 4], [0, 6, 5, 4],
];
