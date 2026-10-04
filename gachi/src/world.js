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
const TERRAIN_SEG = 400;            // 本体メッシュの分割（1 マス 325m）
const ISLAND_R = 50000;

function naturalHeight(x, z) {
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

// ---- 対地ミッションの地形：北の山岳に曲がりくねった谷（キャニオン）を彫り、奥の盆地に核開発基地 ----
//   谷は南の低地から入り、尾根に隠れながら盆地へ抜ける（地形マスキングで対空レーダーから隠れる）
const CANYON_CTRL = [
  [17300, -5400], [16900, -8000], [17300, -10600],
  [16500, -13200], [16500, -15400], [15700, -17300], [14800, -18700],
];
const CANYON_HALF = 320;          // 谷底の半幅 m
const CANYON_WALL = 800;          // 谷底の縁から元の山の高さに戻るまで m
const CANYON_FLOOR0 = 300, CANYON_FLOOR1 = 640;   // 谷底の高さ（入口 → 盆地）
const BOWL = { x: 14300, z: -19400, r: 1150, wall: 2700, floor: 640 };

export const STRIKE = {
  base: { x: BOWL.x, z: BOWL.z, y: BOWL.floor },
  bowl: BOWL,
  canyon: [],                      // 谷の中心線（50m ごと）{ x, z, y }
  start: null,                     // 出撃位置 { pos, heading }
};

// 中心線：Catmull-Rom で滑らかにつなぎ、50m ごとに点を打つ
(function buildCanyon() {
  const P = CANYON_CTRL, pts = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.ceil(len / 50);
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      pts.push({ x: cr(p0[0], p1[0], p2[0], p3[0]), z: cr(p0[1], p1[1], p2[1], p3[1]) });
    }
  }
  pts.push({ x: P[P.length - 1][0], z: P[P.length - 1][1] });
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    pts[i].s = s;
  }
  for (const p of pts) {
    const u = p.s / s;
    p.y = CANYON_FLOOR0 + (CANYON_FLOOR1 - CANYON_FLOOR0) * smoothstep(0, 1, u);
  }
  STRIKE.canyon = pts;
  STRIKE.canyonLen = s;
})();

// 谷の線分を 400m の格子に登録しておき、heightAt で近くの線分だけ調べる
const CG = 400, REACH = CANYON_HALF + CANYON_WALL + 200;
const cgrid = new Map();
const cbox = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
(function buildCanyonGrid() {
  const P = STRIKE.canyon;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    const x0 = Math.floor((Math.min(a.x, b.x) - REACH) / CG), x1 = Math.floor((Math.max(a.x, b.x) + REACH) / CG);
    const z0 = Math.floor((Math.min(a.z, b.z) - REACH) / CG), z1 = Math.floor((Math.max(a.z, b.z) + REACH) / CG);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const k = gx * 100000 + gz;
      if (!cgrid.has(k)) cgrid.set(k, []);
      cgrid.get(k).push(i);
    }
    cbox.x0 = Math.min(cbox.x0, x0 * CG); cbox.x1 = Math.max(cbox.x1, (x1 + 1) * CG);
    cbox.z0 = Math.min(cbox.z0, z0 * CG); cbox.z1 = Math.max(cbox.z1, (z1 + 1) * CG);
  }
})();

function carve(x, z, h) {
  // 盆地
  const rb = Math.hypot(x - BOWL.x, z - BOWL.z);
  if (rb < BOWL.wall + 600) {
    const r = rb + (valueNoise(x / 420, z / 420) - 0.5) * 500;
    const k = smoothstep(BOWL.r, BOWL.wall, r);
    const bowlH = BOWL.floor + k * k * Math.max(0, h - BOWL.floor);
    h = Math.min(h, bowlH);
  }
  // 谷
  if (x < cbox.x0 || x > cbox.x1 || z < cbox.z0 || z > cbox.z1) return h;
  const list = cgrid.get(Math.floor(x / CG) * 100000 + Math.floor(z / CG));
  if (!list) return h;
  const P = STRIKE.canyon;
  let best = Infinity, bs = 0, by = 0;
  for (const i of list) {
    const a = P[i], b = P[i + 1];
    const ex = b.x - a.x, ez = b.z - a.z;
    const L2 = ex * ex + ez * ez;
    const t = clamp(((x - a.x) * ex + (z - a.z) * ez) / L2, 0, 1);
    const dx = x - (a.x + ex * t), dz = z - (a.z + ez * t);
    const d2 = dx * dx + dz * dz;
    if (d2 < best) { best = d2; bs = a.s + (b.s - a.s) * t; by = a.y + (b.y - a.y) * t; }
  }
  const d = Math.sqrt(best) + (valueNoise(x / 260, z / 260) - 0.5) * 140;
  const fade = smoothstep(0, 1200, bs);                    // 入口は浅く始まる
  const k = smoothstep(CANYON_HALF, CANYON_HALF + CANYON_WALL, d);
  const floor = by + (valueNoise(x / 90, z / 90) - 0.5) * 8;
  const cut = floor + k * Math.max(0, h - floor);
  return Math.min(h, h + (cut - h) * fade);
}

// ---- 味方の基地（南の低地）：滑走路 3000m、谷の入口のほうへ向く ----
//   u = 滑走路方向（+ が離陸方向）、v = 右方向。周りを平らにならす
export const AIRFIELD = {
  x: 500, z: -500, elev: 78, len: 3000, width: 45,
  flatU: 1750, flatV: 480, blend: 600,
};
{
  const A = AIRFIELD, [cx, cz] = CANYON_CTRL[0];
  A.hdg = Math.atan2(cx - A.x, -(cz - A.z));            // 方位（rad、北 = 0、時計回り）
  A.fu = [Math.sin(A.hdg), -Math.cos(A.hdg)];           // 滑走路方向（x, z）
  A.fv = [Math.cos(A.hdg), Math.sin(A.hdg)];            // 右方向
}

// ワールド座標 ↔ 滑走路座標
export function toField(x, z) {
  const A = AIRFIELD, dx = x - A.x, dz = z - A.z;
  return [dx * A.fu[0] + dz * A.fu[1], dx * A.fv[0] + dz * A.fv[1]];
}
export function fromField(u, v) {
  const A = AIRFIELD;
  return [A.x + u * A.fu[0] + v * A.fv[0], A.z + u * A.fu[1] + v * A.fv[1]];
}

function flatten(x, z, h) {
  const A = AIRFIELD;
  const [u, v] = toField(x, z);
  const d = Math.hypot(Math.max(0, Math.abs(u) - A.flatU), Math.max(0, Math.abs(v) - A.flatV));
  if (d >= A.blend) return h;
  return A.elev + (h - A.elev) * smoothstep(0, A.blend, d);
}

export function heightAt(x, z) {
  const h = naturalHeight(x, z);
  if (h < -200) return h;
  return flatten(x, z, carve(x, z, h));
}

// 出撃地点：基地の滑走路の端（離陸方向に向いて、脚で地面に）
{
  const A = AIRFIELD;
  const [sx, sz] = fromField(-A.len / 2 + 120, 0);
  STRIKE.start = {
    pos: new THREE.Vector3(sx, A.elev, sz),
    heading: THREE.MathUtils.radToDeg(A.hdg),
    ground: true,
  };
  STRIKE.home = new THREE.Vector3(A.x, A.elev, A.z);   // RTB の帰り先
}

// 基地のコンクリートの敷地（地形の色を塗る）
export function onBasePad(x, z) {
  return Math.abs(x - BOWL.x) < 520 && Math.abs(z - BOWL.z) < 330;
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

const sand = new THREE.Color(0xcbb98a), grass = new THREE.Color(0x4f7a35),
  forest = new THREE.Color(0x2f4f25), rock = new THREE.Color(0x6e665c),
  snow = new THREE.Color(0xf2f4f7), seabed = new THREE.Color(0x3a5a5a),
  concrete = new THREE.Color(0x8d8c86), dirt = new THREE.Color(0x7d6f55);

function colorTerrain(geo) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
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
      // 盆地の底は踏み固められた土、基地の敷地はコンクリート
      const rb = Math.hypot(x - BOWL.x, z - BOWL.z);
      c.lerp(dirt, smoothstep(BOWL.r + 300, BOWL.r - 200, rb) * 0.7);
      if (onBasePad(x, z)) c.copy(concrete).multiplyScalar(0.92 + 0.16 * valueNoise(x / 40, z / 40));
    }
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// 谷と盆地、基地のまわりだけ細かいメッシュ（約 40m）。本体の格子線に合わせて切り出し、
// 本体側はその範囲の三角形を抜く。縁の頂点は本体の辺と同じ直線補間にして、すき間を作らない
function snapRect(x0, x1, z0, z1) {
  const cell = TERRAIN_SIZE / TERRAIN_SEG, o = -TERRAIN_SIZE / 2;
  const i0 = Math.floor((x0 - o) / cell), i1 = Math.ceil((x1 - o) / cell);
  const j0 = Math.floor((z0 - o) / cell), j1 = Math.ceil((z1 - o) / cell);
  return { x0: o + i0 * cell, x1: o + i1 * cell, z0: o + j0 * cell, z1: o + j1 * cell, nx: i1 - i0, nz: j1 - j0, cell };
}
function patchRects() {
  const m = 300, A = AIRFIELD, R = Math.hypot(A.flatU, A.flatV) + A.blend + 200;
  return [
    snapRect(Math.min(cbox.x0, BOWL.x - BOWL.wall - 600) - m, Math.max(cbox.x1, BOWL.x + BOWL.wall + 600) + m,
      Math.min(cbox.z0, BOWL.z - BOWL.wall - 600) - m, Math.max(cbox.z1, BOWL.z + BOWL.wall + 600) + m),
    snapRect(A.x - R, A.x + R, A.z - R, A.z + R),
  ];
}

function buildPatch(R, mat, detail) {
  const sub = 8, W = R.x1 - R.x0, D = R.z1 - R.z0;
  const pg = new THREE.PlaneGeometry(W, D, R.nx * sub, R.nz * sub);
  pg.rotateX(-Math.PI / 2);
  pg.translate(R.x0 + W / 2, 0, R.z0 + D / 2);
  const pp = pg.attributes.position;
  const lerpEdge = (u, a0x, a0z, a1x, a1z) => {
    const h0 = heightAt(a0x, a0z), h1 = heightAt(a1x, a1z);
    return h0 + (h1 - h0) * u;
  };
  const eps = 1;
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i), z = pp.getZ(i);
    let h;
    const onX = Math.abs(x - R.x0) < eps || Math.abs(x - R.x1) < eps;
    const onZ = Math.abs(z - R.z0) < eps || Math.abs(z - R.z1) < eps;
    if (onX && !onZ) {
      const j = Math.floor((z - R.z0) / R.cell), za = R.z0 + j * R.cell;
      h = lerpEdge((z - za) / R.cell, x, za, x, za + R.cell);
    } else if (onZ && !onX) {
      const j = Math.floor((x - R.x0) / R.cell), xa = R.x0 + j * R.cell;
      h = lerpEdge((x - xa) / R.cell, xa, z, xa + R.cell, z);
    } else {
      h = heightAt(x, z);
    }
    pp.setY(i, h);
  }
  pg.computeVertexNormals();
  colorTerrain(pg);
  const m = mat.clone();
  m.map = detail.clone();
  m.map.repeat.set(W / 400, D / 400);
  m.map.needsUpdate = true;
  return new THREE.Mesh(pg, m);
}

function buildTerrain() {
  const seg = TERRAIN_SEG;
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  }
  // 細かいメッシュの範囲の三角形を抜く
  const rects = patchRects();
  const idx = geo.index.array, keep = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    if (rects.some((R) => cx > R.x0 && cx < R.x1 && cz > R.z0 && cz < R.z1)) continue;
    keep.push(a, b, c);
  }
  geo.setIndex(keep);
  geo.computeVertexNormals();
  colorTerrain(geo);

  const detail = makeNoiseTexture(256, 0.72, 1.0, 24);
  detail.repeat.set(TERRAIN_SIZE / 400, TERRAIN_SIZE / 400);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, map: detail, roughness: 0.95, metalness: 0,
  });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, mat));
  for (const R of rects) group.add(buildPatch(R, mat, detail));
  return group;
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
