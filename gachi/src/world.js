// 空・地形・海・雲
import * as THREE from 'three';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---- ノイズ ----
function hash(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function valueNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function fbm(x, z, oct = 6) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += valueNoise(x * f, z * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}
function ridged(x, z, oct = 5) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(valueNoise(x * f, z * f) * 2 - 1);
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return sum / norm;
}

// ---- 地形：海に浮かぶ山岳の島 ----
export const TERRAIN_SIZE = 130000;
const ISLAND_R = 50000;

export function heightAt(x, z) {
  const d = Math.hypot(x, z * 1.25) / ISLAND_R;
  const warp = fbm(x / 22000 + 7.3, z / 22000 - 3.1, 4);
  const mask = smoothstep(1.0, 0.55, d + (warp - 0.5) * 0.6);
  if (mask <= 0) return -300;
  const base = fbm(x / 15000, z / 15000);
  const mtn = ridged(x / 8000 + 11, z / 8000 + 5);
  let h = Math.pow(base, 1.5) * 1100
    + Math.pow(mtn, 1.6) * 2600 * smoothstep(0.35, 0.65, base) * smoothstep(0.2, 0.8, mask)
    + 60;
  return h * mask - 300 * (1 - mask);
}

function makeNoiseTexture(size, lo, hi, scale) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // タイル可能にするため周期ノイズ
      const n = 0.5 * valueNoise((x % size) / scale, (y % size) / scale)
        + 0.3 * hash(x, y) + 0.2 * valueNoise(x / (scale * 0.25), y / (scale * 0.25));
      const v = Math.round(255 * (lo + (hi - lo) * n));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function buildTerrain() {
  const seg = 400;
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  const nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(0xcbb98a), grass = new THREE.Color(0x4f7a35),
    forest = new THREE.Color(0x2f4f25), rock = new THREE.Color(0x6e665c),
    snow = new THREE.Color(0xf2f4f7), seabed = new THREE.Color(0x3a5a5a);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), h = pos.getY(i), z = pos.getZ(i);
    const slope = 1 - nrm.getY(i);
    const n = valueNoise(x / 900, z / 900);
    if (h < 0) c.copy(seabed);
    else if (h < 25) c.copy(sand);
    else {
      c.copy(grass).lerp(forest, smoothstep(0.35, 0.7, n) * smoothstep(1400, 300, h));
      c.lerp(rock, smoothstep(900, 1700, h + n * 300));
      c.lerp(rock, smoothstep(0.12, 0.3, slope));
      c.lerp(snow, smoothstep(2000, 2400, h + n * 250) * smoothstep(0.45, 0.2, slope));
    }
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const detail = makeNoiseTexture(256, 0.72, 1.0, 24);
  detail.repeat.set(TERRAIN_SIZE / 400, TERRAIN_SIZE / 400);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, map: detail, roughness: 0.95, metalness: 0,
  });
  return new THREE.Mesh(geo, mat);
}

// ---- 雲：インスタンス化したビルボードのパフ ----
function makePuffTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const img = g.createImageData(s, s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (x + 0.5) / s * 2 - 1, dy = (y + 0.5) / s * 2 - 1;
      const r = Math.hypot(dx, dy);
      const n = fbm(x / 18, y / 18, 4);
      const a = clamp((1 - r) * 1.6 - 0.15 + (n - 0.5) * 0.9, 0, 1);
      const i = (y * s + x) * 4;
      const v = Math.round(255 * (0.86 + 0.14 * n));
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.round(255 * a * a);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildClouds(fog) {
  const offsets = [], scales = [], shades = [], rots = [];
  let seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 140; k++) {
    const cx = (rnd() - 0.5) * 140000, cz = (rnd() - 0.5) * 140000;
    const cy = 1300 + rnd() * 900;
    const size = 500 + rnd() * 1200;
    const puffs = 10 + Math.floor(rnd() * 18);
    for (let i = 0; i < puffs; i++) {
      const px = cx + (rnd() - 0.5) * size * 2.2;
      const pz = cz + (rnd() - 0.5) * size * 2.2;
      const py = cy + rnd() * size * 0.35;
      offsets.push(px, py, pz);
      scales.push(size * (0.45 + rnd() * 0.5));
      shades.push(clamp(0.45 + (py - cy) / (size * 0.35) * 0.55, 0, 1));
      rots.push(rnd() * Math.PI * 2);
    }
  }
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  geo.setAttribute('offset', new THREE.InstancedBufferAttribute(new Float32Array(offsets), 3));
  geo.setAttribute('scale', new THREE.InstancedBufferAttribute(new Float32Array(scales), 1));
  geo.setAttribute('shade', new THREE.InstancedBufferAttribute(new Float32Array(shades), 1));
  geo.setAttribute('rot', new THREE.InstancedBufferAttribute(new Float32Array(rots), 1));
  geo.instanceCount = scales.length;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: makePuffTexture() },
      fogColor: { value: fog.color },
      fogDensity: { value: fog.density },
    },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec3 offset;
      attribute float scale;
      attribute float shade;
      attribute float rot;
      varying vec2 vUv;
      varying float vShade;
      varying float vDist;
      void main() {
        vec4 mv = viewMatrix * vec4(offset, 1.0);
        float c = cos(rot), s = sin(rot);
        vec2 p = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * scale;
        mv.xy += p;
        vUv = uv;
        vShade = shade;
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
      varying float vShade;
      varying float vDist;
      void main() {
        #include <logdepthbuf_fragment>
        vec4 t = texture2D(map, vUv);
        float a = t.a * 0.9;
        a *= smoothstep(40.0, 400.0, vDist);
        if (a < 0.01) discard;
        vec3 col = mix(vec3(0.60, 0.65, 0.74), vec3(1.0), vShade) * t.rgb;
        float f = 1.0 - exp(-vDist * vDist * fogDensity * fogDensity);
        col = mix(col, fogColor, f);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  return mesh;
}

// ---- 空：グラデーション + 太陽 ----
const HORIZON = 0xbcd0e2;
const ZENITH = 0x2f6bc0;

function buildSky(sunDir) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      horizon: { value: new THREE.Color(HORIZON) },
      zenith: { value: new THREE.Color(ZENITH) },
      sunDir: { value: sunDir },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = (modelMatrix * vec4(position, 0.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 horizon;
      uniform vec3 zenith;
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.5));
        col = mix(col, horizon * 0.92, smoothstep(0.0, -0.2, h));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        col += vec3(1.0, 0.92, 0.78) * (pow(s, 1500.0) * 6.0 + pow(s, 60.0) * 0.25 + pow(s, 6.0) * 0.12);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(100000, 32, 16), mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}

export function createWorld(scene, renderer) {
  // 太陽
  const sunDir = new THREE.Vector3().setFromSphericalCoords(
    1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(160));

  const sky = buildSky(sunDir);
  scene.add(sky);

  scene.fog = new THREE.FogExp2(HORIZON, 0.000014);

  const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x5a6a4a, 1.3);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
  sun.position.copy(sunDir).multiplyScalar(1000);
  scene.add(sun);

  const terrain = buildTerrain();
  scene.add(terrain);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(400000, 400000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x24597f, roughness: 0.6, metalness: 0.05 }),
  );
  scene.add(water);

  const clouds = buildClouds(scene.fog);
  scene.add(clouds);

  return {
    heightAt,
    sunDir,
    update(camera) {
      sky.position.copy(camera.position);
      water.position.set(camera.position.x, 0, camera.position.z);
    },
  };
}
