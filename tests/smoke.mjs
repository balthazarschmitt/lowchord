// End-to-end smoke test in headless Chromium at phone viewports.
// Usage: node tests/smoke.mjs   (serves the repo on a random port)
import { chromium, devices } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { mkdirSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://localhost:${server.address().port}/`;
const outDir = join(root, 'test-results');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

for (const [label, device] of [['iphone', devices['iPhone 13']], ['pixel', devices['Pixel 7']]]) {
  const ctx = await browser.newContext({ ...device, defaultBrowserType: undefined });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.tap('#start');
  await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 10000 });
  check(true, `${label}: app boots`);

  // Pad press → chord on display and voices sounding
  const pad = page.locator('.pad[data-deg="4"]');
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(250);
  const state = await page.evaluate(() => ({
    name: window.__lowchord.perf.active && window.__lowchord.perf.active.chord.name,
    voices: window.__lowchord.engine.meter.voices,
  }));
  check(state.name === 'G', `${label}: V pad plays G (got ${state.name})`);
  check(state.voices >= 3, `${label}: engine has ${state.voices} active voices`);

  // Joystick up-right while holding → G7
  await page.evaluate(() => window.__lowchord.perf.setJoy('ur'));
  const name7 = await page.evaluate(() => window.__lowchord.perf.active.chord.name);
  check(name7 === 'G7', `${label}: joystick ↗ gives G7 (got ${name7})`);
  await page.evaluate(() => window.__lowchord.perf.setJoy('c'));
  await page.mouse.up();
  await page.waitForTimeout(100);
  check(await page.evaluate(() => !window.__lowchord.perf.active), `${label}: release stops chord`);

  await page.screenshot({ path: join(outDir, `${label}-play.png`) });

  // Chord change with glide reuses the sounding voices (C → F → Am stays at 3 voices)
  const legatoVoices = await page.evaluate(async () => {
    const a = window.__lowchord;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // Let release tails from earlier steps die out first
    for (let i = 0; i < 40 && a.engine.meter.voices > 0; i++) await wait(50);
    a.perf.tail = null;
    a.perf.padDown(0); await wait(150);
    a.perf.padDown(3); a.perf.padUp(0); await wait(150);
    a.perf.padDown(5); a.perf.padUp(3); await wait(150);
    const v = a.engine.meter.voices;
    a.perf.padUp(5);
    return v;
  });
  check(legatoVoices === 3, `${label}: chord changes glide on the same 3 voices (got ${legatoVoices})`);

  // Every panel opens without errors
  for (const p of ['key', 'sound', 'fx', 'mode', 'beat', 'loop', 'mic', 'midi', 'settings']) {
    await page.click(`[data-panel="${p}"]`);
    await page.waitForTimeout(60);
    if (p === 'sound') await page.screenshot({ path: join(outDir, `${label}-sound.png`) });
    await page.click(`[data-panel="${p}"]`);
  }
  check(true, `${label}: all panels open`);

  // Every mode: press and release a pad
  const modes = await page.evaluate(() => ['play', 'strum', 'lead', 'drone', 'arp', 'repeat', 'seq', 'drums', 'hero', 'ear']);
  for (const m of modes) {
    await page.evaluate((m) => window.__lowchord.perf.setMode(m), m);
    await pad.dispatchEvent('pointerdown', { pointerId: 7, isPrimary: true });
    await page.waitForTimeout(120);
    await pad.dispatchEvent('pointerup', { pointerId: 7, isPrimary: true });
  }
  check(true, `${label}: all modes accept input`);

  // Beat + looper record/playback
  await page.evaluate(() => {
    const a = window.__lowchord;
    a.perf.setMode('play');
    a.S.beatOn = true;
    a.clock.startTransport();
    a.looper.toggleRecord();
  });
  await pad.dispatchEvent('pointerdown', { pointerId: 8, isPrimary: true });
  await page.waitForTimeout(300);
  await pad.dispatchEvent('pointerup', { pointerId: 8, isPrimary: true });
  await page.evaluate(() => window.__lowchord.looper.toggleRecord());
  const loopEvents = await page.evaluate(() => window.__lowchord.looper.tracks[0].events.length);
  check(loopEvents >= 3, `${label}: looper recorded ${loopEvents} note events`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, `${label}-beat.png`) });
  await page.evaluate(() => { const a = window.__lowchord; a.clock.stopTransport(); a.out.stopSrc('loop'); a.out.stopSrc('beat'); });

  // Sequencer: step-enter two chords while stopped, then play
  const seqVoices = await page.evaluate(async () => {
    const a = window.__lowchord;
    a.perf.setMode('seq');
    a.perf.seq.rec = true;
    a.perf.padDown(0); a.perf.padUp(0);
    a.perf.padDown(3); a.perf.padUp(3);
    a.perf.seq.rec = false;
    a.clock.startTransport();
    await new Promise((r) => setTimeout(r, 400));
    const v = a.engine.meter.voices;
    a.clock.stopTransport(); a.perf.seqStop();
    return v;
  });
  check(seqVoices >= 3, `${label}: sequencer plays steps (${seqVoices} voices)`);

  // Arpeggio produces notes over time
  const arpCount = await page.evaluate(async () => {
    const a = window.__lowchord;
    a.perf.setMode('arp');
    let n = 0;
    const orig = a.out.noteOn.bind(a.out);
    a.out.noteOn = (...args) => { n++; return orig(...args); };
    a.perf.padDown(0);
    await new Promise((r) => setTimeout(r, 700));
    a.perf.padUp(0);
    a.out.noteOn = orig;
    return n;
  });
  check(arpCount >= 4, `${label}: arpeggiator played ${arpCount} notes in 0.7 s`);

  // Chord Hero renders
  await page.evaluate(() => window.__lowchord.perf.setMode('hero'));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(outDir, `${label}-hero.png`) });
  await page.evaluate(() => { const a = window.__lowchord; a.perf.setMode('play'); a.clock.stopTransport(); a.out.stopSrc('beat'); a.S.beatOn = false; });

  // Landscape
  await page.setViewportSize({ width: device.viewport.height, height: device.viewport.width });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(outDir, `${label}-landscape.png`) });

  check(errors.length === 0, `${label}: no console errors ${errors.length ? JSON.stringify(errors) : ''}`);
  await ctx.close();
}

// DSP load: render 10 s offline with 12 voices + all effects, compare to real time.
{
  const page = await (await browser.newContext()).newPage();
  await page.goto(url);
  const r = await page.evaluate(async () => {
    const sr = 48000;
    const ctx = new OfflineAudioContext(2, sr * 10, sr);
    await ctx.audioWorklet.addModule('src/worklet/synth.js');
    const node = new AudioWorkletNode(ctx, 'lowchord', { outputChannelCount: [2] });
    node.connect(ctx.destination);
    node.port.postMessage({ t: 'ps', p: { wave: 4, detune: 0.5, sub: 0.5, chorus: 0.6, trem: 0.3, delayMix: 0.4, revMix: 0.5, bass: 6, drive: 0.3 } });
    for (let i = 0; i < 12; i++) node.port.postMessage({ t: 'on', id: i + 1, n: 48 + i * 3, v: 0.8, w: 0, g: -1 });
    for (let b = 0; b < 40; b++) node.port.postMessage({ t: 'drum', d: b % 7, v: 0.9, w: 0.1 + b * 0.25 });
    await new Promise((r) => setTimeout(r, 50));
    const t0 = performance.now();
    const buf = await ctx.startRendering();
    const ms = performance.now() - t0;
    const d = buf.getChannelData(0);
    let peak = 0, nan = false;
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; if (Number.isNaN(d[i])) nan = true; }
    return { ms, peak, nan };
  });
  const load = r.ms / 10000;
  console.log(`DSP: 10 s rendered in ${r.ms.toFixed(0)} ms → ${(load * 100).toFixed(1)}% of real time on this machine; peak ${r.peak.toFixed(3)}`);
  check(!r.nan && r.peak > 0.05 && r.peak <= 1, 'worst-case patch renders clean audio (no NaN, no clipping)');
  check(load < 0.25, 'worst-case patch uses < 25% of real time on desktop CPU');
}

// Glide: one sine voice slides C4 → C5 over 0.2 s via a legato message; measure pitch over time.
{
  const page = await (await browser.newContext()).newPage();
  await page.goto(url);
  const f = await page.evaluate(async () => {
    const sr = 48000;
    const ctx = new OfflineAudioContext(1, sr * 1.2, sr);
    await ctx.audioWorklet.addModule('src/worklet/synth.js');
    const node = new AudioWorkletNode(ctx, 'lowchord', { outputChannelCount: [2] });
    node.connect(ctx.destination);
    node.port.postMessage({ t: 'ps', p: { wave: 0, revMix: 0, delayMix: 0, chorus: 0, cutoff: 18000, attack: 0.001, sustain: 1 } });
    node.port.postMessage({ t: 'on', id: 1, n: 60, v: 1, w: 0, g: -1 });
    node.port.postMessage({ t: 'leg', from: 1, id: 2, n: 72, v: 1, gt: 0.2, rt: 0, w: 0.4 });
    await new Promise((r) => setTimeout(r, 50));
    const d = (await ctx.startRendering()).getChannelData(0);
    // Frequency from zero crossings in 40 ms windows
    const freqAt = (t) => {
      const a = Math.round(t * sr), n = Math.round(0.04 * sr);
      let z = 0;
      for (let i = a + 1; i < a + n; i++) if (d[i - 1] <= 0 && d[i] > 0) z++;
      return z / 0.04;
    };
    return { before: freqAt(0.3), mid: freqAt(0.44), after: freqAt(0.9) };
  });
  console.log(`glide: ${f.before} Hz → ${f.mid} Hz (mid-slide) → ${f.after} Hz`);
  check(Math.abs(f.before - 262) < 30 && Math.abs(f.after - 523) < 30 && f.mid > 300 && f.mid < 500, 'legato voice glides smoothly between pitches');
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
