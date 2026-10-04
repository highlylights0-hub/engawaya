// キーボード + ゲームパッド（PS4 DUALSHOCK 4 / 標準マッピング）入力
//
// PS4 の割り当て:
//   左スティック = ピッチ / ロール      右スティック = 視点
//   L1 / R1 = ラダー                    R2 / L2 = スロットル（MIL で R2 を押し込み続けると A/B）
//   × = 機関砲   ○ = ミサイル   □ = フレア（押し続けると連続）   △ = ターゲット切替
//   L3（左スティック押し込み）= G リミッター解除
//   R3 = カメラ切替   OPTIONS = 一時停止   SHARE = リスタート
//   十字↑ = HUD 表示切替   十字↓ = スピードブレーキ   十字← = 戦術レーダーの大きさ   タッチパッド = ヘルプ
import { THROTTLE_AB_MAX } from './flight.js';

const PREVENT = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab',
]);

// ボタン番号 → キーボードと同じイベントコード
const PAD_EVENTS = { 11: 'KeyC', 9: 'KeyP', 8: 'Enter', 12: 'KeyU', 13: 'KeyB', 17: 'KeyH', 3: 'KeyT', 1: 'KeyX', 2: 'KeyV', 14: 'Tab' };

const approach = (v, target, step) =>
  v < target ? Math.min(target, v + step) : Math.max(target, v - step);

const deadzone = (v, dz = 0.12) => (Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz));

export class Input {
  constructor() {
    this.keys = new Set();
    this.events = [];
    this.pitch = 0;      // + = 引く（機首上げ）
    this.roll = 0;       // + = 右ロール
    this.yaw = 0;        // + = 右ヨー
    this.throttle = 0.8; // 0..1 = アイドル〜MIL, 1..1.25 = A/B
    this.gOverride = false;
    this.gun = false;
    this.flare = false;  // フレアボタンを押している
    this.lookX = 0;      // 右スティックでの視点（-1..1）
    this.lookY = 0;
    this.invertPitch = false;
    this.abArmed = false;   // MIL の戻り止めを越えるには R を押し直す
    this.holdAtMil = false; // A/B から下げたときも MIL で一度止める
    this.abHold = 0;
    this.padName = null;
    this.prevButtons = [];

    addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.events.push(e.code);
        if (e.code === 'KeyR' && this.throttle >= 0.999) this.abArmed = true;
      }
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('gamepadconnected', (e) => { this.padName = e.gamepad.id; });
    addEventListener('gamepaddisconnected', () => { this.padName = null; });
  }

  down(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  consume() {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  setThrottle(v) {
    this.throttle = v;
    this.abArmed = v > 1;
  }

  update(dt) {
    // キーボード：押している間ゆっくり舵が入る
    let tp = (this.down('KeyS', 'ArrowDown') ? 1 : 0) - (this.down('KeyW', 'ArrowUp') ? 1 : 0);
    const tr = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    const ty = (this.down('KeyE') ? 1 : 0) - (this.down('KeyQ') ? 1 : 0);
    if (this.invertPitch) tp = -tp;
    this.pitch = approach(this.pitch, tp, (tp === 0 ? 5 : 1.8) * dt);
    this.roll = approach(this.roll, tr, (tr === 0 ? 6 : 3) * dt);
    this.yaw = approach(this.yaw, ty, (ty === 0 ? 5 : 2.5) * dt);

    let up = this.down('KeyR') ? 1 : 0;
    let dn = this.down('KeyF') ? 1 : 0;
    this.gOverride = this.down('KeyG');
    this.gun = this.down('Space');
    this.flare = this.down('KeyV');
    this.lookX = this.lookY = 0;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected);
    if (gp) {
      this.padName = gp.id;
      const btn = (i) => gp.buttons[i]?.pressed || false;
      const val = (i) => gp.buttons[i]?.value || 0;

      // スティック（入力があるときだけキーボードを上書き）
      const ax = deadzone(gp.axes[0] || 0), ay = deadzone(gp.axes[1] || 0);
      // スティックを大きく倒したら（中立に戻してからもう一度倒すたびに）PadAny
      if ((Math.abs(ax) > 0.5 || Math.abs(ay) > 0.5) && !this.padMoved) {
        this.padMoved = true;
        this.events.push('PadAny');
        // メニュー用：倒した向き
        this.events.push(Math.abs(ay) > Math.abs(ax) ? (ay < 0 ? 'PadUp' : 'PadDown') : (ax < 0 ? 'PadLeft' : 'PadRight'));
      } else if (Math.abs(ax) < 0.2 && Math.abs(ay) < 0.2) {
        this.padMoved = false;
      }
      if (ax) this.roll = Math.sign(ax) * ax * ax;   // 2乗カーブで中心付近を繊細に
      if (ay) this.pitch = (this.invertPitch ? -1 : 1) * Math.sign(ay) * ay * ay;
      if (btn(4) || btn(5)) this.yaw = (btn(5) ? 1 : 0) - (btn(4) ? 1 : 0);
      this.lookX = deadzone(gp.axes[2] || 0, 0.15);
      this.lookY = deadzone(gp.axes[3] || 0, 0.15);

      const r2 = val(7), l2 = val(6);
      up = Math.max(up, r2 > 0.05 ? r2 : 0);
      dn = Math.max(dn, l2 > 0.05 ? l2 : 0);
      // MIL で R2 を奥まで押し込み続けると A/B
      if (r2 > 0.92 && this.throttle >= 0.999) {
        this.abHold += dt;
        if (this.abHold > 0.3) this.abArmed = true;
      } else {
        this.abHold = 0;
      }

      if (btn(0)) this.gun = true;
      if (btn(2)) this.flare = true;
      if (btn(10)) this.gOverride = true;

      for (const [i, code] of Object.entries(PAD_EVENTS)) {
        if (btn(i) && !this.prevButtons[i]) this.events.push(code);
      }
      // メニュー用：ボタンを押した瞬間（Pad0 = × / Pad1 = ○ / Pad3 = △ / Pad12〜15 = 十字）
      for (let i = 0; i < gp.buttons.length; i++) {
        if (btn(i) && !this.prevButtons[i]) this.events.push(`Pad${i}`);
      }
      this.prevButtons = gp.buttons.map((b) => b.pressed);
    }

    // スロットル（MIL に戻り止め）
    if (dn < 0.05) this.holdAtMil = false;
    if (up > 0 && dn === 0) {
      let next = this.throttle + 0.45 * up * dt;
      if (this.throttle <= 1 && next > 1 && !this.abArmed) next = 1;
      this.throttle = Math.min(THROTTLE_AB_MAX, next);
    } else if (dn > 0 && up === 0) {
      let next = this.throttle - 0.45 * dn * dt;
      if (this.throttle > 1 && next <= 1) { next = 1; this.holdAtMil = true; }
      if (this.holdAtMil) next = Math.max(1, next);
      this.throttle = Math.max(0, next);
    }
    if (this.throttle < 1) this.abArmed = false;
  }
}
