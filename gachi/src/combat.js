// 戦闘の進行：敵機のウェーブ、ターゲット選択、シーカー、ミサイル・フレア、被弾・撃墜の処理
import * as THREE from 'three';
import { Enemy, SKILLS } from './enemy.js';
import { Wreck } from './wreck.js';
import { Missile, Flare, AIM9X, R74, HARM, SA15, flyoutTime, flyoutGround } from './missile.js';
import { Tunguska, AAA_SKILLS, SamSite, SAM_SKILLS, lineOfSight } from './ground.js';
import { STRIKE } from './world.js';
import { missionById } from './missions.js';

const DEG = Math.PI / 180;
const CALLSIGNS = ['BANDIT 1', 'BANDIT 2', 'BANDIT 3'];
const NUM = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];
export const MISSILES_PER_WAVE = 4;
export const FLARES_PER_WAVE = 60;
export const MISSION_WAVES = 5;   // 5 ウェーブ目はエース編隊（FELON）
// 偵察：基地の真上（水平 RECON_R 以内）を、低く（AGL 以下）・水平に RECON_T 秒通過すると撮影
const RECON_R = 750, RECON_AGL = 1200, RECON_T = 1.2;
const RTB_R = 3500;          // 出撃地点からこの距離に戻れば帰還

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
    this.ground = [];          // 地上の敵（対空砲）
    this.gunTargets = [];      // 機関砲の当たり判定の対象（敵機 + 地上）
    this.missionId = 'm1';
    this.waypoint = null;      // HUD の目標 { pos, label }
    this.recon = null;         // 偵察 { done, prog, ok, photo }
    this.phase = 'ingress';    // ingress / rtb
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
    this.onHitEnemy = (e, killed) => { this.stats.gunHits++; if (killed) (e.ground ? this.killGround(e) : this.kill(e)); };
    this.onHitPlayer = (_p, killed) => {
      this.hitFlash = 0.35;
      if (killed) {
        this.fx.explosion(this.player.pos, this.player.vel);
        this.sound?.explosion(this.player.pos);
        this.message('SHOT DOWN', 99);
      }
    };
    this.onDetonate = (m, target, dist) => {
      if (!target && m.spec === HARM) {
        // 地面で炸裂：近くの地上目標に爆風
        for (const u of this.ground) {
          const d = u.alive ? u.pos.distanceTo(m.pos) : Infinity;
          if (d < 30) { this.stats.mslHits += d < 12 ? 1 : 0; if (u.hit(d < 12 ? 150 : 35)) this.killGround(u); }
        }
        return;
      }
      if (!target) return;
      const sp = m.spec;
      const dmg = dist < sp.lethal ? 150 : 40 + 50 * (1 - (dist - sp.lethal) / (sp.fuze - sp.lethal));
      const killed = target.hit(dmg);
      if (target === this.player) this.onHitPlayer(target, killed);
      else {
        if (m.owner === this.player) this.stats.mslHits++;
        if (killed) (target.ground ? this.killGround(target) : this.kill(target));
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
    for (const u of this.ground) u.skill = (u instanceof SamSite ? SAM_SKILLS : AAA_SKILLS)[key];
  }

  get def() { return missionById(this.missionId); }
  // 自機のミサイル：対地の作戦で HARM を積むときは HARM、それ以外は AIM-9X
  get missileSpec() { return this.def.weapon === 'harm' ? HARM : AIM9X; }
  get mode() { return this.def.kind === 'ground' ? 'strike' : 'felon'; }

  // ウェーブ・残り数・いまの目標の表示（HUD）
  statusText() {
    if (this.mode === 'strike') {
      const left = this.ground.filter((u) => u.alive).length;
      return `${this.skill.name}  ${this.objectiveText()}  TGT ${left}/${this.ground.length}`;
    }
    const left = this.enemies.filter((e) => e.alive).length;
    return `${this.skill.name}  W${this.wave}  ${left}/${this.enemies.length}`;
  }

  message(text, time = 3) {
    this.msg = text;
    this.msgTime = time;
  }

  reset() {
    for (const e of this.enemies) e.dispose(this.scene);
    for (const u of this.ground) u.dispose(this.scene);
    for (const m of this.missiles) m.dispose();
    for (const r of this.wrecks) this.removeWreck(r);
    this.wrecks = [];
    this.enemies = [];
    this.ground = [];
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
    this.waypoint = null;
    this.recon = null;
    this.phase = 'ingress';
    this.photoRequest = false;
    this.newStats();
    if (this.mode === 'strike') this.startStrike();
    else this.startWave();
  }

  // ---- 谷と基地のミッション ----
  startStrike() {
    const b = STRIKE.base, d = this.def;
    for (const [dx, dz] of d.aaa ?? []) {
      this.ground.push(new Tunguska(this.scene, this.fx, b.x + dx, b.z + dz, 200, this.world.heightAt, this.skillKey, this));
    }
    for (const [dx, dz] of d.sam ?? []) {
      this.ground.push(new SamSite(this.scene, this.fx, b.x + dx, b.z + dz, 180, this.world.heightAt, this.skillKey, this));
    }
    this.gunTargets = [...this.ground];
    this.recon = d.recon ? { done: false, prog: 0, ok: false, photo: null } : null;
    this.phase = 'ingress';
    this.waypoint = { pos: new THREE.Vector3(b.x, b.y + 30, b.z), label: d.recon ? 'RECON' : 'TGT' };
    this.missileCount = d.msl ?? MISSILES_PER_WAVE;
    this.target = null;
    this.gun.reload();
    this.playerJet.setMissiles(this.missileCount);
    this.flareCount = FLARES_PER_WAVE;
    this.prevAmmo = this.gun.ammo;
    this.message(`${d.code}  -  CLEARED FOR TAKEOFF`, 5);
  }

  objectiveText() {
    if (this.phase === 'rtb') return 'RTB';
    if (this.recon && !this.recon.done) return 'RECON';
    return 'STRIKE';
  }

  // 偵察・帰還の判定（描画フレームごと）
  updateObjectives(dt) {
    const p = this.player, ms = this.mission, rc = this.recon;
    if (ms.state !== 'active' || p.crashed || this.mode !== 'strike') return;
    const b = STRIKE.base;
    if (rc && !rc.done) {
      const t = p.t;
      const dh = Math.hypot(p.pos.x - b.x, p.pos.z - b.z);
      rc.ok = dh < RECON_R && t.agl < RECON_AGL && Math.abs(t.bank) < 25 && Math.abs(t.pitch) < 25;
      rc.near = dh < RECON_R * 2.5;
      rc.prog = rc.ok ? rc.prog + dt : Math.max(0, rc.prog - dt * 2);
      if (rc.prog >= RECON_T) {
        rc.done = true;
        this.photoRequest = true;           // main が真下を撮る
        this.sound?.shutter?.();
        this.message('RECON COMPLETE  -  RTB', 4);
      }
    }
    const killed = this.ground.every((u) => !u.alive);
    const needKill = this.def.killAll;
    if (this.phase === 'ingress' && (!rc || rc.done) && (!needKill || killed)) {
      this.phase = 'rtb';
      const s = STRIKE.home;
      this.waypoint = { pos: new THREE.Vector3(s.x, s.y, s.z), label: 'RTB' };
    }
    if (this.phase === 'rtb') {
      const s = STRIKE.home;
      if (Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < RTB_R) {
        ms.state = 'complete';
        ms.endT = 0;
        this.waypoint = null;
        this.message('MISSION COMPLETE  -  WELCOME HOME', 99);
      }
    }
  }

  // 地上目標の撃破
  killGround(u) {
    if (u.handled) return;
    u.handled = true;
    this.fx.explosion(u.pos, u.vel);
    this.sound?.explosion(u.pos);
    this.kills++;
    this.message(`${u.callsign} DESTROYED`, 3);
    this.killEvent = { w: { pos: u.pos, vel: _f.set(0, 0, -1).clone() }, text: `${u.callsign}  DESTROYED` };
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
    this.gunTargets = this.enemies;
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
    const spec = this.missileSpec;
    // HARM は目標のレーダーをロックしてから（電波をたどるので、ロックなしでは撃てない）
    if (spec === HARM && this.seeker.state !== 'lock') { this.message('HARM  NO LOCK', 1.5); return; }
    const st = this.playerJet.missileStations[MISSILES_PER_WAVE - this.missileCount];
    const pos = _v.set(st[0], st[1], st[2]).applyQuaternion(p.quat).add(p.pos).clone();
    const fwd = _f.set(0, 0, -1).applyQuaternion(p.quat);
    const vel = p.vel.clone().addScaledVector(fwd, 15);
    const track = this.seeker.state === 'lock' ? this.target : null;
    this.missiles.push(new Missile(this.scene, p, pos, vel, track, spec));
    this.missileCount--;
    this.stats.mslFired++;
    this.playerJet.setMissiles(this.missileCount);
    this.sound?.launch();
    this.message(spec === HARM ? 'MAGNUM' : track ? 'FOX TWO' : 'FOX TWO (NO LOCK)', 1.5);
    if (spec === HARM) track.harmWarning?.();          // 撃たれた側は（少し遅れて）気づく
  }

  // ---- 地対空ミサイル（SA-15）：真上に打ち上げてから向きを変える ----
  fireSam(u) {
    const pos = u.eye.clone().add(_v.set(0, 1.5, 0));
    const vel = u.aimLauncher(this.player).vel.clone().addScaledVector(_f.set(0, 0, -1).applyQuaternion(u.launcher.quat), 20);
    const m = new Missile(this.scene, u, pos, vel, this.player, SA15);
    m.lostT = 0;
    this.missiles.push(m);
    this.fx.dust(pos);                       // 打ち上げの煙
    this.sound?.explosion(pos, false);
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
    // チャフ（フレアと一緒にまく）：レーダー誘導のミサイルが、まいた雲に騙されて追尾を失うことがある
    for (const m of this.missiles) {
      if (!m.alive || !m.spec.radar || m.track !== p) continue;
      if (m.pos.distanceTo(p.pos) > 6000) continue;
      const ch = (SAM_SKILLS[this.skillKey] ?? SAM_SKILLS.veteran).chaff;
      if (Math.random() < ch / 2) m.track = null;
    }
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
    for (const u of this.ground) u.update(dt, p, hAt, this.onHitPlayer);
    // 指令誘導のミサイル：撃った SAM のレーダーが自機を見失って 0.4 秒たつと、誘導が切れる
    for (const m of this.missiles) {
      if (!m.spec.radar || !m.track) continue;
      const u = m.owner;
      if (u.alive && u.visible) m.lostT = 0;
      else if ((m.lostT += dt) > 0.4) m.track = null;
    }
    this.gun.update(dt, p, trigger, this.gunTargets, this.fx, hAt, this.onHitEnemy);

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
        if (m.spec === HARM) {
          // 目標がレーダーを切ったら、最後に受信した位置へ（電波の方向だけが頼りなので、数十 m ずれる）
          if (m.track?.ground && !m.track.emitting && !m.memory) {
            const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 50;
            m.memory = { pos: m.track.pos.clone().add(_v.set(Math.cos(a) * r, -2, Math.sin(a) * r)), vel: new THREE.Vector3(), alive: true };
            m.track = m.memory;
          }
          m.update(dt, this.ground, this.flares, this.fx, hAt, this.onDetonate);
          continue;
        }
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

    this.updateObjectives(dt);
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
      this.rwr.push({ e, range, bearing: bearingOf(e.pos), locked: e.locked, sym: '57' });
    }
    // 対空砲：捜索レーダーが見通しで届いていれば RWR に出る。追尾（ロック）されたら LOCK
    for (const u of this.ground) {
      if (!u.alive || !u.visible || p.crashed) continue;
      this.rwr.push({ e: u, range: u.range, bearing: bearingOf(u.pos), locked: u.locked, sym: u.spec.rwr });
    }
  }

  // デブリーフィングの評価（S / A / B / C / D）
  rating() {
    const st = this.stats;
    const acc = st.gunRounds ? Math.min(1, st.gunHits / st.gunRounds) : 0;
    if (this.mode === 'strike') {
      let score = this.kills * 800 + (this.recon?.done ? 2000 : 0) - Math.round(st.damage * 8);
      if (this.mission.state === 'complete') score += 7000 + Math.max(0, Math.round((900 - st.time) * 6));
      score = Math.max(0, score);
      const grade = score >= 11000 ? 'S' : score >= 9000 ? 'A' : score >= 6000 ? 'B' : score >= 3000 ? 'C' : 'D';
      return { score, grade, acc };
    }
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
    if (this.missileSpec === HARM) { this.updateHarm(dt); return; }
    let canSee = false;
    if (t && t.alive && !t.ground) {             // 9X は空対空（地上目標はロックしない）
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

  // ---- HARM：機首の前 ±35° にいる敵レーダーの電波を受信してロック。届くか（ロフトで飛ばしてみる）を判定 ----
  updateHarm(dt) {
    const sk = this.seeker, p = this.player, t = this.target;
    let canSee = false;
    if (t && t.alive && t.ground) {
      _v.subVectors(t.pos, p.pos);
      const range = _v.length();
      _v.divideScalar(range);
      const off = Math.acos(Math.min(1, _v.dot(_f.set(0, 0, -1).applyQuaternion(p.quat))));
      sk.losT = (sk.losT ?? 0) - dt;
      if (sk.losT <= 0 || sk.losTarget !== t) {
        sk.losT = 0.2;
        sk.losTarget = t;
        sk.los = range < 45000 && lineOfSight(t.eye, p.pos, this.world.heightAt);
      }
      canSee = t.emitting && sk.los && off < (sk.state === 'lock' ? 60 : 35) * DEG;
      sk.range = range;
    }
    if (canSee) { sk.acq += dt; sk.state = sk.acq > 0.6 ? 'lock' : 'search'; }
    else { sk.acq = 0; sk.state = 'idle'; }
    sk.checkT -= dt;
    if (sk.state !== 'lock') { sk.inRange = false; sk.tof = null; }
    else if (sk.checkT <= 0) {
      sk.checkT = 0.4;
      sk.tof = flyoutGround(p, t, HARM);
      sk.inRange = sk.tof !== null && sk.range > 1500;
    }
  }

  // 機首に近く、距離の近い敵を選ぶ
  pickTarget() {
    const p = this.player;
    let best = null, bestScore = Infinity;
    for (const e of this.gunTargets) {
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
    const alive = this.gunTargets.filter((e) => e.alive);
    if (!alive.length) return;
    const i = alive.indexOf(this.target);
    this.target = alive[(i + 1) % alive.length];
    this.seeker.acq = 0;
  }

  // 飛行中のプレイヤーミサイルのうち、敵を追っている最も近いものの到達予想時間
  nearestTti() {
    let tti = null;
    for (const m of this.missiles) {
      if (m.owner !== this.player || !m.track || !(m.track.ac || m.track.ground)) continue;
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
    for (const u of this.ground) {
      u.sync(dt);
      u.gun?.render(this.player);
    }
    for (const e of this.enemies) {
      e.sync(dt);
      if (dt > 0 && e.alive) this.fx.vapor(e.jet, e.ac, dt);
      e.gun.render(this.player);
    }
  }
}
