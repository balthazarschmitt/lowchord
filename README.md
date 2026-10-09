# LowChord

A pocket chord synthesizer that runs in your phone's browser. Seven chord pads always play the chords that belong to your key; a joystick turns them into 7ths, 9ths, sus, diminished and borrowed chords. Inspired by the HiChord; no install, no app store.

Works on iPhone (Safari) and Android (Chrome). Add it to your home screen for full-screen play and offline use.

## Features

- **Chords:** 7 diatonic pads, 12 keys, 10 scales, octave −2…+2, three joystick modes (Default, Extension, Chromatic) for 24 chord variations per pad, smooth voice leading, close/spread voicings, inversions, bass note.
- **Modes:** Play, Strum (plus an always-on strum strip), Lead, Drone, Arpeggio (5 patterns, synced), Repeat, 16-step chord Sequencer, Drums, Chord Hero rhythm game, Ear Trainer.
- **Synth:** 12-voice engine in an AudioWorklet. Sine, triangle, saw, pulse, supersaw, FM bell, organ, Karplus-Strong pluck and your own sample. ADSR, resonant filter with envelope, LFO, glide, sub oscillator. 24 presets plus user presets.
- **Effects:** chorus/flanger, tremolo, tempo-synced ping-pong delay, reverb, bass boost, drive, limiter.
- **Beat:** 48 drum patterns, 3 synthesized kits, tempo, swing, tap tempo.
- **Looper:** 6 tracks of note events with quantize, mute, undo; record the output to an audio file.
- **Mic:** sampler (record a sound, play it chromatically) and a 16-band vocoder.
- **MIDI out** (Chrome/Android only; iOS Safari has no Web MIDI), with clock and per-track channels.
- **Tilt** the phone as a joystick.

Keyboard for desktop testing: `1`–`7` pads, arrow keys / WASD joystick.

## Run locally

```sh
npx http-server -c-1 .      # then open http://localhost:8080
npm test                    # chord theory unit tests
node tests/smoke.mjs        # headless phone-viewport test + DSP load check (needs Playwright)
```

No build step and no dependencies: plain ES modules.

## Deploy

`.github/workflows/pages.yml` runs the tests and publishes to GitHub Pages on every push to `main`. One-time setup: repo **Settings → Pages → Source: GitHub Actions**.

## Layout

| Path | What |
|---|---|
| `src/theory.js` | scales, chords, joystick transforms, voicing (pure, unit-tested) |
| `src/worklet/synth.js` | the whole audio engine: voices, drums, vocoder, sampler, effects |
| `src/engine.js` | AudioContext, mic, recording |
| `src/clock.js` | look-ahead scheduler on the audio clock |
| `src/modes.js` | play modes, sequencer, beat player, Chord Hero, Ear Trainer |
| `src/looper.js` | 6-track event looper |
| `src/main.js` | state, panels, wiring |
