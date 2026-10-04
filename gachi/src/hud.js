// HUD（F/A-18 風のコンフォーマル表示）
// ピッチラダー・フライトパスマーカーは 3D の方向をカメラで投影して描くので、景色と一致する。
import * as THREE from 'three';

const DEG = Math.PI / 180;
const GREEN = '#7dff8a';
const GLOW = 'rgba(70,255,110,0.55)';
const AMBER = '#ffcc33';
const RED = '#ff4a3a';
const CYAN = '#6fe7ff';       // 目標地点（ステアポイント）

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _rv = new THREE.Vector3();
const _qInv = new THREE.Quaternion();



export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.visible = true;
    this.showData = false;
    this.tacMode = 'small';          // 戦術レーダー：small / large / off（Tab）
    this.trails = new Map();         // 機体 → 過去の位置（軌跡）
    this.trailT = 0;
    this.time = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = innerWidth * dpr;
    this.canvas.height = innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ワールド方向ベクトル → 画面座標（カメラの後ろなら null）
  proj(dir) {
    if (dir.dot(_camFwd) < 0.05) return null;
    _p.copy(this.camera.position).addScaledVector(dir, 1000).project(this.camera);
    return { x: (_p.x + 1) / 2 * this.W, y: (1 - _p.y) / 2 * this.H };
  }

  // 方位 az（北=0, 東=+）・ピッチ p（度）の方向を投影
  projAt(az, pDeg) {
    const p = pDeg * DEG;
    _d.set(Math.sin(az) * Math.cos(p), Math.sin(p), -Math.cos(az) * Math.cos(p));
    return this.proj(_d);
  }

  // ワールド座標の点 → 画面座標（追尾カメラでも機体と照準が正しく重なる）
  projPoint(pt) {
    _d.subVectors(pt, this.camera.position);
    if (_d.dot(_camFwd) < 0.5) return null;
    _p.copy(pt).project(this.camera);
    return { x: (_p.x + 1) / 2 * this.W, y: (1 - _p.y) / 2 * this.H };
  }

  draw(ac, state, camera, dt, combat) {
    this.time += dt;
    const g = this.ctx;
    const W = (this.W = innerWidth), H = (this.H = innerHeight);
    this.camera = camera;
    camera.getWorldDirection(_camFwd);
    g.clearRect(0, 0, W, H);
    const t = ac.t;
    if (t.speed === undefined) return;

    const u = Math.min(Math.max(H / 760, 0.8), 1.7);
    this.u = u;
    const C = { x: W / 2, y: H * 0.47 };
    const hw = Math.min(W * 0.24, H * 0.34), hh = H * 0.3;
    const box = { l: C.x - hw, r: C.x + hw, t: C.y - hh, b: C.y + hh };

    if (this.visible && !state.dead && !state.lookAway) {
      g.save();
      g.strokeStyle = g.fillStyle = GREEN;
      g.shadowColor = GLOW;
      g.shadowBlur = 4 * u;
      g.lineWidth = 1.6 * u;
      g.lineCap = 'round';
      g.font = `${13 * u}px Menlo, Consolas, monospace`;
      g.textBaseline = 'middle';

      // --- 景色に重なるもの（HUD 枠でクリップ） ---
      g.save();
      g.beginPath();
      g.rect(box.l, box.t, hw * 2, hh * 2);
      g.clip();
      this.drawLadder(ac);
      g.restore();

      this.drawWaterline(ac, box);
      this.drawFpm(ac, box);
      if (combat) this.drawCombat(ac, combat, box, C, hh);
      this.drawHeadingTape(t, C.x, box.t - 26 * u, hw * 1.5);
      if (combat?.waypoint) this.drawWaypointCaret(ac, combat.waypoint, C.x, box.t - 26 * u, hw * 1.5);
      this.drawSpeedTape(t, box.l - 18 * u, C.y, hh * 1.5);
      this.drawAltTape(t, box.r + 18 * u, C.y, hh * 1.5);
      this.drawBankScale(t, C.x, box.b - 24 * u, 54 * u);
      this.drawLeftData(ac, box.l - 18 * u, C.y + hh * 0.75 + 22 * u);
      this.drawRightData(ac, box.r + 18 * u, C.y + hh * 0.75 + 22 * u);
      g.restore();
    }

    if (combat && combat.hitFlash > 0) {
      // 被弾：画面の縁が赤く光る
      const a = Math.min(1, combat.hitFlash / 0.35) * 0.55;
      const grad = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
      grad.addColorStop(0, 'rgba(255,0,0,0)');
      grad.addColorStop(1, `rgba(255,30,10,${a})`);
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    }
    if (combat && !state.dead) {
      if (this.visible && !state.lookAway) this.drawRwr(combat, u);
      if (this.tacMode !== 'off') this.drawTactical(ac, combat, u, dt);
      this.drawMissileCue(combat, C, hh, u);
    }
    this.drawWarnings(ac, state, C.x, box.t + hh * 0.3, combat);
    if (ac.onGround && !state.dead) this.drawTakeoff(ac, C.x, C.y + hh * 0.62);
    if (this.showData) this.drawData(ac);
  }

  // ---------- ピッチラダー ----------
  drawLadder(ac) {
    const v = ac.vel;
    const hspd = Math.hypot(v.x, v.z);
    const az = hspd > 1
      ? Math.atan2(v.x, -v.z)
      : ac.t.heading * DEG;
    const fpPitch = Math.atan2(v.y, Math.max(hspd, 1e-3)) / DEG;

    for (let p = -85; p <= 85; p += 5) {
      if (Math.abs(p - fpPitch) > 35) continue;
      const c = this.projAt(az, p);
      const c2 = this.projAt(az, p + 0.5);
      if (!c || !c2) continue;
      let nx = c2.x - c.x, ny = c2.y - c.y;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;               // 画面上で「ピッチが上がる」向き
      const tx = -ny, ty = nx;          // ラダーの右向き
      this.drawRung(c, tx, ty, nx, ny, p);
    }
  }

  drawRung(c, tx, ty, nx, ny, p) {
    const g = this.ctx, u = this.u;
    const gap = (p === 0 ? 30 : 24) * u;
    const L = (p === 0 ? 170 : 50) * u;
    const tick = 9 * u;
    // 負のピッチは外端が水平線の方へ半角分傾く（F/A-18 の特徴）
    const drop = p < 0 ? L * Math.sin((-p / 2) * DEG) : 0;
    const tickDir = p > 0 ? -1 : 1; // 目盛りの爪は水平線の方向
    g.setLineDash(p < 0 ? [7 * u, 5 * u] : []);
    for (const s of [-1, 1]) {
      const ix = c.x + tx * gap * s, iy = c.y + ty * gap * s;
      const ox = c.x + tx * (gap + L) * s + nx * drop, oy = c.y + ty * (gap + L) * s + ny * drop;
      g.beginPath();
      g.moveTo(ix, iy);
      g.lineTo(ox, oy);
      if (p !== 0) {
        g.moveTo(ix, iy);
        g.lineTo(ix + nx * tick * tickDir, iy + ny * tick * tickDir);
      }
      g.stroke();
      if (p !== 0) {
        g.textAlign = 'center';
        g.fillText(String(Math.abs(p)), ox + tx * 16 * u * s, oy + ty * 16 * u * s);
      }
    }
    g.setLineDash([]);
  }

  // ---------- 機首方向（ウォーターライン） ----------
  drawWaterline(ac, box) {
    _d.set(0, 0, -1).applyQuaternion(ac.quat);
    const s = this.proj(_d);
    if (!s || s.x < box.l || s.x > box.r || s.y < box.t || s.y > box.b) return;
    const g = this.ctx, u = this.u;
    g.beginPath();
    g.moveTo(s.x - 22 * u, s.y);
    g.lineTo(s.x - 10 * u, s.y);
    g.lineTo(s.x - 5 * u, s.y + 8 * u);
    g.lineTo(s.x, s.y);
    g.lineTo(s.x + 5 * u, s.y + 8 * u);
    g.lineTo(s.x + 10 * u, s.y);
    g.lineTo(s.x + 22 * u, s.y);
    g.stroke();
  }

  // ---------- フライトパスマーカー（速度ベクトル） ----------
  drawFpm(ac, box) {
    if (ac.t.speed < 1) return;
    _d.copy(ac.vel).normalize();
    let s = this.proj(_d);
    const g = this.ctx, u = this.u;
    const m = 14 * u;
    let caged = false;
    if (!s) { s = { x: box.l + (box.r - box.l) / 2, y: box.b - m }; caged = true; }
    if (s.x < box.l + m || s.x > box.r - m || s.y < box.t + m || s.y > box.b - m) {
      s.x = Math.min(box.r - m, Math.max(box.l + m, s.x));
      s.y = Math.min(box.b - m, Math.max(box.t + m, s.y));
      caged = true;
    }
    const r = 7 * u;
    // HUD の枠（機体）基準でロールさせる：機体の右方向を投影して傾きを得る
    g.beginPath();
    g.arc(s.x, s.y, r, 0, Math.PI * 2);
    g.moveTo(s.x - r, s.y); g.lineTo(s.x - r - 13 * u, s.y);
    g.moveTo(s.x + r, s.y); g.lineTo(s.x + r + 13 * u, s.y);
    g.moveTo(s.x, s.y - r); g.lineTo(s.x, s.y - r - 9 * u);
    if (caged && Math.sin(this.time * 10) > 0) {
      g.moveTo(s.x - r * 1.4, s.y - r * 1.4); g.lineTo(s.x + r * 1.4, s.y + r * 1.4);
      g.moveTo(s.x + r * 1.4, s.y - r * 1.4); g.lineTo(s.x - r * 1.4, s.y + r * 1.4);
    }
    g.stroke();
  }

  // ---------- AIM-9X ----------
  drawMissileSymbology(ac, cb, box, C, inBox) {
    const g = this.ctx, u = this.u, sk = cb.seeker;
    if (sk.state !== 'off') {
      const r = 15 * u;
      let s = null;
      if (sk.state === 'lock' && cb.target) s = this.projPoint(cb.target.pos);
      if (sk.state === 'lock' && inBox(s)) {
        // ロック：シーカー円がターゲットに重なる（実線）
        g.beginPath();
        g.arc(s.x, s.y, r, 0, Math.PI * 2);
        g.stroke();
        if (sk.inRange) {
          if (Math.sin(this.time * 14) > -0.3) {
            g.textAlign = 'center';
            g.fillText('SHOOT', s.x, s.y + r + 14 * u);
          }
        }
      } else {
        // 探索中：機首方向の破線円
        _d.set(0, 0, -1).applyQuaternion(ac.quat);
        const b = this.proj(_d);
        if (inBox(b)) {
          g.setLineDash([4 * u, 4 * u]);
          g.beginPath();
          g.arc(b.x, b.y, r, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
        }
      }
      // ステータス（右側）
      g.textAlign = 'left';
      const x = box.r + 18 * u, y = C.y - (box.b - box.t) * 0.375 - 76 * u;
      if (sk.state === 'lock') {
        g.fillText(sk.inRange ? `IN RNG  TOF ${Math.round(sk.tof)}` : 'LOCK', x, y);
      }
    }
    // 飛行中ミサイルの到達予想時間
    const tti = cb.nearestTti();
    if (tti !== null) {
      g.textAlign = 'center';
      g.fillText(`TTI ${Math.ceil(tti)}`, C.x, box.b + 34 * u);
    }
  }

  // ---------- 機関砲・ターゲット ----------
  drawCombat(ac, cb, box, C, hh) {
    const g = this.ctx, u = this.u;
    const inBox = (s, m = 0) => s && s.x > box.l + m && s.x < box.r - m && s.y > box.t + m && s.y < box.b - m;

    // ガンクロス（砲身の向き）
    cb.gun.gunDir(ac, _d);
    const gc = this.proj(_d);
    if (inBox(gc)) {
      const a = 9 * u, gap = 3 * u;
      g.beginPath();
      g.moveTo(gc.x - a - gap, gc.y); g.lineTo(gc.x - gap, gc.y);
      g.moveTo(gc.x + gap, gc.y); g.lineTo(gc.x + a + gap, gc.y);
      g.moveTo(gc.x, gc.y - a - gap); g.lineTo(gc.x, gc.y - gap);
      g.moveTo(gc.x, gc.y + gap); g.lineTo(gc.x, gc.y + a * 0.6 + gap);
      g.stroke();
    }

    // 残弾
    g.textAlign = 'right';
    g.fillStyle = cb.gun.ammo === 0 ? AMBER : GREEN;
    g.fillText(cb.gun.ammo === 0 ? 'GUN XXX' : `GUN ${cb.gun.ammo}`, box.l - 18 * u, C.y - hh * 0.75 - 40 * u);
    g.fillStyle = cb.missileCount === 0 ? AMBER : GREEN;
    g.fillText(`9X ${cb.missileCount}`, box.l - 18 * u, C.y - hh * 0.75 - 22 * u);
    g.fillStyle = cb.flareCount === 0 ? AMBER : GREEN;
    g.fillText(`FLR ${cb.flareCount}`, box.l - 18 * u, C.y - hh * 0.75 - 4 * u);
    g.fillStyle = GREEN;

    // ロックしていない敵は小さなひし形
    for (const e of cb.gunTargets) {
      if (!e.alive || e === cb.target) continue;
      const es = this.projPoint(e.pos);
      if (!inBox(es)) continue;
      const b = 7 * u;
      g.beginPath();
      g.moveTo(es.x, es.y - b); g.lineTo(es.x + b, es.y); g.lineTo(es.x, es.y + b); g.lineTo(es.x - b, es.y);
      g.closePath();
      g.stroke();
    }

    // 敵の腕前・ウェーブ・残り機数
    g.textAlign = 'right';
    g.fillText(cb.statusText(), box.l - 18 * u, C.y - hh * 0.75 - 58 * u);

    this.drawMissileSymbology(ac, cb, box, C, inBox);

    // 自機の損傷
    const php = ac.hp;
    if (php < 100) {
      g.textAlign = 'center';
      g.fillStyle = php < 40 ? RED : AMBER;
      if (php >= 40 || Math.sin(this.time * 8) > -0.3) g.fillText(`DAMAGE ${Math.round(100 - php)}%`, C.x, box.b + 52 * u);
      g.fillStyle = GREEN;
    }

    const d = cb.target;
    if (d && d.alive && cb.sight) {
      const range = cb.sight.range;
      const ts = this.projPoint(d.pos);

      // ターゲット指示ボックス（TD box）
      if (inBox(ts)) {
        const b = 11 * u;
        g.strokeRect(ts.x - b, ts.y - b, b * 2, b * 2);
      } else {
        // ターゲットロケーターライン：HUD 中心からターゲットの方向へ
        _d.subVectors(d.pos, this.camera.position).applyQuaternion(_qInv.copy(this.camera.quaternion).invert());
        const ang = Math.atan2(-_d.y, _d.x);
        const off = Math.acos(Math.max(-1, Math.min(1, -_d.z / _d.length()))) / DEG;
        const L = 70 * u;
        const ex = C.x + Math.cos(ang) * L, ey = C.y + Math.sin(ang) * L;
        g.beginPath();
        g.moveTo(C.x + Math.cos(ang) * 20 * u, C.y + Math.sin(ang) * 20 * u);
        g.lineTo(ex, ey);
        g.stroke();
        g.textAlign = 'center';
        g.fillText(`${Math.round(off)}`, C.x + Math.cos(ang) * (L + 16 * u), C.y + Math.sin(ang) * (L + 16 * u));
      }

      // 距離・接近率
      _d.subVectors(d.pos, ac.pos).normalize();
      const vc = -_rv.subVectors(d.vel, ac.vel).dot(_d) * 1.94384;
      const ft = range * 3.28084;
      g.textAlign = 'left';
      g.fillText(ft < 6000 ? `${Math.round(ft / 10) * 10} FT` : `${(range / 1852).toFixed(1)} NM`, box.r + 18 * u, C.y - hh * 0.75 - 40 * u);
      g.fillText(`Vc ${Math.round(vc)}`, box.r + 18 * u, C.y - hh * 0.75 - 22 * u);

      // リード計算ピパー（射程 12000ft 以内）
      const R_MAX = 3658;
      if (range < R_MAX && inBox(ts)) {
        const ps = this.projPoint(cb.sight.pipper);
        if (ps) {
          const r = 26 * u;
          g.beginPath();
          g.arc(ps.x, ps.y, r, 0, Math.PI * 2);
          g.stroke();
          g.beginPath();
          g.arc(ps.x, ps.y, 2 * u, 0, Math.PI * 2);
          g.fill();
          // 距離バー：12時から時計回りに減っていく
          const frac = Math.min(1, range / R_MAX);
          g.save();
          g.lineWidth = 3 * u;
          g.beginPath();
          g.arc(ps.x, ps.y, r - 4 * u, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
          g.stroke();
          g.restore();
          // 有効射程の目盛り（約 3000ft）
          const th = -Math.PI / 2 + (914 / R_MAX) * Math.PI * 2;
          g.beginPath();
          g.moveTo(ps.x + Math.cos(th) * r, ps.y + Math.sin(th) * r);
          g.lineTo(ps.x + Math.cos(th) * (r + 6 * u), ps.y + Math.sin(th) * (r + 6 * u));
          g.stroke();
          // 射撃キュー
          if (ts && range < 1200 && Math.hypot(ts.x - ps.x, ts.y - ps.y) < r && Math.sin(this.time * 14) > -0.3) {
            g.textAlign = 'center';
            g.fillText('SHOOT', ps.x, ps.y - r - 14 * u);
          }
        }
      }
    }

    this.drawWaypoint(ac, cb, box, C, inBox);
    this.drawRecon(ac, cb, box, C);

    // メッセージ（FIGHT'S ON / SPLASH）
    if (cb.msgTime > 0 && cb.msg !== 'SHOT DOWN') {
      g.save();
      g.textAlign = 'center';
      g.font = `bold ${24 * u}px Menlo, Consolas, monospace`;
      g.fillText(cb.msg, C.x, box.t + hh * 0.35);
      g.restore();
    }
  }

  // ---------- 目標地点（ステアポイント）：◇ と距離。視野の外なら HUD の縁に矢印 ----------
  drawWaypoint(ac, cb, box, C, inBox) {
    const wp = cb.waypoint;
    if (!wp) return;
    const g = this.ctx, u = this.u;
    const dist = Math.hypot(wp.pos.x - ac.pos.x, wp.pos.z - ac.pos.z);
    const s = this.projPoint(wp.pos);
    g.save();
    g.strokeStyle = g.fillStyle = CYAN;
    if (inBox(s)) {
      const b = 9 * u;
      g.beginPath();
      g.moveTo(s.x, s.y - b); g.lineTo(s.x + b, s.y); g.lineTo(s.x, s.y + b); g.lineTo(s.x - b, s.y); g.closePath();
      g.moveTo(s.x, s.y + b); g.lineTo(s.x, s.y + b + 10 * u);
      g.stroke();
      g.textAlign = 'center';
      g.fillText(wp.label, s.x, s.y - b - 6 * u);
    } else {
      _d.subVectors(wp.pos, this.camera.position).applyQuaternion(_qInv.copy(this.camera.quaternion).invert());
      const ang = Math.atan2(-_d.y, _d.x);
      const r = Math.min(box.r - C.x, box.b - C.y) - 14 * u;
      const x = C.x + Math.cos(ang) * r, y = C.y + Math.sin(ang) * r;
      g.save();
      g.translate(x, y); g.rotate(ang);
      g.beginPath(); g.moveTo(10 * u, 0); g.lineTo(-4 * u, -7 * u); g.lineTo(-4 * u, 7 * u); g.closePath(); g.fill();
      g.restore();
    }
    g.textAlign = 'right';
    const nm = dist / 1852;
    g.fillText(`${wp.label} ${nm < 10 ? nm.toFixed(1) : Math.round(nm)} NM`, box.r + 120 * u, box.b + 34 * u);
    g.restore();
  }

  drawWaypointCaret(ac, wp, cx, y, width) {
    const g = this.ctx, u = this.u;
    const brg = (Math.atan2(wp.pos.x - ac.pos.x, -(wp.pos.z - ac.pos.z)) / DEG + 360) % 360;
    let dh = brg - ac.t.heading;
    dh = ((dh + 540) % 360) - 180;
    const x = cx + Math.max(-25, Math.min(25, dh)) * (width / 50);
    g.save();
    g.fillStyle = CYAN;
    g.beginPath(); g.moveTo(x, y + 3 * u); g.lineTo(x - 6 * u, y + 13 * u); g.lineTo(x + 6 * u, y + 13 * u); g.closePath(); g.fill();
    g.restore();
  }

  // ---------- 偵察ポッド：撮影できる条件と進み具合 ----------
  drawRecon(ac, cb, box, C) {
    const rc = cb.recon;
    if (!rc || rc.done || !rc.near) return;
    const g = this.ctx, u = this.u, t = ac.t;
    const y = box.b - 70 * u;
    g.save();
    g.textAlign = 'center';
    g.fillStyle = g.strokeStyle = rc.ok ? GREEN : AMBER;
    let hint = 'PHOTO WINDOW';
    if (t.agl > 1200) hint = 'DESCEND  < 1200 AGL';
    else if (Math.abs(t.bank) > 25 || Math.abs(t.pitch) > 25) hint = 'WINGS LEVEL';
    else if (!rc.ok) hint = 'OVERFLY TARGET';
    g.fillText(rc.ok ? '● REC' : `RECON  ${hint}`, C.x, y);
    const w = 120 * u, h = 8 * u;
    g.strokeRect(C.x - w / 2, y + 8 * u, w, h);
    g.fillRect(C.x - w / 2, y + 8 * u, w * Math.min(1, rc.prog / 1.2), h);
    g.restore();
  }

  // ---------- 方位テープ ----------
  drawHeadingTape(t, cx, y, width) {
    const g = this.ctx, u = this.u;
    const ppd = width / 50;
    g.save();
    g.beginPath();
    g.rect(cx - width / 2, y - 26 * u, width, 40 * u);
    g.clip();
    const h0 = Math.floor((t.heading - 30) / 5) * 5;
    g.textAlign = 'center';
    for (let h = h0; h <= t.heading + 30; h += 5) {
      const x = cx + (h - t.heading) * ppd;
      const major = ((h % 10) + 10) % 10 === 0;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y - (major ? 9 : 5) * u);
      g.stroke();
      if (major) {
        const hd = ((h % 360) + 360) % 360;
        g.fillText(String(hd / 10).padStart(2, '0'), x, y - 18 * u);
      }
    }
    g.restore();
    // 中央のキャレット + 数値
    g.beginPath();
    g.moveTo(cx, y + 2 * u);
    g.lineTo(cx - 5 * u, y + 10 * u);
    g.lineTo(cx + 5 * u, y + 10 * u);
    g.closePath();
    g.stroke();
    g.textAlign = 'center';
    g.fillText(String(Math.round(t.heading) % 360).padStart(3, '0'), cx, y + 22 * u);
  }

  // ---------- 速度テープ（左） ----------
  drawSpeedTape(t, xr, cy, h) {
    const g = this.ctx, u = this.u;
    const v = t.kts;
    const ppk = h / 120;
    g.save();
    g.beginPath();
    g.rect(xr - 70 * u, cy - h / 2, 72 * u, h);
    g.clip();
    g.beginPath();
    g.moveTo(xr, cy - h / 2);
    g.lineTo(xr, cy + h / 2);
    g.stroke();
    g.textAlign = 'right';
    for (let k = Math.floor((v - 70) / 10) * 10; k <= v + 70; k += 10) {
      if (k < 0) continue;
      const y = cy - (k - v) * ppk;
      const major = k % 50 === 0;
      g.beginPath();
      g.moveTo(xr, y);
      g.lineTo(xr - (major ? 10 : 6) * u, y);
      g.stroke();
      if (major) g.fillText(String(k), xr - 14 * u, y);
    }
    g.restore();
    this.readoutBox(xr - 64 * u, cy, 58 * u, String(Math.round(v)), 'right');
  }

  // ---------- 高度テープ（右） ----------
  drawAltTape(t, xl, cy, h) {
    const g = this.ctx, u = this.u;
    const a = t.alt * 3.28084;
    const ppf = h / 1400;
    g.save();
    g.beginPath();
    g.rect(xl - 2 * u, cy - h / 2, 80 * u, h);
    g.clip();
    g.beginPath();
    g.moveTo(xl, cy - h / 2);
    g.lineTo(xl, cy + h / 2);
    g.stroke();
    g.textAlign = 'left';
    for (let f = Math.floor((a - 800) / 100) * 100; f <= a + 800; f += 100) {
      const y = cy - (f - a) * ppf;
      const major = f % 500 === 0;
      g.beginPath();
      g.moveTo(xl, y);
      g.lineTo(xl + (major ? 10 : 6) * u, y);
      g.stroke();
      if (major) g.fillText(String(f), xl + 14 * u, y);
    }
    g.restore();
    this.readoutBox(xl + 6 * u, cy, 66 * u, String(Math.round(a / 10) * 10), 'left');
  }

  readoutBox(x, cy, w, text, align) {
    const g = this.ctx, u = this.u;
    const bh = 22 * u;
    const bx = align === 'right' ? x : x;
    g.clearRect(bx, cy - bh / 2, w, bh); // 背後の目盛りを消す
    g.strokeRect(bx, cy - bh / 2, w, bh);
    g.save();
    g.font = `bold ${15 * u}px Menlo, Consolas, monospace`;
    g.textAlign = 'center';
    g.fillText(text, bx + w / 2, cy + 1);
    g.restore();
  }

  // ---------- バンク角スケール（下） ----------
  drawBankScale(t, cx, cy, R) {
    const g = this.ctx, u = this.u;
    for (const a of [-45, -30, -20, -10, 0, 10, 20, 30, 45]) {
      const th = Math.PI / 2 + a * DEG;
      const len = (a === 0 || Math.abs(a) === 30 ? 10 : 6) * u;
      g.beginPath();
      g.moveTo(cx + Math.cos(th) * R, cy + Math.sin(th) * R);
      g.lineTo(cx + Math.cos(th) * (R + len), cy + Math.sin(th) * (R + len));
      g.stroke();
    }
    // 振り子のように「下」を指すポインタ
    const b = Math.max(-60, Math.min(60, t.bank));
    const th = Math.PI / 2 + b * DEG;
    const px = cx + Math.cos(th) * (R - 2 * u), py = cy + Math.sin(th) * (R - 2 * u);
    const ox = Math.cos(th), oy = Math.sin(th);
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px - ox * 10 * u - oy * 5 * u, py - oy * 10 * u + ox * 5 * u);
    g.lineTo(px - ox * 10 * u + oy * 5 * u, py - oy * 10 * u - ox * 5 * u);
    g.closePath();
    g.stroke();
  }

  // ---------- 左下：AOA / マッハ / G ----------
  drawLeftData(ac, xr, y) {
    const g = this.ctx, u = this.u, t = ac.t;
    g.textAlign = 'right';
    const line = 18 * u;
    g.fillText(`α ${(t.alpha / DEG).toFixed(1)}`, xr, y);
    g.fillText(`M ${t.mach.toFixed(2)}`, xr, y + line);
    if (ac.gear > 0) {
      g.save();
      g.fillStyle = ac.gear >= 1 ? GREEN : AMBER;
      g.fillText(ac.gear >= 1 ? 'GEAR DN' : 'GEAR', xr - 70 * u, y);
      g.restore();
    }
    const over = t.nz > t.gLimit + 0.3;
    if (!over || Math.sin(this.time * 12) > 0) {
      g.fillStyle = over ? RED : GREEN;
      g.fillText(`G ${t.nz.toFixed(1)}`, xr, y + line * 2);
      g.fillStyle = GREEN;
    }
    g.fillText(`${t.gPeak.toFixed(1)}`, xr, y + line * 3);
  }

  // ---------- 右下：電波高度 / 昇降率 / エンジン ----------
  drawRightData(ac, xl, y) {
    const g = this.ctx, u = this.u, t = ac.t;
    g.textAlign = 'left';
    const line = 18 * u;
    const agl = t.agl * 3.28084;
    if (agl < 5000) g.fillText(`R ${Math.round(agl / 10) * 10}`, xl, y);
    const vs = Math.round(t.vs * 196.85 / 10) * 10;
    g.fillText(`VS ${vs > 0 ? '+' : ''}${vs}`, xl, y + line);
    const thr = t.throttle > 1.001
      ? `AB ${Math.round(((t.throttle - 1) / 0.25) * 100)}%`
      : t.throttle > 0.995 ? 'MIL' : `${Math.round(t.throttle * 100)}%`;
    g.fillText(thr, xl, y + line * 2);
    if (ac.speedbrake) g.fillText('SPD BRK', xl, y + line * 3);
    if (t.gLimit > 7.5) g.fillText('G-LIM OVRD', xl, y + line * 4);
  }

  // ---------- 警告 ----------
  drawWarnings(ac, state, cx, y, cb) {
    const g = this.ctx, t = ac.t, u = this.u;
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold ${22 * u}px Menlo, Consolas, monospace`;
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 4;
    const blink = Math.sin(this.time * 9) > -0.2;
    const warn = (txt, col, flash) => {
      if (!flash || blink) { g.fillStyle = col; g.fillText(txt, cx, y); }
      y += 30 * u;
    };
    if (state.paused) warn('PAUSED', AMBER);
    if (ac.crashed) {
      warn(ac.hp <= 0 ? 'SHOT DOWN' : 'CRASHED', RED);
      g.font = `${16 * u}px Menlo, Consolas, monospace`;
      warn('Enter でリスタート', GREEN);
    } else {
      if (cb && cb.incoming.length) {
        const m = cb.incoming[0];
        g.save();
        g.font = `bold ${26 * u}px Menlo, Consolas, monospace`;
        if (Math.sin(this.time * 18) > -0.2) { g.fillStyle = RED; g.fillText('MISSILE', cx, y); }
        g.restore();
        y += 32 * u;
        // ミサイルの方向へブレーク（ビームに向ける）
        if (m.tti < 6) warn(m.bearing >= 0 ? 'BREAK RIGHT  ▶' : '◀  BREAK LEFT', AMBER);
      }
      if (!ac.onGround && t.agl < 300 && t.vs < -15 && t.agl / -t.vs < 8) warn('PULL UP', RED, true);
      if (t.stall) warn('STALL', RED, true);
      else if (t.aoaWarn) warn('AOA', AMBER);
      if (t.nz > t.gLimit + 0.3) warn('OVER-G', RED, true);
    }
    g.restore();
  }

  // ---------- 離陸の手順（地上にいる間） ----------
  drawTakeoff(ac, cx, y) {
    const g = this.ctx, u = this.u, t = ac.t;
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold ${17 * u}px Menlo, Consolas, monospace`;
    g.shadowColor = 'rgba(0,0,0,0.7)';
    g.shadowBlur = 4;
    const kt = Math.round(t.kts);
    let txt, col = GREEN;
    if (ac.brake) { txt = 'BRAKES ON  ▸  R / R2 でスロットルを MIL へ'; col = AMBER; }
    else if (t.speed < 72) txt = `TAKEOFF ROLL  ${kt} KT  ▸  もう一度 R / R2 押し込みで A/B`;
    else txt = `ROTATE  ${kt} KT  ▸  機首上げ（S / スティック手前）`;
    if (t.speed < 72 || Math.sin(this.time * 9) > -0.2) { g.fillStyle = col; g.fillText(txt, cx, y); }
    g.restore();
  }

  // ---------- 戦術レーダー（TAC）：右下。上から見た空域、機首方向が上 ----------
  //   敵機 = 向きの分かる三角 + 軌跡、敵の後方の扇形（ここに入れば背後を取った）、高度差、アスペクト
  drawTactical(ac, cb, u, dt) {
    const g = this.ctx;
    const big = this.tacMode === 'large';
    const S = (big ? 330 : 190) * u;                  // 一辺
    const x0 = this.W - S - 22 * u, y0 = this.H - S - 22 * u;
    const cx = x0 + S / 2, cy = y0 + S / 2 + S * 0.12;  // 自機は少し下寄り（前方を広く）
    const R = S * 0.44;

    // 自機の向き（水平）
    _d.set(0, 0, -1).applyQuaternion(ac.quat);
    const hdg = Math.atan2(_d.x, -_d.z);
    const ch = Math.cos(hdg), sh = Math.sin(hdg);
    // ワールド → 画面（機首が上）
    const toScr = (p, scale) => {
      const dx = p.x - ac.pos.x, dz = p.z - ac.pos.z;
      const right = dx * ch + dz * sh;               // 機首に対して右
      const fwd = dx * sh - dz * ch;                 // 機首方向
      return [cx + right * scale, cy - fwd * scale];
    };

    // 軌跡を 0.4 秒ごとに記録
    this.trailT -= dt;
    const alive = cb.enemies.filter((e) => e.alive);
    if (this.trailT <= 0) {
      this.trailT = cb.missiles.length ? 0.15 : 0.4;   // ミサイルが飛んでいる間は細かく
      for (const e of alive) {
        if (!this.trails.has(e)) this.trails.set(e, []);
        const tr = this.trails.get(e);
        tr.push(e.pos.clone());
        if (tr.length > 60) tr.shift();
      }
      for (const k of this.trails.keys()) if (k !== ac && !alive.includes(k) && !cb.missiles.includes(k)) this.trails.delete(k);
      // ミサイルの軌跡（自機 = 緑、敵 = 赤）
      for (const m of cb.missiles) {
        if (!this.trails.has(m)) this.trails.set(m, []);
        const tr = this.trails.get(m);
        tr.push(m.pos.clone());
        if (tr.length > 40) tr.shift();
      }
      if (!this.trails.has(ac)) this.trails.set(ac, []);
      const mine = this.trails.get(ac);
      mine.push(ac.pos.clone());
      if (mine.length > 60) mine.shift();
    }

    // 距離：一番近い敵が入る大きさに自動で（2 / 5 / 10 / 20 / 40 km）
    let near = Infinity;
    const gnd = cb.ground.filter((x) => x.alive);
    for (const e of [...alive, ...gnd]) near = Math.min(near, Math.hypot(e.pos.x - ac.pos.x, e.pos.z - ac.pos.z));
    const ranges = [2000, 5000, 10000, 20000, 40000];
    const range = ranges.find((r) => near * 1.15 < r) ?? 40000;
    const scale = R / range;

    g.save();
    // 背景
    g.fillStyle = 'rgba(0,12,4,0.55)';
    g.strokeStyle = 'rgba(125,255,138,0.45)';
    g.lineWidth = 1;
    g.beginPath(); g.rect(x0, y0, S, S); g.fill(); g.stroke();
    g.beginPath(); g.rect(x0, y0, S, S); g.clip();
    // 距離の輪
    g.setLineDash([3 * u, 4 * u]);
    for (const k of [0.5, 1]) { g.beginPath(); g.arc(cx, cy, R * k, 0, Math.PI * 2); g.stroke(); }
    g.setLineDash([]);
    g.font = `${10 * u}px Menlo, Consolas, monospace`;
    g.fillStyle = 'rgba(125,255,138,0.7)';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(`${range / 1000}km`, cx + R * 0.71 + 3 * u, cy - R * 0.71);
    g.fillText(`${range / 2000}km`, cx + R * 0.35 + 3 * u, cy - R * 0.35);

    // 軌跡（線。古いほど薄く）
    const trail = (list, rgb, last) => {
      if (!list || !list.length) return;
      g.lineWidth = 2 * u;
      let [px, py] = toScr(list[0], scale);
      for (let i = 1; i <= list.length; i++) {
        const [qx, qy] = i < list.length ? toScr(list[i], scale) : last;
        g.strokeStyle = `rgba(${rgb},${(0.1 + 0.6 * i / list.length).toFixed(2)})`;
        g.beginPath(); g.moveTo(px, py); g.lineTo(qx, qy); g.stroke();
        px = qx; py = qy;
      }
      g.lineWidth = 1;
    };
    trail(this.trails.get(ac), '125,255,138', [cx, cy]);

    // 目標地点
    if (cb.waypoint) {
      let [wx, wy] = toScr(cb.waypoint.pos, scale);
      const dx = wx - cx, dy = wy - cy, L = Math.hypot(dx, dy);
      if (L > R * 1.05) { wx = cx + dx / L * R * 1.05; wy = cy + dy / L * R * 1.05; }
      g.strokeStyle = g.fillStyle = CYAN;
      g.beginPath();
      g.moveTo(wx, wy - 6 * u); g.lineTo(wx + 6 * u, wy); g.lineTo(wx, wy + 6 * u); g.lineTo(wx - 6 * u, wy); g.closePath();
      g.stroke();
      g.textAlign = 'left';
      g.fillText(cb.waypoint.label, wx + 8 * u, wy - 8 * u);
    }

    // 対空砲：■ と機関砲の有効射程の輪（追尾されていたら赤く点滅）
    for (const x of gnd) {
      const [gx, gy] = toScr(x.pos, scale);
      const rr = x.spec.gunRange * scale;
      const hot = x.locked;
      g.setLineDash([4 * u, 4 * u]);
      g.strokeStyle = hot && Math.sin(this.time * 10) > 0 ? 'rgba(255,80,64,0.9)' : 'rgba(255,110,90,0.5)';
      g.fillStyle = hot ? 'rgba(255,60,40,0.12)' : 'rgba(255,110,90,0.05)';
      g.beginPath(); g.arc(gx, gy, rr, 0, Math.PI * 2); g.fill(); g.stroke();
      g.setLineDash([]);
      g.fillStyle = RED;
      g.fillRect(gx - 4.5 * u, gy - 4.5 * u, 9 * u, 9 * u);
      if (x === cb.target) { g.strokeStyle = GREEN; g.strokeRect(gx - 10 * u, gy - 10 * u, 20 * u, 20 * u); }
      g.fillStyle = 'rgba(255,200,190,0.9)';
      g.textAlign = 'left';
      g.fillText('AAA', gx + 9 * u, gy + 9 * u);
    }

    let status = null;
    for (const e of alive) {
      // 敵の向き（水平）
      _d.set(0, 0, -1).applyQuaternion(e.ac.quat);
      const eh = Math.atan2(_d.x, -_d.z) - hdg;      // 画面上の向き（上 = 0）
      const [ex, ey] = toScr(e.pos, scale);
      // 背後に入っているか（3D：敵の真後ろから 30° 以内・4km 以内）
      _rv.subVectors(ac.pos, e.pos);
      const dist = _rv.length();
      const aot = Math.acos(Math.max(-1, Math.min(1, -_d.dot(_rv) / dist)));   // 敵の尾部から見た角度
      const behind = aot < 30 * DEG && dist < 4000;
      // 後方の扇形（±30°、4km まで）
      const tailA = eh + Math.PI;
      const rr = Math.min(4000 * scale, R * 1.4);
      g.fillStyle = behind ? 'rgba(125,255,138,0.28)' : 'rgba(255,204,51,0.12)';
      g.strokeStyle = behind ? 'rgba(125,255,138,0.8)' : 'rgba(255,204,51,0.4)';
      g.beginPath();
      g.moveTo(ex, ey);
      g.arc(ex, ey, rr, tailA - Math.PI / 2 - 30 * DEG, tailA - Math.PI / 2 + 30 * DEG);
      g.closePath();
      g.fill(); g.stroke();
      trail(this.trails.get(e), '255,110,90', [ex, ey]);
      // 機体
      g.save();
      g.translate(ex, ey); g.rotate(eh);
      g.fillStyle = e.locked ? AMBER : RED;
      g.beginPath(); g.moveTo(0, -8 * u); g.lineTo(5.5 * u, 6 * u); g.lineTo(-5.5 * u, 6 * u); g.closePath(); g.fill();
      g.restore();
      if (e === cb.target) { g.strokeStyle = GREEN; g.strokeRect(ex - 10 * u, ey - 10 * u, 20 * u, 20 * u); }
      // 高度差（百 ft 単位）
      const dAlt = (e.pos.y - ac.pos.y) * 3.28084;
      g.fillStyle = 'rgba(255,200,190,0.9)';
      g.textAlign = 'left';
      g.fillText(`${dAlt >= 0 ? '+' : '−'}${(Math.abs(dAlt) / 1000).toFixed(1)}k`, ex + 9 * u, ey + 9 * u);
      if (e === cb.target || (!status && behind)) {
        const asp = aot < 50 * DEG ? 'TAIL' : aot < 130 * DEG ? 'BEAM' : 'HEAD';
        status = { behind, asp, dist };
      }
    }
    // ミサイル（軌跡つき）
    for (const m of cb.missiles) {
      const [mx, my] = toScr(m.pos, scale);
      trail(this.trails.get(m), m.owner === ac ? '125,255,138' : '255,80,64', [mx, my]);
      g.fillStyle = m.owner === ac ? GREEN : RED;
      g.fillRect(mx - 1.5 * u, my - 1.5 * u, 3 * u, 3 * u);
    }
    // 自機（中心）
    g.strokeStyle = GREEN;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx, cy - 9 * u); g.lineTo(cx, cy + 7 * u);
    g.moveTo(cx - 8 * u, cy); g.lineTo(cx + 8 * u, cy);
    g.moveTo(cx - 3.5 * u, cy + 7 * u); g.lineTo(cx + 3.5 * u, cy + 7 * u);
    g.stroke();
    g.restore();

    // 見出しと状態
    g.save();
    g.font = `bold ${11 * u}px Menlo, Consolas, monospace`;
    g.textBaseline = 'top';
    g.textAlign = 'left';
    g.fillStyle = GREEN;
    g.fillText('TAC', x0 + 6 * u, y0 + 5 * u);
    if (status) {
      g.textAlign = 'right';
      if (status.behind) {
        if (Math.sin(this.time * 8) > -0.3) { g.fillStyle = GREEN; g.fillText('BEHIND ◎', x0 + S - 6 * u, y0 + 5 * u); }
      } else {
        g.fillStyle = status.asp === 'HEAD' ? RED : AMBER;
        g.fillText(`ASPECT ${status.asp}`, x0 + S - 6 * u, y0 + 5 * u);
      }
    }
    g.textAlign = 'left';
    g.textBaseline = 'bottom';
    g.font = `${9 * u}px Menlo, Consolas, monospace`;
    g.fillStyle = 'rgba(125,255,138,0.6)';
    g.fillText('Tab: 大きさ', x0 + 6 * u, y0 + S - 4 * u);
    g.restore();
  }

  // ---------- RWR（レーダー警戒受信機）：左下の円形スコープ ----------
  //   上 = 機首方向。57 = Su-57 のレーダー（内側ほど近い）、ひし形 = ロック、M = ミサイル（MAWS）
  drawRwr(cb, u) {
    const g = this.ctx;
    const R = 62 * u;
    const cx = 26 * u + R, cy = this.H - 26 * u - R;
    g.save();
    g.fillStyle = 'rgba(0,12,4,0.45)';
    g.beginPath(); g.arc(cx, cy, R + 8 * u, 0, Math.PI * 2); g.fill();
    g.strokeStyle = g.fillStyle = GREEN;
    g.lineWidth = 1.2 * u;
    g.globalAlpha = 0.55;
    for (const k of [0.33, 0.66, 1]) { g.beginPath(); g.arc(cx, cy, R * k, 0, Math.PI * 2); g.stroke(); }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R);
      g.lineTo(cx + Math.sin(a) * (R + (i % 3 ? 4 : 8) * u), cy - Math.cos(a) * (R + (i % 3 ? 4 : 8) * u));
      g.stroke();
    }
    g.globalAlpha = 1;
    // 自機
    g.beginPath();
    g.moveTo(cx, cy - 6 * u); g.lineTo(cx, cy + 5 * u);
    g.moveTo(cx - 6 * u, cy); g.lineTo(cx + 6 * u, cy);
    g.moveTo(cx - 3 * u, cy + 5 * u); g.lineTo(cx + 3 * u, cy + 5 * u);
    g.stroke();
    g.font = `bold ${13 * u}px Menlo, Consolas, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const blink = Math.sin(this.time * 12) > -0.2;
    for (const c of cb.rwr) {
      const r = R * (0.3 + 0.62 * Math.min(1, c.range / 15000));
      const x = cx + Math.sin(c.bearing) * r, y = cy - Math.cos(c.bearing) * r;
      g.fillStyle = g.strokeStyle = c.locked ? AMBER : GREEN;
      g.fillText(c.sym ?? '57', x, y);
      if (c.locked && blink) {
        const b = 11 * u;
        g.beginPath();
        g.moveTo(x, y - b); g.lineTo(x + b, y); g.lineTo(x, y + b); g.lineTo(x - b, y); g.closePath();
        g.stroke();
      }
    }
    for (const t of cb.incoming) {
      const r = R * (0.18 + 0.75 * Math.min(1, t.tti / 12));
      const x = cx + Math.sin(t.bearing) * r, y = cy - Math.cos(t.bearing) * r;
      if (blink) { g.fillStyle = RED; g.fillText('M', x, y); }
    }
    g.fillStyle = GREEN;
    g.font = `${10 * u}px Menlo, Consolas, monospace`;
    g.fillText('RWR', cx, cy + R + 16 * u);
    g.restore();
  }

  // ---------- ミサイルの方向（画面中央の周りの赤い矢印） ----------
  drawMissileCue(cb, C, hh, u) {
    if (!cb.incoming.length) return;
    const g = this.ctx;
    g.save();
    g.strokeStyle = g.fillStyle = RED;
    g.lineWidth = 2.5 * u;
    for (const t of cb.incoming.slice(0, 3)) {
      const a = t.bearing;              // 上 = 機首方向
      const r0 = hh * 0.95, r1 = hh * 0.95 + 30 * u;
      const x0 = C.x + Math.sin(a) * r0, y0 = C.y - Math.cos(a) * r0;
      const x1 = C.x + Math.sin(a) * r1, y1 = C.y - Math.cos(a) * r1;
      g.globalAlpha = t.tti < 4 ? (Math.sin(this.time * 20) > 0 ? 1 : 0.35) : 0.85;
      g.beginPath();
      g.moveTo(x0, y0); g.lineTo(x1, y1);
      // 矢じり（外向き）
      const px = Math.cos(a), py = Math.sin(a);
      g.moveTo(x1 + px * 8 * u - Math.sin(a) * 10 * u, y1 + py * 8 * u + Math.cos(a) * 10 * u);
      g.lineTo(x1, y1);
      g.lineTo(x1 - px * 8 * u - Math.sin(a) * 10 * u, y1 - py * 8 * u + Math.cos(a) * 10 * u);
      g.stroke();
      g.font = `bold ${12 * u}px Menlo, Consolas, monospace`;
      g.textAlign = 'center';
      g.fillText(`${Math.ceil(t.tti)}`, C.x + Math.sin(a) * (r1 + 14 * u), C.y - Math.cos(a) * (r1 + 14 * u));
    }
    g.restore();
  }

  // ---------- デバッグ用の数値パネル（N キー） ----------
  drawData(ac) {
    const g = this.ctx, t = ac.t;
    g.save();
    g.font = '12px Menlo, Consolas, monospace';
    g.textBaseline = 'top';
    g.textAlign = 'left';
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(8, 8, 300, 150);
    g.fillStyle = '#d8ffe0';
    const rows = [
      `SPD ${t.kts.toFixed(0)} KT  ${t.speed.toFixed(0)} m/s  M${t.mach.toFixed(3)}`,
      `ALT ${t.alt.toFixed(0)} m  AGL ${t.agl.toFixed(0)} m`,
      `PIT ${t.pitch.toFixed(1)}  BNK ${t.bank.toFixed(1)}  HDG ${t.heading.toFixed(1)}`,
      `AOA ${(t.alpha / DEG).toFixed(2)}  β ${(t.beta / DEG).toFixed(2)}`,
      `Nz ${t.nz.toFixed(2)}  peak ${t.gPeak.toFixed(2)}  lim ${t.gLimit}`,
      `THR ${t.throttle.toFixed(2)}  ENG ${t.engine.toFixed(2)}`,
      `THRUST ${(t.thrust / 1000).toFixed(1)} kN`,
    ];
    rows.forEach((r, i) => g.fillText(r, 16, 16 + i * 19));
    g.restore();
  }
}
