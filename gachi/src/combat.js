// 戦闘の進行：敵機のウェーブ、ターゲット選択、シーカー、ミサイル・フレア、被弾・撃墜の処理
import * as THREE from 'three';
import { Enemy, SKILLS } from './enemy.js';
import { Wreck } from './wreck.js';
import { Missile, Flare, AIM9X, R74, flyoutTime } from './missile.js';

const DEG = Math.PI / 180;
const CALLSIGNS = ['BANDIT 1', 'BANDIT 2', 'BANDIT 3'];
const NUM = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];
export const MISSILES_PER_WAVE = 4;
export const FLARES_PER_WAVE = 60;
export const MISSION_WAVES = 5;   // 5 ウェーブ目はエース編隊（FELON）

const NO_ENGINE = { engine: 0 };
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _f = new THREE.Vector3();

export class Combat {
  constructor(scene, fx, world, player, gun, playerJet, sound) {
    this.scene = scene;
    this.fx = fx;
    this.world = world;
    this.player = player;
    this.gun = gun;            // プレイヤーの機関砲（HUD が参照）
    this.playerJet = playerJet;
    this.sound = sound;
    this.enemies = [];
    this.missiles = [];
    this.flares = [];
    this.missileCount = MISSILES_PER_WAVE;
    this.flareCount = FLARES_PER_WAVE;
    this.flareQueue = 0;
    this.wrecks = [];          // 撃墜した敵機の残骸 { w, jet }
    this.flareT = 0;
    // プレイヤーへの脅威（MAWS / RWR 用）
    this.incoming = [];        // 自分に向かってくる敵ミサイル { m, range, tti, bearing }
    this.rwr = [];             // 敵機 { e, bearing, range, locked }
    this.skillKey = 'veteran';
    this.kills = 0;
    this.wave = 0;
    this.target = null;
    this.sight = null;
    // シーカー状態（HUD・トーン用）
    this.seeker = { state: 'off', acq: 0, inRange: false, tof: null, checkT: 0 };
    this.msg = '';
    this.msgTime = 0;
    this.hitFlash = 0;
    this.nextWave = 0;
    this.onHitEnemy = (e, killed) => { this.stats.gunHits++; if (killed) this.kill(e); };
    this.onHitPlayer = (_p, killed) => {
      this.hitFlash = 0.35;
      if (killed) {
        this.fx.explosion(this.player.pos, this.player.vel);
        this.sound?.explosion(this.player.pos);
        this.message('SHOT DOWN', 99);
      }
    };
    this.onDetonate = (m, target, dist) => {
      if (!target) return;
      const sp = m.spec;
      const dmg = dist < sp.lethal ? 150 : 40 + 50 * (1 - (dist - sp.lethal) / (sp.fuze - sp.lethal));
      const killed = target.hit(dmg);
      if (target === this.player) this.onHitPlayer(target, killed);
      else {
        if (m.owner === this.player) this.stats.mslHits++;
        if (killed) this.kill(target);
      }
    };
  }

  get skill() { return SKILLS[this.skillKey]; }

  // ---- ミッションの記録（デブリーフィング用） ----
  newStats() {
    this.stats = { time: 0, gunRounds: 0, gunHits: 0, mslFired: 0, mslHits: 0, flares: 0, damage: 0 };
    this.mission = { state: 'active', endT: 0 };   // active / complete / failed
    this.prevAmmo = this.gun.ammo;
    this.prevHp = this.player.hp;
  }

  setSkill(key) {
    this.skillKey = key;
    for (const e of this.enemies) e.skill = SKILLS[key];
  }

  message(text, time = 3) {
    this.msg = text;
    this.msgTime = time;
  }

  reset() {
    for (const e of this.enemies) e.dispose(this.scene);
    for (const m of this.missiles) m.dispose();
    for (const r of this.wrecks) this.removeWreck(r);
    this.wrecks = [];
    this.enemies = [];
    this.missiles = [];
    this.flares = [];
    this.flareQueue = 0;
    this.incoming = [];
    this.rwr = [];
    this.kills = 0;
    this.wave = 0;
    this.target = null;
    this.nextWave = 0;
    this.hitFlash = 0;
    this.newStats();
    this.startWave();
  }

  startWave() {
    for (const e of this.enemies) e.dispose(this.scene);
    this.enemies = [];
    this.wave++;
    const final = this.wave === MISSION_WAVES;
    const n = final ? 2 : Math.min(this.wave, 3);
    for (let i = 0; i < n; i++) {
      // 最終ウェーブ：隊長機は必ず ACE
      const e = final
        ? new Enemy(this.scene, i === 0 ? 'ace' : this.skillKey, i === 0 ? 'FELON LEAD' : 'FELON 2', this)
        : new Enemy(this.scene, this.skillKey, CALLSIGNS[i], this);
      e.spawnMerge(this.player, 6500 + i * 900, (i - (n - 1) / 2) * 1800, i % 2 ? 300 : -150, this.world.heightAt);
      this.enemies.push(e);
    }
    this.target = null;
    this.gun.reload();
    this.missileCount = MISSILES_PER_WAVE;
    this.playerJet.setMissiles(this.missileCount);
    this.flareCount = FLARES_PER_WAVE;
    this.prevAmmo = this.gun.ammo;
    this.message(final ? `FINAL WAVE  -  FELON FLIGHT` : `WAVE ${this.wave} / ${MISSION_WAVES}  -  FIGHT'S ON`, 3);
  }

  kill(e) {
    if (e.handled) return;
    e.handled = true;
    this.fx.explosion(e.pos, e.vel);
    this.sound?.explosion(e.pos);
    // 燃えながら落ちる残骸に（地面に激突したときは落下なしで爆発）
    const w = new Wreck(this.scene, this.fx, this.sound);
    w.start(e.ac, e.jet, e.ac.hp > 0, this.world.heightAt);
    e.wreck = w;
    this.wrecks.push({ w, jet: e.jet });
    this.kills++;
    this.message(`SPLASH ${NUM[this.kills] ?? this.kills}`, 3);
    this.killEvent = { w, text: `${e.callsign}  SPLASH ${NUM[this.kills] ?? this.kills}` };   // キルカメラ用
  }

  // ---- ミサイル発射（プレイヤー） ----
  fireMissile() {
    const p = this.player;
    if (this.missileCount <= 0 || p.crashed) return;
    const st = this.playerJet.missileStations[MISSILES_PER_WAVE - this.missileCount];
    const pos = _v.set(st[0], st[1], st[2]).applyQuaternion(p.quat).add(p.pos).clone();
    const fwd = _f.set(0, 0, -1).applyQuaternion(p.quat);
    const vel = p.vel.clone().addScaledVector(fwd, 15);
    const track = this.seeker.state === 'lock' ? this.target : null;
    this.missiles.push(new Missile(this.scene, p, pos, vel, track, AIM9X));
    this.missileCount--;
    this.stats.mslFired++;
    this.playerJet.setMissiles(this.missileCount);
    this.sound?.launch();
    this.message(track ? 'FOX TWO' : 'FOX TWO (NO LOCK)', 1.5);
  }

  // ---- 敵機のミサイル発射 ----
  fireEnemyMissile(e) {
    if (e.missiles <= 0) return;
    const q = e.ac.quat;
    const st = e.jet.missileStations[e.jet.missileStations.length - e.missiles];
    const pos = _v.set(st[0], st[1], st[2]).applyQuaternion(q).add(e.pos).clone();
    const vel = e.vel.clone().addScaledVector(_f.set(0, 0, -1).applyQuaternion(q), 15);
    this.missiles.push(new Missile(this.scene, e, pos, vel, this.player, R74));
    e.missiles--;
    e.jet.setMissiles(e.missiles);
  }

  // ---- プレイヤーのフレア（1 回押すと 2 発ずつ） ----
  flareProgram(n = 2) {
    if (this.player.crashed) return;
    this.flareQueue += n;
  }

  dropPlayerFlare() {
    const p = this.player, q = p.quat;
    const side = this.flareCount % 2 ? 1 : -1;
    const pos = _v.set(side * 1.2, -0.6, 6).applyQuaternion(q).add(p.pos).clone();
    const vel = _w.set(side * (15 + Math.random() * 15), -20 - Math.random() * 10, 10).applyQuaternion(q).add(p.vel).clone();
    this.flares.push(new Flare(p, pos, vel));
    this.flareCount--;
    this.stats.flares++;
  }

  // 敵機のフレア放出
  dropFlare(e) {
    const q = e.ac.quat;
    const pos = _v.set(0, -1.2, 4).applyQuaternion(q).add(e.pos).clone();
    const vel = _w.set((Math.random() - 0.5) * 30, -25, 8).applyQuaternion(q).add(e.vel).clone();
    this.flares.push(new Flare(e, pos, vel));
  }

  // 物理ステップ
  step(dt, trigger) {
    const p = this.player, hAt = this.world.heightAt;
    for (const e of this.enemies) {
      e.update(dt, p, this.fx, hAt, this.onHitPlayer);
      e.updateBullets(dt, p, this.fx, hAt, this.onHitPlayer);
    }
    this.gun.update(dt, p, trigger, this.enemies, this.fx, hAt, this.onHitEnemy);

    // プレイヤーのフレア（0.12 秒間隔）
    this.flareT -= dt;
    if (this.flareQueue > 0 && this.flareT <= 0) {
      if (this.flareCount > 0 && !p.crashed) {
        this.dropPlayerFlare();
        this.flareT = 0.12;
        this.flareQueue--;
      } else {
        this.flareQueue = 0;
      }
    }
    for (const f of this.flares) f.update(dt, this.fx);
    this.flares = this.flares.filter((f) => f.alive);

    const playerList = [p];
    for (const m of this.missiles) {
      if (m.owner === p) {
        // ロックせずに撃ったミサイルは、発射後しばらく前方の熱源を探す
        if (!m.track && m.age < 3) m.track = this.acquireAfterLaunch(m);
        m.update(dt, this.enemies, this.flares, this.fx, hAt, this.onDetonate);
      } else {
        m.update(dt, playerList, this.flares, this.fx, hAt, this.onDetonate);
      }
    }
    this.missiles = this.missiles.filter((m) => m.alive);
  }

  acquireAfterLaunch(m) {
    _f.copy(m.vel).normalize();
    let best = null, bestAng = 12 * DEG;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      _v.subVectors(e.pos, m.pos);
      if (_v.length() > 8000) continue;
      const a = Math.acos(Math.min(1, _v.normalize().dot(_f)));
      if (a < bestAng) { bestAng = a; best = e; }
    }
    return best;
  }

  // 描画フレーム
  frame(dt) {
    // 地面に激突した敵も撃墜扱い（マニューバー・キル）
    for (const e of this.enemies) if (!e.alive && !e.handled) this.kill(e);

    this.updateWrecks(dt);

    this.msgTime = Math.max(0, this.msgTime - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);

    // ミッションの記録
    const st = this.stats, ms = this.mission;
    if (ms.state === 'active') {
      st.time += dt;
      if (this.gun.ammo < this.prevAmmo) st.gunRounds += this.prevAmmo - this.gun.ammo;
      this.prevAmmo = this.gun.ammo;
      if (this.player.hp < this.prevHp) st.damage += this.prevHp - this.player.hp;
      this.prevHp = this.player.hp;
      if (this.player.crashed) { ms.state = 'failed'; ms.endT = 0; }
    } else {
      ms.endT += dt;
    }

    if (this.enemies.length && this.enemies.every((e) => !e.alive) && !this.player.crashed && ms.state === 'active') {
      if (this.wave >= MISSION_WAVES) {
        ms.state = 'complete';
        ms.endT = 0;
        this.message('MISSION COMPLETE  -  RTB', 99);
      } else {
        if (this.nextWave <= 0) this.nextWave = 6;
        this.nextWave -= dt;
        if (this.nextWave <= 0) this.startWave();
      }
    }

    if (!this.target || !this.target.alive) this.target = this.pickTarget();
    this.sight = this.target ? this.gun.computeSight(this.player, this.target) : null;
    this.updateSeeker(dt);

    this.updateThreats();

    // 敵機に「自分を追っているミサイル」を知らせる（MAWS）
    for (const e of this.enemies) {
      let best = null, bestD = 8000;
      for (const m of this.missiles) {
        const chasing = m.track === e || (m.track instanceof Flare && m.track.owner === e);
        if (!chasing) continue;
        const d = m.pos.distanceTo(e.pos);
        if (d < bestD) { bestD = d; best = m; }
      }
      e.threat = best;
    }
  }

  // ---- プレイヤーの MAWS（ミサイル接近警報）と RWR ----
  //   MAWS: 敵ミサイルのモーターの紫外線・赤外線を検知（燃焼中は遠くから、燃え尽きたら近くだけ）
  //   RWR : 機首をこちらに向けた敵機のレーダー照射。シーカーがロックしていたら LOCK
  updateThreats() {
    const p = this.player;
    const qi = new THREE.Quaternion().copy(p.quat).invert();
    const bearingOf = (pos) => {
      _v.subVectors(pos, p.pos).applyQuaternion(qi);     // 機体座標
      return Math.atan2(_v.x, -_v.z);                    // 0 = 正面、+ = 右
    };
    this.incoming = [];
    if (!p.crashed) {
      for (const m of this.missiles) {
        if (m.owner === p || !m.alive) continue;
        _v.subVectors(p.pos, m.pos);
        const range = _v.length();
        const detect = m.burning ? 10000 : 2500;
        if (range > detect) continue;
        const vc = _w.subVectors(m.vel, p.vel).dot(_v.normalize());
        if (vc < 0) continue;                              // 離れていく
        this.incoming.push({ m, range, tti: range / Math.max(vc, 1), bearing: bearingOf(m.pos) });
      }
      this.incoming.sort((a, b) => a.tti - b.tti);
    }
    this.rwr = [];
    for (const e of this.enemies) {
      if (!e.alive || p.crashed) continue;
      _v.subVectors(p.pos, e.pos);
      const range = _v.length();
      if (range > 20000) continue;
      const efwd = _w.set(0, 0, -1).applyQuaternion(e.ac.quat);
      const aim = efwd.dot(_v.normalize());
      if (aim < 0.5 && !e.locked) continue;              // レーダーの視野外
      this.rwr.push({ e, range, bearing: bearingOf(e.pos), locked: e.locked });
    }
  }

  // デブリーフィングの評価（S / A / B / C / D）
  rating() {
    const st = this.stats;
    const acc = st.gunRounds ? Math.min(1, st.gunHits / st.gunRounds) : 0;
    let score = this.kills * 1000 + Math.round(acc * 2000) + st.mslHits * 200 - Math.round(st.damage * 8);
    if (this.mission.state === 'complete') score += 3000 + Math.max(0, Math.round((600 - st.time) * 5));
    const grade = score >= 12000 ? 'S' : score >= 9000 ? 'A' : score >= 6000 ? 'B' : score >= 3000 ? 'C' : 'D';
    return { score, grade, acc };
  }

  // ---- AIM-9X シーカー ----
  updateSeeker(dt) {
    const sk = this.seeker, p = this.player, t = this.target;
    if (this.missileCount <= 0 || p.crashed) {
      sk.state = 'off'; sk.acq = 0; sk.inRange = false;
      return;
    }
    let canSee = false;
    if (t && t.alive) {
      _v.subVectors(t.pos, p.pos);
      const range = _v.length();
      _v.divideScalar(range);
      const fwd = _f.set(0, 0, -1).applyQuaternion(p.quat);
      const off = Math.acos(Math.min(1, _v.dot(fwd)));
      // 赤外線の見え方：後方から（排気が見える）ほど遠くまで、A/B ならさらに遠く
      const tail = _w.copy(t.vel).normalize().dot(_v);
      let irRange = 4000 + 7000 * Math.max(0, tail);
      if (t.ac.engine > 1.001) irRange *= 1.4;
      const cone = sk.state === 'lock' ? 60 * DEG : 30 * DEG;
      canSee = range < irRange * (sk.state === 'lock' ? 1.1 : 1) && off < cone;
      sk.range = range;
    }
    // idle: 何も見えていない / search: 熱源を捉えてグロウル / lock: ロック（高音）
    if (canSee) {
      sk.acq += dt;
      sk.state = sk.acq > 0.8 ? 'lock' : 'search';
    } else {
      sk.acq = 0;
      sk.state = 'idle';
    }
    // 射程内か（実際にミサイルを飛ばして判定。0.3 秒ごと）
    sk.checkT -= dt;
    if (sk.state !== 'lock') {
      sk.inRange = false; sk.tof = null;
    } else if (sk.checkT <= 0) {
      sk.checkT = 0.3;
      sk.tof = flyoutTime(p, t);
      sk.inRange = sk.tof !== null && sk.range > 300;
    }
  }

  // 機首に近く、距離の近い敵を選ぶ
  pickTarget() {
    const p = this.player;
    let best = null, bestScore = Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = e.pos.clone().sub(p.pos);
      const range = d.length();
      const fwdDot = d.normalize().dot(p.vel.clone().normalize());
      const score = range * (2 - fwdDot);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  cycleTarget() {
    const alive = this.enemies.filter((e) => e.alive);
    if (!alive.length) return;
    const i = alive.indexOf(this.target);
    this.target = alive[(i + 1) % alive.length];
    this.seeker.acq = 0;
  }

  // 飛行中のプレイヤーミサイルのうち、敵を追っている最も近いものの到達予想時間
  nearestTti() {
    let tti = null;
    for (const m of this.missiles) {
      if (!m.track || !m.track.ac) continue;
      _v.subVectors(m.track.pos, m.pos);
      const r = _v.length();
      const vc = -_w.subVectors(m.track.vel, m.vel).dot(_v.normalize());
      if (vc > 0) {
        const t = r / vc;
        if (tti === null || t < tti) tti = t;
      }
    }
    return tti;
  }

  removeWreck(r) {
    r.w.reset();
    this.scene.remove(r.jet.group);
  }

  // 敵機の残骸：落下・炎上。着地して 12 秒たったら片付ける
  updateWrecks(dt) {
    for (const r of this.wrecks) {
      r.w.update(dt, this.world.heightAt);
      r.jet.group.position.copy(r.w.pos);
      r.jet.group.quaternion.copy(r.w.quat);
      r.jet.group.visible = !r.w.landed;
      r.jet.update(NO_ENGINE, dt);
      if (r.w.landed && r.w.t - r.w.landT > 12) r.done = true;
    }
    for (const r of this.wrecks) if (r.done) this.removeWreck(r);
    this.wrecks = this.wrecks.filter((r) => !r.done);
  }

  render(dt) {
    for (const e of this.enemies) {
      e.sync(dt);
      if (dt > 0 && e.alive) this.fx.vapor(e.jet, e.ac, dt);
      e.gun.render(this.player);
    }
  }
}
