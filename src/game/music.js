/**
 * Chill background music, synthesized live (no audio files): a lo-fi loop at 76 BPM.
 *
 *   - soft electric-piano chords (Fmaj9 → Dm9 → Gm9 → C9sus), a warm sine bass
 *   - brushed drums with a lazy swing, a little vinyl crackle
 *   - every few bars a short, random pentatonic melody on a mellow bell
 *   - everything goes through a gentle low-pass and an echo, so it sits in the background
 *
 * Notes are scheduled a little ahead from `update()` (called every frame), so it keeps time
 * even when frames stutter. It uses the app's AudioContext, which the first click unlocks.
 */
const BPM = 76;
const BEAT = 60 / BPM;
const STEP = BEAT / 2; // eighth notes
const SWING = 0.12; // late off-beats

// chords as MIDI notes (F major, jazzy voicings)
const CHORDS = [
  { root: 41, notes: [57, 60, 64, 67] }, // Fmaj9 (A C E G over F)
  { root: 38, notes: [57, 60, 64, 65] }, // Dm9  (A C E F over D)
  { root: 43, notes: [58, 62, 65, 69] }, // Gm9  (Bb D F A over G)
  { root: 36, notes: [58, 62, 65, 67] }, // C9sus (Bb D F G over C)
];
const MELODY = [72, 74, 77, 79, 81, 84]; // F-major pentatonic, upper octave

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class ChillMusic {
  constructor(app, { volume = 0.3 } = {}) {
    this.app = app;
    this.volume = volume;
    this.on = true;
    this.started = false;
    this.next = 0; // time of the next step
    this.step = 0;
    this.melody = null;
  }

  get ctx() { return this.app.sfx.ctx; }

  start() {
    const c = this.ctx;
    if (!c || this.started) return;
    this.started = true;
    // master → low-pass → speakers, with an echo send
    this.master = c.createGain();
    this.master.gain.value = 0.0001;
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 2600;
    this.lp.Q.value = 0.3;
    this.master.connect(this.lp).connect(c.destination);
    this.echo = c.createDelay(1);
    this.echo.delayTime.value = BEAT * 0.75;
    const fb = c.createGain();
    fb.gain.value = 0.28;
    const echoLp = c.createBiquadFilter();
    echoLp.type = 'lowpass';
    echoLp.frequency.value = 1500;
    this.echoIn = c.createGain();
    this.echoIn.gain.value = 0.35;
    this.echoIn.connect(this.echo);
    this.echo.connect(echoLp).connect(fb).connect(this.echo);
    echoLp.connect(this.master);
    // noise for drums and crackle
    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.crackle = c.createBuffer(1, len * 2, c.sampleRate);
    const k = this.crackle.getChannelData(0);
    for (let i = 0; i < k.length; i++) k[i] = Math.random() < 0.0009 ? (Math.random() - 0.5) * 0.9 : (Math.random() - 0.5) * 0.012;
    const cr = c.createBufferSource();
    cr.buffer = this.crackle;
    cr.loop = true;
    const crG = c.createGain();
    crG.gain.value = 0.25;
    cr.connect(crG).connect(this.master);
    cr.start();
    this.crackleSrc = cr;
    this.next = c.currentTime + 0.15;
    this.fadeTo(this.on ? this.volume : 0.0001, 2.5);
  }

  fadeTo(v, secs) {
    if (!this.master) return;
    const g = this.master.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.exponentialRampToValueAtTime(Math.max(0.0001, v), now + secs);
  }

  setOn(on) {
    this.on = on;
    this.fadeTo(on ? this.volume : 0.0001, 0.6);
  }

  stop() {
    if (!this.started) return;
    this.fadeTo(0.0001, 0.4);
    const master = this.master;
    const src = this.crackleSrc;
    setTimeout(() => { try { src.stop(); master.disconnect(); } catch { /* already gone */ } }, 600);
    this.started = false;
  }

  /** Call every frame: schedules the next notes about 0.25 s ahead. */
  update() {
    if (!this.started) { if (this.ctx && this.ctx.state === 'running') this.start(); return; }
    const c = this.ctx;
    if (this.next < c.currentTime - 0.5) this.next = c.currentTime + 0.05; // tab was asleep
    while (this.next < c.currentTime + 0.25) {
      this.playStep(this.step, this.next + (this.step % 2 ? SWING * STEP : 0));
      this.step++;
      this.next += STEP;
    }
  }

  playStep(i, t) {
    const bar = Math.floor(i / 8);
    const s = i % 8; // eighth within the bar
    const chord = CHORDS[bar % CHORDS.length];
    // keys: chord on beat 1, a softer re-strike on the "and" of 2
    if (s === 0) this.keys(chord.notes, t, BEAT * 3.2, 0.055);
    if (s === 3 && bar % 2 === 1) this.keys(chord.notes.slice(1), t, BEAT * 1.6, 0.03);
    // bass: root on 1, fifth on the "and" of 3
    if (s === 0) this.bass(chord.root, t, BEAT * 1.6);
    if (s === 5) this.bass(chord.root + 7, t, BEAT * 0.8);
    if (s === 7 && bar % 4 === 3) this.bass(chord.root + 12, t, BEAT * 0.4);
    // drums (start after the first two bars)
    if (bar >= 2) {
      if (s === 0 || (s === 5 && bar % 2 === 0)) this.kick(t);
      if (s === 2 || s === 6) this.snare(t);
      this.hat(t, s % 2 ? 0.012 : 0.02);
    }
    // a little melody every other phrase
    if (bar >= 4 && bar % 8 >= 4 && s % 2 === 0 && Math.random() < 0.45) {
      const n = MELODY[Math.floor(Math.random() * MELODY.length)];
      this.bell(n, t, BEAT * 1.5);
    }
  }

  voice(type, f, t, dur, vol, { attack = 0.02, echo = 0 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    if (echo) { const e = c.createGain(); e.gain.value = echo; g.connect(e).connect(this.echoIn); }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  keys(notes, t, dur, vol) {
    notes.forEach((n, i) => {
      const at = t + i * 0.018; // slightly rolled
      this.voice('sine', hz(n), at, dur, vol, { attack: 0.03, echo: 0.6 });
      this.voice('triangle', hz(n) * 2.001, at, dur * 0.35, vol * 0.18, { attack: 0.01 });
    });
  }

  bass(n, t, dur) {
    this.voice('sine', hz(n), t, dur, 0.13, { attack: 0.02 });
    this.voice('triangle', hz(n), t, dur * 0.6, 0.03, { attack: 0.02 });
  }

  bell(n, t, dur) {
    this.voice('sine', hz(n), t, dur, 0.035, { attack: 0.005, echo: 1 });
    this.voice('sine', hz(n) * 3.01, t, dur * 0.25, 0.008, { attack: 0.005 });
  }

  kick(t) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.35);
  }

  noiseHit(t, dur, vol, type, freq, q = 0.8) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  snare(t) { this.noiseHit(t, 0.22, 0.05, 'bandpass', 1800, 0.6); }
  hat(t, vol) { this.noiseHit(t, 0.05, vol, 'highpass', 7000, 0.5); }
}
