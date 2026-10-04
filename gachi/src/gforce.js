// G による視界の変化
//   プラス G：脳の血流が減る → 色が抜ける（グレーアウト）→ 視野が狭まる（トンネル視）→ 真っ暗（ブラックアウト）→ 失神（G-LOC）
//   マイナス G：顔に血がのぼって視界が赤くなる（レッドアウト）
//   耐性はすぐには尽きない：5G を超えた分だけ「負担」がたまり、4G 以下で回復する（G スーツ + L-1 呼吸法 相当）
//     7G を続けると 3 秒ほどで色が抜け始め約 11 秒、9G だと約 4 秒でブラックアウト
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class GEffects {
  constructor() {
    this.el = document.getElementById('gfx');
    this.canvas = document.querySelector('#app canvas');
    this.stress = 0;     // 0〜1（1 でブラックアウト）
    this.red = 0;        // レッドアウト 0〜1
    this.gloc = 0;       // 失神の残り時間（s）
  }

  reset() {
    this.stress = this.red = this.gloc = 0;
    this.apply();
  }

  get unconscious() { return this.gloc > 0; }

  update(dt, ac) {
    const nz = ac.crashed ? 1 : ac.t.nz ?? 1;
    if (this.gloc > 0) {
      this.gloc -= dt;
      if (this.gloc <= 0) this.stress = 0.75;   // 目が覚めても、しばらくは視界が暗い
    } else if (nz > 5) {
      this.stress += 0.035 * (nz - 5) ** 1.4 * dt;
    } else if (nz < 4) {
      this.stress -= (0.12 + 0.05 * (4 - nz)) * dt;
    }
    this.stress = clamp(this.stress, 0, 1);
    if (this.stress >= 1 && this.gloc <= 0) this.gloc = 4;    // G-LOC
    // マイナス G は速く効いて速く戻る
    this.red += (nz < -1.5 ? 0.5 * (-1.5 - nz) : -0.6) * dt;
    this.red = clamp(this.red, 0, 1);
    this.apply();
  }

  apply() {
    const s = this.gloc > 0 ? 1 : this.stress;
    const gray = clamp((s - 0.25) / 0.4, 0, 1);          // 色が抜ける
    const tunnel = clamp((s - 0.45) / 0.55, 0, 1);       // 視野が狭まる
    const dark = this.gloc > 0 ? 1 : tunnel ** 2;
    this.canvas.style.filter = gray > 0.01 || this.red > 0.01
      ? `grayscale(${gray.toFixed(2)}) brightness(${(1 - 0.5 * tunnel).toFixed(2)})` : '';
    if (s < 0.3 && this.red < 0.01) {
      this.el.style.opacity = 0;
      this.overlay = null;
      return;
    }
    // トンネル：中心は見え、周りから暗くなる
    const r0 = 70 - 62 * tunnel, r1 = r0 + 25;
    const redA = this.red * 0.75;
    const c0 = `rgba(${redA > 0 ? '120,0,0' : '0,0,0'},${(redA * 0.6).toFixed(2)})`;
    const c1 = `rgba(${redA > 0 ? '90,0,0' : '0,0,0'},${Math.max(dark, redA).toFixed(2)})`;
    this.overlay = this.gloc > 0 ? { black: true } : { r0, r1, c0, c1 };
    this.el.style.opacity = 1;
    this.el.style.background = this.gloc > 0
      ? '#000'
      : `radial-gradient(ellipse at 50% 50%, ${c0} ${r0.toFixed(0)}%, ${c1} ${r1.toFixed(0)}%)`;
  }

  // 撃墜クリップの録画用：#gfx と同じ暗がりをキャンバスに描く（CSS の ellipse farthest-corner に合わせる）
  paint(ctx, w, h) {
    const o = this.overlay;
    if (!o) return;
    if (o.black) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); return; }
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(1, h / w);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, (w / 2) * Math.SQRT2);
    g.addColorStop(Math.min(1, o.r0 / 100), o.c0);
    g.addColorStop(Math.min(1, o.r1 / 100), o.c1);
    ctx.fillStyle = g;
    ctx.fillRect(-w, -w, 2 * w, 2 * w);
    ctx.restore();
  }
}
