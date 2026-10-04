// 効果音（Web Audio）
//   サイドワインダーのトーン: 探索中は低い「グロウル」、ロックすると高い連続音
//   自機のエンジン: タービンの高音（回転数で音程が上がる）+ 排気の轟音（ノイズ）+ A/B の低いうなりと「バリバリ」
//   風切り音: 速度の 2 乗で大きく
//   敵機: 1 機ずつ HRTF の PannerNode で立体定位。距離で小さく・こもり、接近・離脱でドップラー
//   機関砲の連射音、爆発音（爆発も立体定位）
//   ブラウザの制約で、最初のキー入力 / クリックまで音は出ない
import * as THREE from 'three';

const C_SOUND = 340;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const _rel = new THREE.Vector3(), _fwd = new THREE.Vector3(), _up = new THREE.Vector3();
const _qi = new THREE.Quaternion(), _vr = new THREE.Vector3();

export class Sound {
  constructor() {
    this.ctx = null;
    this.toneMode = 'off';
    this.voices = new Map();     // 敵機 → 音源
    this.debug = {};             // 確認用（直近に設定した値）
    const start = () => this.init();
    addEventListener('keydown', start);
    addEventListener('pointerdown', start);
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    // 大きな音が重なっても割れないように
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.out = comp;

    // ノイズ（白 / 茶色）
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0), b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      d[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * d[i]) / 1.02;
      b[i] = last * 3.5;
    }

    this.initTone();
    this.initRwr();
    this.initEngine();
    this.initGun();
  }

  // 撃墜クリップの録画用：ゲームの音（スピーカーに出しているのと同じもの）のトラック
  captureTrack() {
    if (!this.ctx) return null;
    if (!this.recDest) {
      this.recDest = this.ctx.createMediaStreamDestination();
      this.out.connect(this.recDest);
    }
    return this.recDest.stream.getAudioTracks()[0];
  }

  // ---- シーカートーン：矩形波 + 周波数をゆらす LFO ----
  initTone() {
    const ctx = this.ctx;
    this.tone = ctx.createOscillator();
    this.tone.type = 'square';
    this.tone.frequency.value = 400;
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 27;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 0;
    this.lfo.connect(this.lfoGain).connect(this.tone.frequency);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 2500;
    this.toneGain = ctx.createGain();
    this.toneGain.gain.value = 0;
    this.tone.connect(filt).connect(this.toneGain).connect(this.master);
    this.tone.start();
    this.lfo.start();
  }

  // ---- RWR / ミサイル警報の電子音 ----
  initRwr() {
    const ctx = this.ctx;
    this.rwrOsc = ctx.createOscillator();
    this.rwrOsc.type = 'square';
    this.rwrOsc.frequency.value = 1000;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3000;
    this.rwrGain = ctx.createGain();
    this.rwrGain.gain.value = 0;
    this.rwrOsc.connect(lp).connect(this.rwrGain).connect(this.master);
    this.rwrOsc.start();
    this.rwrMode = 'off';
    this.rwrT = 0;
  }

  // mode: 'off' | 'lock'（ゆっくりした断続音）| 'missile'（速い 2 音の警報）
  setRwr(mode) {
    this.rwrMode = mode;
  }

  updateRwr(dt, mute) {
    const t = this.ctx.currentTime;
    this.rwrT += dt;
    let on = false, f = 1000;
    if (!mute && this.rwrMode === 'missile') {
      const ph = (this.rwrT * 8) % 2;                 // 8Hz で 2 つの音を交互に
      on = ph % 1 < 0.75;
      f = ph < 1 ? 1350 : 950;
    } else if (!mute && this.rwrMode === 'lock') {
      on = (this.rwrT * 3) % 1 < 0.45;
      f = 1150;
    }
    this.rwrOsc.frequency.setValueAtTime(f, t);
    this.rwrGain.gain.setTargetAtTime(on ? 0.05 : 0, t, 0.005);
    this.debug.rwr = on ? f : 0;
  }

  loop(buffer) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.loopStart = Math.random();      // 複数の音源が同じ波形にならないように
    s.start(0, Math.random() * 1.5);
    return s;
  }

  // ---- 自機のエンジン ----
  initEngine() {
    const ctx = this.ctx;
    const e = (this.eng = {});
    e.out = ctx.createGain();
    e.out.gain.value = 1;
    e.out.connect(this.master);

    // タービンの高音：のこぎり波 2 つ（少しずらしてうなり）→ バンドパス
    e.whineA = ctx.createOscillator(); e.whineA.type = 'sawtooth';
    e.whineB = ctx.createOscillator(); e.whineB.type = 'sawtooth';
    e.whineBP = ctx.createBiquadFilter(); e.whineBP.type = 'bandpass'; e.whineBP.Q.value = 6;
    e.whineGain = ctx.createGain(); e.whineGain.gain.value = 0;
    e.whineA.connect(e.whineBP); e.whineB.connect(e.whineBP);
    e.whineBP.connect(e.whineGain).connect(e.out);
    e.whineA.start(); e.whineB.start();

    // 排気の轟音：ノイズ → ローパス
    e.roar = this.loop(this.noise);
    e.roarLP = ctx.createBiquadFilter(); e.roarLP.type = 'lowpass'; e.roarLP.Q.value = 0.7;
    e.roarGain = ctx.createGain(); e.roarGain.gain.value = 0;
    e.roar.connect(e.roarLP).connect(e.roarGain).connect(e.out);

    // A/B：低いうなり（茶色ノイズ）+ 不規則な「バリバリ」（振幅をノイズで揺らす）
    e.ab = this.loop(this.brown);
    e.abLP = ctx.createBiquadFilter(); e.abLP.type = 'lowpass'; e.abLP.frequency.value = 260;
    e.abGain = ctx.createGain(); e.abGain.gain.value = 0;
    e.crackle = this.loop(this.noise);
    e.crackle.playbackRate.value = 0.004;            // ゆっくり再生したノイズ = 不規則な揺れ
    e.crackleDepth = ctx.createGain(); e.crackleDepth.gain.value = 0;
    e.crackle.connect(e.crackleDepth).connect(e.abGain.gain);
    e.ab.connect(e.abLP).connect(e.abGain).connect(e.out);

    // 風切り音
    e.wind = this.loop(this.noise);
    e.windBP = ctx.createBiquadFilter(); e.windBP.type = 'bandpass'; e.windBP.Q.value = 0.6;
    e.windGain = ctx.createGain(); e.windGain.gain.value = 0;
    e.wind.connect(e.windBP).connect(e.windGain).connect(e.out);
  }

  // ---- 機関砲（M61 の「ブォーッ」）----
  initGun() {
    const ctx = this.ctx;
    const g = (this.gun = {});
    g.osc = ctx.createOscillator(); g.osc.type = 'sawtooth'; g.osc.frequency.value = 100; // 6000 発/分 = 100Hz
    g.noise = this.loop(this.noise);
    g.lp = ctx.createBiquadFilter(); g.lp.type = 'lowpass'; g.lp.frequency.value = 900;
    g.gain = ctx.createGain(); g.gain.gain.value = 0;
    const ng = ctx.createGain(); ng.gain.value = 0.35;
    g.osc.connect(g.lp);
    g.noise.connect(ng).connect(g.lp);
    g.lp.connect(g.gain).connect(this.master);
    g.osc.start();
    g.on = false;
  }

  // ---- 敵機の音源（立体定位） ----
  makeVoice() {
    const ctx = this.ctx;
    const v = {};
    v.panner = new PannerNode(ctx, {
      panningModel: 'HRTF', distanceModel: 'inverse',
      refDistance: 120, rolloffFactor: 1.0, maxDistance: 30000,
      coneInnerAngle: 360, coneOuterAngle: 360,
    });
    v.air = ctx.createBiquadFilter(); v.air.type = 'lowpass'; v.air.frequency.value = 8000;
    v.gain = ctx.createGain(); v.gain.gain.value = 0;
    v.air.connect(v.gain).connect(v.panner).connect(this.master);

    v.roar = this.loop(this.noise);
    v.roarLP = ctx.createBiquadFilter(); v.roarLP.type = 'lowpass'; v.roarLP.frequency.value = 900;
    v.roarGain = ctx.createGain(); v.roarGain.gain.value = 0.9;
    v.roar.connect(v.roarLP).connect(v.roarGain).connect(v.air);

    v.rumble = this.loop(this.brown);
    v.rumbleGain = ctx.createGain(); v.rumbleGain.gain.value = 0.8;
    v.rumble.connect(v.rumbleGain).connect(v.air);

    v.whine = ctx.createOscillator(); v.whine.type = 'sawtooth';
    v.whineBP = ctx.createBiquadFilter(); v.whineBP.type = 'bandpass'; v.whineBP.Q.value = 5;
    v.whineGain = ctx.createGain(); v.whineGain.gain.value = 0.05;
    v.whine.connect(v.whineBP).connect(v.whineGain).connect(v.air);
    v.whine.start();
    v.alive = true;
    return v;
  }

  // 対空砲（30mm 2 連装 ×2、毎分 4800 発）の「ドドドド」：ノイズを 80Hz の矩形波で刻む
  makeAaaVoice() {
    const ctx = this.ctx;
    const v = {};
    v.panner = new PannerNode(ctx, {
      panningModel: 'HRTF', distanceModel: 'inverse',
      refDistance: 250, rolloffFactor: 1.1, maxDistance: 30000,
    });
    v.air = ctx.createBiquadFilter(); v.air.type = 'lowpass'; v.air.frequency.value = 3000;
    v.gain = ctx.createGain(); v.gain.gain.value = 0;
    v.src = this.loop(this.noise);
    v.bp = ctx.createBiquadFilter(); v.bp.type = 'lowpass'; v.bp.frequency.value = 700;
    v.chop = ctx.createGain(); v.chop.gain.value = 0.5;
    v.lfo = ctx.createOscillator(); v.lfo.type = 'square'; v.lfo.frequency.value = 80;
    const depth = ctx.createGain(); depth.gain.value = 0.5;
    v.lfo.connect(depth).connect(v.chop.gain);
    v.lfo.start();
    v.thump = ctx.createOscillator(); v.thump.type = 'sawtooth'; v.thump.frequency.value = 80;
    const tg = ctx.createGain(); tg.gain.value = 0.35;
    v.thump.connect(tg).connect(v.air);
    v.thump.start();
    v.src.connect(v.bp).connect(v.chop).connect(v.air);
    v.air.connect(v.gain).connect(v.panner).connect(this.master);
    v.on = false;
    return v;
  }

  dropVoice(v) {
    const t = this.ctx.currentTime;
    v.gain.gain.setTargetAtTime(0, t, 0.15);
    setTimeout(() => {
      if (v.roar) { v.roar.stop(); v.rumble.stop(); v.whine.stop(); }
      else { v.src.stop(); v.lfo.stop(); v.thump.stop(); }
      v.panner.disconnect();
    }, 1200);
  }

  // 毎フレーム：自機エンジン・風・敵機の音・リスナーの向き
  // o: { player, camera, enemies, gunFiring, paused, cockpit }
  update(dt, o) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const p = o.player, cam = o.camera;
    this.cam = cam;
    const mute = o.paused;
    const k = 0.06;   // 変化の時定数（s）

    // ---- 自機 ----
    const e = this.eng;
    const alive = !p.crashed;
    const eng = alive ? p.engine : 0;
    const rpm = Math.min(1, eng);                       // 0〜1（MIL）
    const ab = Math.max(0, (eng - 1) / 0.25);           // 0〜1
    const spd = p.vel.length();
    // コクピット内は外の轟音がこもり、タービンが近い
    const inside = o.cockpit ? 1 : 0;
    const whineF = 900 + 2600 * rpm * rpm;
    e.whineA.frequency.setTargetAtTime(whineF, t, 0.1);
    e.whineB.frequency.setTargetAtTime(whineF * 1.503, t, 0.1);
    e.whineBP.frequency.setTargetAtTime(whineF * 1.2, t, 0.1);
    const whineG = mute ? 0 : (0.012 + 0.03 * rpm) * (inside ? 1.3 : 1);
    e.whineGain.gain.setTargetAtTime(whineG, t, k);
    const roarF = 350 + 1500 * rpm + 600 * ab;
    e.roarLP.frequency.setTargetAtTime(inside ? roarF * 0.5 : roarF, t, k);
    const roarG = mute || !alive ? 0 : (0.03 + 0.16 * rpm ** 2 + 0.12 * ab) * (inside ? 0.6 : 1);
    e.roarGain.gain.setTargetAtTime(roarG, t, k);
    const abG = mute || !alive ? 0 : 0.5 * ab;
    e.abGain.gain.setTargetAtTime(abG, t, 0.15);
    e.crackleDepth.gain.setTargetAtTime(abG * 2.2, t, 0.15);
    // 風切り音（コクピットではキャノピー越しに大きく）
    const q = Math.min(1.5, (spd / 300) ** 2);
    e.windBP.frequency.setTargetAtTime(400 + 900 * Math.min(1, spd / 400), t, k);
    const windG = mute || !alive ? 0 : 0.1 * q * (inside ? 1.4 : 0.8);
    e.windGain.gain.setTargetAtTime(windG, t, k);
    Object.assign(this.debug, { whineF, whineG, roarG, abG, windG });

    this.updateRwr(dt, mute);

    // ---- 機関砲 ----
    const gOn = !mute && o.gunFiring;
    if (gOn !== this.gun.on) {
      this.gun.on = gOn;
      this.gun.gain.gain.setTargetAtTime(gOn ? 0.22 : 0, t, gOn ? 0.01 : 0.04);
    }

    // ---- リスナー（カメラ）：位置は原点、音源はカメラからの相対位置で置く ----
    const L = ctx.listener;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    if (L.forwardX) {
      L.forwardX.value = _fwd.x; L.forwardY.value = _fwd.y; L.forwardZ.value = _fwd.z;
      L.upX.value = _up.x; L.upY.value = _up.y; L.upZ.value = _up.z;
    } else {
      L.setOrientation(_fwd.x, _fwd.y, _fwd.z, _up.x, _up.y, _up.z);
    }

    // ---- 敵機 ----
    const seen = new Set();
    for (const en of o.enemies) {
      if (!en.alive) continue;
      seen.add(en);
      let v = this.voices.get(en);
      if (!v) { v = this.makeVoice(); this.voices.set(en, v); }
      _rel.subVectors(en.pos, cam.position);
      const d = Math.max(1, _rel.length());
      if (v.panner.positionX) {
        v.panner.positionX.setTargetAtTime(_rel.x, t, 0.02);
        v.panner.positionY.setTargetAtTime(_rel.y, t, 0.02);
        v.panner.positionZ.setTargetAtTime(_rel.z, t, 0.02);
      } else {
        v.panner.setPosition(_rel.x, _rel.y, _rel.z);
      }
      // ドップラー：視線方向の相対速度
      const vr = _vr.subVectors(en.vel, p.vel).dot(_rel) / d;      // + = 離れていく
      const dop = clamp(C_SOUND / (C_SOUND + vr), 0.65, 1.6);
      const er = Math.min(1, en.ac.engine), eab = Math.max(0, (en.ac.engine - 1) / 0.25);
      // 排気は後ろ向きに大きい：敵の後方から聞くほど大きく
      _fwd.set(0, 0, -1).applyQuaternion(en.ac.quat);
      const behind = clamp(_fwd.dot(_rel) / d, -1, 1);   // + = カメラが敵の後ろ側
      const aspect = 0.55 + 0.45 * behind;
      // 空気による高音の減衰（遠いほどこもる）
      v.air.frequency.setTargetAtTime(clamp(9000 * Math.exp(-d / 1800), 350, 9000), t, 0.1);
      v.roarLP.frequency.setTargetAtTime((500 + 900 * er + 500 * eab) * dop, t, 0.1);
      v.whine.frequency.setTargetAtTime((900 + 2400 * er * er) * dop, t, 0.05);
      v.whineBP.frequency.setTargetAtTime((1000 + 2800 * er * er) * dop, t, 0.05);
      v.rumbleGain.gain.setTargetAtTime(0.5 + 1.2 * eab, t, 0.1);
      const g = mute ? 0 : (0.35 + 0.4 * er + 0.5 * eab) * aspect;
      v.gain.gain.setTargetAtTime(g, t, 0.05);
      if (en === o.enemies[0]) Object.assign(this.debug, { e0dist: d, e0gain: g, e0dop: dop, e0rel: _rel.clone().applyQuaternion(_qi.copy(cam.quaternion).invert()) });
    }
    // ---- 対空砲（撃っている間だけ鳴る。音は距離のぶん遅れて届く） ----
    for (const u of o.ground ?? []) {
      if (!u.alive && !this.voices.has(u)) continue;
      seen.add(u);
      let v = this.voices.get(u);
      if (!v) { v = this.makeAaaVoice(); this.voices.set(u, v); }
      _rel.subVectors(u.pos, cam.position);
      const d = Math.max(1, _rel.length());
      if (v.panner.positionX) {
        v.panner.positionX.setTargetAtTime(_rel.x, t, 0.05);
        v.panner.positionY.setTargetAtTime(_rel.y, t, 0.05);
        v.panner.positionZ.setTargetAtTime(_rel.z, t, 0.05);
      } else {
        v.panner.setPosition(_rel.x, _rel.y, _rel.z);
      }
      v.air.frequency.setTargetAtTime(clamp(4000 * Math.exp(-d / 2500), 250, 4000), t, 0.1);
      const on = !mute && u.firing;
      if (on !== v.on) {
        v.on = on;
        const at = t + Math.min(4, d / C_SOUND);
        v.gain.gain.setTargetAtTime(on ? 1.6 : 0, at, on ? 0.01 : 0.05);
      }
      if (mute) v.gain.gain.setTargetAtTime(0, t, 0.02);
    }
    for (const [en, v] of this.voices) {
      if (!seen.has(en)) { this.dropVoice(v); this.voices.delete(en); }
    }
  }

  // 爆発（立体定位）。pos: ワールド座標
  explosion(pos, big = true) {
    const camera = this.cam;
    if (!this.ctx || !camera) return;
    const ctx = this.ctx, t = ctx.currentTime;
    _rel.subVectors(pos, camera.position);
    const d = _rel.length();
    const delay = Math.min(3, d / C_SOUND);              // 音は光より遅れて届く
    const pan = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 150, rolloffFactor: 0.9, positionX: _rel.x, positionY: _rel.y, positionZ: _rel.z });
    const src = ctx.createBufferSource();
    src.buffer = this.brown;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(clamp(3000 * Math.exp(-d / 2500), 300, 3000), t + delay);
    lp.frequency.exponentialRampToValueAtTime(120, t + delay + 2.5);
    const g = ctx.createGain();
    const peak = big ? 3.5 : 1.5;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.setValueAtTime(0.0001, t + delay);
    g.gain.exponentialRampToValueAtTime(peak, t + delay + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 3.0);
    src.connect(lp).connect(g).connect(pan).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + delay + 3.2);
  }

  // 偵察ポッドのシャッター（カシャ、カシャ）
  shutter() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const dt of [0, 0.09, 0.18]) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.5, t + dt + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.05);
      src.connect(hp).connect(g).connect(this.master);
      src.start(t + dt, Math.random());
      src.stop(t + dt + 0.07);
    }
  }

  // 全体の音量（ブラックアウト中は遠のく）
  setDim(k) {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(0.7 * k, this.ctx.currentTime, 0.3);
  }

  // mode: 'off' | 'search'（グロウル）| 'lock'（高音）
  setTone(mode) {
    if (!this.ctx || mode === this.toneMode) return;
    this.toneMode = mode;
    const t = this.ctx.currentTime;
    const g = this.toneGain.gain, f = this.tone.frequency, l = this.lfoGain.gain;
    g.cancelScheduledValues(t);
    if (mode === 'off') {
      g.setTargetAtTime(0, t, 0.03);
    } else if (mode === 'search') {
      f.setTargetAtTime(380, t, 0.02);
      l.setTargetAtTime(70, t, 0.02);
      g.setTargetAtTime(0.035, t, 0.03);
    } else {
      f.setTargetAtTime(1150, t, 0.02);
      l.setTargetAtTime(25, t, 0.02);
      g.setTargetAtTime(0.045, t, 0.03);
    }
  }

  launch() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1800, t);
    bp.frequency.exponentialRampToValueAtTime(300, t + 1.4);
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 1.7);
  }
}
