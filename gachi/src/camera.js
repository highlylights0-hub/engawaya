// 追尾カメラ / コクピットカメラ
import * as THREE from 'three';

const _off = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.mode = 'chase';
    this.smoothQ = new THREE.Quaternion();
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.distance = 22;
    this.dragging = false;
    this.first = true;

    dom.addEventListener('mousedown', () => { this.dragging = true; });
    addEventListener('mouseup', () => { this.dragging = false; });
    addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      this.lookYaw -= e.movementX * 0.005;
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - e.movementY * 0.005, -1.4, 1.4);
    });
    dom.addEventListener('wheel', (e) => {
      this.distance = THREE.MathUtils.clamp(this.distance * (1 + e.deltaY * 0.001), 10, 120);
    }, { passive: true });
  }

  toggle() {
    this.mode = this.mode === 'chase' ? 'cockpit' : 'chase';
    this.lookYaw = this.lookPitch = 0;
    this.camera.fov = this.mode === 'chase' ? 60 : 72;
    this.camera.updateProjectionMatrix();
  }

  update(dt, ac, look) {
    if (this.first) { this.smoothQ.copy(ac.quat); this.first = false; }
    // 右スティック：倒した方向を見る（離すと正面に戻る）
    const padLook = look && (look.lookX || look.lookY);
    if (padLook) {
      const k = 1 - Math.exp(-dt * 8);
      this.lookYaw += (-look.lookX * 2.6 - this.lookYaw) * k;
      this.lookPitch += (-look.lookY * 1.2 - this.lookPitch) * k;
    }
    // ドラッグを離すと視点が正面に戻る
    if (!this.dragging && !padLook) {
      const k = Math.exp(-dt * 2.5);
      this.lookYaw *= k;
      this.lookPitch *= k;
    }
    _e.set(this.lookPitch, this.lookYaw, 0);
    _q.setFromEuler(_e);

    const cam = this.camera;
    if (this.mode === 'chase') {
      this.smoothQ.slerp(ac.quat, 1 - Math.exp(-dt * 5));
      cam.quaternion.copy(this.smoothQ).multiply(_q);
      _off.set(0, this.distance * 0.16, this.distance).applyQuaternion(cam.quaternion);
      cam.position.copy(ac.pos).add(_off);
      cam.rotateX(-0.06);
    } else {
      this.smoothQ.copy(ac.quat);
      cam.quaternion.copy(ac.quat).multiply(_q);
      _off.set(0, 0.95, -4.4).applyQuaternion(ac.quat);
      cam.position.copy(ac.pos).add(_off);
    }
  }
}
