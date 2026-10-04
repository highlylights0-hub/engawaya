// パーティクル（火花・爆発・煙）
import * as THREE from 'three';

function makeSoftTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

const TEX = { soft: null };

class Particles {
  constructor(scene, fog, capacity, additive) {
    if (!TEX.soft) TEX.soft = makeSoftTexture();
    this.cap = capacity;
    this.list = [];
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    this.aOffset = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('offset', this.aOffset);
    geo.setAttribute('size', this.aSize);
    geo.setAttribute('pcolor', this.aColor);
    geo.instanceCount = 0;
    this.geo = geo;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: TEX.soft },
        fogColor: { value: fog.color },
        fogDensity: { value: fog.density },
      },
      defines: additive ? { ADDITIVE: 1 } : {},
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 offset;
        attribute float size;
        attribute vec4 pcolor;
        varying vec2 vUv;
        varying vec4 vColor;
        varying float vDist;
        void main() {
          vec4 mv = viewMatrix * vec4(offset, 1.0);
          mv.xy += position.xy * size;
          vUv = uv;
          vColor = pcolor;
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform sampler2D map;
        uniform vec3 fogColor;
        uniform float fogDensity;
        varying vec2 vUv;
        varying vec4 vColor;
        varying float vDist;
        void main() {
          #include <logdepthbuf_fragment>
          float a = texture2D(map, vUv).a * vColor.a;
          if (a < 0.004) discard;
          float f = 1.0 - exp(-vDist * vDist * fogDensity * fogDensity);
          vec3 col = vColor.rgb;
          #ifdef ADDITIVE
            gl_FragColor = vec4(col * a * (1.0 - f), 1.0);
          #else
            gl_FragColor = vec4(mix(col, fogColor, f), a);
          #endif
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 12 : 11;
    scene.add(this.mesh);
  }

  // p: { pos, vel, life, size0, size1, c0:[r,g,b,a], c1:[r,g,b,a], drag }
  spawn(p) {
    if (this.list.length >= this.cap) this.list.shift();
    this.list.push({
      pos: p.pos.clone(), vel: p.vel ? p.vel.clone() : new THREE.Vector3(),
      age: 0, life: p.life, size0: p.size0, size1: p.size1 ?? p.size0,
      c0: p.c0, c1: p.c1 ?? p.c0, drag: p.drag ?? 0, rise: p.rise ?? 0,
    });
  }

  update(dt) {
    const L = this.list;
    let w = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      if (p.drag) p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.vel.y += p.rise * dt;
      p.pos.addScaledVector(p.vel, dt);
      L[w++] = p;
    }
    L.length = w;
    const o = this.aOffset.array, s = this.aSize.array, c = this.aColor.array;
    for (let i = 0; i < w; i++) {
      const p = L[i];
      const k = p.age / p.life;
      o[i * 3] = p.pos.x; o[i * 3 + 1] = p.pos.y; o[i * 3 + 2] = p.pos.z;
      s[i] = p.size0 + (p.size1 - p.size0) * Math.sqrt(k);
      for (let j = 0; j < 4; j++) c[i * 4 + j] = p.c0[j] + (p.c1[j] - p.c0[j]) * k;
    }
    this.geo.instanceCount = w;
    this.aOffset.needsUpdate = this.aSize.needsUpdate = this.aColor.needsUpdate = true;
  }
}

const _v = new THREE.Vector3();
const _v0 = new THREE.Vector3();
const _p = new THREE.Vector3();
const rnd = (a) => (Math.random() * 2 - 1) * a;
const rndVec = (a) => _v.set(rnd(a), rnd(a), rnd(a));

export class Effects {
  constructor(scene, fog) {
    this.fire = new Particles(scene, fog, 3000, true);
    this.smoke = new Particles(scene, fog, 12000, false);
  }

  update(dt) {
    this.fire.update(dt);
    this.smoke.update(dt);
  }

  muzzle(pos, vel) {
    this.fire.spawn({ pos, vel, life: 0.05, size0: 1.6, size1: 0.6, c0: [1, 0.85, 0.5, 1], c1: [1, 0.5, 0.2, 0] });
  }

  sparks(pos, vel) {
    this.fire.spawn({ pos, vel, life: 0.08, size0: 7, size1: 3, c0: [1, 0.95, 0.7, 1], c1: [1, 0.6, 0.2, 0] });
    for (let i = 0; i < 5; i++) {
      this.fire.spawn({
        pos, vel: _p.copy(vel).add(rndVec(70)), life: 0.25 + Math.random() * 0.2,
        size0: 1.4, size1: 0.3, c0: [1, 0.85, 0.4, 1], c1: [1, 0.4, 0.1, 0], drag: 2,
      });
    }
    this.smoke.spawn({ pos, vel, life: 1.2, size0: 3, size1: 9, c0: [0.25, 0.24, 0.22, 0.6], c1: [0.4, 0.4, 0.4, 0], drag: 1.5 });
  }

  dust(pos) {
    this.smoke.spawn({ pos, life: 1.5, size0: 3, size1: 14, c0: [0.55, 0.5, 0.42, 0.7], c1: [0.6, 0.58, 0.52, 0], rise: 2 });
  }

  damageSmoke(pos, vel, heavy) {
    this.smoke.spawn({
      pos, vel: _p.copy(vel).multiplyScalar(0.15).add(rndVec(3)), life: heavy ? 4 : 2.5,
      size0: heavy ? 4 : 2.5, size1: heavy ? 22 : 12,
      c0: heavy ? [0.1, 0.1, 0.1, 0.8] : [0.3, 0.3, 0.3, 0.55], c1: [0.45, 0.45, 0.45, 0], drag: 0.6,
    });
    if (heavy) {
      this.fire.spawn({ pos, vel: _p.copy(vel).multiplyScalar(0.6), life: 0.2, size0: 4, size1: 1.5, c0: [1, 0.6, 0.2, 0.9], c1: [1, 0.3, 0.05, 0] });
    }
  }

  // ベイパー：高 G で翼端から白い渦、さらに引くと主翼の上面に雲（湿った空気の断熱膨張）
  //   jet.vapor の点を機体の姿勢で回してワールドに置く
  vapor(jet, ac, dt) {
    if (ac.crashed || !jet.vapor) return;
    const t = ac.t;
    if (!t.speed || t.speed < 120) return;
    const g = t.nz;
    const tipK = Math.min(1, Math.max(0, (g - 3.5) / 3));
    const wingK = Math.min(1, Math.max(0, (g - 5.5) / 2.5)) * Math.min(1, t.speed / 220)
      + Math.max(0, 1 - Math.abs(t.mach - 0.98) / 0.06) * 0.6;          // 遷音速の衝撃波でも
    // 翼端の渦：前フレームの位置から線でつなぐように置く（点々にならないように）
    jet.vaporPrev ??= jet.vapor.tips.map(() => new THREE.Vector3());
    jet.vapor.tips.forEach((p, i) => {
      _p.set(p[0], p[1], p[2]).applyQuaternion(ac.quat).add(ac.pos);
      const prev = jet.vaporPrev[i];
      if (tipK > 0 && jet.vaporOn) {
        const d = prev.distanceTo(_p);
        const n = Math.min(16, Math.max(1, Math.ceil(d / 0.5)));
        for (let k = 1; k <= n; k++) {
          _v0.lerpVectors(prev, _p, k / n);
          this.smoke.spawn({ pos: _v0, life: 0.35 + 0.55 * tipK, size0: 0.7, size1: 1.6 + tipK, c0: [1, 1, 1, 0.3 * tipK], c1: [1, 1, 1, 0], drag: 0 });
        }
      }
      prev.copy(_p);
    });
    jet.vaporOn = tipK > 0;
    if (wingK > 0.02) {
      const n = Math.ceil(10 * wingK * Math.min(2, dt * 60));
      const w = jet.vapor.wing;
      for (let i = 0; i < n; i++) {
        const a = Math.random(), b = Math.random() ** 0.7;   // 後縁寄りに濃く
        const side = i % 2 ? 1 : -1;
        // 四角の中の点（双一次補間）
        const x = (w[0][0] * (1 - a) + w[1][0] * a) * (1 - b) + (w[3][0] * (1 - a) + w[2][0] * a) * b;
        const y = (w[0][1] * (1 - a) + w[1][1] * a) * (1 - b) + (w[3][1] * (1 - a) + w[2][1] * a) * b + 0.25;
        const z = (w[0][2] * (1 - a) + w[1][2] * a) * (1 - b) + (w[3][2] * (1 - a) + w[2][2] * a) * b;
        _p.set(x * side, y, z).applyQuaternion(ac.quat).add(ac.pos);
        this.smoke.spawn({ pos: _p, vel: _v0.copy(ac.vel), life: 0.08 + 0.06 * Math.random(), size0: 1.2, size1: 2.4, c0: [1, 1, 1, 0.3 * Math.min(1, wingK)], c1: [1, 1, 1, 0], drag: 0 });
      }
    }
  }

  explosion(pos, vel) {
    this.fire.spawn({ pos, vel: _p.copy(vel).multiplyScalar(0.4), life: 0.25, size0: 40, size1: 80, c0: [1, 0.95, 0.8, 1], c1: [1, 0.6, 0.2, 0] });
    for (let i = 0; i < 40; i++) {
      this.fire.spawn({
        pos, vel: _p.copy(vel).multiplyScalar(0.35).add(rndVec(55)), life: 0.6 + Math.random() * 0.9,
        size0: 8 + Math.random() * 8, size1: 30 + Math.random() * 25,
        c0: [1, 0.75, 0.35, 1], c1: [0.7, 0.15, 0.02, 0], drag: 1.2,
      });
    }
    for (let i = 0; i < 30; i++) {
      this.smoke.spawn({
        pos, vel: _p.copy(vel).multiplyScalar(0.25).add(rndVec(25)), life: 4 + Math.random() * 4,
        size0: 12, size1: 55 + Math.random() * 30,
        c0: [0.12, 0.11, 0.1, 0.85], c1: [0.35, 0.35, 0.35, 0], drag: 0.5, rise: 1.5,
      });
    }
    // 燃えながら落ちる破片
    for (let i = 0; i < 14; i++) {
      this.fire.spawn({
        pos, vel: _p.copy(vel).multiplyScalar(0.5).add(rndVec(90)), life: 1.5 + Math.random(),
        size0: 3, size1: 1, c0: [1, 0.7, 0.3, 1], c1: [1, 0.3, 0.05, 0], drag: 0.4, rise: -9.8,
      });
    }
  }
}
