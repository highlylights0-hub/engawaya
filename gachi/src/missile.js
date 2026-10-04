// AIM-9X サイドワインダー（赤外線誘導）とフレア
//   誘導 : 比例航法 a = N · Vc · (Ω × LOS)、重力補償、最大G は動圧で制限
//   推進 : 3 秒間のブースト → 以後は空気抵抗で減速（旋回すると誘導抗力で余計に減速）
//   信管 : 近接信管（最接近点で判定）
//   フレア: シーカー視野に入っているフレアごとに、毎ステップ「騙されるか」を判定（明るさ・目標の向き・エンジン出力で変わる）
import * as THREE from 'three';
import { GRAV, atmosphere } from './flight.js';

const DEG = Math.PI / 180;

export const AIM9X = {
  name: '9X',
  ignite: 0.12,         // レールを離れてから点火まで
  burn: 3.0,            // s
  boostAcc: 230,        // m/s^2（燃焼中）
  maxG: 40,
  navN: 4,
  kDrag: 0.00009,       // v^2 抵抗（海面）
  life: 25,
  arm: 0.6,             // 信管が作動するまでの時間
  fuze: 14,             // 近接信管 m
  lethal: 9,            // 確実撃墜 m
  gimbal: 90 * DEG,     // シーカーの首振り限界
  flareCone: 8 * DEG,   // シーカー視野：この角度内のフレアと目標を見比べる
  flareRate: 0.03,      // 視野内のフレア 1 発あたり、1 秒間に騙される率（9X は画像赤外線シーカーで騙されにくい）
};

// 敵の短射程ミサイル（R-74M2 相当）：9X より少しフレアに弱い
export const R74 = {
  ...AIM9X,
  name: 'R-74',
  maxG: 36,
  flareRate: 0.15,
};

const _r = new THREE.Vector3(), _vrel = new THREE.Vector3(), _om = new THREE.Vector3();
const _a = new THREE.Vector3(), _vh = new THREE.Vector3(), _los = new THREE.Vector3();
const _tmp = new THREE.Vector3(), _d0 = new THREE.Vector3(), _d1 = new THREE.Vector3();
const FWD = new THREE.Vector3(0, 0, -1);

// 1 ステップ分の運動（実ミサイルと射程計算シミュレーションで共通）
// s: { pos, vel, age, latG } / trackPos, trackVel: 追尾目標（null なら無誘導）
export function stepMissile(s, trackPos, trackVel, dt, spec = AIM9X) {
  const V = s.vel.length();
  _vh.copy(s.vel).divideScalar(V || 1);
  _a.set(0, 0, 0);
  if (trackPos) {
    _r.subVectors(trackPos, s.pos);
    const R2 = Math.max(_r.lengthSq(), 1);
    _vrel.subVectors(trackVel, s.vel);
    _om.crossVectors(_r, _vrel).divideScalar(R2);          // 視線角速度 Ω
    _los.copy(_r).divideScalar(Math.sqrt(R2));
    const vc = -_vrel.dot(_los);                            // 接近速度
    _a.crossVectors(_om, _los).multiplyScalar(spec.navN * Math.max(vc, 50));
    _a.y += GRAV;                                           // 重力補償
    _a.addScaledVector(_vh, -_a.dot(_vh));                  // 速度方向成分は使えない
    const rho = atmosphere(s.pos.y).rho;
    const qd = 0.5 * rho * V * V;
    const gLim = spec.maxG * GRAV * Math.min(1, qd / 55000);
    if (_a.length() > gLim) _a.setLength(gLim);
  }
  s.latG = _a.length() / GRAV;

  const rho = atmosphere(s.pos.y).rho;
  const k = spec.kDrag * (rho / 1.225) * (1 + 0.004 * s.latG * s.latG);
  const thrust = s.age > spec.ignite && s.age < spec.ignite + spec.burn ? spec.boostAcc : 0;
  _a.addScaledVector(_vh, thrust - k * V * V);
  _a.y -= GRAV;
  s.vel.addScaledVector(_a, dt);
  s.pos.addScaledVector(s.vel, dt);
  s.age += dt;
}

// 線分 a0→a1（ミサイル）と b0→b1（目標）の最接近距離
function closestApproach(a0, a1, b0, b1) {
  _d0.subVectors(a0, b0);
  _d1.subVectors(a1, b1).sub(_d0);   // 相対移動
  const l2 = _d1.lengthSq();
  const t = l2 > 0 ? Math.max(0, Math.min(1, -_d0.dot(_d1) / l2)) : 0;
  return _tmp.copy(_d0).addScaledVector(_d1, t).length();
}

let missileMesh = null;
function buildMissileMesh() {
  if (!missileMesh) {
    const g = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xe8eaec, roughness: 0.5 });
    const body = new THREE.CylinderGeometry(0.065, 0.065, 3.0, 10);
    body.rotateX(Math.PI / 2);
    g.add(new THREE.Mesh(body, white));
    const nose = new THREE.ConeGeometry(0.065, 0.25, 10);
    nose.rotateX(-Math.PI / 2);
    nose.translate(0, 0, -1.62);
    g.add(new THREE.Mesh(nose, new THREE.MeshStandardMaterial({ color: 0x556070, metalness: 0.6, roughness: 0.3 })));
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.32, 0.3), white);
      fin.position.set(0, 0, 1.3);
      fin.geometry.translate(0, 0.16, 0);
      fin.rotation.z = (i * Math.PI) / 2 + Math.PI / 4;
      g.add(fin);
    }
    missileMesh = g;
  }
  return missileMesh.clone();
}

let missileId = 0;

export class Missile {
  constructor(scene, owner, pos, vel, track, spec = AIM9X) {
    this.id = ++missileId;
    this.spec = spec;
    this.owner = owner;
    this.pos = pos.clone();
    this.prev = pos.clone();
    this.vel = vel.clone();
    this.age = 0;
    this.latG = 0;
    this.track = track;        // 追尾中の対象（敵機 or フレア）
    this.alive = true;
    this.smokeT = 0;
    this.mesh = buildMissileMesh();
    this.mesh.position.copy(pos);
    scene.add(this.mesh);
    this.scene = scene;
  }

  get burning() {
    return this.age > this.spec.ignite && this.age < this.spec.ignite + this.spec.burn;
  }

  // aircraft: 信管が反応する機体の配列 / flares: 全フレア
  update(dt, aircraft, flares, fx, heightAt, onDetonate) {
    if (!this.alive) return;
    const sp = this.spec;
    _vh.copy(this.vel).normalize();

    // ---- シーカー ----
    if (this.track) {
      const tr = this.track;
      if (!tr.alive) {
        this.track = null;
      } else {
        _los.subVectors(tr.pos, this.pos).normalize();
        if (Math.acos(Math.max(-1, Math.min(1, _los.dot(_vh)))) > sp.gimbal) this.track = null;
      }
    }
    if (this.track) {
      // 視野に入っているフレアに騙されるか
      let k = sp.flareRate;
      const tac = this.track.ac ?? this.track;
      const eng = tac.engine;
      if (eng !== undefined) {
        if (eng > 1.001) k *= 0.5;          // A/B の熱源はフレアより明るい
        else if (eng < 0.5) k *= 1.8;       // アイドルだとフレアが勝つ
      }
      if (tac.quat) {
        // 真後ろからは排気口が丸見え。横や前から見ると熱源が小さく、フレアが目立つ
        const tail = _d0.set(0, 0, -1).applyQuaternion(tac.quat).dot(_los);
        k *= 1 + 2 * (1 - Math.max(0, tail));
      }
      for (const f of flares) {
        if (!f.alive || f === this.track || this.track instanceof Flare) continue;
        _tmp.subVectors(f.pos, this.pos).normalize();
        if (Math.acos(Math.max(-1, Math.min(1, _tmp.dot(_los)))) > sp.flareCone) continue;
        const bright = Math.min(1, f.life / 1.5);      // 燃え尽きかけのフレアは暗い
        if (Math.random() < 1 - Math.exp(-k * bright * dt)) {
          this.track = f;
          break;
        }
      }
    }

    this.prev.copy(this.pos);
    const s = this;
    stepMissile(s, this.track ? this.track.pos : null, this.track ? this.track.vel : null, dt, sp);

    // ---- 煙と炎 ----
    if (this.burning) {
      this.smokeT -= dt;
      _tmp.copy(this.vel).normalize().multiplyScalar(-1.6).add(this.pos);
      fx.fire.spawn({ pos: _tmp, vel: this.vel, life: 0.05, size0: 1.6, size1: 0.8, c0: [1, 0.85, 0.55, 1], c1: [1, 0.5, 0.2, 0] });
      if (this.smokeT <= 0) {
        this.smokeT = 1 / 60;
        fx.smoke.spawn({
          pos: _tmp, vel: _r.set(0, 0, 0), life: 5 + Math.random() * 2, size0: 1.6, size1: 9,
          c0: [0.92, 0.92, 0.9, 0.55], c1: [0.85, 0.86, 0.88, 0], drag: 0.5, rise: 0.4,
        });
      }
    }

    // ---- 信管 ----
    if (this.age > sp.arm) {
      for (const t of aircraft) {
        if (!t.alive || t === this.owner) continue;
        const d = closestApproach(this.prev, this.pos, t.prevPos ?? t.pos, t.pos);
        if (d < sp.fuze) {
          this.detonate(fx, onDetonate, t, d);
          return;
        }
      }
    }
    const gh = this.pos.y < 4000 ? Math.max(0, heightAt(this.pos.x, this.pos.z)) : -1;
    if (this.pos.y < gh) {
      this.detonate(fx, onDetonate, null, Infinity);
      return;
    }
    if (this.age > sp.life || (!this.burning && this.age > 2 && this.vel.length() < 150)) {
      this.detonate(fx, onDetonate, null, Infinity);
      return;
    }

    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.setFromUnitVectors(FWD, _vh.copy(this.vel).normalize());
  }

  detonate(fx, onDetonate, target, dist) {
    this.alive = false;
    fx.fire.spawn({ pos: this.pos, vel: this.vel.clone().multiplyScalar(0.2), life: 0.3, size0: 10, size1: 26, c0: [1, 0.9, 0.6, 1], c1: [1, 0.4, 0.1, 0] });
    fx.smoke.spawn({ pos: this.pos, vel: this.vel.clone().multiplyScalar(0.1), life: 3, size0: 8, size1: 22, c0: [0.2, 0.2, 0.2, 0.7], c1: [0.4, 0.4, 0.4, 0], drag: 1 });
    onDetonate(this, target, dist);
    this.dispose();
  }

  dispose() {
    this.scene.remove(this.mesh);
  }
}

// ---- フレア ----
let flareId = 0;
export class Flare {
  constructor(owner, pos, vel) {
    this.id = ++flareId;
    this.owner = owner;
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.life = 4.5;
    this.alive = true;
    this.smokeT = 0;
  }

  update(dt, fx) {
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    this.vel.multiplyScalar(Math.exp(-1.2 * dt));
    this.vel.y -= GRAV * 0.35 * dt;
    this.pos.addScaledVector(this.vel, dt);
    const b = Math.min(1, this.life / 1.5);
    // 芯（小さく白い）+ にじみ（橙）
    fx.fire.spawn({ pos: this.pos, life: 0.04, size0: 2.2 * b + 0.8, size1: 1.5, c0: [1, 0.97, 0.9, 1], c1: [1, 0.8, 0.5, 0] });
    fx.fire.spawn({ pos: this.pos, life: 0.07, size0: 5 * b + 1, size1: 2, c0: [1, 0.55, 0.15, 0.55], c1: [1, 0.3, 0.05, 0] });
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.015;
      fx.smoke.spawn({ pos: this.pos, life: 2.5, size0: 1.0, size1: 5.5, c0: [0.95, 0.95, 0.95, 0.45], c1: [0.9, 0.9, 0.9, 0], drag: 0.8 });
    }
  }
}

// 発射したら当たるか（目標は等速と仮定して飛ばしてみる）。当たるなら到達時間を返す
export function flyoutTime(launcher, target, spec = AIM9X) {
  const fwd = _tmp.set(0, 0, -1).applyQuaternion(launcher.quat);
  const s = {
    pos: launcher.pos.clone(),
    vel: launcher.vel.clone().addScaledVector(fwd, 20),
    age: 0, latG: 0,
  };
  const tp = target.pos.clone();
  const tv = target.vel.clone();
  const dt = 0.05;
  for (let t = 0; t < 40; t += dt) {
    const prevM = s.pos.clone();
    const prevT = tp.clone();
    stepMissile(s, tp, tv, dt, spec);
    tp.addScaledVector(tv, dt);
    if (s.age > spec.arm && closestApproach(prevM, s.pos, prevT, tp) < spec.lethal) {
      return s.vel.length() > 250 ? t : null;
    }
    if (!(s.age < spec.ignite + spec.burn) && s.vel.length() < 250) return null;
  }
  return null;
}
