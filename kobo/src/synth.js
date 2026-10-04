// チップチューン＋ロックの音源（Web Audio）。音源ファイルは使わない。
//   lead   … 矩形波（デューティ25%、ファミコンの音）＋長い音にビブラート＋付点8分のエコー
//   guitar … のこぎり波2本を少しずらして重ね、歪ませる（パワーコード）
//   bass   … 三角波
//   drums  … キック＝サイン波のピッチを急に下げる、スネア/ハイハット/クラッシュ＝ノイズ
//   orig   … 原曲の音（比べる用。やわらかい三角波）
// events: [{ beat, inst, pitch, dur, vel }]（beat 順）。ループの頭ごとに getSong() を呼び直すので、編集が次の周から反映される。

const mtof = (p) => 440 * 2 ** ((p - 69) / 12);

export class Player {
  constructor() {
    this.ctx = null;
    this.playing = false;
    this.onLoop = null;
  }

  ensure() {
    if (!this.ctx) {
      const ctx = (this.ctx = new AudioContext());
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      this.master = ctx.createGain();
      this.master.gain.value = 0.8;
      comp.connect(this.master).connect(ctx.destination);
      this.out = comp;

      const n = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, n, n);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;

      const H = 64, re = new Float32Array(H), im = new Float32Array(H), duty = 0.25;
      for (let k = 1; k < H; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      this.pulse = ctx.createPeriodicWave(re, im);

      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 9); }
      this.curve = curve;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // 1回の再生ごとの配線（止めるときにまとめて切る）
  makeBus() {
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.connect(this.out);
    const lead = ctx.createGain();
    lead.connect(bus);
    const delay = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain();
    fb.gain.value = 0.3; wet.gain.value = 0.22;
    lead.connect(delay); delay.connect(fb).connect(delay); delay.connect(wet).connect(bus);
    const gtr = ctx.createGain(), shaper = ctx.createWaveShaper(), lp = ctx.createBiquadFilter(), mid = ctx.createBiquadFilter(), gout = ctx.createGain();
    shaper.curve = this.curve; shaper.oversample = '2x';
    lp.type = 'lowpass'; lp.frequency.value = 3200;
    mid.type = 'peaking'; mid.frequency.value = 900; mid.gain.value = -5;
    gtr.gain.value = 0.6; gout.gain.value = 0.11;
    gtr.connect(shaper).connect(lp).connect(mid).connect(gout).connect(bus);
    return { bus, lead, delay, gtr };
  }

  play(getSong, { loop = true } = {}) {
    this.stop();
    this.ensure();
    this.getSong = getSong;
    this.loop = loop;
    this.song = getSong();
    this.b = this.makeBus();
    this.b.delay.delayTime.value = (60 / this.song.bpm) * 0.75;
    this.loopStart = this.ctx.currentTime + 0.08;
    this.idx = 0;
    this.playing = true;
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    const bus = this.b.bus, t = this.ctx.currentTime;
    bus.gain.setTargetAtTime(0, t, 0.02);
    setTimeout(() => bus.disconnect(), 300);
  }

  // いま何拍目か（再生していなければ -1）
  position() {
    if (!this.playing) return -1;
    const b = (this.ctx.currentTime - this.loopStart) / (60 / this.song.bpm);
    return b < 0 ? -1 : b;
  }

  tick() {
    const ahead = this.ctx.currentTime + 0.25;
    while (this.playing) {
      const spb = 60 / this.song.bpm;
      const ev = this.song.events[this.idx];
      if (!ev) {
        const loopEnd = this.loopStart + this.song.lengthBeats * spb;
        if (loopEnd > ahead) break;
        if (!this.loop) {
          setTimeout(() => { this.stop(); this.onLoop && this.onLoop(); }, Math.max(0, (loopEnd - this.ctx.currentTime) * 1000));
          clearInterval(this.timer);
          break;
        }
        this.loopStart = loopEnd;
        this.song = this.getSong();
        this.b.delay.delayTime.setValueAtTime((60 / this.song.bpm) * 0.75, loopEnd);
        this.idx = 0;
        if (this.onLoop) this.onLoop();
        continue;
      }
      const t = this.loopStart + ev.beat * spb;
      if (t > ahead) break;
      this.fire(ev, t, spb);
      this.idx++;
    }
  }

  fire(ev, t, spb) {
    const ctx = this.ctx, v = ev.vel / 127;
    const env = (dest, t0, len, peak, attack = 0.004, sustain = 0.75, release = 0.03) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + attack);
      g.gain.setTargetAtTime(peak * sustain, t0 + attack, 0.05);
      g.gain.setValueAtTime(peak * sustain, Math.max(t0 + attack, t0 + len));
      g.gain.linearRampToValueAtTime(0, t0 + len + release);
      g.connect(dest);
      return g;
    };
    const osc = (type, freq, dest, t0, t1) => {
      const o = ctx.createOscillator();
      if (type === 'pulse') o.setPeriodicWave(this.pulse); else o.type = type;
      o.frequency.value = freq;
      o.connect(dest);
      o.start(t0); o.stop(t1);
      return o;
    };
    const noise = (dest, t0, t1) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      s.connect(dest);
      s.start(t0, Math.random() * 0.5); s.stop(t1);
    };
    const len = (ev.dur || 0.25) * spb;

    switch (ev.inst) {
      case 'lead': {
        const l = len * 0.92;
        const g = env(this.b.lead, t, l, 0.2 * v);
        const o = osc('pulse', mtof(ev.pitch), g, t, t + l + 0.05);
        if (l > 0.3) {   // 長い音は少し遅れてビブラート
          const lfo = ctx.createOscillator(), depth = ctx.createGain();
          lfo.frequency.value = 5.5;
          depth.gain.setValueAtTime(0, t);
          depth.gain.linearRampToValueAtTime(0, t + 0.18);
          depth.gain.linearRampToValueAtTime(18, t + 0.45);
          lfo.connect(depth).connect(o.detune);
          lfo.start(t); lfo.stop(t + l + 0.05);
        }
        break;
      }
      case 'guitar': {
        const g = ev.mute ? env(this.b.gtr, t, len * 0.5, 0.33 * v, 0.003, 0.4, 0.04) : env(this.b.gtr, t, len, 0.33 * v, 0.003, 0.8, 0.08);
        for (const det of [-7, 7]) { const o = osc('sawtooth', mtof(ev.pitch), g, t, t + len + 0.1); o.detune.value = det; }
        break;
      }
      case 'bass': {
        const g = env(this.b.bus, t, len, 0.42 * v, 0.004, 0.8, 0.02);
        osc('triangle', mtof(ev.pitch), g, t, t + len + 0.05);
        break;
      }
      case 'orig': {
        const g = env(this.b.bus, t, len * 0.95, 0.09 * v, 0.006, 0.7, 0.05);
        osc('triangle', mtof(ev.pitch), g, t, t + len + 0.1);
        break;
      }
      case 'kick': {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.9 * v, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        g.connect(this.b.bus);
        const o = osc('sine', 150, g, t, t + 0.32);
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        break;
      }
      case 'snare': {
        const g = ctx.createGain(), bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.7;
        g.gain.setValueAtTime(0.55 * v, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        bp.connect(g).connect(this.b.bus);
        noise(bp, t, t + 0.2);
        const tg = ctx.createGain();
        tg.gain.setValueAtTime(0.3 * v, t);
        tg.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        tg.connect(this.b.bus);
        const o = osc('triangle', 190, tg, t, t + 0.1);
        o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
        break;
      }
      case 'hat':
      case 'crash': {
        const crash = ev.inst === 'crash';
        const g = ctx.createGain(), hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = crash ? 4000 : 7000;
        const d = crash ? 1.2 : 0.05;
        g.gain.setValueAtTime((crash ? 0.22 : 0.16) * v, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + d);
        hp.connect(g).connect(this.b.bus);
        noise(hp, t, t + d + 0.02);
        break;
      }
    }
  }
}
