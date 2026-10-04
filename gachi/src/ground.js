// 地上の敵：核開発基地（建物）と、ツングースカ風の自走対空砲（2K22 相当）
//   対空砲：捜索レーダーで探知 → 追尾レーダーでロック（acquire 秒）→ 見越し射撃。
//   見通し（地形マスキング）がなければ探知も射撃もできない。尾根の陰に隠れれば追尾が切れる。
import * as THREE from 'three';
import { Gun, K_DRAG } from './gun.js';
import { GRAV } from './flight.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 腕前（ヘルプの THREAT と共通のキー）
//   acquire: 追尾が固まるまでの秒 / filter: 目標の速度・加速度の推定の遅れ（秒） / err: 追尾誤差（rad）
export const AAA_SKILLS = {
  rookie: { acquire: 3.5, filter: 0.8, err: 0.010, burst: [0.8, 1.4], pause: [1.2, 2.0] },
  veteran: { acquire: 2.2, filter: 0.45, err: 0.005, burst: [1.2, 2.0], pause: [0.6, 1.2] },
  ace: { acquire: 1.4, filter: 0.3, err: 0.003, burst: [1.6, 2.6], pause: [0.4, 0.8] },
};

export const TUNGUSKA = {
  name: 'TUNGUSKA', rwr: '19',
  hp: 60, radius: 5.5,
  radarRange: 16000,       // 捜索レーダー（RWR に出る）
  gunRange: 4000,          // 2A38M 30mm の有効射程
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
  constructor(scene, fx, x, z, headingDeg, heightAt, skillKey = 'veteran') {
    this.ground = true;
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

    // ---- 探知：レーダー範囲内で見通しがあるか（0.1 秒ごと） ----
    this.range = player.pos.distanceTo(this.eye);
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.1;
      this.visible = !player.crashed && this.range < T.radarRange && lineOfSight(this.eye, player.pos, heightAt);
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

function gauss() {
  return Math.sqrt(-2 * Math.log(Math.random() + 1e-12)) * Math.cos(2 * Math.PI * Math.random());
}
function rand([a, b]) { return a + (b - a) * Math.random(); }

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
