// M61A2 20mm 機関砲：弾道（重力 + 空気抵抗）、命中判定、リード計算ガンサイト
import * as THREE from 'three';
import { GRAV } from './flight.js';

export const MUZZLE_V = 1050;     // m/s
export const FIRE_RATE = 100;     // 発/秒（6000 rpm）
export const AMMO_MAX = 412;      // F/A-18E の搭載弾数
export const K_DRAG = 0.00027;           // 抵抗 dv/dt = -k v^2（1000m で約 800m/s に減速）
const GUN_UP = 1.5 * Math.PI / 180; // 砲身は機軸より少し上向き
const DISPERSION = 0.0025;        // rad
const MAX_LIFE = 4;
const DMG = 9;
const STREAK = 18;                // 曳光の長さ m

const _tmp = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _u = new THREE.Vector3();
const _gunDir = new THREE.Vector3();
const _muz = new THREE.Vector3();
const _acc = new THREE.Vector3();

export class Gun {
  // 既定値は M61A2。対空砲などは opts で弾速・発射速度・威力・砲口の位置を変える
  //   muzzles: 砲口の位置（銃の座標系、前 -Z）。複数なら交互に撃つ / onExpire(pos): 寿命が来た弾（自爆信管）
  constructor(scene, {
    color = 0xffd890, muzzleV = MUZZLE_V, rate = FIRE_RATE, ammo = AMMO_MAX, dmg = DMG,
    dispersion = DISPERSION, gunUp = GUN_UP, muzzles = [[0, 0.35, -7.2]], streak = STREAK,
    life = MAX_LIFE, flash = 1, onExpire = null, max = 800, glow = 0,
  } = {}) {
    Object.assign(this, { muzzleV, rate, ammoMax: ammo, dmg, dispersion, gunUp, muzzles, streak, life, flash, onExpire });
    this.mi = 0;
    this.bullets = [];
    this.ammo = ammo;
    this.cool = 0;
    this.firing = false;
    this.hits = 0;

    this.maxDraw = max;
    this.linePos = new Float32Array(max * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    this.lines.frustumCulled = false;
    scene.add(this.lines);

    // 光る弾頭（glow = 画面上の大きさ px）：遠くからでも弾幕が見えるように
    if (glow) {
      this.headPos = new Float32Array(max * 3);
      const hg = new THREE.BufferGeometry();
      hg.setAttribute('position', new THREE.BufferAttribute(this.headPos, 3).setUsage(THREE.DynamicDrawUsage));
      hg.setDrawRange(0, 0);
      this.heads = new THREE.Points(hg, new THREE.PointsMaterial({
        color, size: glow, sizeAttenuation: false, map: glowTexture(), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      this.heads.frustumCulled = false;
      scene.add(this.heads);
    }
  }

  gunDir(ac, out) {
    return out.set(0, Math.sin(this.gunUp), -Math.cos(this.gunUp)).applyQuaternion(ac.quat);
  }

  muzzle(ac, out, i = 0) {
    const m = this.muzzles[i];
    return out.set(m[0], m[1], m[2]).applyQuaternion(ac.quat).add(ac.pos);
  }

  reload() {
    this.ammo = this.ammoMax;
    this.bullets.length = 0;
  }

  // 物理ステップごとに呼ぶ
  // targets: { pos, vel, radius, alive, hit(dmg) } の配列。onHit(target, killed)
  update(dt, ac, trigger, targets, fx, heightAt, onHit) {
    this.firing = trigger && this.ammo > 0 && !ac.crashed;
    if (this.firing) {
      this.cool -= dt;
      while (this.cool <= 0 && this.ammo > 0) {
        this.spawn(ac, -this.cool, fx);
        this.cool += 1 / this.rate;
        this.ammo--;
      }
    } else {
      this.cool = 0;
    }

    const B = this.bullets;
    let w = 0;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      b.life -= dt;
      if (b.life <= 0) { this.onExpire?.(b.pos); continue; }
      b.prev.copy(b.pos);
      const sp = b.vel.length();
      b.vel.multiplyScalar(1 / (1 + K_DRAG * sp * dt));
      b.vel.y -= GRAV * dt;
      b.pos.addScaledVector(b.vel, dt);

      // 命中判定：線分（前フレーム→今）と球
      let hit = false;
      for (const tg of targets) {
        if (tg.alive && segmentHitsSphere(b.prev, b.pos, tg.pos, tg.radius)) {
          this.hits++;
          fx.sparks(b.pos, tg.vel);
          onHit(tg, tg.hit(this.dmg));
          hit = true;
          break;
        }
      }
      if (hit) continue;
      if (b.pos.y < 4000 && b.pos.y < Math.max(0, heightAt(b.pos.x, b.pos.z))) {
        if (b.pos.y > 0.5 || Math.random() < 0.5) fx.dust(b.pos);
        continue;
      }
      B[w++] = b;
    }
    B.length = w;
  }

  spawn(ac, lead, fx) {
    this.gunDir(ac, _gunDir);
    // 散布
    const D = this.dispersion;
    _gunDir.x += (Math.random() - 0.5) * 2 * D;
    _gunDir.y += (Math.random() - 0.5) * 2 * D;
    _gunDir.z += (Math.random() - 0.5) * 2 * D;
    _gunDir.normalize();
    this.mi = (this.mi + 1) % this.muzzles.length;
    const pos = this.muzzle(ac, new THREE.Vector3(), this.mi);
    const vel = new THREE.Vector3().copy(ac.vel).addScaledVector(_gunDir, this.muzzleV);
    pos.addScaledVector(vel, lead);
    this.bullets.push({ pos, prev: pos.clone(), vel, life: this.life * (0.92 + 0.16 * Math.random()) });
    if (Math.random() < 0.35) fx.muzzle(pos, ac.vel, this.flash);
  }

  // 描画用：曳光弾の線分を更新
  render(ac) {
    const B = this.bullets;
    const n = Math.min(B.length, this.maxDraw);
    const a = this.linePos;
    for (let i = 0; i < n; i++) {
      const b = B[i];
      _rel.subVectors(b.vel, ac.vel);
      const len = _rel.length() || 1;
      _rel.multiplyScalar(this.streak / len);
      a[i * 6] = b.pos.x; a[i * 6 + 1] = b.pos.y; a[i * 6 + 2] = b.pos.z;
      a[i * 6 + 3] = b.pos.x - _rel.x; a[i * 6 + 4] = b.pos.y - _rel.y; a[i * 6 + 5] = b.pos.z - _rel.z;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.setDrawRange(0, n * 2);
    if (this.heads) {
      const h = this.headPos;
      for (let i = 0; i < n; i++) { h[i * 3] = B[i].pos.x; h[i * 3 + 1] = B[i].pos.y; h[i * 3 + 2] = B[i].pos.z; }
      this.heads.geometry.attributes.position.needsUpdate = true;
      this.heads.geometry.setDrawRange(0, n);
    }
  }

  // リード計算（ディレクター）ガンサイト
  // 返り値の pipper にターゲットを重ねて撃てば、弾が届く時刻にターゲットと交わる。
  computeSight(ac, target) {
    this.muzzle(ac, _muz);
    this.gunDir(ac, _gunDir);
    const v0vec = _u.copy(ac.vel).addScaledVector(_gunDir, this.muzzleV);
    const v0 = v0vec.length();
    v0vec.divideScalar(v0);
    const range = _tmp.subVectors(target.pos, _muz).length();
    // 加速度の推定は 10G 程度で頭打ち（発散防止）
    const acc = _acc.copy(target.acc ?? target.accEst).clampLength(0, 100);

    let t = Math.min(range / v0, 6);
    for (let i = 0; i < 4; i++) {
      // t 秒後のターゲット位置までの距離に弾が届く時刻を求め直す
      _tmp.copy(target.pos)
        .addScaledVector(target.vel, t)
        .addScaledVector(acc, 0.5 * t * t);
      const r = _tmp.distanceTo(_muz);
      t = Math.min((Math.exp(K_DRAG * r) - 1) / (K_DRAG * v0), 6);
    }
    const s = Math.log(1 + K_DRAG * v0 * t) / K_DRAG;
    const pipper = new THREE.Vector3().copy(_muz).addScaledVector(v0vec, s);
    pipper.y -= 0.5 * GRAV * t * t;
    // ターゲットの移動分を差し引く
    pipper.addScaledVector(target.vel, -t).addScaledVector(acc, -0.5 * t * t);
    return { pipper, tof: t, range };
  }
}

let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.3, 'rgba(255,255,255,0.7)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  return (_glowTex = new THREE.CanvasTexture(c));
}

function segmentHitsSphere(a, b, c, r) {
  _seg.subVectors(b, a);
  const len2 = _seg.lengthSq();
  let t = len2 > 0 ? _tmp.subVectors(c, a).dot(_seg) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  _tmp.copy(a).addScaledVector(_seg, t);
  return _tmp.distanceToSquared(c) <= r * r;
}
