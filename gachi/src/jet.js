// 機体モデル：自機 F-22 風 / 敵機 Su-57 風（前方 = -Z、上 = +Y、右 = +X、単位 m）
//   胴体・インテーク・ノズル・キャノピーは「断面をつなぐロフト」で作る。
//     断面は右半分のキーポイントを Catmull-Rom でつなぎ（チャインなどは角を立てる）、左右対称に展開。
//     機軸方向は各断面のキーポイントを単調 3 次補間でつなぐので、滑らかなふくらみになる。
//   主翼・尾翼は翼型（両凸）断面の板。
//   迷彩とパネルラインは機体座標の平面図に描いたテクスチャを、三平面投影（triplanar）で貼る。
import * as THREE from 'three';
import { toCreasedNormals, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { THROTTLE_AB_MAX } from './flight.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// 補間・断面
// ---------------------------------------------------------------------------

// 単調 3 次補間（Fritsch–Carlson 風、行き過ぎない）
function monotone(xs, ys) {
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : 2 / (1 / d[i - 1] + 1 / d[i]);
  return (x) => {
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = Math.min(1, Math.max(0, (x - xs[i]) / h));
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i]
      + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// 左右対称の断面。keys: 右半分 [x, y] を上の中心 → 下の中心の順。sharp: 角を立てるキーの番号
// 戻り値：上中心から右回り（後方から見て時計回り）の閉じた点列
function symSection(keys, sharp = [], sub = 4) {
  const n = keys.length;
  const isSharp = (i) => sharp.includes(i);
  const P = (i) => {
    if (i < 0) return [-keys[-i][0], keys[-i][1]];                  // 上中心の向こう側（鏡像）
    if (i > n - 1) return [-keys[2 * (n - 1) - i][0], keys[2 * (n - 1) - i][1]];
    return keys[i];
  };
  const half = [];
  for (let i = 0; i < n - 1; i++) {
    const p1 = P(i), p2 = P(i + 1);
    const p0 = isSharp(i) ? p1 : P(i - 1);
    const p3 = isSharp(i + 1) ? p2 : P(i + 2);
    for (let s = 0; s < sub; s++) {
      const t = s / sub, t2 = t * t, t3 = t2 * t;
      const pt = [0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t
        + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
      half.push(pt);
    }
  }
  half.push(keys[n - 1]);
  half[0][0] = 0;
  const ring = half.slice();
  for (let i = half.length - 2; i >= 1; i--) ring.push([-half[i][0], half[i][1]]);
  return ring;
}

// 角の点列をそのまま（直線でつなぐ）閉じた断面に
function polySection(pts, sub = 1) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    for (let s = 0; s < sub; s++) {
      const t = s / sub;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * t]);
    }
  }
  return out;
}

// 断面をつなぐ。stations: [{ z, pts: [[x, y, dz?], ...] }]（全断面で点数をそろえる）
// opts.rings: 機軸方向の分割数 / capFront, capBack: 端をふさぐ
function loft(stations, { rings = 60, capFront = true, capBack = true } = {}) {
  const P = stations[0].pts.length;
  const zs = stations.map((s) => s.z);
  const fx = [], fy = [], fdz = [];
  for (let i = 0; i < P; i++) {
    fx.push(monotone(zs, stations.map((s) => s.pts[i][0])));
    fy.push(monotone(zs, stations.map((s) => s.pts[i][1])));
    fdz.push(monotone(zs, stations.map((s) => s.pts[i][2] || 0)));
  }
  // 端ほど細かく（機首の丸み）
  const z0 = zs[0], z1 = zs[zs.length - 1];
  const pos = [];
  for (let r = 0; r <= rings; r++) {
    const u = r / rings;
    const w = 0.5 - 0.5 * Math.cos(Math.PI * u);
    const z = z0 + (z1 - z0) * (0.55 * u + 0.45 * w);
    for (let i = 0; i < P; i++) pos.push(fx[i](z), fy[i](z), z + fdz[i](z));
  }
  const idx = [];
  for (let r = 0; r < rings; r++) {
    for (let i = 0; i < P; i++) {
      const a = r * P + i, b = r * P + ((i + 1) % P), c = a + P, d = b + P;
      idx.push(a, c, b, b, c, d);
    }
  }
  const cap = (r, front) => {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < P; i++) { cx += pos[(r * P + i) * 3]; cy += pos[(r * P + i) * 3 + 1]; cz += pos[(r * P + i) * 3 + 2]; }
    const c = pos.length / 3;
    pos.push(cx / P, cy / P, cz / P);
    for (let i = 0; i < P; i++) {
      const a = r * P + i, b = r * P + ((i + 1) % P);
      if (front) idx.push(c, a, b); else idx.push(c, b, a);
    }
  };
  if (capFront) cap(0, true);
  if (capBack) cap(rings, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// 翼（両凸の翼型断面）。root / tip: { x, y, le, te }（le, te は前縁・後縁の z）, t: 最大厚 m
// 左翼は x を反転して作る
function surface(root, tip, { tRoot = 0.25, tTip = 0.08, spanSeg = 6, chordSeg = 10 } = {}, side = 1) {
  const pos = [], idx = [];
  const C = chordSeg;
  for (let j = 0; j <= spanSeg; j++) {
    const s = j / spanSeg;
    const x = (root.x + (tip.x - root.x) * s) * side;
    const y = root.y + (tip.y - root.y) * s;
    const le = root.le + (tip.le - root.le) * s, te = root.te + (tip.te - root.te) * s;
    const th = tRoot + (tTip - tRoot) * s;
    // 上面 C+1 点（前縁 → 後縁）、下面 C-1 点（後縁 → 前縁、両端は共有）
    for (let i = 0; i <= C; i++) {
      const c = 0.5 - 0.5 * Math.cos(Math.PI * i / C);
      const h = th * 2.6 * Math.pow(c, 0.9) * (1 - c) ** 1.1;
      pos.push(x, y + h * 0.5, le + (te - le) * c);
    }
    for (let i = C - 1; i >= 1; i--) {
      const c = 0.5 - 0.5 * Math.cos(Math.PI * i / C);
      const h = th * 2.6 * Math.pow(c, 0.9) * (1 - c) ** 1.1;
      pos.push(x, y - h * 0.5, le + (te - le) * c);
    }
  }
  const P = 2 * C;
  for (let j = 0; j < spanSeg; j++) {
    for (let i = 0; i < P; i++) {
      const a = j * P + i, b = j * P + ((i + 1) % P), c = a + P, d = b + P;
      if (side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  }
  // 翼端をふさぐ
  const t0 = spanSeg * P;
  for (let i = 1; i < C; i++) {
    const a = t0 + i, b = t0 + i + 1, c = t0 + (P - i) % P, d = t0 + (P - i - 1);
    if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// のこぎり刃：中心 cx・高さ y・後縁 z の、幅 ±w を n 枚の三角形で（両面）
function sawtooth(cx, y, z, w, n, len) {
  const pos = [];
  const step = (2 * w) / n;
  for (let i = 0; i < n; i++) {
    const x0 = cx - w + i * step, x1 = x0 + step, xm = (x0 + x1) / 2;
    pos.push(x0, y, z, x1, y, z, xm, y, z + len);   // 上向き
    pos.push(x0, y, z, xm, y, z + len, x1, y, z);   // 下向き
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// 垂直尾翼：翼を「根元 → 外側に cant 傾けた上向き」に置く
function fin(rootPos, { chordRoot, chordTip, height, sweepLE, cant, tRoot = 0.18, tTip = 0.06 }, side) {
  const g = surface(
    { x: 0, y: 0, le: 0, te: chordRoot },
    { x: height, y: 0, le: height * Math.tan(sweepLE), te: height * Math.tan(sweepLE) + chordTip },
    { tRoot, tTip, spanSeg: 4, chordSeg: 8 }, 1);
  g.rotateZ(side > 0 ? Math.PI / 2 - cant : Math.PI / 2 + cant);
  g.translate(rootPos[0] * side, rootPos[1], rootPos[2]);
  return g;
}

// ---------------------------------------------------------------------------
// 迷彩テクスチャ（平面図: u = x, v = z。側面: u = y, v = z。正面: u = x, v = y）
// ---------------------------------------------------------------------------
const TEX_SPAN = 24;                 // テクスチャ 1 枚がカバーする m
const TEX_PX = 2048;
const toPx = (m) => (m / TEX_SPAN + 0.5) * TEX_PX;

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function camoTexture(scheme) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_PX;
  const g = cv.getContext('2d');
  const R = rng(scheme.seed);
  g.fillStyle = scheme.base;
  g.fillRect(0, 0, TEX_PX, TEX_PX);

  // 迷彩パッチ
  for (const [color, count, size, sharp] of scheme.patches) {
    g.fillStyle = color;
    for (let k = 0; k < count; k++) {
      const cx = R() * TEX_PX, cy = R() * TEX_PX;
      const r0 = size * (0.5 + R()) * TEX_PX / TEX_SPAN;
      const n = sharp ? 4 + Math.floor(R() * 3) : 9;
      const a0 = R() * Math.PI;
      const stretch = 0.6 + R() * 1.4;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * Math.PI * 2;
        const rr = r0 * (sharp ? 0.55 + R() * 0.8 : 0.75 + R() * 0.4);
        const px = cx + Math.cos(a) * rr * stretch, py = cy + Math.sin(a) * rr / stretch;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      if (!sharp) { g.filter = 'blur(6px)'; }
      g.fill();
      g.filter = 'none';
    }
  }

  // 汚れ・ムラ
  for (let k = 0; k < 9000; k++) {
    const v = R() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${0.025 + R() * 0.03})`;
    const s = 2 + R() * 10;
    g.fillRect(R() * TEX_PX, R() * TEX_PX, s, s * (0.3 + R()));
  }

  // 気流方向（機軸 = テクスチャの縦）に流れた汚れの筋
  for (let k = 0; k < 1400; k++) {
    const x = R() * TEX_PX, y = R() * TEX_PX, len = (0.4 + R() * 2.6) * TEX_PX / TEX_SPAN;
    const grad = g.createLinearGradient(x, y, x, y + len);
    const a = 0.03 + R() * 0.05;
    grad.addColorStop(0, `rgba(30,28,26,${a})`);
    grad.addColorStop(1, 'rgba(30,28,26,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, 1 + R() * 4, len);
  }
  // ノズル周りの煤（すす）
  for (const [x, z, rx, rz] of scheme.soot ?? []) {
    const cx = toPx(x), cy = toPx(z);
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, rz / TEX_SPAN * TEX_PX);
    grad.addColorStop(0, 'rgba(25,22,20,0.55)');
    grad.addColorStop(1, 'rgba(25,22,20,0)');
    g.save();
    g.translate(cx, cy); g.scale(rx / rz, 1); g.translate(-cx, -cy);
    g.fillStyle = grad;
    g.fillRect(cx - TEX_PX, cy - TEX_PX, TEX_PX * 2, TEX_PX * 2);
    g.restore();
  }

  // パネルライン（機体ごとの線分 [x0, z0, x1, z1] を平面図座標で）
  g.lineCap = 'round';
  const line = (pts, w, a, dark = true) => {
    g.strokeStyle = dark ? `rgba(20,24,28,${a})` : `rgba(255,255,255,${a})`;
    g.lineWidth = w;
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(toPx(x), toPx(z)) : g.moveTo(toPx(x), toPx(z))));
    g.stroke();
  };
  for (const pl of scheme.lines) {
    line(pl, 3.0, 0.08, false);                    // 縁のハイライト
    g.save(); g.translate(-1.5, -1.5); line(pl, 2.0, 0.32); g.restore();
  }
  // 細かいパネルのグリッド（ランダムな長方形）
  for (let k = 0; k < scheme.panels; k++) {
    const x = (R() - 0.5) * 16, z = (R() - 0.5) * 20;
    const w = 0.5 + R() * 1.6, h = 0.5 + R() * 1.8;
    line([[x, z], [x + w, z], [x + w, z + h], [x, z + h], [x, z]], 1.4, 0.12);
  }
  // 留め具の点
  g.fillStyle = 'rgba(20,24,28,0.35)';
  g.fillStyle = 'rgba(20,24,28,0.2)';
  for (let k = 0; k < 1500; k++) g.fillRect(R() * TEX_PX, R() * TEX_PX, 2, 2);
  // 機体ごとの追加（RAM の前縁、マーキングなど）
  scheme.extra?.(g, toPx);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// 三平面投影で迷彩を貼るマテリアル
function camoMaterial(tex, { metalness = 0.35, roughness = 0.55, envMap = null } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness, roughness, envMap, envMapIntensity: 0.6 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.camoTex = { value: tex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP;\nvarying vec3 vON;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position;\nvON = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D camoTex;\nvarying vec3 vOP;\nvarying vec3 vON;')
      .replace('#include <map_fragment>', `
        vec3 bw = pow(abs(normalize(vON)), vec3(4.0));
        bw /= (bw.x + bw.y + bw.z);
        vec4 cTop = texture2D(camoTex, vOP.xz / ${TEX_SPAN.toFixed(1)} + 0.5);
        vec4 cSide = texture2D(camoTex, vOP.yz / ${TEX_SPAN.toFixed(1)} + 0.5);
        vec4 cFront = texture2D(camoTex, vOP.xy / ${TEX_SPAN.toFixed(1)} + 0.5);
        diffuseColor.rgb *= cSide.rgb * bw.x + cTop.rgb * bw.y + cFront.rgb * bw.z;`);
  };
  m.customProgramCacheKey = () => 'camo-triplanar';
  return m;
}

// 機体に映り込む空（グラデーションの環境マップ）。最初の buildJet で作る
let envTex = null;
export function initJetEnvironment(renderer) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#5f86c4');
  grad.addColorStop(0.45, '#b9cde6');
  grad.addColorStop(0.5, '#dfe8f0');
  grad.addColorStop(0.53, '#6d7a70');
  grad.addColorStop(1, '#2c3b45');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 128);
  // 太陽
  g.fillStyle = 'rgba(255,250,235,0.9)';
  g.beginPath(); g.arc(256 * (160 / 360), 128 * (52 / 180), 5, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  const pm = new THREE.PMREMGenerator(renderer);
  envTex = pm.fromEquirectangular(t).texture;
  pm.dispose();
  t.dispose();
}

// ---------------------------------------------------------------------------
// 機体定義
// ---------------------------------------------------------------------------

// 胴体断面（チャイン付き）。上中心, 肩, チャイン, 下側面, 下面, 下中心
const chine = (top, sh, ch, lo, lb, bot) => [[0, top], sh, ch, lo, lb, [0, bot]];

const F22 = {
  // 搭載位置（発射順）：左外、右外、左内、右内（翼下パイロン）
  stations: [[-4.3, -0.32, 2.7], [4.3, -0.32, 2.7], [-2.9, -0.42, 1.6], [2.9, -0.42, 1.6]],
  nav: [[-6.75, 0.0, 4.3], [6.75, 0.0, 4.3]],
  // ベイパー：翼端（渦）と右主翼上面の四角（前縁根元・前縁翼端・後縁翼端・後縁根元）
  vapor: { tips: [[-6.8, -0.06, 4.6], [6.8, -0.06, 4.6]], wing: [[1.8, 0.4, -0.6], [6.6, 0.02, 3.5], [6.6, 0.02, 5.0], [1.8, 0.4, 6.4]] },
  nozzles: [[-0.68, -0.02, 8.62], [0.68, -0.02, 8.62]],
  flameShape: [1.0, 0.55],        // 2 次元ノズル：横長の炎
  flameR: 0.48,
  scheme: {
    seed: 22,
    base: '#8f969d',
    patches: [['#7a8188', 26, 2.6, false], ['#9aa1a8', 18, 2.0, false]],
    panels: 70,
    lines: [],
    soot: [[-0.68, 8.4, 0.7, 1.4], [0.68, 8.4, 0.7, 1.4]],
  },
  build(add, M) {
    // ---- 胴体 ----
    const S = (z, ...k) => ({ z, pts: symSection(chine(...k), [2], 4) });
    add(loft([
      S(-9.6, 0.0, [0.004, 0.0], [0.008, -0.0], [0.006, -0.004], [0.003, -0.006], -0.006),
      S(-8.9, 0.17, [0.13, 0.13], [0.24, -0.02], [0.17, -0.1], [0.09, -0.15], -0.16),
      S(-7.6, 0.42, [0.32, 0.34], [0.58, -0.02], [0.42, -0.24], [0.22, -0.36], -0.38),
      S(-6.0, 0.62, [0.46, 0.52], [0.86, 0.02], [0.66, -0.36], [0.33, -0.54], -0.57),
      S(-4.4, 0.7, [0.55, 0.62], [1.05, 0.1], [0.82, -0.42], [0.4, -0.62], -0.65),
      S(-2.6, 0.74, [0.72, 0.64], [1.32, 0.28], [1.12, -0.44], [0.55, -0.7], -0.72),
      S(-0.8, 0.72, [0.95, 0.6], [1.86, 0.32], [1.82, -0.46], [1.0, -0.76], -0.76),
      S(1.4, 0.64, [1.0, 0.55], [2.06, 0.26], [1.98, -0.4], [1.1, -0.74], -0.73),
      S(4.2, 0.56, [0.98, 0.5], [1.94, 0.2], [1.84, -0.34], [1.02, -0.6], -0.6),
      S(6.6, 0.5, [0.9, 0.45], [1.7, 0.14], [1.6, -0.28], [0.95, -0.5], -0.5),
      S(7.9, 0.42, [0.8, 0.4], [1.4, 0.1], [1.34, -0.24], [0.85, -0.42], -0.43),
    ], { rings: 90, capFront: true, capBack: true }), M.body);

    // ---- インテーク（カレット型、斜めに切った開口） ----
    for (const sd of [-1, 1]) {
      const I = (z, inT, outT, outB, inB, rake = 0) => ({
        z,
        pts: polySection([
          [inT[0] * sd, inT[1], 0], [outT[0] * sd, outT[1], -rake * 0.4],
          [outB[0] * sd, outB[1], rake * 0.15], [inB[0] * sd, inB[1], rake * 0.55],
        ], 2).map((p) => [p[0], p[1], p[2]]),
      });
      const st = [
        I(-4.7, [1.02, 0.28], [1.86, 0.24], [1.64, -0.86], [1.06, -0.9], 1),
        I(-3.6, [1.0, 0.3], [1.9, 0.26], [1.7, -0.88], [1.04, -0.92]),
        I(-2.0, [1.0, 0.32], [1.94, 0.3], [1.78, -0.86], [1.02, -0.9]),
        I(0.5, [1.0, 0.3], [1.96, 0.28], [1.86, -0.76], [1.0, -0.82]),
      ];
      // 左側は点の並びが逆回りになるので反転
      if (sd < 0) for (const s of st) s.pts.reverse();
      add(loft(st, { rings: 24, capFront: false, capBack: true }), M.body);
      // 開口の奥（暗い）
      const cap = loft([
        { z: -4.35, pts: polySection([[1.08 * sd, 0.24], [1.82 * sd, 0.2], [1.62 * sd, -0.82], [1.1 * sd, -0.86]], 2) },
        { z: -4.3, pts: polySection([[1.08 * sd, 0.24], [1.82 * sd, 0.2], [1.62 * sd, -0.82], [1.1 * sd, -0.86]], 2) },
      ], { rings: 1, capFront: true, capBack: false });
      if (sd < 0) cap.index.array.reverse();
      add(cap, M.dark);
    }

    // ---- ノズル（2 次元推力偏向：四角） ----
    for (const sd of [-1, 1]) {
      const cx = 0.68 * sd;
      const R = (z, w, h, yc = -0.02) => ({ z, pts: polySection([[cx - w, yc + h], [cx + w, yc + h], [cx + w, yc - h], [cx - w, yc - h]], 3) });
      const g = loft([R(7.4, 0.58, 0.42), R(7.95, 0.56, 0.38), R(8.7, 0.52, 0.18)], { rings: 8, capFront: true, capBack: false });
      add(g, M.metal);
      // 内側の暗い面
      const inner = loft([R(8.45, 0.48, 0.2), R(8.47, 0.48, 0.2)], { rings: 1, capFront: false, capBack: true });
      add(inner, M.nozzleIn);
      // 上下のフラップ後縁はのこぎり刃（ステルスのためのギザギザ）
      add(sawtooth(cx, -0.02 + 0.18, 8.7, 0.52, 3, 0.22), M.metal);
      add(sawtooth(cx, -0.02 - 0.18, 8.7, 0.52, 3, 0.22), M.metal);
    }
    // ノズル間のビーバーテイル
    add(surface({ x: 0, y: 0.05, le: 6.8, te: 8.7 }, { x: 0.3, y: 0.05, le: 6.9, te: 8.5 }, { tRoot: 0.12, tTip: 0.1, spanSeg: 1 }, 1), M.body);
    add(surface({ x: 0, y: 0.05, le: 6.8, te: 8.7 }, { x: 0.3, y: 0.05, le: 6.9, te: 8.5 }, { tRoot: 0.12, tTip: 0.1, spanSeg: 1 }, -1), M.body);

    // ---- 主翼（前縁 42°、後縁 前進 17°、下反角） ----
    for (const sd of [-1, 1]) {
      add(surface({ x: 1.5, y: 0.22, le: -1.4, te: 6.7 }, { x: 6.8, y: -0.08, le: 3.4, te: 5.1 }, { tRoot: 0.32, tTip: 0.07, spanSeg: 8, chordSeg: 12 }, sd), M.body);
      // 水平尾翼
      add(surface({ x: 1.4, y: 0.02, le: 6.0, te: 9.15 }, { x: 4.45, y: -0.02, le: 8.6, te: 9.5 }, { tRoot: 0.16, tTip: 0.05, spanSeg: 5, chordSeg: 10 }, sd), M.body);
      // 垂直尾翼（外傾 28°）
      add(fin([1.45, 0.45, 3.5], { chordRoot: 4.1, chordTip: 1.45, height: 2.75, sweepLE: 33 * DEG, cant: 28 * DEG }, sd), M.body);
      // 翼下パイロン（ミサイル用）
      for (const [px, py, pz] of F22.stations.filter((st) => Math.sign(st[0]) === sd)) {
        add(new THREE.BoxGeometry(0.08, 0.22, 2.0).translate(px, py + 0.18, pz - 0.2), M.body);
      }
    }

    // ---- キャノピー（金色の一体型バブル） ----
    const C = (z, w, top, base = 0.5) => ({ z, pts: symSection([[0, top], [w * 0.72, base + (top - base) * 0.82], [w, base + (top - base) * 0.25], [w * 0.95, base], [0, base - 0.05]], [3], 4) });
    add(loft([
      C(-6.5, 0.02, 0.6, 0.58), C(-5.7, 0.38, 1.0, 0.6), C(-4.6, 0.52, 1.27, 0.64),
      C(-3.6, 0.52, 1.3, 0.68), C(-2.7, 0.4, 1.14, 0.7), C(-2.0, 0.04, 0.84, 0.72),
    ], { rings: 30 }), M.glass);
    // フレーム（後端）
    add(loft([C(-2.72, 0.405, 1.15, 0.7), C(-2.64, 0.39, 1.13, 0.7)], { rings: 1 }), M.dark);
  },
  extra: null,
};

// パネルライン（F-22）：胴体の区切り、ギザギザのドア、主翼の動翼、RAM 前縁
F22.scheme.lines = [
  // 胴体の横断ライン
  ...[-7.8, -6.4, -2.4, 0.2, 2.6, 5.0, 7.0].map((z) => [[-1.9, z], [1.9, z]]),
  // 胴体の縦ライン
  [[-0.5, -8.5], [-0.6, 7.6]], [[0.5, -8.5], [0.6, 7.6]],
  [[-1.25, -2.0], [-1.25, 7.4]], [[1.25, -2.0], [1.25, 7.4]],
  // ギザギザ（のこぎり刃）のアクセスパネル
  [[-1.1, -1.0], [-0.8, -0.6], [-1.1, -0.2], [-0.8, 0.2], [-1.1, 0.6], [-0.8, 1.0]],
  [[1.1, -1.0], [0.8, -0.6], [1.1, -0.2], [0.8, 0.2], [1.1, 0.6], [0.8, 1.0]],
  // 主翼のフラッペロン・エルロン・前縁フラップ
  ...[-1, 1].flatMap((s) => [
    [[1.6 * s, 6.0], [3.9 * s, 5.6], [6.7 * s, 4.75]],
    [[3.9 * s, 5.6], [3.9 * s, 6.3]],
    [[1.9 * s, -0.7], [6.6 * s, 3.55]],
    [[2.6 * s, 1.5], [5.2 * s, 2.4], [5.2 * s, 4.0]],
    // 水平尾翼
    [[1.7 * s, 6.6], [4.3 * s, 8.8]],
  ]),
];
F22.scheme.extra = (g, P) => {
  // 前縁の RAM（暗いグレーの帯）
  g.strokeStyle = 'rgba(70,76,82,0.9)';
  g.lineWidth = 14;
  for (const s of [-1, 1]) {
    g.beginPath(); g.moveTo(P(1.5 * s), P(-1.4)); g.lineTo(P(6.8 * s), P(3.4)); g.stroke();
    g.beginPath(); g.moveTo(P(1.4 * s), P(6.0)); g.lineTo(P(4.45 * s), P(8.6)); g.stroke();
  }
  // 機首のレドーム（わずかに色違い）
  g.fillStyle = 'rgba(120,126,132,0.35)';
  g.beginPath(); g.ellipse(P(0), P(-8.6), 0.55 / 24 * 2048, 1.3 / 24 * 2048, 0, 0, Math.PI * 2); g.fill();
};

const SU57 = {
  stations: [[-3.6, -0.55, 1.8], [3.6, -0.55, 1.8], [-2.6, -0.62, 0.9], [2.6, -0.62, 0.9]],
  nav: [[-7.05, -0.05, 4.5], [7.05, -0.05, 4.5]],
  vapor: { tips: [[-7.05, -0.1, 4.6], [7.05, -0.1, 4.6]], wing: [[2.6, 0.35, -1.2], [6.9, -0.02, 3.6], [6.9, -0.02, 4.9], [2.6, 0.35, 5.5]] },
  nozzles: [[-1.45, -0.32, 9.05], [1.45, -0.32, 9.05]],
  flameShape: [1, 1],
  flameR: 0.46,
  scheme: {
    seed: 57,
    base: '#aebccb',
    patches: [['#7b93ad', 34, 1.9, true], ['#56616d', 26, 1.6, true], ['#c9d3dc', 14, 1.5, true]],
    panels: 70,
    lines: [],
    soot: [[-1.45, 8.6, 0.8, 1.6], [1.45, 8.6, 0.8, 1.6]],
  },
  build(add, M) {
    // ---- 中央胴体（機首〜テールスティング、チャイン付き） ----
    const S = (z, ...k) => ({ z, pts: symSection(chine(...k), [2], 4) });
    add(loft([
      S(-10.3, 0.0, [0.004, 0.0], [0.008, 0.0], [0.006, -0.004], [0.003, -0.006], -0.006),
      S(-9.4, 0.2, [0.15, 0.15], [0.27, -0.04], [0.19, -0.13], [0.1, -0.19], -0.2),
      S(-8.0, 0.44, [0.34, 0.36], [0.6, -0.06], [0.44, -0.3], [0.22, -0.42], -0.44),
      S(-6.3, 0.62, [0.47, 0.52], [0.82, -0.04], [0.64, -0.42], [0.32, -0.58], -0.6),
      S(-4.4, 0.72, [0.56, 0.62], [0.95, 0.0], [0.76, -0.46], [0.38, -0.64], -0.66),
      S(-2.0, 0.74, [0.62, 0.62], [1.0, 0.0], [0.8, -0.44], [0.4, -0.6], -0.62),
      S(1.5, 0.5, [0.56, 0.44], [0.9, 0.0], [0.72, -0.36], [0.36, -0.5], -0.52),
      S(5.5, 0.32, [0.42, 0.29], [0.66, 0.0], [0.52, -0.26], [0.26, -0.36], -0.38),
      S(8.6, 0.24, [0.24, 0.2], [0.38, 0.0], [0.3, -0.16], [0.15, -0.22], -0.23),
      S(9.9, 0.1, [0.1, 0.08], [0.16, 0.0], [0.12, -0.07], [0.06, -0.1], -0.1),
    ], { rings: 90 }), M.body);

    // ---- 揚力胴体（LEVCON〜テールブーム、平たい板） ----
    const B = (z, w, top, bot, edgeY = 0.0) => ({ z, pts: symSection([[0, top], [w * 0.55, top * 0.9], [w, edgeY], [w * 0.55, bot * 0.9], [0, bot]], [2], 4) });
    add(loft([
      B(-6.6, 0.5, 0.05, -0.1),
      B(-5.0, 1.15, 0.2, -0.25),
      B(-3.2, 1.9, 0.3, -0.34),
      B(-1.4, 2.65, 0.34, -0.38),
      B(2.0, 2.7, 0.34, -0.38),
      B(5.4, 2.55, 0.26, -0.34),
      B(8.0, 2.45, 0.2, -0.28),
      B(9.6, 2.3, 0.12, -0.18),
    ], { rings: 60 }), M.body);

    // ---- エンジンナセル（下面、台形の取り入れ口 → 丸いノズル） ----
    for (const sd of [-1, 1]) {
      const cx = 1.45 * sd;
      const T = (z, wt, wb, yt, yb) => ({ z, pts: polySection([[cx - wt, yt], [cx + wt, yt], [cx + wb, yb], [cx - wb, yb]], 3) });
      const Rn = (z, r, yc) => ({ z, pts: Array.from({ length: 12 }, (_, i) => { const a = 0.75 * Math.PI - (i / 12) * Math.PI * 2; return [cx + r * Math.cos(a), yc + r * Math.sin(a)]; }) });
      // 台形 12 点（各辺 3 分割）と丸 12 点の点数をそろえる
      const st = [
        T(-3.6, 0.5, 0.42, -0.1, -1.08),
        T(-2.4, 0.52, 0.46, -0.08, -1.08),
        T(0.0, 0.56, 0.5, -0.05, -1.0),
        Rn(4.0, 0.64, -0.54),
        Rn(7.6, 0.6, -0.46),
        Rn(8.4, 0.58, -0.34),
      ];
      add(loft(st, { rings: 40, capFront: false, capBack: true }), M.body);
      // 取り入れ口の奥
      add(loft([T(-3.3, 0.44, 0.37, -0.15, -1.02), T(-3.28, 0.44, 0.37, -0.15, -1.02)], { rings: 1, capFront: true, capBack: false }), M.dark);
      // 丸いノズル（推力偏向、ペタル状）
      const N = (z, r) => ({ z, pts: Array.from({ length: 20 }, (_, i) => { const a = -(i / 20) * Math.PI * 2 + Math.PI / 2; const rr = r * (i % 2 ? 0.97 : 1); return [cx + rr * Math.cos(a), -0.32 + rr * Math.sin(a)]; }) });
      add(loft([N(8.2, 0.6), N(8.6, 0.57), N(9.1, 0.5)], { rings: 6, capFront: true, capBack: false }), M.metal);
      add(loft([N(8.85, 0.45), N(8.87, 0.45)], { rings: 1, capFront: false, capBack: true }), M.nozzleIn);
    }

    for (const sd of [-1, 1]) {
      // ---- 主翼（前縁 48°） ----
      add(surface({ x: 2.4, y: 0.0, le: -1.6, te: 5.7 }, { x: 7.05, y: -0.1, le: 3.55, te: 5.0 }, { tRoot: 0.3, tTip: 0.07, spanSeg: 8, chordSeg: 12 }, sd), M.body);
      // ---- LEVCON（可動の前縁付け根） ----
      add(surface({ x: 0.8, y: 0.06, le: -5.4, te: -1.6 }, { x: 2.6, y: 0.02, le: -2.2, te: -1.3 }, { tRoot: 0.12, tTip: 0.05, spanSeg: 3, chordSeg: 6 }, sd), M.body);
      // ---- 水平尾翼（全遊動） ----
      add(surface({ x: 2.1, y: -0.02, le: 6.1, te: 9.5 }, { x: 5.05, y: -0.08, le: 8.75, te: 9.85 }, { tRoot: 0.16, tTip: 0.05, spanSeg: 5, chordSeg: 10 }, sd), M.body);
      // ---- 垂直尾翼（全遊動、外傾 26°、小さめ） ----
      add(fin([2.05, 0.3, 4.9], { chordRoot: 3.0, chordTip: 1.15, height: 2.45, sweepLE: 46 * DEG, cant: 26 * DEG, tRoot: 0.16 }, sd), M.body);
      // ---- 翼下パイロン ----
      for (const [px, py, pz] of SU57.stations.filter((st) => Math.sign(st[0]) === sd)) {
        add(new THREE.BoxGeometry(0.08, 0.3, 2.0).translate(px, py + 0.2, pz - 0.2), M.body);
      }
    }

    // ---- キャノピー ----
    const C = (z, w, top, base) => ({ z, pts: symSection([[0, top], [w * 0.72, base + (top - base) * 0.82], [w, base + (top - base) * 0.25], [w * 0.95, base], [0, base - 0.05]], [3], 4) });
    add(loft([
      C(-7.0, 0.02, 0.55, 0.53), C(-6.2, 0.34, 0.95, 0.58), C(-5.1, 0.47, 1.16, 0.64),
      C(-4.0, 0.46, 1.16, 0.68), C(-3.2, 0.32, 1.02, 0.71), C(-2.5, 0.03, 0.8, 0.73),
    ], { rings: 30 }), M.glass);
    // キャノピーの枠（前方の窓枠）
    add(loft([C(-6.05, 0.37, 0.99, 0.58), C(-5.95, 0.38, 1.01, 0.59)], { rings: 1 }), M.dark);
    // IRST（キャノピー前の球）
    const irst = new THREE.SphereGeometry(0.14, 12, 8);
    irst.translate(0.22, 0.47, -7.25);
    add(irst, M.glass);
  },
};

SU57.scheme.lines = [
  ...[-8.4, -6.8, -2.6, 0.6, 3.6, 6.4, 8.6].map((z) => [[-1.0, z], [1.0, z]]),
  [[-0.45, -9.0], [-0.3, 9.6]], [[0.45, -9.0], [0.3, 9.6]],
  ...[-1, 1].flatMap((s) => [
    [[2.6 * s, 4.9], [7.0 * s, 4.75]],               // フラッペロン
    [[4.8 * s, 4.85], [4.8 * s, 5.4]],
    [[2.7 * s, -1.2], [6.9 * s, 3.45]],              // 前縁フラップ
    [[0.9 * s, -5.0], [2.5 * s, -1.9]],              // LEVCON の境界
    [[1.5 * s, -2.0], [1.5 * s, 8.6]],               // ナセルの上
    [[2.4 * s, 6.8], [4.8 * s, 9.0]],                // 水平尾翼
    [[2.4 * s, -1.0], [2.5 * s, 9.4]],
  ]),
];
SU57.scheme.extra = (g, P) => {
  // 機首のレドーム（暗いグレー）
  g.fillStyle = 'rgba(70,80,92,0.85)';
  g.beginPath(); g.ellipse(P(0), P(-9.4), 0.7 / 24 * 2048, 1.2 / 24 * 2048, 0, 0, Math.PI * 2); g.fill();
  // 赤い星（翼上面）
  for (const s of [-1, 1]) {
    const cx = P(5.0 * s), cy = P(3.2), r = 0.6 / 24 * 2048;
    g.fillStyle = '#c8302a';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      const rr = i % 2 ? r * 0.42 : r;
      g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath(); g.fill();
  }
};

const TYPES = { f22: F22, su57: SU57 };
const texCache = {};

// ミサイルの搭載位置（自機 F-22、発射順）
export const MISSILE_STATIONS = F22.stations;

export function buildJet({ type = 'f22' } = {}) {
  const T = TYPES[type];
  const group = new THREE.Group();
  const tex = (texCache[type] ??= camoTexture(T.scheme));
  const M = {
    body: camoMaterial(tex, { envMap: envTex }),
    dark: new THREE.MeshStandardMaterial({ color: 0x15181b, metalness: 0.2, roughness: 0.9 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x4a4d50, metalness: 0.75, roughness: 0.42, envMap: envTex, envMapIntensity: 0.8 }),
    nozzleIn: new THREE.MeshStandardMaterial({ color: 0x16110e, metalness: 0.3, roughness: 0.8, emissive: 0xff4a0c, emissiveIntensity: 0 }),
    glass: new THREE.MeshStandardMaterial({
      color: type === 'f22' ? 0x6b5420 : 0x5a4a22, metalness: 0.95, roughness: 0.06,
      envMap: envTex, envMapIntensity: 1.4, transparent: true, opacity: 0.93,
    }),
  };

  // 同じマテリアルの部品はまとめて 1 メッシュに（折り目の角度で法線を分ける）
  const parts = new Map();
  const add = (geo, mat) => {
    if (geo.attributes.uv) geo.deleteAttribute('uv');
    if (geo.attributes.normal) geo.deleteAttribute('normal');
    const g = toCreasedNormals(geo, 40 * DEG);
    if (!parts.has(mat)) parts.set(mat, []);
    parts.get(mat).push(g);
  };
  T.build(add, M);
  for (const [mat, list] of parts) group.add(new THREE.Mesh(mergeGeometries(list), mat));

  // サイドワインダー（発射順に並べる）
  const aimMat = new THREE.MeshStandardMaterial({ color: 0xd8dadc, roughness: 0.6 });
  const aim = new THREE.Group();
  const bodyG = new THREE.CylinderGeometry(0.064, 0.064, 2.9, 10).rotateX(Math.PI / 2);
  aim.add(new THREE.Mesh(bodyG, aimMat));
  const noseG = new THREE.ConeGeometry(0.064, 0.22, 10).rotateX(-Math.PI / 2).translate(0, 0, -1.56);
  aim.add(new THREE.Mesh(noseG, new THREE.MeshStandardMaterial({ color: 0x556070, metalness: 0.6, roughness: 0.3 })));
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.26, 0.28).translate(0, 0.13, 1.25), aimMat);
    f.rotation.z = (i * Math.PI) / 2 + Math.PI / 4;
    aim.add(f);
  }
  const stations = T.stations.map(([x, y, z]) => {
    const m = aim.clone();
    m.position.set(x, y, z);
    group.add(m);
    return m;
  });

  // 航法灯（左 赤 / 右 緑）
  const navs = T.nav.map(([x, y, z], i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: i === 0 ? 0xff2020 : 0x20ff40 }));
    m.position.set(x, y, z);
    group.add(m);
    return m;
  });

  // アフターバーナーの炎
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xffa040, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const coreMat = flameMat.clone();
  coreMat.color.set(0x88aaff);
  const flames = T.nozzles.map(([x, y, z]) => {
    const cone = new THREE.ConeGeometry(T.flameR, 1, 16, 1, true);
    cone.rotateX(Math.PI / 2);     // 先端が +Z（後方）
    cone.translate(0, 0, 0.5);
    const fg = new THREE.Group();
    const inner = new THREE.Mesh(cone, coreMat);
    inner.scale.setScalar(0.6);
    fg.add(new THREE.Mesh(cone, flameMat), inner);
    fg.position.set(x, y, z);
    fg.userData.shape = T.flameShape;
    group.add(fg);
    return fg;
  });

  let time = 0;
  return {
    group,
    type,
    missileStations: T.stations,
    vapor: T.vapor,
    // 撃墜：焼け焦げた色に
    setScorched(on) {
      M.body.color.setScalar(on ? 0.28 : 1);
      M.glass.opacity = on ? 0.5 : 0.93;
    },
    // 残っているミサイルの数だけ表示（発射済みのステーションは空に）
    setMissiles(n) {
      stations.forEach((m, i) => { m.visible = i >= stations.length - n; });
    },
    update(ac, dt) {
      time += dt;
      const ab = Math.max(0, (ac.engine - 1) / (THROTTLE_AB_MAX - 1));
      for (const f of flames) {
        const flick = 0.9 + 0.1 * Math.sin(time * 60 + f.position.x * 10);
        const [sx, sy] = f.userData.shape;
        f.visible = ab > 0.02;
        f.scale.set(sx, sy, (1.5 + ab * 4.5) * flick);
      }
      // ノズル内の赤熱
      M.nozzleIn.emissiveIntensity = 1.6 * ab;          // 昼間の MIL では見えない。A/B で赤熱
      // 点滅（航法灯）
      const on = Math.sin(time * 6) > -0.3;
      for (const n of navs) n.visible = on;
    },
  };
}
