// 撃墜演出：爆発のあと、燃えながらきりもみで落ちる機体と破片（自機・敵機共通）
// 自機のときは updateCamera でカメラがその場から見送る
import * as THREE from 'three';
import { GRAV } from './flight.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const _v = new THREE.Vector3(), _dq = new THREE.Quaternion(), _ax = new THREE.Vector3();
const _look = new THREE.Vector3(), _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export class Wreck {
  constructor(scene, fx, sound) {
    this.scene = scene;
    this.fx = fx;
    this.sound = sound;
    this.active = false;
    this.debris = [];
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.spin = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
    this.camVel = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.debrisMat = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.9, metalness: 0.2, side: THREE.DoubleSide });
  }

  // ac: 撃墜された機体 / jet: その見た目
  // ground: 地面に激突した場合（落下なしで爆発）
  start(ac, jet, ground = false, heightAt = null) {
    this.active = true;
    this.t = 0;
    this.jet = jet;
    this.pos.copy(ac.pos);
    this.vel.copy(ac.vel);
    this.vel.y -= 25;                 // 爆発で機首が落ちる
    this.quat.copy(ac.quat);
    // きりもみ（機体座標：ピッチ・ヨー・ロール）
    this.spin.set(rnd(-1.0, 1.0), rnd(-0.8, 0.8), rnd(2.0, 3.6) * (Math.random() < 0.5 ? -1 : 1));
    this.landed = false;
    this.burnT = 0;
    this.popT = rnd(0.4, 0.9);
    jet.setScorched(true);

    // 斜め後ろ・横・上から（煙の帯の中に入らないように）
    const side = Math.random() < 0.5 ? -1 : 1;
    _v.set(side * 70, 30, 45).applyQuaternion(ac.quat);
    _v.y = Math.abs(_v.y) + 20;
    this.camPos.copy(ac.pos).add(_v);
    this.camVel.copy(ac.vel).multiplyScalar(0.7);
    this.camLook.copy(ac.pos);

    // 破片：主翼の一部・尾翼・外板（暗い板）が飛び散って、それぞれ煙を引く
    for (let i = 0; i < 7; i++) {
      const w = rnd(0.6, 2.4), h = rnd(0.4, 1.4);
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.lineTo(w, rnd(-0.2, 0.3)); shape.lineTo(w * rnd(0.6, 1), h); shape.lineTo(rnd(-0.3, 0.3), h * rnd(0.5, 1));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
      geo.center();
      const mesh = new THREE.Mesh(geo, this.debrisMat);
      mesh.position.copy(ac.pos);
      this.scene.add(mesh);
      this.debris.push({
        mesh,
        vel: ac.vel.clone().multiplyScalar(rnd(0.5, 0.9)).add(_v.set(rnd(-1, 1), rnd(-0.5, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(25, 70))),
        spin: new THREE.Vector3(rnd(-6, 6), rnd(-6, 6), rnd(-6, 6)),
        k: rnd(0.004, 0.012),       // 板は抵抗が大きい
        burning: Math.random() < 0.6,
        smokeT: 0,
        alive: true,
      });
    }
    if (ground) this.impact(heightAt);
  }

  reset() {
    for (const d of this.debris) { this.scene.remove(d.mesh); d.mesh.geometry.dispose(); }
    this.debris = [];
    if (this.jet) this.jet.setScorched(false);
    this.active = false;
  }

  impact(heightAt) {
    this.landed = true;
    this.landT = this.t;
    this.vel.set(0, 0, 0);
    const sea = !heightAt || heightAt(this.pos.x, this.pos.z) <= 0;
    this.sea = sea;
    // 粒子が地面・海面で切れないよう、少し上で爆発させる
    const p = _v.copy(this.pos).add(new THREE.Vector3(0, 14, 0));
    this.fx.explosion(p, new THREE.Vector3(0, 10, 0));
    if (sea) {
      // 水柱
      for (let i = 0; i < 40; i++) {
        this.fx.smoke.spawn({
          pos: this.pos, vel: new THREE.Vector3(rnd(-12, 12), rnd(30, 90), rnd(-12, 12)), life: rnd(2, 3.5),
          size0: rnd(4, 8), size1: rnd(20, 36), c0: [0.95, 0.97, 1, 0.85], c1: [0.9, 0.93, 0.96, 0], drag: 0.6, rise: -9,
        });
      }
    } else {
      this.fx.explosion(p.add(new THREE.Vector3(rnd(-8, 8), 4, rnd(-8, 8))), new THREE.Vector3(0, 15, 0));
    }
    this.sound?.explosion(this.pos, true);
  }

  update(dt, heightAt) {
    if (!this.active) return;
    this.t += dt;
    const fx = this.fx;

    if (!this.landed) {
      // 空気抵抗（きりもみで大きい）+ 重力
      const V = this.vel.length();
      const k = 0.00022 + 0.00013 * Math.min(1, this.t / 3);   // 終端速度 ~170m/s
      this.vel.addScaledVector(this.vel, -k * V * dt);
      this.vel.y -= GRAV * dt;
      this.pos.addScaledVector(this.vel, dt);
      const ang = this.spin.length() * dt;
      _dq.setFromAxisAngle(_ax.copy(this.spin).normalize(), ang);
      this.quat.multiply(_dq).normalize();

      // 炎と黒煙
      this.burnT -= dt;
      if (this.burnT <= 0) {
        this.burnT = 1 / 60;
        for (let i = 0; i < 2; i++) {
          _v.set(rnd(-2, 2), rnd(-1, 1), rnd(-1, 5)).applyQuaternion(this.quat).add(this.pos);
          fx.fire.spawn({ pos: _v, vel: this.vel, life: rnd(0.2, 0.4), size0: rnd(5, 9), size1: rnd(2, 4), c0: [1, 0.7, 0.3, 1], c1: [1, 0.25, 0.05, 0], drag: 3 });
        }
        fx.smoke.spawn({
          pos: this.pos, vel: _v.copy(this.vel).multiplyScalar(0.05), life: rnd(6, 9), size0: 6, size1: rnd(28, 40),
          c0: [0.08, 0.07, 0.07, 0.85], c1: [0.3, 0.3, 0.3, 0], drag: 0.8, rise: 1.2,
        });
      }
      // ときどき小さな誘爆
      this.popT -= dt;
      if (this.popT <= 0 && this.t < 5) {
        this.popT = rnd(0.5, 1.4);
        fx.fire.spawn({ pos: this.pos, vel: this.vel, life: 0.3, size0: 14, size1: 28, c0: [1, 0.85, 0.5, 1], c1: [1, 0.4, 0.1, 0] });
      }

      const gh = Math.max(0, heightAt(this.pos.x, this.pos.z));
      if (this.pos.y < gh + 2) {
        this.pos.y = gh + 2;
        this.impact(heightAt);
      }
    } else if (this.t < 40 && !(this.sea && this.t - this.landT > 6)) {
      // 地上で燃え続ける煙の柱
      this.burnT -= dt;
      if (this.burnT <= 0) {
        this.burnT = 0.05;
        fx.smoke.spawn({ pos: this.pos, vel: _v.set(rnd(-2, 2), 6, rnd(-2, 2)), life: rnd(8, 12), size0: 10, size1: 60, c0: [0.1, 0.09, 0.09, 0.8], c1: [0.35, 0.35, 0.35, 0], drag: 0.2, rise: 3 });
        if (!this.sea) fx.fire.spawn({ pos: _v.copy(this.pos).add(new THREE.Vector3(rnd(-5, 5), 2, rnd(-5, 5))), life: 0.5, size0: 10, size1: 4, c0: [1, 0.6, 0.2, 0.9], c1: [1, 0.3, 0.05, 0], rise: 4 });
      }
    }

    for (const d of this.debris) {
      if (!d.alive) continue;
      const V = d.vel.length();
      d.vel.addScaledVector(d.vel, -d.k * V * dt);
      d.vel.y -= GRAV * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      d.smokeT -= dt;
      if (d.smokeT <= 0) {
        d.smokeT = 0.04;
        fx.smoke.spawn({ pos: d.mesh.position, life: rnd(2.5, 4), size0: 1.5, size1: rnd(8, 14), c0: [0.15, 0.14, 0.13, 0.7], c1: [0.4, 0.4, 0.4, 0], drag: 1 });
        if (d.burning) fx.fire.spawn({ pos: d.mesh.position, life: 0.15, size0: 3, size1: 1, c0: [1, 0.7, 0.3, 1], c1: [1, 0.3, 0.05, 0] });
      }
      const gh = Math.max(0, heightAt(d.mesh.position.x, d.mesh.position.z));
      if (d.mesh.position.y < gh + 0.5) {
        d.alive = false;
        fx.dust(d.mesh.position);
        d.mesh.visible = false;
      }
    }
  }

  // 見送りカメラ：撃墜された地点からゆっくり流れながら、落ちていく機体を追う
  updateCamera(camera, dt, heightAt) {
    this.camVel.multiplyScalar(Math.exp(-0.9 * dt));
    this.camPos.addScaledVector(this.camVel, dt);
    // 遠ざかりすぎたら少し寄る、近すぎたら離れる
    _v.subVectors(this.pos, this.camPos);
    const d = _v.length();
    const far = this.landed ? 500 : 260;
    // 高さは遅れて追う（斜め上から見下ろす角度を保つ）
    const wantY = this.pos.y + (this.landed ? 150 : 90);
    if (this.camPos.y > wantY) this.camPos.y += (wantY - this.camPos.y) * (1 - Math.exp(-dt * 0.6));
    if (d > far) this.camPos.addScaledVector(_v, (1 - far / d) * Math.min(1, dt * 0.8));
    else if (d < 35) this.camPos.addScaledVector(_v, -(1 - d / 35));
    const gh = Math.max(0, heightAt(this.camPos.x, this.camPos.z)) + 25;
    if (this.camPos.y < gh) this.camPos.y = gh;
    // 注視点は滑らかに追う（揺れを抑える）
    this.camLook.lerp(this.pos, 1 - Math.exp(-dt * 6));
    camera.position.copy(this.camPos);
    _m.lookAt(this.camPos, this.camLook, UP);
    camera.quaternion.setFromRotationMatrix(_m);
    // 少しズーム（遠いほど望遠）
    const fov = THREE.MathUtils.clamp(60 - d * 0.08, 32, 60);
    if (Math.abs(camera.fov - fov) > 0.2) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
}
