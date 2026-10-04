// 地上の敵：核開発基地（建物）と、ツングースカ風の自走対空砲（2K22 相当）
//   対空砲：捜索レーダーで探知 → 追尾レーダーでロック（acquire 秒）→ 見越し射撃。
//   見通し（地形マスキング）がなければ探知も射撃もできない。尾根の陰に隠れれば追尾が切れる。
import * as THREE from 'three';
import { Gun, K_DRAG } from './gun.js';
import { GRAV } from './flight.js';
import { flyoutTime, SA15 } from './missile.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 腕前（ヘルプの THREAT と共通のキー）
//   acquire: 追尾が固まるまでの秒 / filter: 目標の速度・加速度の推定の遅れ（秒） / err: 追尾誤差（rad）
export const AAA_SKILLS = {
  // dark: HARM を撃たれたと気づいたら、レーダーを切って隠れる確率
  rookie: { acquire: 3.5, filter: 0.8, err: 0.010, burst: [0.8, 1.4], pause: [1.2, 2.0], dark: 0 },
  veteran: { acquire: 2.2, filter: 0.45, err: 0.005, burst: [1.2, 2.0], pause: [0.6, 1.2], dark: 0.3 },
  ace: { acquire: 1.4, filter: 0.3, err: 0.003, burst: [1.6, 2.6], pause: [0.4, 0.8], dark: 0.5 },
};

export const TUNGUSKA = {
  name: 'TUNGUSKA', rwr: '19', label: 'AAA',
  hp: 60, radius: 5.5,
  radarRange: 12000,       // 捜索レーダーを出す距離（電波管制：これより遠いと黙っている＝RWR にも HARM にも見えない）
  gunRange: 4000,          // 2A38M 30mm の有効射程
  ring: 4000,              // 戦術レーダーに描く射程の輪
  slewAz: 100 * DEG, slewEl: 70 * DEG, elMin: -6 * DEG, elMax: 82 * DEG,
};

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

// a → b の見通し（地形が線分をさえぎっていないか）
export function lineOfSight(a, b, heightAt) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const L = Math.hypot(dx, dy, dz);
  const n = Math.min(240, Math.max(8, Math.ceil(L / 60)));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const y = a.y + dy * t;
    if (y < heightAt(a.x + dx * t, a.z + dz * t) + 3) return false;
  }
  return true;
}

// ---- 2K22 ツングースカ風の車体 ----
function buildTunguskaModel() {
  const green = new THREE.MeshStandardMaterial({ color: 0x56613d, roughness: 0.85, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c27, roughness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x3b3e3b, roughness: 0.5, metalness: 0.6 });
  const tube = new THREE.MeshStandardMaterial({ color: 0x4b5536, roughness: 0.8 });
  const mats = [green, dark, steel, tube];
  const box = (w, h, l, m, x, y, z, parent) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const cyl = (r, len, m, parent, seg = 10) => {
    const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), m);
    parent.add(o);
    return o;
  };

  const g = new THREE.Group();
  // 車体
  box(2.4, 1.0, 7.0, green, 0, 1.05, 0.1, g);
  const glacis = box(2.4, 0.12, 1.5, green, 0, 1.18, -3.65, g);
  glacis.rotation.x = -0.45;
  box(3.3, 0.08, 7.6, green, 0, 1.2, 0, g);                       // フェンダー
  // 履帯と転輪
  for (const s of [-1, 1]) {
    box(0.6, 0.8, 7.2, dark, s * 1.4, 0.48, 0, g);
    for (let i = 0; i < 6; i++) {
      const w = cyl(0.34, 0.2, steel, g, 12);
      w.rotation.z = Math.PI / 2;
      w.position.set(s * 1.73, 0.4, -2.75 + i * 1.1);
    }
  }
  // 砲塔
  const turret = new THREE.Group();
  turret.position.set(0, 1.55, 0.7);
  g.add(turret);
  box(2.3, 1.0, 3.2, green, 0, 0.5, 0, turret);
  const front = box(2.3, 0.12, 1.0, green, 0, 0.85, -1.85, turret);
  front.rotation.x = 0.6;
  // 捜索レーダー（後部、回転）
  const search = new THREE.Group();
  search.position.set(0, 1.25, 1.2);
  turret.add(search);
  box(0.25, 0.6, 0.25, dark, 0, -0.1, 0, search);
  const ant = box(2.3, 0.85, 0.12, steel, 0, 0.45, 0, search);
  ant.rotation.x = 0.25;
  // 俯仰する部分：機関砲 2 門（各 2 連装）＋ミサイル 4 発ずつ ＋ 追尾レーダー
  const elev = new THREE.Group();
  elev.position.set(0, 0.6, -0.3);
  turret.add(elev);
  const dish = cyl(0.55, 0.3, steel, elev, 16);
  dish.rotation.x = Math.PI / 2;
  dish.position.set(0, 0.55, -1.5);
  for (const s of [-1, 1]) {
    box(0.45, 0.55, 1.4, green, s * 1.4, 0, -0.4, elev);           // 砲架
    for (const dy of [-0.13, 0.13]) {
      const b = cyl(0.065, 3.2, steel, elev, 8);
      b.rotation.x = Math.PI / 2;
      b.position.set(s * 1.4, dy, -2.6);
    }
    for (const [dx, dy] of [[0, 0], [0.3, 0], [0, 0.3], [0.3, 0.3]]) {
      const t = cyl(0.13, 3.0, tube, elev, 10);
      t.rotation.x = Math.PI / 2;
      t.position.set(s * (1.85 + dx), 0.15 + dy, -0.6);
    }
  }
  return { group: g, turret, elev, search, mats };
}

export class Tunguska {
  constructor(scene, fx, x, z, headingDeg, heightAt, skillKey = 'veteran', combat = null) {
    this.ground = true;
    this.combat = combat;
    this.darkT = 0;
    this.spec = TUNGUSKA;
    this.callsign = TUNGUSKA.name;
    this.fx = fx;
    this.skill = AAA_SKILLS[skillKey];
    this.model = buildTunguskaModel();
    this.group = this.model.group;
    const gy = heightAt(x, z);
    this.base = new THREE.Vector3(x, gy, z);
    this.hdg = headingDeg * DEG;
    this.group.position.copy(this.base);
    this.group.rotation.y = -this.hdg;
    scene.add(this.group);

    this.pos = new THREE.Vector3(x, gy + 2.6, z);    // 砲塔の中心（被弾判定・照準の基準）
    this.vel = new THREE.Vector3();
    this.acc = new THREE.Vector3();
    this.radius = TUNGUSKA.radius;
    this.hp = TUNGUSKA.hp;
    this.alive = true;
    this.eye = new THREE.Vector3(x, gy + 4.2, z);    // レーダーの高さ

    // 機関砲：2A38M ×2（各 2 連装）。曳光弾は赤、外れた弾は自爆して黒い煙
    this.shooter = { pos: new THREE.Vector3(x, gy + 2.15, z), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), crashed: false };
    this.gun = new Gun(scene, {
      color: 0xff6a3a, muzzleV: 960, rate: 80, ammo: 1904, dmg: 6, dispersion: 0.0035, gunUp: 0,
      muzzles: [[-1.4, 0.13, -4.2], [1.4, -0.13, -4.2], [-1.4, -0.13, -4.2], [1.4, 0.13, -4.2]],
      streak: 45, life: 5.5, flash: 2.5, max: 900, glow: 7,
      onExpire: (p) => { if (Math.random() < 0.5) fx.flak(p); },
    });

    this.az = this.hdg;     // 砲塔の向き（方位、北 = 0、時計回り）
    this.el = 5 * DEG;
    this.state = 'search';  // search / track
    this.visible = false;   // プレイヤーが見えている（見通し・レーダー範囲内）
    this.losT = 0;
    this.trackT = 0;
    this.lostT = 0;
    this.burstT = 0;
    this.burstCool = 1;
    this.trigger = false;
    this.pVel = new THREE.Vector3();
    this.pAcc = new THREE.Vector3();
    this.errAz = 0; this.errEl = 0;
    this.smokeT = 0;
    this.range = Infinity;
  }

  get locked() { return this.alive && this.state === 'track'; }
  get firing() { return this.alive && this.trigger; }

  hit(dmg) {
    if (!this.alive) return false;
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.trigger = false;
      // 焼け焦げた色に
      for (const m of this.model.mats) m.color.multiplyScalar(0.22);
      return true;
    }
    return false;
  }

  update(dt, player, heightAt, onHitPlayer) {
    const fx = this.fx;
    this.gun.update(dt, this.shooter, this.trigger && this.alive && !player.crashed, [player], fx, heightAt, onHitPlayer);
    if (!this.alive) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) { this.smokeT = 0.1; fx.burn(this.pos, 1); }
      return;
    }
    if (this.hp < 35) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) { this.smokeT = 0.12; fx.damageSmoke(this.pos, this.vel, true); }
    }
    const s = this.skill, T = TUNGUSKA;
    this.updateRadar(dt, this.combat);

    // ---- 探知：レーダー範囲内で見通しがあるか（0.1 秒ごと） ----
    this.range = player.pos.distanceTo(this.eye);
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.1;
      this.visible = !player.crashed && this.emitting && lineOfSight(this.eye, player.pos, heightAt);
    }
    if (this.visible) {
      this.trackT += dt;
      this.lostT = 0;
      const k = 1 - Math.exp(-dt / s.filter);
      this.pVel.lerp(player.vel, k);
      this.pAcc.lerp(player.accEst, k);
    } else {
      this.lostT += dt;
      if (this.lostT > 1.5) this.trackT = 0;              // 尾根の陰に 1.5 秒隠れたら追尾が切れる
    }
    this.state = this.trackT > s.acquire ? 'track' : 'search';

    // ---- 照準：弾が届く時刻の未来位置 + 重力の落ち分を狙う ----
    let azDes, elDes;
    if (this.state === 'track') {
      const M = this.shooter.pos, v0 = this.gun.muzzleV;
      let t = Math.min(8, this.range / v0);
      for (let i = 0; i < 4; i++) {
        _v.copy(player.pos).addScaledVector(this.pVel, t).addScaledVector(this.pAcc, 0.5 * t * t);
        const r = _v.distanceTo(M);
        t = Math.min(8, (Math.exp(K_DRAG * r) - 1) / (K_DRAG * v0));
      }
      _v.y += 0.5 * GRAV * t * t;
      _d.subVectors(_v, M);
      // 追尾誤差：ゆっくりさまよう（オルンシュタイン＝ウーレンベック過程）
      const sig = s.err * Math.sqrt(2 / 0.8) * Math.sqrt(dt);
      this.errAz += -this.errAz / 0.8 * dt + sig * gauss();
      this.errEl += -this.errEl / 0.8 * dt + sig * gauss();
      azDes = Math.atan2(_d.x, -_d.z) + this.errAz;
      elDes = Math.atan2(_d.y, Math.hypot(_d.x, _d.z)) + this.errEl;
    } else if (this.visible || this.lostT < 1.5) {
      // 探知中：目標のほうへ砲塔を回しておく
      _d.subVectors(player.pos, this.shooter.pos);
      azDes = Math.atan2(_d.x, -_d.z);
      elDes = Math.atan2(_d.y, Math.hypot(_d.x, _d.z));
    } else {
      azDes = this.az + 0.4;                                // ゆっくり見回す
      elDes = 8 * DEG;
    }
    elDes = clamp(elDes, T.elMin, T.elMax);
    let dAz = azDes - this.az;
    dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
    this.az += clamp(dAz, -T.slewAz * dt, T.slewAz * dt);
    this.el += clamp(elDes - this.el, -T.slewEl * dt, T.slewEl * dt);
    _e.set(this.el, -this.az, 0);
    this.shooter.quat.setFromEuler(_e);

    // ---- 射撃（バースト）：照準が合っていて有効射程内 ----
    const aimed = Math.abs(dAz) < 2 * DEG && Math.abs(elDes - this.el) < 2 * DEG;
    const canFire = this.state === 'track' && this.visible && this.range < T.gunRange && aimed;
    this.burstCool -= dt;
    if (this.burstT > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0 || !canFire) {
        this.burstT = 0;
        this.burstCool = rand(s.pause);
      }
    } else if (canFire && this.burstCool <= 0) {
      this.burstT = rand(s.burst);
    }
    this.trigger = this.burstT > 0 && canFire;
  }

  sync(dt) {
    const m = this.model;
    m.turret.rotation.y = -(this.az - this.hdg);
    m.elev.rotation.x = this.el;
    if (this.alive) m.search.rotation.y += dt * Math.PI * 2;   // 毎秒 1 回転
  }

  dispose(scene) {
    scene.remove(this.group);
    scene.remove(this.gun.lines);
    if (this.gun.heads) scene.remove(this.gun.heads);
  }
}

// ---- SA-15 風の地対空ミサイル車両（9K331 Tor 相当） ----
//   捜索レーダーで探知 → 追尾（acquire 秒）→ 届くなら垂直に打ち上げ → 追尾レーダーが見えている間だけ指令で誘導。
//   尾根の陰に入って見通しが切れると、飛んでいるミサイルも誘導を失う（Combat が判定）
export const SAM_SKILLS = {
  rookie: { acquire: 4.5, maxTof: 9, cool: 14, chaff: 0.35, dark: 0.2 },
  veteran: { acquire: 3.0, maxTof: 12, cool: 9, chaff: 0.22, dark: 0.55 },
  ace: { acquire: 2.0, maxTof: 14, cool: 6, chaff: 0.12, dark: 0.8 },
};
export const TOR = {
  name: 'SA-15', rwr: '15', label: 'SAM',
  hp: 60, radius: 5.5,
  radarRange: 15000,       // レーダーを出す距離（電波管制）
  ring: 12000,
  missiles: 8,
};

function buildSamModel() {
  const sand = new THREE.MeshStandardMaterial({ color: 0x6b6a46, roughness: 0.85, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c27, roughness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x3b3e3b, roughness: 0.5, metalness: 0.6 });
  const mats = [sand, dark, steel];
  const box = (w, h, l, m, x, y, z, parent) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const g = new THREE.Group();
  box(3.0, 1.0, 7.2, sand, 0, 1.05, 0, g);
  for (const s of [-1, 1]) {
    box(0.6, 0.8, 7.0, dark, s * 1.5, 0.45, 0, g);
    for (let i = 0; i < 6; i++) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.2, 12), steel);
      w.rotation.z = Math.PI / 2;
      w.position.set(s * 1.83, 0.4, -2.7 + i * 1.08);
      g.add(w);
    }
  }
  // 箱形の砲塔：中に垂直発射のミサイル 8 発、前面に平らな追尾レーダー、上に回る捜索レーダー
  const turret = new THREE.Group();
  turret.position.set(0, 1.55, 0.6);
  g.add(turret);
  box(2.8, 2.2, 3.6, sand, 0, 1.1, 0, turret);
  const panel = box(1.8, 1.6, 0.25, steel, 0, 1.3, -1.9, turret);
  panel.rotation.x = -0.25;
  const search = new THREE.Group();
  search.position.set(0, 2.5, 0.8);
  turret.add(search);
  box(0.3, 0.5, 0.3, dark, 0, -0.1, 0, search);
  const ant = box(3.0, 0.7, 0.18, steel, 0, 0.35, 0, search);
  ant.rotation.x = 0.3;
  // 屋根のハッチ（垂直発射口）
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) box(0.5, 0.06, 0.5, dark, s * 0.6, 2.22, -0.9 + i * 0.6, turret);
  return { group: g, turret, search, mats };
}

export class SamSite {
  constructor(scene, fx, x, z, headingDeg, heightAt, skillKey, combat) {
    this.ground = true;
    this.spec = TOR;
    this.callsign = TOR.name;
    this.fx = fx;
    this.combat = combat;
    this.skill = SAM_SKILLS[skillKey];
    this.model = buildSamModel();
    this.group = this.model.group;
    const gy = heightAt(x, z);
    this.base = new THREE.Vector3(x, gy, z);
    this.hdg = headingDeg * DEG;
    this.group.position.copy(this.base);
    this.group.rotation.y = -this.hdg;
    scene.add(this.group);
    this.pos = new THREE.Vector3(x, gy + 2.8, z);
    this.vel = new THREE.Vector3();
    this.acc = new THREE.Vector3();
    this.radius = TOR.radius;
    this.hp = TOR.hp;
    this.alive = true;
    this.eye = new THREE.Vector3(x, gy + 5.5, z);
    this.missiles = TOR.missiles;
    this.darkT = 0;
    this.state = 'search';
    this.visible = false;
    this.losT = 0;
    this.trackT = 0;
    this.lostT = 0;
    this.cool = 4;
    this.checkT = 0;
    this.az = this.hdg;
    this.smokeT = 0;
    this.range = Infinity;
    // flyoutTime 用の「発射機」：真上に向けて打ち上げる
    this.launcher = { pos: this.eye.clone(), vel: new THREE.Vector3(0, 30, 0), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2) };
  }

  get locked() { return this.alive && this.state === 'track'; }
  get firing() { return false; }

  hit(dmg) {
    if (!this.alive) return false;
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      for (const m of this.model.mats) m.color.multiplyScalar(0.22);
      return true;
    }
    return false;
  }

  update(dt, player, heightAt) {
    const fx = this.fx;
    if (!this.alive) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) { this.smokeT = 0.1; fx.burn(this.pos, 1); }
      return;
    }
    if (this.hp < 35) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) { this.smokeT = 0.12; fx.damageSmoke(this.pos, this.vel, true); }
    }
    const s = this.skill;
    this.range = player.pos.distanceTo(this.eye);
    this.updateRadar(dt, this.combat);
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.1;
      this.visible = !player.crashed && this.emitting && lineOfSight(this.eye, player.pos, heightAt);
    }
    if (this.visible) { this.trackT += dt; this.lostT = 0; }
    else { this.lostT += dt; if (this.lostT > 1.5) this.trackT = 0; }
    this.state = this.trackT > s.acquire ? 'track' : 'search';
    // 砲塔は目標のほうへ（見えていなければゆっくり見回す）
    const want = this.state === 'track' || this.visible
      ? Math.atan2(player.pos.x - this.pos.x, -(player.pos.z - this.pos.z)) : this.az + 0.3;
    let d = want - this.az;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.az += Math.max(-1.2 * dt, Math.min(1.2 * dt, d));

    // 発射：追尾していて、届くと分かり、前の弾から十分たっていて、誘導中の弾が 2 発未満
    this.cool -= dt;
    this.checkT -= dt;
    if (this.state === 'track' && this.visible && this.missiles > 0 && this.cool <= 0 && this.checkT <= 0) {
      this.checkT = 0.5;
      const guiding = this.combat.missiles.filter((m) => m.alive && m.owner === this).length;
      this.aimLauncher(player);
      const tof = guiding < 2 ? flyoutTime(this.launcher, player, SA15) : null;
      if (tof !== null && tof < s.maxTof) {
        this.combat.fireSam(this);
        this.missiles--;
        this.cool = s.cool;
      }
    }
  }

  // 垂直に打ち上げた直後、ガス噴射で目標の方へ傾ける（Tor の方式）＝最初から目標寄りの上向きで飛び出す
  aimLauncher(player) {
    const L = this.launcher;
    _d.subVectors(player.pos, this.eye).normalize();
    _d.y = Math.max(_d.y, 0) + 0.5;
    _d.normalize();
    L.vel.copy(_d).multiplyScalar(30);
    L.quat.setFromUnitVectors(_w.set(0, 0, -1), _d);
    return L;
  }

  sync(dt) {
    const m = this.model;
    m.turret.rotation.y = -(this.az - this.hdg);
    if (this.alive) m.search.rotation.y += dt * Math.PI * 1.2;
  }

  dispose(scene) { scene.remove(this.group); }
}

// ---- レーダーの電波：出している間だけ探知でき、RWR に映り、HARM にロックされる ----
//   HARM を撃たれたと気づくと（1〜2.5 秒後）、腕前に応じた確率でレーダーを切って 14〜20 秒隠れる（その間は撃てない）
function radarMixin(C) {
  Object.defineProperty(C.prototype, 'emitting', {
    get() { return this.alive && this.darkT <= 0 && this.range < this.spec.radarRange; },
  });
  C.prototype.harmWarning = function () {
    if (this.alertT === undefined || this.alertT <= 0) this.alertT = 1 + Math.random() * 1.5;
  };
  C.prototype.updateRadar = function (dt, combat) {
    this.darkT = Math.max(0, (this.darkT ?? 0) - dt);
    if (this.alertT > 0 && (this.alertT -= dt) <= 0) {
      if (Math.random() < this.skill.dark) {
        this.darkT = 14 + Math.random() * 6;
        combat?.message(`${this.callsign}  SHUT DOWN`, 3);
      }
    }
  };
}

function gauss() {
  return Math.sqrt(-2 * Math.log(Math.random() + 1e-12)) * Math.cos(2 * Math.PI * Math.random());
}
function rand([a, b]) { return a + (b - a) * Math.random(); }
radarMixin(Tunguska);
radarMixin(SamSite);

// ---- 核開発基地の建物（いまは景色。次の段階で破壊目標にする） ----
export function buildBase(scene, base, heightAt) {
  const g = new THREE.Group();
  const conc = new THREE.MeshStandardMaterial({ color: 0xc4c0b6, roughness: 0.9 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x55585a, roughness: 0.8, metalness: 0.2 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x8a6a4c, roughness: 0.85 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb03a2e, roughness: 0.8 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.8 });
  const at = (dx, dz) => new THREE.Vector3(base.x + dx, heightAt(base.x + dx, base.z + dz), base.z + dz);

  // 濃縮施設：長い建屋 2 棟（屋根は濃い色）
  for (const dz of [-150, -70]) {
    const p = at(-200, dz);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(230, 16, 52), conc);
    hall.position.copy(p).add(_w.set(0, 7, 0));
    g.add(hall);
    const r = new THREE.Mesh(new THREE.BoxGeometry(232, 1.2, 54), roof);
    r.position.copy(p).add(_w.set(0, 15.5, 0));
    g.add(r);
  }
  // 原子炉のドーム
  {
    const p = at(140, -120);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 26, 32), conc);
    c.position.copy(p).add(_w.set(0, 12, 0));
    g.add(c);
    const d = new THREE.Mesh(new THREE.SphereGeometry(30, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), white);
    d.position.copy(p).add(_w.set(0, 25, 0));
    g.add(d);
  }
  // 冷却塔（双曲面）
  {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const r = 30 + 22 * Math.pow(Math.abs(t - 0.72) / 0.72, 1.6) * (t < 0.72 ? 1 : 0.35);
      pts.push(new THREE.Vector2(r, t * 120));
    }
    const tower = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), new THREE.MeshStandardMaterial({ color: 0xbab6ac, roughness: 0.95, side: THREE.DoubleSide }));
    tower.position.copy(at(330, 110)).add(_w.set(0, -2, 0));
    g.add(tower);
  }
  // 排気塔（紅白）
  {
    const p = at(40, 70);
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, 10, 12), i % 2 ? white : red);
      s.position.copy(p).add(_w.set(0, 5 + i * 10, 0));
      g.add(s);
    }
  }
  // タンク
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 15, 20), rust);
    t.position.copy(at(-330 + i * 30, 200)).add(_w.set(0, 7.5, 0));
    g.add(t);
  }
  // 管理棟
  for (const [dx, dz, w, l] of [[-40, 180, 60, 30], [60, 210, 40, 40], [200, -230, 70, 26]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 9, l), conc);
    b.position.copy(at(dx, dz)).add(_w.set(0, 4, 0));
    g.add(b);
  }
  scene.add(g);
  return g;
}
