// タイトル画面：作戦（ミッション）の一覧とブリーフィング。キーボード・マウス・PS コントローラーで選ぶ
//   ↑↓ / 十字・左スティック = 作戦を選ぶ   ←→ = 敵の腕前   Enter / × = 出撃   H / タッチパッド = 操作説明
import { MISSIONS, loadCleared } from './missions.js';
import { STRIKE } from './world.js';

const SKILL_KEYS = ['rookie', 'veteran', 'ace'];

export class Title {
  // o: { onStart(missionId), onHelp(), getSkill(), setSkill(key), isPad(), setPad(bool), heightAt }
  constructor(el, o) {
    this.el = el;
    this.o = o;
    this.list = el.querySelector('.tt-list');
    this.brief = el.querySelector('.tt-brief');
    this.map = el.querySelector('.tb-map');
    this.sel = 0;
    this.render();
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'pick') { this.sel = +b.dataset.i; this.update(); }
      else if (act === 'skill') { o.setSkill(b.dataset.skill); this.update(); }
      else if (act === 'kbd') { o.setPad(false); this.update(); }
      else if (act === 'pad') { o.setPad(true); this.update(); }
      else if (act === 'go') this.start();
      else if (act === 'help') o.onHelp();
    });
    el.addEventListener('dblclick', (e) => { if (e.target.closest('[data-act="pick"]')) this.start(); });
  }

  get open() { return !this.el.classList.contains('hidden'); }
  show(missionId) {
    const i = MISSIONS.findIndex((m) => m.id === missionId);
    if (i >= 0) this.sel = i;
    this.cleared = loadCleared();
    this.el.classList.remove('hidden');
    this.render();
  }
  hide() { this.el.classList.add('hidden'); }

  // 前の作戦をクリアしていれば選べる（作りかけの作戦は COMING SOON）
  unlocked(m) {
    if (m.soon) return false;
    if (m.camp !== 'OPERATION NEEDLE' || m.no <= 1) return true;
    const prev = MISSIONS.find((x) => x.camp === m.camp && x.no === m.no - 1);
    return !prev || this.cleared.has(prev.id);
  }

  start() {
    const m = MISSIONS[this.sel];
    if (!this.unlocked(m)) return;
    this.o.onStart(m.id);
  }

  // キー・パッドのイベント。処理したら true
  handle(code) {
    if (['ArrowUp', 'KeyW', 'PadUp', 'Pad12'].includes(code)) { this.sel = (this.sel + MISSIONS.length - 1) % MISSIONS.length; this.update(); }
    else if (['ArrowDown', 'KeyS', 'PadDown', 'Pad13'].includes(code)) { this.sel = (this.sel + 1) % MISSIONS.length; this.update(); }
    else if (['ArrowLeft', 'KeyA', 'PadLeft', 'Pad14', 'ArrowRight', 'KeyD', 'PadRight', 'Pad15'].includes(code)) {
      const d = ['ArrowLeft', 'KeyA', 'PadLeft', 'Pad14'].includes(code) ? -1 : 1;
      const i = SKILL_KEYS.indexOf(this.o.getSkill());
      this.o.setSkill(SKILL_KEYS[Math.max(0, Math.min(2, i + d))]);
      this.update();
    }
    else if (['Enter', 'Space', 'Pad0', 'Pad9'].includes(code)) this.start();
    else if (['KeyH', 'Pad17'].includes(code)) this.o.onHelp();
    else return false;
    return true;
  }

  render() {
    this.cleared ??= loadCleared();
    let html = '', camp = '';
    MISSIONS.forEach((m, i) => {
      if (m.camp !== camp) { camp = m.camp; html += `<div class="tt-camp">${camp}</div>`; }
      const st = m.soon ? 'COMING SOON' : !this.unlocked(m) ? 'LOCKED' : this.cleared.has(m.id) ? '✓ CLEARED' : 'NEW';
      html += `<button class="tt-m" data-act="pick" data-i="${i}">
        <span class="no">${m.no ? String(m.no).padStart(2, '0') : '◆'}</span>
        <span class="nm"><b>${m.code}</b><em>${m.title}</em></span>
        <i class="st ${st === 'NEW' ? 'new' : st.startsWith('✓') ? 'ok' : 'dim'}">${st}</i></button>`;
    });
    this.list.innerHTML = html;
    this.update();
  }

  update() {
    const m = MISSIONS[this.sel], open = this.unlocked(m);
    this.list.querySelectorAll('.tt-m').forEach((b) => {
      b.classList.toggle('on', +b.dataset.i === this.sel);
      b.classList.toggle('locked', !this.unlocked(MISSIONS[+b.dataset.i]));
    });
    const q = (s) => this.brief.querySelector(s);
    q('.tb-code').textContent = m.no ? `${m.camp} · MISSION ${String(m.no).padStart(2, '0')}` : m.camp;
    q('.tb-title').textContent = `${m.code}  ─  ${m.title}`;
    q('.tb-story').textContent = m.story;
    q('.tb-obj').innerHTML = m.objectives.map((x) => `<li>${x}</li>`).join('');
    q('.tb-tip').textContent = m.tips ? `TIPS ▸ ${m.tips}` : '';
    const go = q('[data-act="go"]');
    go.disabled = !open;
    go.textContent = m.soon ? 'COMING SOON ─ いま作っています' : !open ? 'LOCKED ─ 前の作戦をクリアすると選べます' : 'TAKE OFF ▶';
    for (const b of this.brief.querySelectorAll('[data-act="skill"]')) b.classList.toggle('on', b.dataset.skill === this.o.getSkill());
    const pad = this.o.isPad();
    q('[data-act="kbd"]').classList.toggle('on', !pad);
    q('[data-act="pad"]').classList.toggle('on', pad);
    this.el.classList.toggle('pad', pad);
    this.drawMap(m);
  }

  // 作戦地図：谷のまわりの地形（等高線風の濃淡）、谷の経路、出撃地点、目標
  drawMap(m) {
    const cv = this.map;
    cv.style.display = m.kind === 'ground' ? '' : 'none';
    if (m.kind !== 'ground') return;
    if (!this.mapImg) {
      const W = 190, H = 200;
      const x0 = -3500, x1 = 23500, z0 = -24000, z1 = 4500;
      const img = new ImageData(W, H);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const x = x0 + (x1 - x0) * i / W, z = z0 + (z1 - z0) * j / H;
        const h = this.o.heightAt(x, z);
        const k = (i + j * W) * 4;
        if (h < 0) { img.data[k] = 6; img.data[k + 1] = 24; img.data[k + 2] = 34; }
        else {
          const v = Math.min(1, h / 2400);
          const band = Math.abs(((h / 200) % 1) - 0.5) < 0.06 ? 0.35 : 0;   // 200m ごとの等高線
          img.data[k] = 8 + 30 * v; img.data[k + 1] = 30 + 110 * v + 60 * band; img.data[k + 2] = 14 + 30 * v;
        }
        img.data[k + 3] = 255;
      }
      this.mapImg = { img, x0, x1, z0, z1, W, H };
    }
    const M = this.mapImg;
    cv.width = M.W; cv.height = M.H;
    const g = cv.getContext('2d');
    g.putImageData(M.img, 0, 0);
    const P = (x, z) => [(x - M.x0) / (M.x1 - M.x0) * M.W, (z - M.z0) / (M.z1 - M.z0) * M.H];
    g.strokeStyle = 'rgba(111,231,255,0.8)';
    g.setLineDash([4, 3]);
    g.lineWidth = 1.5;
    g.beginPath();
    const [sx, sz] = P(STRIKE.start.pos.x, STRIKE.start.pos.z);
    g.moveTo(sx, sz);
    for (const p of STRIKE.canyon.filter((_, i) => i % 6 === 0)) g.lineTo(...P(p.x, p.z));
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#6fe7ff';
    g.beginPath(); g.moveTo(sx, sz - 6); g.lineTo(sx + 5, sz + 4); g.lineTo(sx - 5, sz + 4); g.closePath(); g.fill();
    const [bx, bz] = P(STRIKE.base.x, STRIKE.base.z);
    g.strokeStyle = '#ff6a50';
    g.lineWidth = 2;
    g.beginPath(); g.arc(bx, bz, 9, 0, Math.PI * 2); g.stroke();
    g.font = 'bold 11px Menlo, monospace';
    g.fillStyle = '#ff6a50';
    g.fillText(m.recon ? '?' : 'TGT', bx + 12, bz + 4);
    g.fillStyle = '#6fe7ff';
    g.fillText('BASE', sx - 8, sz + 16);
    g.fillStyle = 'rgba(185,255,196,0.7)';
    g.font = '10px Menlo, monospace';
    g.fillText('N▲', M.W - 22, 14);
    g.fillText('5 km', 8, M.H - 8);
    g.fillRect(8, M.H - 20, 5000 / (M.x1 - M.x0) * M.W, 2);
  }
}
