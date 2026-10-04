// 撃墜クリップ：敵を撃墜したら、その約 10 秒前からキルカメラが終わるまでを動画ファイルとして自動で保存する
//   画面（3D + HUD + G の視界 + キルカメラの枠）を 1 枚のキャンバスに合成し、ゲームの音と一緒に MediaRecorder で録る
//   MediaRecorder は「直前の N 秒」を切り出せないので、録画を STAGGER 秒ずつずらして重ねて回しておき、
//   撃墜したら PRE 秒以上前から回っていたもののうち一番新しいものを使う（前置きは PRE〜PRE+STAGGER 秒）
//   一時停止・ヘルプ中は録画も止める
const W = 1280;          // 出力の横幅（縦は画面の比率）
const FPS = 30;
const STAGGER = 8;       // 新しい録画を始める間隔（s）
const PRE = 8;           // 撃墜の何秒前から欲しいか
const POST = 5;          // 撃墜の何秒後まで録るか（キルカメラ 4.2 秒 + 余韻）
const MAX_AGE = PRE + STAGGER + 1;   // 使われなかった録画はこの長さで捨てる
const BITRATE = 8e6;

const MIMES_AV = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4',
  'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const MIMES_V = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4',
  'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export class ClipRecorder {
  // gl: 3D の canvas / hud: HUD の canvas / geff: GEffects / killcam: #killcam / sound: Sound / onSaved(name)
  constructor({ gl, hud, geff, killcam, sound, onSaved }) {
    Object.assign(this, { gl, hud, geff, killcamEl: killcam, sound, onSaved });
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.supported = typeof MediaRecorder !== 'undefined' && !!this.canvas.captureStream;
    this.enabled = this.supported;
    this.recs = [];          // 回している録画 { mr, chunks, start, mime, keep }
    this.pending = null;     // 保存待ち { rec, stopAt, label }
    this.t = 0;              // 録画している間だけ進む時計
    this.lastDraw = 0;
    this.saved = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.canvas.width = W;
    this.canvas.height = Math.round(W * innerHeight / innerWidth / 2) * 2;
    this.track = null;       // 大きさが変わったら次の録画から新しいトラックで
  }

  setEnabled(on) {
    this.enabled = on && this.supported;
    if (!this.enabled) {
      for (const r of this.recs) if (r !== this.pending?.rec) this.discard(r);
    }
  }

  // ---- 毎フレーム：録画の入れ替え・一時停止・保存 ----
  update(dt, halted) {
    if (!this.supported) return;
    for (const r of this.recs) {
      if (halted && r.mr.state === 'recording') r.mr.pause();
      else if (!halted && r.mr.state === 'paused') r.mr.resume();
    }
    if (halted) return;
    this.t += dt;
    if (this.pending && this.t >= this.pending.stopAt) this.save();
    if (!this.enabled) return;
    for (const r of [...this.recs]) {
      if (!r.keep && this.t - r.start > MAX_AGE) this.discard(r);
    }
    const last = this.recs[this.recs.length - 1];
    if (!last || this.t - last.start >= STAGGER) this.spawn();
  }

  spawn() {
    if (!this.track) {
      this.track = this.canvas.captureStream(FPS).getVideoTracks()[0];
      this.draw();
    }
    const tracks = [this.track];
    const audio = this.sound.captureTrack?.();
    if (audio) tracks.push(audio);
    const mime = (audio ? MIMES_AV : MIMES_V).find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    let mr;
    try {
      mr = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: BITRATE });
    } catch (err) {
      console.warn('clip recorder:', err);
      this.supported = this.enabled = false;
      return;
    }
    const r = { mr, chunks: [], start: this.t, mime: mr.mimeType || mime, keep: false };
    mr.ondataavailable = (e) => { if (e.data.size) r.chunks.push(e.data); };
    mr.start(1000);
    this.recs.push(r);
  }

  discard(r) {
    r.chunks = null;
    r.mr.ondataavailable = null;
    if (r.mr.state !== 'inactive') r.mr.stop();
    this.recs.splice(this.recs.indexOf(r), 1);
  }

  // ---- 撃墜した：PRE 秒以上前から回っている録画を選んで、POST 秒後に保存する ----
  kill(label) {
    if (!this.enabled) return;
    if (this.pending) {
      // 続けて撃墜したら、同じクリップを延ばす
      this.pending.stopAt = this.t + POST;
      this.pending.label = label;
      return;
    }
    if (!this.recs.length) return;
    const old = this.recs.filter((r) => this.t - r.start >= PRE);
    const rec = old.length ? old[old.length - 1] : this.recs[0];
    rec.keep = true;
    this.pending = { rec, stopAt: this.t + POST, label };
  }

  save() {
    const { rec, label } = this.pending;
    this.pending = null;
    this.recs.splice(this.recs.indexOf(rec), 1);
    rec.mr.onstop = () => {
      const blob = new Blob(rec.chunks, { type: rec.mime.split(';')[0] });
      if (!blob.size) return;
      const d = new Date(), p = (n) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
      const name = `gachi-kuusen_${stamp}_${label.trim().replace(/\s+/g, '-')}.${rec.mime.includes('mp4') ? 'mp4' : 'webm'}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      this.saved++;
      this.onSaved?.(name);
    };
    rec.mr.stop();
  }

  // ---- 描画のあとに呼ぶ：画面を合成キャンバスに写す（WebGL の絵は同じフレームの中でしか読めない） ----
  capture() {
    if (!this.recs.length) return;
    const now = performance.now();
    if (now - this.lastDraw < 1000 / FPS - 2) return;
    this.lastDraw = now;
    this.draw();
  }

  draw() {
    const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    ctx.filter = this.gl.style.filter || 'none';      // グレーアウト
    ctx.drawImage(this.gl, 0, 0, w, h);
    ctx.filter = 'none';
    if (this.hud.style.visibility !== 'hidden') ctx.drawImage(this.hud, 0, 0, w, h);
    this.geff.paint?.(ctx, w, h);                     // トンネル視・ブラックアウト・レッドアウト
    this.drawKillcamFrame(ctx, w / innerWidth);
    // 透かし
    ctx.font = `${Math.round(h * 0.022)}px Menlo, Consolas, monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('ガチ空戦 · engawaya.com', w - h * 0.02, h - h * 0.015);
  }

  // キルカメラの映像は 3D の canvas に入っている。枠と文字（HTML）だけ描き足す
  drawKillcamFrame(ctx, k) {
    const el = this.killcamEl;
    if (!el.classList.contains('show')) return;
    const r = el.getBoundingClientRect();
    const x = r.left * k, y = r.top * k, w = r.width * k, h = r.height * k;
    ctx.strokeStyle = 'rgba(125,255,138,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    const c = 14 * k, m = 4 * k;
    ctx.strokeStyle = '#7dff8a';
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    for (const [cx, cy, sx, sy] of [[x + m, y + m, 1, 1], [x + w - m, y + m, -1, 1], [x + m, y + h - m, 1, -1], [x + w - m, y + h - m, -1, -1]]) {
      ctx.moveTo(cx + sx * c, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * c);
    }
    ctx.stroke();
    ctx.font = `${Math.round(12 * k)}px Menlo, Consolas, monospace`;
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4 * k;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    if (performance.now() % 1000 < 500) {
      ctx.fillStyle = '#ff5040';
      ctx.fillText('● KILL CAM', x + 8 * k, y + 6 * k);
    }
    ctx.font = `bold ${Math.round(12 * k)}px Menlo, Consolas, monospace`;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#7dff8a';
    ctx.fillText(el.querySelector('.kc-label').textContent, x + w - 8 * k, y + h - 6 * k);
    ctx.shadowBlur = 0;
  }
}
