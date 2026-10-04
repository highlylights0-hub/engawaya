// キルカメラ：撃墜した敵機の残骸を、右上の小窓（ピクチャー・イン・ピクチャー）で数秒間映す
// プレイヤーは操縦を続けられる（全画面にはしない）
import * as THREE from 'three';

const _p = new THREE.Vector3();

export class KillCam {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.5, 200000);
    this.el = document.getElementById('killcam');
    this.label = this.el.querySelector('.kc-label');
    this.target = null;
    this.t = 0;
    this.dur = 4.2;
  }

  // wreck: 落下中の残骸（Wreck） / text: 表示するラベル
  start(wreck, text) {
    this.target = wreck;
    this.t = 0;
    // 残骸の進行方向の斜め後ろ・横から回り込む
    const v = wreck.vel;
    this.a0 = Math.atan2(v.z, v.x) + Math.PI * (0.6 + Math.random() * 0.3) * (Math.random() < 0.5 ? 1 : -1);
    this.label.textContent = text;
    this.el.classList.add('show');
  }

  stop() {
    this.target = null;
    this.el.classList.remove('show');
  }

  get active() { return !!this.target; }

  update(dt) {
    if (!this.target) return;
    this.t += dt;
    if (this.t > this.dur) { this.stop(); return; }
    const w = this.target;
    const a = this.a0 + this.t * 0.45;
    const r = 45 + this.t * 14;
    _p.set(Math.cos(a) * r, 12 + this.t * 6, Math.sin(a) * r);
    this.camera.position.copy(w.pos).add(_p);
    this.camera.lookAt(w.pos);
  }

  // メインの描画のあとに、小窓の領域だけ描き足す
  render(renderer, scene) {
    if (!this.target) return;
    const r = this.el.getBoundingClientRect();
    if (r.width < 2) return;
    const y = innerHeight - r.bottom;
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    renderer.setScissorTest(true);
    renderer.setScissor(r.left, y, r.width, r.height);
    renderer.setViewport(r.left, y, r.width, r.height);
    renderer.render(scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, innerWidth, innerHeight);
  }
}
