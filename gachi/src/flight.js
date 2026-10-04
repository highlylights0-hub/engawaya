// 飛行モデル
// 機体座標系: 前方 = -Z, 上 = +Y, 右 = +X（three.js のカメラと同じ向き）
// 角速度 omega は機体座標系: x = ピッチ(機首上げ +), y = ヨー(機首左 +), z = ロール(左ロール +)
import * as THREE from 'three';

export const GRAV = 9.80665;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// 国際標準大気（対流圏 + 成層圏下部）
export function atmosphere(h) {
  h = Math.max(0, h);
  let T, rho;
  if (h < 11000) {
    T = 288.15 - 0.0065 * h;
    rho = 1.225 * Math.pow(T / 288.15, 4.2559);
  } else {
    T = 216.65;
    rho = 0.36392 * Math.exp(-(h - 11000) / 6341.6);
  }
  return { T, rho, a: Math.sqrt(1.4 * 287.05 * T) };
}

// F/A-18E スーパーホーネットっぽい諸元（戦闘重量）
export const F18E = {
  name: 'F/A-18E',
  mass: 21000,          // kg
  wingArea: 46.5,       // m^2
  CLa: 4.6,             // 揚力傾斜 /rad
  alphaStall: 0.44,     // 失速迎え角 rad (~25°)
  alphaLimit: 0.38,     // FBW の AOA リミット rad (~22°)
  CD0: 0.024,
  K: 0.11,              // 誘導抗力係数
  thrustMil: 124000,    // N  F414 x2 ドライ
  thrustAB: 196000,     // N  F414 x2 A/B
  gMax: 7.5,
  gOverride: 9.0,
  gMin: -3.0,
  rollRate: 3.6,        // rad/s (~205°/s)
  gearH: 2.5,           // 脚を出したとき、重心から地面まで m
  tailStrike: 0.2,      // 地上で機首を上げられる限界 rad（~11.5°、これ以上は尾部が擦る）
};

export const THROTTLE_AB_MAX = 1.25; // 1.0 = MIL, 1.0〜1.25 = アフターバーナー

function liftCoef(alpha, s) {
  const a = Math.abs(alpha);
  const sign = Math.sign(alpha);
  if (a <= s.alphaStall) return s.CLa * alpha;
  // 失速後：揚力が落ちる（90°で0）
  const clMax = s.CLa * s.alphaStall;
  const t = clamp((a - s.alphaStall) / (Math.PI / 2 - s.alphaStall), 0, 1);
  return sign * clMax * (1 - t) * (0.65 + 0.35 * (1 - t));
}

const _f = new THREE.Vector3();
const _u = new THREE.Vector3();
const _r = new THREE.Vector3();
const _vh = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _lift = new THREE.Vector3();
const _side = new THREE.Vector3();
const _F = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _qi = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _eul = new THREE.Euler(0, 0, 0, 'YXZ');

export class Aircraft {
  constructor(spec = F18E) {
    this.spec = spec;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.omega = new THREE.Vector3();
    this.engine = 0.8;        // 実際のエンジン出力（スロットルに遅れて追従）
    this.speedbrake = false;
    this.crashed = false;
    this.gPeak = 1;
    this.accEst = new THREE.Vector3(); // 平滑化した加速度（ガンサイトの未来位置予測用）
    this.hp = 100;
    this.radius = 7;          // 被弾判定の球
    this.t = {};              // テレメトリ（HUD 用）
    this.gear = 0;            // 脚の出具合 0 = 収納 / 1 = 出ている
    this.gearDown = false;
    this.onGround = false;    // 脚で地面に乗っている
    this.brake = false;       // ブレーキ（出撃時は踏んだまま。MIL まで上げると離す）
  }

  get alive() { return !this.crashed; }

  // 戻り値: 撃墜されたら true
  hit(dmg) {
    if (this.crashed) return false;
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.hp = 0;
      this.crashed = true;
      return true;
    }
    return false;
  }

  // ground = true：脚を出して地面（滑走路）に置く
  reset(pos, headingDeg, speed, throttle, ground = false) {
    this.pos.copy(pos);
    this.gearDown = ground;
    this.gear = ground ? 1 : 0;
    this.onGround = ground;
    this.brake = ground;
    if (ground) this.pos.y = pos.y + this.spec.gearH;
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -THREE.MathUtils.degToRad(headingDeg));
    this.vel.set(0, 0, -speed).applyQuaternion(this.quat);
    this.omega.set(0, 0, 0);
    this.engine = throttle;
    this.speedbrake = false;
    this.crashed = false;
    this.gPeak = 1;
    this.accEst.set(0, 0, 0);
    this.hp = 100;
  }

  // 地上滑走：姿勢をヨーとピッチだけにし（ロールなし、機首は 0〜尾部が擦る角度）、
  // 横滑りはタイヤが止め、転がり抵抗とブレーキで減速する
  groundRoll(dt, ground, gH) {
    const s = this.spec, q = this.quat;
    _eul.setFromQuaternion(q, 'YXZ');
    const pitch = clamp(_eul.x, 0, s.tailStrike);
    if ((pitch <= 0 && this.omega.x < 0) || (pitch >= s.tailStrike && this.omega.x > 0)) this.omega.x = 0;
    this.omega.z = 0;
    _eul.set(pitch, _eul.y, 0, 'YXZ');
    q.setFromEuler(_eul);
    // 地面より下には沈まない（揚力が重さを上回れば自然に浮く）
    if (this.pos.y <= ground + gH) {
      this.pos.y = ground + gH;
      if (this.vel.y < 0) this.vel.y = 0;
    }
    // タイヤ：進行方向（機首の水平成分）以外の速度を消す
    const hx = -Math.sin(_eul.y), hz = -Math.cos(_eul.y);
    let vh = this.vel.x * hx + this.vel.z * hz;
    const mu = 0.025 + (this.brake ? 0.6 : 0);
    vh = vh > 0 ? Math.max(0, vh - mu * GRAV * dt) : Math.min(0, vh + mu * GRAV * dt);
    this.vel.x = hx * vh;
    this.vel.z = hz * vh;
    this.onGround = true;
  }

  // ctl: { pitch, roll, yaw (-1..1), throttle (0..1.25), gOverride }
  update(dt, ctl, heightAt) {
    if (this.crashed) return;
    const s = this.spec;
    const q = this.quat;

    // エンジンのスプール（上げは遅く、下げは少し速い）
    const spool = ctl.throttle > this.engine ? 0.7 : 1.2;
    this.engine += clamp(ctl.throttle - this.engine, -spool * dt, spool * dt);

    const fwd = _f.set(0, 0, -1).applyQuaternion(q);
    const up = _u.set(0, 1, 0).applyQuaternion(q);
    const right = _r.set(1, 0, 0).applyQuaternion(q);

    const V = this.vel.length();
    const vhat = V > 0.5 ? _vh.copy(this.vel).divideScalar(V) : _vh.copy(fwd);
    _vb.copy(this.vel).applyQuaternion(_qi.copy(q).invert());
    const alpha = V > 0.5 ? Math.atan2(-_vb.y, -_vb.z) : 0;
    const beta = V > 0.5 ? Math.asin(clamp(_vb.x / V, -1, 1)) : 0;

    const atm = atmosphere(this.pos.y);
    const qd = 0.5 * atm.rho * V * V;
    const mach = V / atm.a;
    const qS = qd * s.wingArea;

    // 空力係数
    const CL = liftCoef(alpha, s);
    const wave = 0.035 * smoothstep(0.8, 1.05, mach) - 0.01 * smoothstep(1.2, 2.0, mach);
    const CD = s.CD0 + wave + s.K * CL * CL
      + (this.speedbrake ? 0.06 : 0)
      + 0.02 * this.gear
      + 0.8 * beta * beta
      + (Math.abs(alpha) > s.alphaStall ? 0.9 * Math.sin(Math.abs(alpha)) ** 2 : 0);

    // 揚力方向：速度ベクトルに垂直、機体の上側
    _lift.crossVectors(right, vhat);
    if (_lift.lengthSq() < 1e-6) _lift.copy(up);
    _lift.normalize();
    _side.copy(right).addScaledVector(vhat, -right.dot(vhat));
    if (_side.lengthSq() < 1e-6) _side.copy(right);
    _side.normalize();

    // 推力（密度で低下、ラム効果で少し回復）
    const e = this.engine;
    const T = e <= 1
      ? s.thrustMil * (0.05 + 0.95 * e)
      : s.thrustMil + (s.thrustAB - s.thrustMil) * ((e - 1) / (THROTTLE_AB_MAX - 1));
    const thrust = T * Math.pow(atm.rho / 1.225, 0.7) * (1 + 0.25 * Math.min(mach, 2));

    _F.set(0, 0, 0)
      .addScaledVector(_lift, qS * CL)
      .addScaledVector(vhat, -qS * CD)
      .addScaledVector(_side, -qS * 0.9 * beta)
      .addScaledVector(fwd, thrust);

    const nz = _F.dot(up) / (s.mass * GRAV); // パイロットが感じる G
    _acc.copy(_F).divideScalar(s.mass);
    _acc.y -= GRAV;

    // ---- フライ・バイ・ワイヤ ----
    // ピッチ：スティック量 → 要求G → 要求迎え角（AOA リミット付き）
    const gMax = ctl.gOverride ? s.gOverride : s.gMax;
    const p = ctl.pitch;
    const nCmd = p >= 0 ? 1 + p * (gMax - 1) : 1 + p * (1 - s.gMin);
    const aCmd = clamp((nCmd * s.mass * GRAV) / (Math.max(qS, 1) * s.CLa), -0.18, s.alphaLimit);
    const auth = clamp(qd / 12000, 0.08, 1); // 舵の効き（低速で弱い）

    // 飛行経路の回転に追従 + 迎え角誤差を修正
    const pathRate = V > 1 ? _acc.dot(_lift) / V : 0;
    let wxT = clamp(pathRate + 5 * (aCmd - alpha) * Math.max(auth, 0.3), -1.5, 1.5);

    // ロール：高AOAでロールレート低下
    let wzT = -ctl.roll * s.rollRate * clamp(qd / 16000, 0.12, 1)
      * (1 - 0.6 * clamp(alpha / s.alphaLimit, 0, 1));

    // ヨー：ラダー + 方向安定（横滑りを打ち消す）
    let wyT = -(ctl.yaw * 0.45 * auth + 4 * beta * Math.max(auth, 0.3));

    // 地上：FBW は地上モード。スティックを引くと機首が上がる（舵は速度とともに効く。約 130kt から）、
    // 放すと前脚に戻る。ラダー（と低速ではロール入力も）で前脚ステアリング
    if (this.onGround) {
      const eff = clamp((V - 45) / 35, 0, 1);
      wxT = ctl.pitch > 0.05 ? ctl.pitch * 0.32 * eff - 0.1 * (1 - eff) : -0.12;
      wzT = 0;
      wyT = -(ctl.yaw * 0.7 + ctl.roll * 0.5) * 0.45 * clamp(1.3 - V / 70, 0.12, 1);
      if (this.brake && ctl.throttle >= 0.999) this.brake = false;   // MIL まで上げたらブレーキを離す
    }

    const kp = 1 - Math.exp(-dt * 12);
    const kr = 1 - Math.exp(-dt * 8);
    this.omega.x += (wxT - this.omega.x) * kp;
    this.omega.y += (wyT - this.omega.y) * kp;
    this.omega.z += (wzT - this.omega.z) * kr;

    // ---- 積分 ----
    this.accEst.lerp(_acc, 1 - Math.exp(-dt * 4));
    this.vel.addScaledVector(_acc, dt);
    this.pos.addScaledVector(this.vel, dt);

    const ang = this.omega.length() * dt;
    if (ang > 1e-9) {
      _axis.copy(this.omega).normalize();
      _dq.setFromAxisAngle(_axis, ang);
      q.multiply(_dq).normalize();
    }

    // ---- 地面 ----
    const hRaw = heightAt(this.pos.x, this.pos.z);
    const ground = Math.max(0, hRaw);
    const gH = this.gear > 0.95 ? s.gearH : 0;
    this.onGround = false;
    if (gH && this.pos.y < ground + gH + 0.05) {
      // 脚で接地：水平に近く・沈下が小さく・陸地なら転がる。それ以外は激突
      _eul.setFromQuaternion(q, 'YXZ');
      const ok = hRaw > 0.5 && this.vel.y > -6 && Math.abs(_eul.z) < 0.26 && _eul.x > -0.12 && _eul.x < s.tailStrike + 0.1;
      if (ok) this.groundRoll(dt, ground, gH);
    }
    if (!this.onGround && this.pos.y < ground + 2) {
      this.pos.y = ground + 2;
      this.vel.set(0, 0, 0);
      this.omega.set(0, 0, 0);
      this.crashed = true;
    }

    // 脚：離陸して 50m 上がったら自動で引き込む（収納に約 5 秒）
    const agl0 = this.pos.y - ground;
    if (this.gearDown && !this.onGround && agl0 > 50 && this.vel.y > 0) this.gearDown = false;
    this.gear = clamp(this.gear + (this.gearDown ? 1 : -1) * dt / 5, 0, 1);

    // ---- テレメトリ ----
    this.gPeak = Math.max(this.gPeak, nz);
    const t = this.t;
    t.speed = V;
    t.kts = V * 1.94384;
    t.mach = mach;
    t.alt = this.pos.y;
    t.agl = this.pos.y - ground;
    t.vs = this.vel.y;
    t.alpha = alpha;
    t.beta = beta;
    t.nz = this.onGround ? 1 : nz;
    t.gPeak = this.gPeak;
    t.gLimit = gMax;
    t.heading = (THREE.MathUtils.radToDeg(Math.atan2(fwd.x, -fwd.z)) + 360) % 360;
    t.pitch = THREE.MathUtils.radToDeg(Math.asin(clamp(fwd.y, -1, 1)));
    t.bank = THREE.MathUtils.radToDeg(Math.atan2(-right.y, up.y));
    t.throttle = ctl.throttle;
    t.engine = this.engine;
    t.ab = this.engine > 1.001;
    t.thrust = thrust;
    t.stall = Math.abs(alpha) > s.alphaStall;
    t.aoaWarn = alpha > s.alphaLimit * 0.92 && V < 130;
  }
}
