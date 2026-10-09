// Main-thread side of the audio engine: context, worklet node, mic and recording.

const SILENT_WAV =
  'data:audio/wav;base64,UklGRuwAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YcgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

export class Engine {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.nextId = 1;
    this.listeners = new Set();
    this.micStream = null;
    this.micSource = null;
    this.recorder = null;
    this.meter = { mic: 0, voices: 0, rec: -1 };
  }

  /** Must be called from a user gesture (iOS requirement). */
  async start() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      return;
    }
    // Stop the iOS ring/silent switch from muting Web Audio.
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
      else {
        const a = new Audio(SILENT_WAV);
        a.loop = true;
        a.setAttribute('playsinline', '');
        a.play().catch(() => {});
        this.silentEl = a;
      }
    } catch {}
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    // Resume synchronously inside the gesture before any await.
    const resumed = this.ctx.resume();
    await this.ctx.audioWorklet.addModule(new URL('./worklet/synth.js', import.meta.url));
    this.node = new AudioWorkletNode(this.ctx, 'lowchord', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.node.connect(this.ctx.destination);
    this.node.port.onmessage = (e) => {
      const m = e.data;
      if (m.t === 'meter') this.meter = m;
      for (const fn of this.listeners) fn(m);
    };
    await resumed;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.ctx.state !== 'running') this.ctx.resume();
    });
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  get latencyMs() {
    if (!this.ctx) return 0;
    return Math.round(((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000);
  }

  onMessage(fn) {
    this.listeners.add(fn);
  }

  post(m) {
    if (this.node) this.node.port.postMessage(m);
  }

  /** Start a note. Returns an id for noteOff. `when` = 0 means now. */
  noteOn(note, vel = 0.8, when = 0, glideFrom = -1, src = 'live', glideTime = 0) {
    const id = this.nextId++;
    this.post({ t: 'on', id, n: note, v: vel, w: when, g: glideFrom == null ? -1 : glideFrom, gt: glideTime, src });
    return id;
  }

  /** Glide the voice playing `fromId` to a new note (no retrigger). Returns the new id. */
  legato(fromId, fromNote, note, vel, glideTime, restrike = true, src = 'live') {
    const id = this.nextId++;
    this.post({ t: 'leg', from: fromId, fn: fromNote, id, n: note, v: vel, gt: glideTime, rt: restrike ? 1 : 0, w: 0, src });
    return id;
  }

  noteOff(id, when = 0, src = 'live') {
    this.post({ t: 'off', id, w: when, src });
  }

  drum(d, vel = 1, when = 0, src = 'live') {
    this.post({ t: 'drum', d, v: vel, w: when, src });
  }

  allOff() {
    this.post({ t: 'alloff' });
  }

  cancel(src) {
    this.post({ t: 'cancel', src });
  }

  set(k, v) {
    this.post({ t: 'p', k, v });
  }

  setMany(p) {
    this.post({ t: 'ps', p });
  }

  // ---------- Microphone ----------

  async enableMic() {
    if (this.micSource) return true;
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      console.warn('mic denied', e);
      return false;
    }
    this.micSource = this.ctx.createMediaStreamSource(this.micStream);
    this.micSource.connect(this.node);
    return true;
  }

  disableMic() {
    if (!this.micSource) return;
    this.micSource.disconnect();
    for (const t of this.micStream.getTracks()) t.stop();
    this.micSource = null;
    this.micStream = null;
  }

  recordSample(on) {
    this.post({ t: 'rec', on });
  }

  loadSample(buf, rate) {
    this.post({ t: 'sample', buf, rate });
  }

  // ---------- Bounce to file ----------

  startBounce() {
    if (!window.MediaRecorder) return false;
    const dest = this.ctx.createMediaStreamDestination();
    this.node.connect(dest);
    const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(dest.stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    this.recorder = { rec, chunks, dest, mimeType: rec.mimeType || mimeType };
    rec.start();
    return true;
  }

  stopBounce() {
    return new Promise((resolve) => {
      const r = this.recorder;
      if (!r) return resolve(null);
      r.rec.onstop = () => {
        this.node.disconnect(r.dest);
        this.recorder = null;
        resolve(new Blob(r.chunks, { type: r.mimeType || 'audio/webm' }));
      };
      r.rec.stop();
    });
  }
}
