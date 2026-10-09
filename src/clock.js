// Look-ahead scheduler on the audio clock (24 ticks per quarter note).
// A JS timer wakes up every 25 ms and schedules everything due in the next ~120 ms
// with exact AudioContext times, so timing does not depend on main-thread jitter.

export const PPQ = 24;
export const TICKS = { '1/4': 24, '1/8': 12, '1/8T': 8, '1/16': 6, '1/16T': 4, '1/32': 3, '1/2': 48, '1/1': 96 };

export class Clock {
  constructor(engine) {
    this.engine = engine;
    this.bpm = 100;
    this.swing = 0;
    this.tick = 0;
    this.nextTime = 0;
    this.subs = new Set();
    this.timer = null;
    this.lookahead = 0.12;
    this.running = false; // transport (beat/loop/sequencer) running
    this.startTick = 0;
    this.history = []; // recent [tick, time] pairs for UI sync
  }

  get tickDur() {
    return 60 / this.bpm / PPQ;
  }

  begin() {
    if (this.timer) return;
    this.nextTime = this.engine.now + 0.05;
    this.timer = setInterval(() => this.pump(), 25);
  }

  pump() {
    const now = this.engine.now;
    // If we fell far behind (tab was hidden), skip ahead instead of bursting.
    if (this.nextTime < now - 0.2) this.nextTime = now + 0.02;
    while (this.nextTime < now + this.lookahead) {
      let t = this.nextTime;
      // Swing delays every second 16th note
      if (this.swing > 0 && this.tick % 12 === 6) t += this.swing * this.tickDur * 6 * 0.66;
      for (const fn of this.subs) fn(this.tick, t);
      this.history.push(this.tick, t);
      if (this.history.length > 64) this.history.splice(0, 2);
      this.tick++;
      this.nextTime += this.tickDur;
    }
  }

  subscribe(fn) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  /** Transport position in ticks (relative to start) at the given tick. */
  pos(tick) {
    return tick - this.startTick;
  }

  /** Start the transport on the next tick to be scheduled. */
  startTransport() {
    if (this.running) return;
    this.startTick = this.tick;
    this.running = true;
  }

  stopTransport() {
    this.running = false;
  }

  /** Current transport position (ticks) at the audio clock's "now", for display. */
  displayPos() {
    const now = this.engine.now;
    const h = this.history;
    for (let i = h.length - 2; i >= 0; i -= 2) if (h[i + 1] <= now) return h[i] - this.startTick;
    return 0;
  }

  timeOfTick(tick) {
    return this.nextTime + (tick - this.tick) * this.tickDur;
  }
}
