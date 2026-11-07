/**
 * All the sounds, synthesized live (no audio files): the diesel engine (a continuous loop whose
 * pitch follows the speed), horn, air doors, the stop bell, indicator ticks, cheers...
 */
export class Sfx {
  constructor() {
    this.ctx = null;
    this.on = true;
    this.engine = null;
  }

  /** Browsers only allow sound after the user clicks or presses something. */
  unlock() {
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch {
      /* audio unavailable */
    }
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  tone(f1, f2, dur, type = 'sine', vol = 0.08, delay = 0) {
    const c = this.ctx;
    if (!c || !this.on) return;
    const t = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f1, t);
    if (f2) osc.frequency.exponentialRampToValueAtTime(f2, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  burst(dur, freq, q = 1, vol = 0.1, delay = 0, type = 'bandpass') {
    const c = this.ctx;
    if (!c || !this.on) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  play(kind) {
    switch (kind) {
      case 'click': this.tone(620, 900, 0.07, 'triangle', 0.06); break;
      case 'horn':
        // two-tone bus horn
        this.tone(330, 325, 0.55, 'sawtooth', 0.05); this.tone(415, 410, 0.55, 'sawtooth', 0.045);
        this.tone(660, 650, 0.55, 'square', 0.012);
        break;
      case 'doorOpen': this.burst(0.7, 2600, 0.5, 0.09); this.tone(180, 120, 0.4, 'triangle', 0.03, 0.15); break;
      case 'doorClose': this.burst(0.5, 2200, 0.6, 0.07); this.tone(140, 90, 0.18, 'square', 0.04, 0.45); break;
      case 'bell': this.tone(1318, null, 0.6, 'sine', 0.07); this.tone(1047, null, 0.8, 'sine', 0.07, 0.35); break;
      case 'tick': this.tone(1800, null, 0.03, 'square', 0.02); break;
      case 'tock': this.tone(1200, null, 0.03, 'square', 0.018); break;
      case 'brake': this.burst(0.35, 3200, 4, 0.025); break;
      case 'airBrake': this.burst(0.5, 3600, 0.6, 0.06); break;
      case 'step': this.burst(0.06, 700, 1.4, 0.03); break;
      case 'hello': this.tone(600, 900, 0.12, 'sine', 0.05); this.tone(900, 700, 0.14, 'sine', 0.05, 0.12); break;
      case 'coin': this.tone(988, null, 0.08, 'square', 0.04); this.tone(1319, null, 0.25, 'square', 0.04, 0.08); break;
      case 'star': this.tone(1046, 2093, 0.18, 'triangle', 0.06); break;
      case 'yay': [660, 880, 1100].forEach((f, i) => this.tone(f, f * 1.2, 0.12, 'sine', 0.05, i * 0.08)); break;
      case 'aw': this.tone(500, 330, 0.3, 'triangle', 0.05); break;
      case 'buzz': this.tone(220, 200, 0.45, 'square', 0.04); this.tone(233, 210, 0.45, 'square', 0.03); break;
      case 'win': [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, null, 0.26, 'triangle', 0.07, i * 0.1)); break;
      case 'fanfare':
        [523, 659, 784].forEach((f, i) => this.tone(f, null, 0.13, 'square', 0.035, i * 0.11));
        this.tone(1047, null, 0.6, 'square', 0.04, 0.33); this.tone(1319, null, 0.6, 'triangle', 0.045, 0.33);
        break;
      case 'clap': for (let i = 0; i < 8; i++) this.burst(0.05, 1500, 1, 0.05, i * 0.08 + Math.random() * 0.03); break;
      case 'bump': this.tone(90, 60, 0.18, 'sine', 0.12); this.burst(0.12, 400, 1, 0.05); break;
      default: break;
    }
  }

  /** The engine: a low two-oscillator drone, louder and higher with speed and throttle. */
  setEngine(on, speed = 0, throttle = 0) {
    const c = this.ctx;
    if (!c) return;
    if (on && !this.engine) {
      const o1 = c.createOscillator();
      const o2 = c.createOscillator();
      const lfo = c.createOscillator();
      const lfoG = c.createGain();
      const f = c.createBiquadFilter();
      const g = c.createGain();
      o1.type = 'sawtooth';
      o2.type = 'square';
      f.type = 'lowpass';
      f.frequency.value = 380;
      f.Q.value = 2;
      g.gain.value = 0.0001;
      lfo.frequency.value = 9;
      lfoG.gain.value = 6;
      lfo.connect(lfoG).connect(o1.frequency);
      o1.connect(f);
      o2.connect(f);
      const g2 = c.createGain();
      g2.gain.value = 0.25;
      o2.disconnect();
      o2.connect(g2).connect(f);
      f.connect(g).connect(this.master);
      o1.start(); o2.start(); lfo.start();
      this.engine = { o1, o2, lfo, f, g };
    }
    if (!this.engine) return;
    const e = this.engine;
    const now = c.currentTime;
    if (!on) {
      e.g.gain.setTargetAtTime(0.0001, now, 0.2);
      const eng = e;
      setTimeout(() => { try { eng.o1.stop(); eng.o2.stop(); eng.lfo.stop(); } catch { /* done */ } }, 800);
      this.engine = null;
      return;
    }
    const rpm = 42 + speed * 4.2 + throttle * 10; // Hz of the drone
    e.o1.frequency.setTargetAtTime(rpm, now, 0.15);
    e.o2.frequency.setTargetAtTime(rpm * 0.5, now, 0.15);
    e.lfo.frequency.setTargetAtTime(7 + speed * 0.6, now, 0.2);
    e.f.frequency.setTargetAtTime(260 + speed * 22 + throttle * 220, now, 0.15);
    e.g.gain.setTargetAtTime(this.on ? 0.05 + throttle * 0.035 + speed * 0.002 : 0.0001, now, 0.15);
  }

  stopAll() { this.setEngine(false); }
}
