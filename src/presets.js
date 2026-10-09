// Sound presets: partial engine parameter sets layered over DEFAULT_SOUND.

export const WAVES = ['Sine', 'Triangle', 'Saw', 'Square', 'Supersaw', 'FM Bell', 'Organ', 'Pluck', 'Sample'];
export const LFO_TARGETS = ['Pitch', 'Filter', 'Amp'];

export const DEFAULT_SOUND = {
  wave: 2, detune: 0.3, sub: 0, pw: 0.5,
  attack: 0.005, decay: 0.3, sustain: 0.7, release: 0.35,
  cutoff: 4000, reso: 0.15, fenv: 1.5, fdecay: 0.4, keytrack: 0.4,
  lfoRate: 5, lfoDepth: 0, lfoTarget: 0, glide: 0, pluckDamp: 0.5,
};

export const DEFAULT_FX = {
  chorus: 0, chorusMode: 0, trem: 0, tremRate: 5,
  delaySync: '3/16', delayFb: 0.35, delayMix: 0, revMix: 0.15, revSize: 0.6,
  bass: 0, drive: 0, volume: 0.8,
};

export const PRESETS = [
  { name: 'Warm Saw', wave: 2, cutoff: 2600, reso: 0.2, fenv: 1.2, attack: 0.01, release: 0.4 },
  { name: 'Super Stack', wave: 4, detune: 0.55, cutoff: 5000, fenv: 0.8, attack: 0.02, release: 0.6 },
  { name: 'Soft Pad', wave: 4, detune: 0.35, cutoff: 1400, reso: 0.1, fenv: 1, fdecay: 1.5, attack: 0.6, decay: 1, sustain: 0.85, release: 1.6, lfoTarget: 1, lfoDepth: 0.2, lfoRate: 0.3 },
  { name: 'Glass Bell', wave: 5, detune: 0.4, cutoff: 12000, fenv: 0, fdecay: 0.8, attack: 0.002, decay: 1.4, sustain: 0, release: 1.2 },
  { name: 'E-Piano', wave: 5, detune: 0.05, cutoff: 6000, fenv: 0.5, fdecay: 0.5, attack: 0.002, decay: 1.2, sustain: 0.25, release: 0.5, lfoTarget: 2, lfoDepth: 0.2, lfoRate: 4.5 },
  { name: 'Drawbar Organ', wave: 6, cutoff: 9000, fenv: 0, attack: 0.005, decay: 0.1, sustain: 1, release: 0.08, lfoTarget: 0, lfoDepth: 0.25, lfoRate: 6 },
  { name: 'Nylon Pluck', wave: 7, cutoff: 5000, pluckDamp: 0.55, attack: 0.001, release: 0.6 },
  { name: 'Harp', wave: 7, cutoff: 9000, pluckDamp: 0.2, attack: 0.001, release: 1.2 },
  { name: 'Square Lead', wave: 3, pw: 0.5, cutoff: 3500, reso: 0.3, fenv: 1.2, glide: 0.06, release: 0.2 },
  { name: 'Hollow Pulse', wave: 3, pw: 0.18, cutoff: 2200, reso: 0.25, fenv: 1.6, fdecay: 0.3, release: 0.3 },
  { name: 'Chip Tune', wave: 3, pw: 0.25, cutoff: 16000, fenv: 0, keytrack: 0, attack: 0.001, decay: 0.15, sustain: 0.6, release: 0.05 },
  { name: 'Pure Sine', wave: 0, cutoff: 18000, fenv: 0, attack: 0.01, release: 0.5 },
  { name: 'Flute-ish', wave: 1, cutoff: 3000, fenv: 0.6, attack: 0.08, release: 0.3, lfoTarget: 0, lfoDepth: 0.15, lfoRate: 5 },
  { name: 'Acid Stab', wave: 2, cutoff: 500, reso: 0.75, fenv: 4, fdecay: 0.18, attack: 0.001, decay: 0.2, sustain: 0.2, release: 0.15 },
  { name: 'Brass', wave: 2, cutoff: 900, reso: 0.1, fenv: 2.4, fdecay: 0.35, attack: 0.05, decay: 0.3, sustain: 0.8, release: 0.25 },
  { name: 'Strings', wave: 4, detune: 0.3, cutoff: 2600, fenv: 0.4, attack: 0.35, decay: 0.5, sustain: 0.9, release: 0.9, lfoTarget: 0, lfoDepth: 0.1, lfoRate: 5.5 },
  { name: 'Sub Bass Chords', wave: 0, sub: 0.8, cutoff: 1200, fenv: 0.5, attack: 0.005, release: 0.3 },
  { name: 'Wobble', wave: 2, sub: 0.5, cutoff: 700, reso: 0.5, fenv: 0.5, lfoTarget: 1, lfoDepth: 0.8, lfoRate: 3 },
  { name: 'Tremolo Keys', wave: 1, cutoff: 5000, fenv: 0.6, attack: 0.003, decay: 0.8, sustain: 0.4, release: 0.4, lfoTarget: 2, lfoDepth: 0.6, lfoRate: 6 },
  { name: 'Glide Saw', wave: 2, cutoff: 3000, reso: 0.25, glide: 0.18, attack: 0.01, release: 0.4 },
  { name: 'Dark Choir', wave: 4, detune: 0.2, cutoff: 900, reso: 0.35, fenv: 0.3, attack: 0.4, release: 1.2, lfoTarget: 1, lfoDepth: 0.15, lfoRate: 0.5 },
  { name: 'Music Box', wave: 5, detune: 0.9, cutoff: 14000, fenv: 0, attack: 0.001, decay: 0.7, sustain: 0, release: 0.7, keytrack: 0 },
  { name: 'Lo-Fi Keys', wave: 1, sub: 0.2, cutoff: 1800, fenv: 0.8, attack: 0.004, decay: 0.6, sustain: 0.5, release: 0.4, lfoTarget: 0, lfoDepth: 0.12, lfoRate: 0.8 },
  { name: 'Vocoder Carrier', wave: 4, detune: 0.4, sub: 0.3, cutoff: 9000, fenv: 0, attack: 0.01, release: 0.2 },
];

/** Full sound object for a preset (defaults filled in). */
export function presetSound(i) {
  const { name, ...p } = PRESETS[i] || PRESETS[0];
  return { ...DEFAULT_SOUND, ...p };
}
