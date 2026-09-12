// All sound is generated procedurally with the Web Audio API — no audio
// files to fetch, so the game works offline and loads instantly.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambientNodes = null;
    this.lastFootstep = 0;
  }

  // Must be called from inside a user-gesture handler (click) or the
  // browser will refuse to start the AudioContext.
  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this._startAmbient();
  }

  _startAmbient() {
    const ctx = this.ctx;
    const hum = ctx.createOscillator();
    hum.type = "sine";
    hum.frequency.value = 55;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.03;
    hum.connect(humGain).connect(this.master);
    hum.start();

    const hiss = ctx.createOscillator();
    hiss.type = "sine";
    hiss.frequency.value = 220;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.015;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.01;
    lfo.connect(lfoGain).connect(hissGain.gain);
    lfo.start();
    hiss.connect(hissGain).connect(this.master);
    hiss.start();

    this.ambientNodes = { hum, hiss, lfo };
  }

  _tone(freq, duration, type = "sine", startGain = 0.2, when = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(startGain, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  footstep() {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - this.lastFootstep < 330) return;
    this.lastFootstep = now;
    const ctx = this.ctx;
    const bufferSize = ctx.sampleRate * 0.08;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 300 + Math.random() * 100;
    const gain = ctx.createGain();
    gain.gain.value = 0.35;
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start();
  }

  click() {
    this._tone(880, 0.05, "square", 0.08);
  }

  pickup() {
    this._tone(523.25, 0.12, "sine", 0.15);
    this._tone(659.25, 0.16, "sine", 0.12, 0.08);
    this._tone(783.99, 0.22, "sine", 0.1, 0.16);
  }

  denied() {
    this._tone(160, 0.18, "sawtooth", 0.15);
    this._tone(110, 0.22, "sawtooth", 0.15, 0.1);
  }

  unlock() {
    this._tone(220, 0.1, "square", 0.12);
    this._tone(440, 0.1, "square", 0.1, 0.09);
    this._tone(880, 0.3, "sine", 0.12, 0.18);
  }

  creak() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const t0 = ctx.currentTime;
    osc.frequency.setValueAtTime(140, t0);
    osc.frequency.linearRampToValueAtTime(90, t0 + 1.1);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.06, t0 + 0.2);
    gain.gain.linearRampToValueAtTime(0.0001, t0 + 1.2);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 400;
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 1.3);
  }

  clack() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const bufferSize = ctx.sampleRate * 0.05;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.value = 0.25;
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start();
  }

  klaxon() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(440, t0);
    osc.frequency.setValueAtTime(330, t0 + 0.25);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(0.12, t0 + 0.05);
    gain.gain.linearRampToValueAtTime(0.001, t0 + 0.5);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.55);
  }

  victory() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      this._tone(f, 0.4, "sine", 0.14, i * 0.12)
    );
  }
}
