// Drum names (pad order in Drums mode), GM notes for MIDI out, and the beat pattern bank.

export const DRUMS = ['Kick', 'Snare', 'Hat', 'Open Hat', 'Clap', 'Tom', 'Rim'];
export const DRUM_MIDI = [36, 38, 42, 46, 39, 45, 37];
export const KITS = ['Analog', 'Punch', 'Lo-Fi'];

// 16 steps per bar. X = accent, x = normal, o = ghost, . = rest.
// Lanes: k kick, s snare, h hat, o open hat, c clap, t tom, r rim.
const BASE = [
  { name: 'Four Floor', k: 'x...x...x...x...', h: '..x...x...x...x.', c: '....x.......x...' },
  { name: 'Boom Bap', k: 'x......x..x.....', s: '....X.......X...', h: 'x.x.x.x.x.x.x.x.' },
  { name: 'Rock', k: 'x.......x.x.....', s: '....X.......X...', h: 'x.x.x.x.x.x.x.x.' },
  { name: 'Trap', k: 'x......x..x.....', s: '........X.......', h: 'xxxxxxxxxxx.xxxx', o: '.........x......' },
  { name: 'Lo-Fi', k: 'x.....x...x.....', s: '....x.......x..o', h: 'x.x.x.x.x.x.x.x.', r: '...........x....' },
  { name: 'Funk', k: 'x.x.......x..x..', s: '....X..o.o..X..o', h: 'xxxxxxxxxxxxxxxx' },
  { name: 'Disco', k: 'x...x...x...x...', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', o: '..x...x...x...x.' },
  { name: 'House', k: 'x...x...x...x...', c: '....x.......x...', o: '..x...x...x...x.', h: 'x.xxx.xxx.xxx.xx' },
  { name: 'Reggaeton', k: 'x...x...x...x...', s: '...x..x....x..x.', h: 'x.x.x.x.x.x.x.x.' },
  { name: 'Bossa', k: 'x..xx..xx..xx..x', r: 'x..x..x...x..x..', h: 'xxxxxxxxxxxxxxxx' },
  { name: 'Shuffle', k: 'x.....x.x.......', s: '....x.......x...', h: 'x..xx..xx..xx..x' },
  { name: 'Half Time', k: 'x.........x.....', s: '........X.......', h: 'x.x.x.x.x.x.x.x.' },
  { name: 'Breakbeat', k: 'x.x.......x.....', s: '....x..o.o..x...', h: 'x.x.x.x.x.x.x.x.' },
  { name: 'Dembow', k: 'x...x...x...x...', s: '...x..x....x..x.', r: '...x..x....x..x.' },
  { name: 'Drill', k: 'x.....x...x..x..', s: '...x.......x....', h: 'x..x..x.x..x..x.' },
  { name: 'Afrobeat', k: 'x..x..x...x..x..', s: '....x.......x...', r: '..x..x..x..x..x.', h: 'x.xxx.xxx.xxx.xx' },
  { name: 'Synthwave', k: 'x...x...x...x...', s: '....X.......X...', h: 'x.x.x.x.x.x.x.x.', t: '..............xx' },
  { name: 'Jungle', k: 'x.........x.....', s: '....x..x.x..x..x', h: 'x.x.x.x.x.x.x.x.' },
  { name: 'Waltz-ish', k: 'x.....x.....x...', s: '....x...x.......', h: 'x.x.x.x.x.x.x.x.' },
  { name: 'Hip Hop', k: 'x..x...x..x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.xx' },
  { name: 'Pop', k: 'x.......x.......', c: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', s: '....x.......x...' },
  { name: 'Garage', k: 'x.....x...x.....', s: '....x.......x...', h: '..x...x.x.x...x.', r: '.x.......x......' },
  { name: 'Motorik', k: 'x...x...x...x.x.', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx' },
  { name: 'Tom Groove', k: 'x.......x.......', t: '..x..x....x..x..', r: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
];

const LANES = ['k', 's', 'h', 'o', 'c', 't', 'r'];

function parse(p) {
  // steps[i] = array of [drumIndex, velocity]
  const steps = Array.from({ length: 16 }, () => []);
  LANES.forEach((lane, d) => {
    const s = p[lane];
    if (!s) return;
    for (let i = 0; i < 16; i++) {
      const ch = s[i];
      if (ch === 'X') steps[i].push([d, 1]);
      else if (ch === 'x') steps[i].push([d, d === 2 ? (i % 4 === 0 ? 0.75 : 0.5) : 0.8]);
      else if (ch === 'o') steps[i].push([d, 0.3]);
    }
  });
  return steps;
}

// Variant B: busier hats and a fill on the last beat.
function variant(p) {
  const v = { ...p, name: p.name + ' B' };
  if (v.h && !/x{16}/.test(v.h)) v.h = v.h.replace(/\./g, (m, i) => (i % 2 === 1 ? 'o' : m));
  const s = (v.s || '................').split('');
  s[13] = s[13] === '.' ? 'o' : s[13];
  s[14] = 'x';
  s[15] = s[15] === '.' ? 'x' : s[15];
  v.s = s.join('');
  return v;
}

export const PATTERNS = BASE.flatMap((p) => [p, variant(p)]).map((p) => ({ name: p.name, steps: parse(p) }));
