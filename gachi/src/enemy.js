// 敵機 AI
// プレイヤーと同じ飛行モデル（Aircraft）を、AI が「操縦入力」だけで飛ばす。
// 基本は「揚力ベクトルを狙う方向に向けて引く」BFM の操縦。
//   attack : 遠距離はリード追跡、接近しすぎたらラグ追跡、射程内はガンソリューションに機首を置く
//   defend : 後方を取られたら脅威に向かってブレーク旋回 + ジンク（不規則な機動）
//   recover: 地面が近ければ何より先に引き起こし
import * as THREE from 'three';
import { Aircraft, F18E } from './flight.js';
import { buildJet } from './jet.js';
import { Gun } from './gun.js';
import { flyoutTime } from './missile.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export const SKILLS = {
  // flareSalvo: 1 回にまくフレアの数 / flareRange: ミサイルがこの距離に来たらまく / mslThrottle: ミサイル回避中のスロットル
  // msl: 搭載ミサイル数 / lockTime: ロックまでの時間 / mslCool: 次の発射までの間隔 / maxTof: この到達時間以内なら撃つ
  rookie: { name: 'ROOKIE', react: 0.8, gScale: 0.7, override: false, fireTol: 2.2 * DEG, burst: 0.35, noise: 0.03, breakRange: 1200, flareSalvo: 2, flareRange: 2000, mslThrottle: 1.25, msl: 1, lockTime: 2.5, mslCool: 20, maxTof: 7 },
  veteran: { name: 'VETERAN', react: 0.35, gScale: 1.0, override: false, fireTol: 1.3 * DEG, burst: 0.5, noise: 0.012, breakRange: 2000, flareSalvo: 4, flareRange: 3500, mslThrottle: 1.0, msl: 2, lockTime: 1.5, mslCool: 12, maxTof: 9 },
  ace: { name: 'ACE', react: 0.15, gScale: 1.0, override: true, fireTol: 0.9 * DEG, burst: 0.7, noise: 0.004, breakRange: 2600, flareSalvo: 6, flareRange: 5000, mslThrottle: 0.6, msl: 2, lockTime: 0.9, mslCool: 8, maxTof: 6 },
};

const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
const _los = new THREE.Vector3(), _aim = new THREE.Vector3(), _tmp = new THREE.Vector3();
const _db = new THREE.Vector3(), _qi = new THREE.Quaternion(), _tf = new THREE.Vector3();
const _muz = new THREE.Vector3(), _pip = new THREE.Vector3(), _tail = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Enemy {
  constructor(scene, skillKey, callsign, combat) {
    this.combat = combat;
    this.threat = null;      // 自分を追ってくるミサイル（Combat が設定）
    this.threatT = 0;
    this.flares = 30;
    this.flareQueue = 0;
    this.flareT = 0;
    this.flareCool = 0;
    this.ac = new Aircraft(F18E);
    this.jet = buildJet({ type: 'su57' });
    scene.add(this.jet.group);
    this.gun = new Gun(scene, { color: 0xff9a70 });
    this.skill = SKILLS[skillKey];
    this.callsign = callsign;
    this.ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 1, gOverride: false };
    this.pVel = new THREE.Vector3();   // 知覚したターゲットの速度（反応遅れ）
    this.pAcc = new THREE.Vector3();
    this.mode = 'attack';
    this.jinkT = 0;
    this.breakSign = 1;
    this.prevMode = 'attack';
    this.burstT = 0;
    this.burstCool = 1;
    this.trigger = false;
    this.smokeT = 0;
    this.removed = false;
    // ミサイル（AIM-9X 相当）
    this.missiles = 0;
    this.lockT = 0;
    this.locked = false;       // シーカーがプレイヤーをロック中（RWR に出る）
    this.mslCool = 0;
    this.checkT = 0;
  }

  get pos() { return this.ac.pos; }
  get vel() { return this.ac.vel; }
  get acc() { return this.ac.accEst; }
  get radius() { return this.ac.radius; }
  get alive() { return !this.ac.crashed; }
  get hp() { return this.ac.hp; }
  hit(dmg) { return this.ac.hit(dmg); }

  // プレイヤーの前方 dist に、向かい合わせで出現（ヘッドオンのマージ）
  spawnMerge(player, dist, lateral, dAlt, heightAt) {
    const h = Math.atan2(player.vel.x, -player.vel.z);
    const p = new THREE.Vector3(
      player.pos.x + Math.sin(h) * dist + Math.cos(h) * lateral,
      player.pos.y + dAlt,
      player.pos.z - Math.cos(h) * dist + Math.sin(h) * lateral,
    );
    p.y = Math.max(p.y, heightAt(p.x, p.z) + 1200);
    this.ac.reset(p, THREE.MathUtils.radToDeg(h) + 180, 250, 1.0);
    this.pVel.copy(player.vel);
    this.pAcc.set(0, 0, 0);
    this.gun.reload();
    this.jet.group.visible = true;
    this.removed = false;
    this.missiles = this.skill.msl;
    this.jet.setMissiles(this.missiles);
    this.lockT = 0;
    this.locked = false;
    this.mslCool = 6 + Math.random() * 4;   // マージ直後は撃たない
  }

  think(dt, tgt, heightAt) {
    const ac = this.ac, s = this.skill;
    const q = ac.quat;
    const fwd = _f.set(0, 0, -1).applyQuaternion(q);
    const k = 1 - Math.exp(-dt / s.react);
    this.pVel.lerp(tgt.vel, k);
    this.pAcc.lerp(tgt.accEst, k);

    _los.subVectors(tgt.pos, ac.pos);
    const range = _los.length();
    _los.divideScalar(range || 1);
    const ata = Math.acos(clamp(fwd.dot(_los), -1, 1));           // 自分の機首からターゲットまでの角度
    _tf.copy(tgt.vel).normalize();
    const threatAta = Math.acos(clamp(_tf.dot(_tmp.copy(_los).negate()), -1, 1)); // 相手の機首が自分を向いている角度
    const closure = -_tmp.subVectors(tgt.vel, ac.vel).dot(_los);

    // 地面との接近を予測
    const agl = ac.pos.y - Math.max(0, heightAt(ac.pos.x, ac.pos.z));
    const ahead = Math.max(0, heightAt(ac.pos.x + ac.vel.x * 6, ac.pos.z + ac.vel.z * 6));
    const danger = agl < 350 || ac.pos.y + Math.min(0, ac.vel.y) * 6 < ahead + 450;

    // ミサイル警報：反応時間の後に気づく
    const th = this.threat && this.threat.alive ? this.threat : null;
    this.threatT = th ? this.threatT + dt : 0;
    const mslDist = th ? th.pos.distanceTo(ac.pos) : Infinity;

    this.prevMode = this.mode;
    if (danger) this.mode = 'recover';
    else if (th && this.threatT > s.react) this.mode = 'missile';
    else if (this.prevMode === 'defend'
      ? threatAta < 55 * DEG && range < s.breakRange * 1.3 && fwd.dot(_los) < 0.6
      : threatAta < 35 * DEG && range < s.breakRange && fwd.dot(_los) < 0.3) this.mode = 'defend';
    else this.mode = 'attack';

    let sight = null;
    if (this.mode === 'recover') {
      _aim.set(ac.vel.x, 0, ac.vel.z).normalize().addScaledVector(UP, 1.3);
    } else if (this.mode === 'missile') {
      // ミサイルに対して真横を向く（ビーム）：比例航法に大きな旋回を強いて運動エネルギーを奪う
      _tmp.subVectors(ac.pos, th.pos).normalize();          // ミサイル → 自分
      _r.crossVectors(_tmp, UP);
      if (_r.lengthSq() < 1e-4) _r.set(-fwd.z, 0, fwd.x);
      _r.normalize();
      if (_r.dot(fwd) < 0) _r.negate();                      // 今の機首に近い側の真横
      _aim.copy(_r).addScaledVector(UP, ac.pos.y > 2500 ? -0.15 : 0.15);
    } else if (this.mode === 'defend') {
      // 水平面での右方向（機体のロールに影響されない）
      _r.set(-fwd.z, 0, fwd.x).normalize();
      if (this.prevMode !== 'defend') {
        // ブレーク方向：脅威のいる側へ（真後ろならランダム）
        const side = _los.dot(_r);
        this.breakSign = Math.abs(side) > 0.1 ? Math.sign(side) : (Math.random() < 0.5 ? -1 : 1);
        this.jinkT = 1.2 + Math.random();
      }
      const fromTail = Math.acos(clamp(-fwd.dot(_los), -1, 1));
      if (fromTail < 70 * DEG) {
        // 後方の脅威：決めた方向へ最大Gでブレーク（少し上向き）
        _aim.copy(_r).multiplyScalar(this.breakSign).addScaledVector(UP, 0.25).addScaledVector(fwd, -0.2);
        // ガン射程で機首を向けられていたら、ときどき切り返す（ジンク）
        this.jinkT -= dt;
        if (range < 1100 && threatAta < 12 * DEG && this.jinkT <= 0) {
          this.breakSign *= -1;
          this.jinkT = 0.9 + Math.random() * 0.9;
        }
      } else {
        // 横〜前方の脅威：脅威に向かって旋回
        _aim.copy(_los);
      }
    } else if (range < 1500 && ata < 25 * DEG) {
      // ガンソリューション：ピパーがターゲットに重なる方向へ機首を置く
      sight = this.gun.computeSight(ac, { pos: tgt.pos, vel: this.pVel, acc: this.pAcc });
      this.gun.muzzle(ac, _muz);
      _pip.subVectors(sight.pipper, _muz).normalize();
      _aim.copy(fwd).add(_los).sub(_pip);
    } else if (closure > 120 && range < 2500) {
      // 速すぎる接近 → ラグ追跡でオーバーシュートを防ぐ
      _aim.copy(tgt.pos).addScaledVector(this.pVel, -1.2).sub(ac.pos);
    } else {
      // リード追跡で距離を詰める
      _aim.copy(tgt.pos).addScaledVector(this.pVel, clamp(range / 700, 0, 3)).sub(ac.pos);
    }
    _aim.normalize();
    _aim.x += (Math.random() - 0.5) * s.noise;
    _aim.y += (Math.random() - 0.5) * s.noise;
    _aim.z += (Math.random() - 0.5) * s.noise;
    _aim.normalize();

    // ---- 狙う方向 → 操縦入力 ----
    _db.copy(_aim).applyQuaternion(_qi.copy(q).invert());
    const aimAta = Math.acos(clamp(-_db.z, -1, 1));
    const phi = Math.atan2(_db.x, _db.y);          // 揚力ベクトルを向けるためのバンク誤差
    const vert = Math.atan2(_db.y, -_db.z);        // 機首より上の角度
    const horiz = Math.atan2(_db.x, -_db.z);       // 機首より右の角度
    const rollRate = -ac.omega.z;
    const far = smoothstep(2 * DEG, 12 * DEG, aimAta); // 遠い=揚力ベクトル操縦、近い=微調整

    const c = this.ctl;
    c.roll = clamp((2.2 * phi * far + 3.0 * horiz * (1 - far)) - 0.25 * rollRate, -1, 1);
    c.pitch = Math.abs(phi) < 1.3 || far < 0.5 ? clamp(vert * 4, -0.4, 1) : 0.15;
    if (c.pitch > 0) c.pitch *= s.gScale;
    c.yaw = clamp(horiz * 5 * (1 - far), -1, 1);

    // ---- エネルギー管理 ----
    const spd = ac.vel.length();
    ac.speedbrake = false;
    if (this.mode === 'missile') c.throttle = mslDist < 4000 ? s.mslThrottle : 1.25; // 熱源を小さくする
    else if (this.mode !== 'attack') c.throttle = 1.25;
    else if (range < 600 && closure > 40) { c.throttle = 0.3; ac.speedbrake = true; }
    else if (spd < 260 || ata > 40 * DEG || (range > 1200 && closure < 80)) c.throttle = 1.25;
    else c.throttle = 1.0;
    c.gOverride = s.override && (this.mode !== 'attack' || ata > 30 * DEG);

    // ---- 射撃（バースト） ----
    this.burstCool -= dt;
    let wantFire = false;
    if (sight && tgt.alive && range < 1100) {
      const err = Math.acos(clamp(_pip.dot(_los), -1, 1));
      wantFire = err < s.fireTol;
    }
    if (this.burstT > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) this.burstCool = 0.4 + Math.random() * 0.8;
    } else if (wantFire && this.burstCool <= 0) {
      this.burstT = s.burst;
    }
    this.trigger = this.burstT > 0 && this.mode === 'attack';

    // ---- ミサイル：機首前方の熱源をシーカーが捉え続けたらロック → 射程内なら発射 ----
    this.mslCool -= dt;
    let canSee = false;
    if (this.missiles > 0 && tgt.alive && this.mode === 'attack') {
      const tail = _tf.dot(_los);                       // + = 相手の排気側から見ている
      let irRange = 4000 + 7000 * Math.max(0, tail);
      if (tgt.engine > 1.001) irRange *= 1.4;
      canSee = range < irRange * (this.locked ? 1.1 : 1) && ata < (this.locked ? 45 : 30) * DEG;
    }
    this.lockT = canSee ? this.lockT + dt : 0;
    this.locked = this.lockT > s.lockTime;
    this.checkT -= dt;
    if (this.locked && this.mslCool <= 0 && range > 600 && this.checkT <= 0) {
      this.checkT = 0.4;
      const tof = flyoutTime(ac, tgt);
      if (tof !== null && tof < s.maxTof) {
        this.combat.fireEnemyMissile(this);
        this.mslCool = s.mslCool;
      }
    }

    // ---- フレア ----
    this.flareCool -= dt;
    this.flareT -= dt;
    if (this.mode === 'missile' && mslDist < s.flareRange && this.flareCool <= 0) {
      this.flareQueue = s.flareSalvo;
      this.flareCool = 2.5;
    }
    if (this.flareQueue > 0 && this.flareT <= 0 && this.flares > 0) {
      this.combat.dropFlare(this);
      this.flares--;
      this.flareQueue--;
      this.flareT = 0.22;
    }
  }

  update(dt, player, fx, heightAt, onHitPlayer) {
    if (!this.alive) return;
    this.think(dt, player, heightAt);
    this.ac.update(dt, this.ctl, heightAt);
    this.gun.update(dt, this.ac, this.trigger && !player.crashed, [player], fx, heightAt, onHitPlayer);

    // 被弾していたら煙
    if (this.ac.hp < 70) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.03;
        _tail.set(0, 0, 8).applyQuaternion(this.ac.quat).add(this.ac.pos);
        fx.damageSmoke(_tail, this.ac.vel, this.ac.hp < 35);
      }
    }
  }

  // 撃墜・墜落後もしばらく弾は飛び続ける
  updateBullets(dt, player, fx, heightAt, onHitPlayer) {
    if (this.alive) return;
    this.gun.update(dt, this.ac, false, [player], fx, heightAt, onHitPlayer);
  }

  sync(dt) {
    if (this.wreck) return;            // 撃墜後の残骸は Combat が動かす
    this.jet.group.position.copy(this.ac.pos);
    this.jet.group.quaternion.copy(this.ac.quat);
    this.jet.group.visible = this.alive;
    this.jet.update(this.ac, dt);
  }

  dispose(scene) {
    if (!this.wreck) scene.remove(this.jet.group);   // 落下中の残骸は Combat が片付ける
    scene.remove(this.gun.lines);
  }
}
