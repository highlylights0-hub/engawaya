// F-22 のコクピット内部（コクピット視点のときだけ表示）
//   計器盤・グレアシールド・HUD コンバイナー・サイドコンソール
//   計器盤の 3 枚の MFD は CanvasTexture に描き、実際の戦況を表示する
//     左: SA（状況認識）… 自機中心の上から見た図。敵機・ミサイル・距離の輪
//     中: ENG … スロットル・A/B・速度・高度・G
//     右: SMS（兵装）… 機体の平面形にミサイルの残り、機関砲・フレアの数
import * as THREE from 'three';

const W = 1024, H = 320;
const SCR = [[40, 40, 300, 250], [362, 40, 300, 250], [684, 40, 300, 250]];   // 画面の位置 [x, y, w, h]
const GREEN = '#7dff8a', DIM = 'rgba(125,255,138,0.45)', AMB = '#ffcc33', RED = '#ff5040';
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

// 内装は別シーン：外の景色を描いたあと深度をクリアして重ねる（外板が計器盤を隠さないように）
export function buildCockpit(sunDir) {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x30302a, 1.1));
  const sun = new THREE.DirectionalLight(0xfff0dc, 1.6);
  sun.position.copy(sunDir ?? new THREE.Vector3(0.3, 0.8, -0.5)).multiplyScalar(10);
  scene.add(sun);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.85, metalness: 0.2 });
  const darker = new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.95 });
  // 画面は自発光（夜でも見える）。周りの金属枠もテクスチャに描く
  const panelMat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.6 });

  // コクピットの「たらい」：床と左右・前の内壁（内側から見るので BackSide）
  const tub = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.5, 1.9), new THREE.MeshStandardMaterial({ color: 0x353a40, roughness: 0.9, side: THREE.BackSide }));
  tub.position.set(0, 0.4, -4.35);
  group.add(tub);
  // キャノピーの縁（敷居）
  for (const sx of [-1, 1]) {
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 1.9), dark);
    sill.position.set(sx * 0.47, 0.66, -4.35);
    group.add(sill);
  }
  // 計器盤（目の 0.7m 前、少し上向きに傾ける）。カメラ（目）は機体座標 (0, 0.95, -4.4)
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.2875), panelMat);
  panel.position.set(0, 0.6, -5.06);
  panel.rotation.x = -0.35;
  group.add(panel);
  // グレアシールド（計器盤の上のひさし、細い）
  const glare = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.025, 0.16), darker);
  glare.position.set(0, 0.755, -5.16);
  group.add(glare);
  // HUD コンバイナー（2 本の細い支柱、ガラスは薄い緑）
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.18),
    new THREE.MeshBasicMaterial({ color: 0x88ffaa, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }),
  );
  glass.position.set(0, 0.92, -5.05);
  glass.rotation.x = -0.25;
  group.add(glass);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.17, 0.006), dark);
    post.position.set(sx * 0.112, 0.86, -5.07);
    post.rotation.x = -0.25;
    group.add(post);
  }
  // サイドコンソール（左：スロットル、右：サイドスティック）
  for (const sx of [-1, 1]) {
    const con = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.9), dark);
    con.position.set(sx * 0.36, 0.5, -4.55);
    group.add(con);
    const knobs = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.6), darker);
    knobs.position.set(sx * 0.36, 0.545, -4.55);
    group.add(knobs);
  }
  // スロットル（左）とスティック（右）のグリップ
  const thr = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.08), darker);
  thr.position.set(-0.34, 0.6, -4.62);
  group.add(thr);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.14, 8), darker);
  stick.position.set(0.34, 0.6, -4.55);
  group.add(stick);
  // 射出座席のヘッドレスト（振り向いたとき）
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.18), dark);
  seat.position.set(0, 1.0, -3.95);
  group.add(seat);

  let acc = 0;
  return {
    scene,
    group,
    // 外の景色の上に重ねて描く（同じカメラ）
    render(renderer, camera) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(scene, camera);
      renderer.autoClear = true;
    },
    thr,
    // d: { ac, combat }。0.15 秒ごとに描き直す
    update(dt, d) {
      // スロットルのグリップを前後に動かす
      thr.position.z = -4.55 - 0.12 * Math.min(1.25, d.ac.engine) / 1.25;
      acc -= dt;
      if (acc > 0) return;
      acc = 0.15;
      draw(ctx, d);
      tex.needsUpdate = true;
    },
  };
}

function frame(g, x, y, w, h, title) {
  g.fillStyle = '#020a05';
  g.fillRect(x, y, w, h);
  g.strokeStyle = DIM;
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  g.fillStyle = GREEN;
  g.font = 'bold 16px Menlo, Consolas, monospace';
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillText(title, x + 8, y + 6);
}

function draw(g, { ac, combat }) {
  // 金属の枠と押しボタン
  g.fillStyle = '#26292d';
  g.fillRect(0, 0, W, H);
  for (const [x, y, w, h] of SCR) {
    g.fillStyle = '#1a1c1f';
    g.fillRect(x - 16, y - 22, w + 32, h + 44);
    g.fillStyle = '#34383d';
    for (let i = 0; i < 5; i++) {
      const bx = x + 18 + i * ((w - 50) / 4);
      g.fillRect(bx, y - 16, 22, 10);
      g.fillRect(bx, y + h + 6, 22, 10);
    }
  }
  sa(g, SCR[0], ac, combat);
  eng(g, SCR[1], ac);
  sms(g, SCR[2], combat);
}

// 左：SA（上が機首方向、外周 20km）
function sa(g, [x, y, w, h], ac, cb) {
  frame(g, x, y, w, h, 'SA');
  const cx = x + w / 2, cy = y + h / 2 + 12, R = 100, RANGE = 20000;
  g.strokeStyle = DIM;
  for (const k of [0.25, 0.5, 1]) { g.beginPath(); g.arc(cx, cy, R * k, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = DIM;
  g.font = '11px Menlo, monospace';
  g.fillText('20', cx + R - 18, cy - 14);
  g.fillText('10', cx + R / 2 - 16, cy - 14);
  // 自機
  g.strokeStyle = GREEN;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(cx, cy - 8); g.lineTo(cx, cy + 7); g.moveTo(cx - 8, cy); g.lineTo(cx + 8, cy);
  g.stroke();
  g.lineWidth = 1;
  _q.copy(ac.quat).invert();
  const plot = (pos) => {
    _v.subVectors(pos, ac.pos).applyQuaternion(_q);
    const d = Math.hypot(_v.x, _v.z);
    const k = Math.min(1, d / RANGE) * R / Math.max(d, 1);
    return [cx + _v.x * k, cy + _v.z * k, d];
  };
  for (const e of cb.enemies) {
    if (!e.alive) continue;
    const [px, py] = plot(e.pos);
    const locked = e === cb.target;
    g.fillStyle = e.locked ? AMB : RED;
    // 敵機の向き（三角）
    _v.set(0, 0, -1).applyQuaternion(e.ac.quat).applyQuaternion(_q);
    const a = Math.atan2(_v.x, -_v.z);
    g.save();
    g.translate(px, py); g.rotate(a);
    g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(-6, 6); g.closePath(); g.fill();
    g.restore();
    if (locked) { g.strokeStyle = GREEN; g.strokeRect(px - 11, py - 11, 22, 22); }
  }
  for (const m of cb.missiles) {
    const [px, py] = plot(m.pos);
    g.fillStyle = m.owner === ac ? GREEN : RED;
    g.fillRect(px - 2, py - 2, 4, 4);
  }
}

// 中：エンジン・速度・高度
function eng(g, [x, y, w, h], ac) {
  frame(g, x, y, w, h, 'ENG');
  const t = ac.t;
  const thr = Math.min(1.25, ac.engine);
  // スロットルのバー（MIL の線、A/B は橙）
  const bx = x + 30, by = y + 40, bh = 170;
  g.strokeStyle = DIM;
  g.strokeRect(bx, by, 36, bh);
  const milY = by + bh * (1 - 1 / 1.25);
  const fillH = bh * thr / 1.25;
  g.fillStyle = thr > 1.001 ? '#ff9a3a' : GREEN;
  g.fillRect(bx + 3, by + bh - fillH, 30, fillH);
  g.strokeStyle = AMB;
  g.beginPath(); g.moveTo(bx - 6, milY); g.lineTo(bx + 42, milY); g.stroke();
  g.fillStyle = GREEN;
  g.font = '12px Menlo, monospace';
  g.fillText('MIL', bx + 46, milY - 7);
  g.fillText(thr > 1.001 ? 'A/B' : `${Math.round(thr * 100)}%`, bx, by + bh + 8);
  // 数値
  g.font = 'bold 20px Menlo, monospace';
  const rows = [
    ['KCAS', Math.round(t.kts ?? 0)],
    ['MACH', (t.mach ?? 0).toFixed(2)],
    ['ALT', Math.round((t.alt ?? 0) * 3.28084)],
    ['G', (t.nz ?? 1).toFixed(1)],
  ];
  rows.forEach(([k, v], i) => {
    g.fillStyle = DIM;
    g.font = '13px Menlo, monospace';
    g.fillText(k, x + 140, y + 44 + i * 48);
    g.fillStyle = k === 'G' && (t.nz ?? 1) > 7 ? AMB : GREEN;
    g.font = 'bold 22px Menlo, monospace';
    g.fillText(String(v), x + 140, y + 60 + i * 48);
  });
}

// 右：兵装（SMS）
function sms(g, [x, y, w, h], cb) {
  frame(g, x, y, w, h, 'SMS');
  const cx = x + w / 2, cy = y + 120;
  // 機体の平面形（簡略）
  g.strokeStyle = DIM;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(cx, cy - 80);
  g.lineTo(cx + 14, cy - 30); g.lineTo(cx + 100, cy + 30); g.lineTo(cx + 100, cy + 45);
  g.lineTo(cx + 22, cy + 55); g.lineTo(cx + 50, cy + 80); g.lineTo(cx + 18, cy + 82);
  g.lineTo(cx - 18, cy + 82); g.lineTo(cx - 50, cy + 80); g.lineTo(cx - 22, cy + 55);
  g.lineTo(cx - 100, cy + 45); g.lineTo(cx - 100, cy + 30); g.lineTo(cx - 14, cy - 30);
  g.closePath();
  g.stroke();
  // ミサイル（発射順：左外・右外・左内・右内）
  const st = [[-62, 30], [62, 30], [-42, 18], [42, 18]];
  const left = cb.missileCount;
  st.forEach(([sx, sy], i) => {
    const has = i >= st.length - left;
    g.fillStyle = has ? GREEN : 'rgba(125,255,138,0.15)';
    g.fillRect(cx + sx - 3, cy + sy - 18, 6, 34);
  });
  g.font = 'bold 18px Menlo, monospace';
  g.fillStyle = GREEN;
  g.textAlign = 'center';
  g.fillText(`${cb.missileSpec.name} ${left}`, cx, cy + 92);
  g.font = '15px Menlo, monospace';
  g.fillStyle = cb.gun.ammo === 0 ? AMB : GREEN;
  g.fillText(`GUN ${cb.gun.ammo}`, cx - 70, cy + 116);
  g.fillStyle = cb.flareCount < 10 ? AMB : GREEN;
  g.fillText(`FLR ${cb.flareCount}`, cx + 70, cy + 116);
  g.textAlign = 'left';
}
