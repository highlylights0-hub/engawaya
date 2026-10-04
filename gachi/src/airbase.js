// 味方の基地：滑走路（標示・灯火）、誘導路、エプロン、かまぼこ型の格納庫、管制塔、駐機中の F-22
//   基地の座標系：u = 滑走路方向（離陸方向が +）、v = 右。グループを方位に回して置く（ローカル -Z = u、+X = v）
import * as THREE from 'three';
import { AIRFIELD } from './world.js';
import { buildJet } from './jet.js';

export function buildAirbase(scene) {
  const A = AIRFIELD;
  const g = new THREE.Group();
  g.position.set(A.x, A.elev, A.z);
  g.rotation.y = -A.hdg;
  // 基地座標 (u, v) → ローカル (x, z)
  const P = (u, v) => [v, -u];

  const flat = (w, l, color, u, v, y, rot = 0, mat) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2),
      mat ?? new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
    const [x, z] = P(u, v);
    m.position.set(x, y, z);
    m.rotation.y = rot;
    g.add(m);
    return m;
  };

  // ---- 滑走路 ----
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x3b3d40, roughness: 0.92, map: asphaltTexture() });
  asphalt.map.repeat.set(1, A.len / 60);
  flat(A.width + 6, A.len + 60, 0x55575a, 0, 0, 0.18);           // 路肩
  flat(A.width, A.len, 0, 0, 0, 0.25, 0, asphalt);

  // 標示（白）：中心線、縁の線、末端のピアノキー、接地帯
  const W = [];
  const mark = (u, v, w, l) => { const [x, z] = P(u, v); W.push(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2).translate(x, 0.3, z)); };
  for (let u = -A.len / 2 + 120; u < A.len / 2 - 120; u += 50) mark(u + 15, 0, 0.9, 30);
  for (const s of [-1, 1]) mark(0, s * (A.width / 2 - 1), 0.9, A.len - 20);
  for (const end of [-1, 1]) {
    const u0 = end * (A.len / 2 - 25);
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) mark(u0, s * (3.5 + i * 3.4), 1.8, 30);
    for (const du of [150, 300, 450]) for (const s of [-1, 1]) mark(end * (A.len / 2 - 100 - du), s * 7, 3, 22);
  }
  const white = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.8 });
  g.add(new THREE.Mesh(mergePlanes(W), white));
  // 滑走路番号（方位 / 10）
  const rwy = Math.round(((A.hdg * 180 / Math.PI) + 360) % 360 / 10) || 36;
  const opp = ((rwy + 17) % 36) + 1;
  numberPlate(g, P, String(rwy).padStart(2, '0'), -A.len / 2 + 70, 0);
  numberPlate(g, P, String(opp).padStart(2, '0'), A.len / 2 - 70, Math.PI);

  // ---- 誘導路とエプロン ----
  const taxiM = new THREE.MeshStandardMaterial({ color: 0x46484b, roughness: 0.93 });
  const TV = -190;
  flat(23, A.len - 200, 0, 0, TV, 0.22, 0, taxiM);
  for (const u of [-A.len / 2 + 100, 0, A.len / 2 - 100]) flat(23, -TV, 0, u, TV / 2, 0.21, Math.PI / 2, taxiM);
  flat(1100, 150, 0x7c7d7f, 0, -310, 0.2, Math.PI / 2);          // エプロン（コンクリート）
  const yellow = new THREE.MeshBasicMaterial({ color: 0xd8b52a });
  flat(0.35, A.len - 220, 0, 0, TV, 0.27, 0, yellow);

  // ---- かまぼこ型の格納庫 ----
  const hangarM = new THREE.MeshStandardMaterial({ color: 0x8b9294, roughness: 0.75, metalness: 0.2, side: THREE.DoubleSide });
  const doorM = new THREE.MeshStandardMaterial({ color: 0x5d6466, roughness: 0.8 });
  for (let i = 0; i < 5; i++) {
    const u = -440 + i * 220, v = -425;
    const geo = new THREE.CylinderGeometry(26, 26, 60, 28, 1, false, -Math.PI / 2, Math.PI).rotateZ(Math.PI / 2);
    geo.scale(1, 0.62, 1);
    const h = new THREE.Mesh(geo, hangarM);
    const [x, z] = P(u, v);
    h.position.set(x, 0, z);         // 円筒の軸はローカル X（= v 方向）、口はエプロン側
    g.add(h);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(40, 13), doorM);
    const [dx, dz] = P(u, v + 30.2);
    door.position.set(dx, 6.5, dz);
    door.rotation.y = Math.PI / 2;
    g.add(door);
  }

  // ---- 管制塔と建物 ----
  const conc = new THREE.MeshStandardMaterial({ color: 0xbdb9b0, roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x22323d, roughness: 0.15, metalness: 0.6 });
  const box = (w, h, l, m, u, v, y = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
    const [x, z] = P(u, v);
    b.position.set(x, y + h / 2, z);
    g.add(b);
    return b;
  };
  box(9, 30, 9, conc, 640, -360);
  box(14, 5, 14, glass, 640, -360, 30);
  box(15, 1, 15, conc, 640, -360, 35);
  box(60, 10, 30, conc, 560, -400);
  box(30, 7, 20, conc, -620, -380);
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 9, 18), new THREE.MeshStandardMaterial({ color: 0xd6d6d0, roughness: 0.7 }));
    const [x, z] = P(-700 - i * 20, -330);
    t.position.set(x, 4.5, z);
    g.add(t);
  }

  // ---- 灯火：滑走路の縁（白）、末端（緑）、終端（赤）、進入灯、管制塔の障害灯 ----
  const lights = { w: [], gr: [], r: [] };
  for (let u = -A.len / 2; u <= A.len / 2; u += 60) for (const s of [-1, 1]) lights.w.push([u, s * (A.width / 2 + 1.5), 0.6]);
  for (let v = -A.width / 2; v <= A.width / 2; v += 4) { lights.gr.push([-A.len / 2 - 2, v, 0.6]); lights.r.push([A.len / 2 + 2, v, 0.6]); }
  for (let k = 1; k <= 10; k++) for (let v = -6; v <= 6; v += 3) lights.w.push([-A.len / 2 - k * 30, v, 0.9]);
  lights.r.push([640, -360, 37]);
  for (const [key, color, size] of [['w', 0xfff2d8, 2.2], ['gr', 0x40ff70, 2.4], ['r', 0xff3020, 2.6]]) {
    const pos = new Float32Array(lights[key].length * 3);
    lights[key].forEach(([u, v, y], i) => { const [x, z] = P(u, v); pos.set([x, y, z], i * 3); });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.add(new THREE.Points(geo, new THREE.PointsMaterial({
      color, size, map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })));
  }

  // ---- 駐機中の F-22（2 機） ----
  for (const u of [-120, -60]) {
    const j = buildJet({ type: 'f22' });
    j.update({ gear: 1, engine: 0 }, 0);
    const [x, z] = P(u, -300);
    j.group.position.set(x, 2.5 + 0.2, z);
    j.group.rotation.y = -Math.PI / 2;     // 機首を滑走路へ
    g.add(j.group);
  }

  scene.add(g);
  return g;
}

function mergePlanes(list) {
  let n = 0;
  for (const p of list) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), idx = [];
  let o = 0;
  for (const p of list) {
    pos.set(p.attributes.position.array, o * 3);
    nrm.set(p.attributes.normal.array, o * 3);
    for (const i of p.index.array) idx.push(i + o);
    o += p.attributes.position.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  return geo;
}

function numberPlate(g, P, text, u, rot) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#e8e8e2';
  x.font = 'bold 150px Helvetica, Arial, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.save(); x.translate(64, 128); x.scale(0.55, 1.4); x.fillText(text, 0, 0); x.restore();
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 28).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, depthWrite: false }));
  const [px, pz] = P(u, 0);
  m.position.set(px, 0.31, pz);
  m.rotation.y = rot;
  g.add(m);
}

function asphaltTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const x = c.getContext('2d');
  const img = x.createImageData(64, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 200 + Math.random() * 55;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  // タイヤの跡（中央寄りの黒いすじ）
  x.fillStyle = 'rgba(40,40,40,0.25)';
  x.fillRect(22, 0, 20, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let _glow = null;
function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 32, 32);
  return (_glow = new THREE.CanvasTexture(c));
}
