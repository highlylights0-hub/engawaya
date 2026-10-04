import * as THREE from 'three';
import { createWorld, STRIKE } from './world.js';
import { buildBase } from './ground.js';
import { buildAirbase } from './airbase.js';
import { Aircraft } from './flight.js';
import { buildJet, initJetEnvironment } from './jet.js';
import { Input } from './input.js';
import { CameraRig } from './camera.js';
import { Hud } from './hud.js';
import { Gun } from './gun.js';
import { Combat } from './combat.js';
import { SKILLS } from './enemy.js';
import { MISSION_WAVES } from './combat.js';
import { MISSIONS, missionById, saveCleared } from './missions.js';
import { Title } from './title.js';
import { Effects } from './effects.js';
import { Sound } from './audio.js';
import { Wreck } from './wreck.js';
import { KillCam } from './killcam.js';
import { GEffects } from './gforce.js';
import { buildCockpit } from './cockpit.js';
import { ClipRecorder } from './recorder.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NoToneMapping;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 200000);

const world = createWorld(scene, renderer);
buildBase(scene, STRIKE.base, world.heightAt);   // 盆地の核開発基地
buildAirbase(scene);                             // 味方の基地（出撃・帰還）
initJetEnvironment(renderer);
const jet = buildJet({ type: 'f22' });
const cockpit = buildCockpit(world.sunDir);
scene.add(jet.group);

const fx = new Effects(scene, scene.fog);
const gun = new Gun(scene);
const ac = new Aircraft();
const sound = new Sound();
const combat = new Combat(scene, fx, world, ac, gun, jet, sound);
const wreck = new Wreck(scene, fx, sound);
const killcam = new KillCam();
const geff = new GEffects();

const input = new Input();
const rig = new CameraRig(camera, renderer.domElement);
const hud = new Hud(document.getElementById('hud'));
const help = document.getElementById('help');
const debrief = document.getElementById('debrief');
// 撃墜クリップ：撃墜の少し前からキルカメラまでを自動で動画保存（K で ON / OFF）
const clips = new ClipRecorder({
  gl: renderer.domElement, hud: hud.canvas, geff, killcam: killcam.el, sound,
  onSaved: () => showToast('🎬 撃墜クリップを保存しました（ダウンロード）', 3500),
});

const START = { pos: new THREE.Vector3(0, 3500, 58000), heading: 0, speed: 230, throttle: 0.8 };
function restart() {
  // 対地ミッションは谷の入口の手前から、低めの高度で
  // 対地ミッションは基地の滑走路から、エンジンはアイドル・ブレーキを踏んで
  const st = combat.mode === 'strike' ? { ...STRIKE.start, speed: 0, throttle: 0 } : START;
  ac.reset(st.pos, st.heading, st.speed, st.throttle, !!st.ground);
  input.setThrottle(st.throttle);
  rig.first = true;
  wreck.reset();
  killcam?.stop();
  geff?.reset();
  debrief.classList.add('hidden');
  state.dead = false;
  camera.fov = rig.mode === 'chase' ? 60 : 72;
  camera.updateProjectionMatrix();
  combat.reset();
}

function showToast(text, ms = 3000) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
}

// ゲームパッド接続のお知らせ
const toast = document.getElementById('toast');
let toastTimer = 0;
addEventListener('gamepadconnected', (e) => {
  showToast(`🎮 コントローラー接続: ${e.gamepad.id.replace(/\s*\(.*\)\s*$/, '')}`, 4000);
});
const state = { paused: false, cockpit: false, flown: false, dead: false, helpOpen: false, titleOpen: true };

// ---- コクピット風ヘルプ：開いている間はゲームの時間を止める ----
function openHelp() { help.classList.remove('hidden'); state.helpOpen = true; }
function closeHelp() {
  help.classList.add('hidden'); state.helpOpen = false; state.flown = true;
  // タイトルから開いた操作説明は、閉じるとタイトルに戻る
  if (state.helpFromTitle) { state.helpFromTitle = false; openTitle(); }
}
function setHelpMode(pad) { help.classList.toggle('pad', pad); help.classList.toggle('kbd', !pad); syncHelp(); }
function syncHelp() {
  for (const b of help.querySelectorAll('[data-act="skill"]')) b.classList.toggle('on', b.dataset.skill === combat.skillKey);
  const d = combat.def;
  help.querySelector('.ck-ufd-title span').textContent = `GACHI KUSEN · ${d.code}`;
  help.querySelector('.ck-ufd-msn').textContent = `MISSION ▸ ${d.objectives.join(' → ')}`;
  help.querySelector('[data-act="kbd"]').classList.toggle('on', !help.classList.contains('pad'));
  help.querySelector('[data-act="pad"]').classList.toggle('on', help.classList.contains('pad'));
}
help.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'skill') { combat.setSkill(b.dataset.skill); syncHelp(); }
  else if (act === 'title') { state.helpFromTitle = false; help.classList.add('hidden'); state.helpOpen = false; openTitle(); }
  else if (act === 'kbd') setHelpMode(false);
  else if (act === 'pad') setHelpMode(true);
  else if (act === 'start') closeHelp();
});
addEventListener('gamepadconnected', () => { setHelpMode(true); title.update(); });

// ---- タイトル（作戦選択） ----
const title = new Title(document.getElementById('title'), {
  heightAt: world.heightAt,
  getSkill: () => combat.skillKey,
  setSkill: (k) => { combat.setSkill(k); syncHelp(); },
  isPad: () => help.classList.contains('pad'),
  setPad: (p) => setHelpMode(p),
  onStart: (id) => startMission(id),
  onHelp: () => { title.hide(); state.titleOpen = false; state.helpFromTitle = true; openHelp(); },
});
function openTitle() {
  debrief.classList.add('hidden');
  title.show(combat.missionId);
  state.titleOpen = true;
}
function startMission(id) {
  combat.missionId = id;
  title.hide();
  state.titleOpen = false;
  state.helpFromTitle = false;
  help.classList.add('hidden');
  state.helpOpen = false;
  state.flown = true;
  restart();
  syncHelp();
}

// ---- デブリーフィング ----
function showDebrief() {
  const st = combat.stats, ok = combat.mission.state === 'complete';
  const r = combat.rating();
  const mm = Math.floor(st.time / 60), ss = Math.floor(st.time % 60);
  const t = debrief.querySelector('.db-title');
  t.textContent = ok ? 'MISSION COMPLETE' : 'MISSION FAILED';
  t.classList.toggle('fail', !ok);
  const strike = combat.mode === 'strike', d = combat.def, rc = combat.recon;
  debrief.querySelector('.db-sub').textContent = strike
    ? `${d.camp} ${String(d.no).padStart(2, '0')} ${d.code}  ·  THREAT ${combat.skill.name}`
    : `${d.camp} ${d.code}  ·  THREAT ${combat.skill.name}  ·  WAVE ${combat.wave} / ${MISSION_WAVES}`;
  const rows = [
    ...(rc ? [['偵察写真 RECON', rc.done ? '✓ 撮影' : '✗ 未撮影']] : []),
    ...(strike ? [['帰還 RTB', ok ? '✓ 帰還' : '✗']] : []),
    strike ? ['撃破 DESTROYED', `${combat.kills} / ${combat.ground.length}`] : ['撃墜 KILLS', combat.kills],
    ['飛行時間 TIME', `${mm}:${String(ss).padStart(2, '0')}`],
    ['機関砲 GUN', `${st.gunHits} 命中 / ${st.gunRounds} 発（${Math.round(r.acc * 100)}%）`],
    ['ミサイル AIM-9X', `${st.mslHits} 命中 / ${st.mslFired} 発`],
    ['フレア FLARES', st.flares],
    ['被弾 DAMAGE', `${Math.round(st.damage)}%`],
  ];
  debrief.querySelector('.db-stats').innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  debrief.querySelector('.db-grade b').textContent = r.grade;
  debrief.querySelector('.db-grade em').textContent = `${r.score} PTS`;
  const img = debrief.querySelector('.db-photo');
  img.classList.toggle('show', !!rc?.photo);
  if (rc?.photo) img.src = rc.photo;
  if (ok) saveCleared(d.id);
  debrief.querySelector('[data-act="next"]').classList.toggle('hidden', !nextMission());
  debrief.classList.remove('hidden');
}
// クリアした作戦の次（作りかけでなければ）
function nextMission() {
  if (combat.mission.state !== 'complete') return null;
  const d = combat.def;
  const n = MISSIONS.find((m) => m.camp === d.camp && m.no === d.no + 1);
  return n && !n.soon ? n : null;
}
function debriefAct(act) {
  if (act === 'again') restart();
  else if (act === 'next') { const n = nextMission(); if (n) startMission(n.id); }
  else if (act === 'title') openTitle();
}
debrief.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b) debriefAct(b.dataset.act);
});

// ---- 偵察写真：機体の真下を撮って、白黒の写真にする ----
const photoCam = new THREE.PerspectiveCamera(55, 1.5, 1, 20000);
function capturePhoto() {
  const W = 480, H = 320;
  photoCam.position.copy(ac.pos);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ac.quat).setY(0).normalize();
  photoCam.up.copy(fwd);
  photoCam.lookAt(ac.pos.x, ac.pos.y - 100, ac.pos.z);
  const vis = jet.group.visible;
  jet.group.visible = false;
  renderer.setScissorTest(true);
  renderer.setScissor(0, 0, W, H);
  renderer.setViewport(0, 0, W, H);
  renderer.render(scene, photoCam);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const pr = renderer.getPixelRatio(), el = renderer.domElement;
  g.filter = 'grayscale(1) contrast(1.35) brightness(1.05)';
  g.drawImage(el, 0, el.height - H * pr, W * pr, H * pr, 0, 0, W, H);
  g.filter = 'none';
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
  jet.group.visible = vis;
  // 写真の枠と記録
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(W / 2 - 18, H / 2); g.lineTo(W / 2 + 18, H / 2); g.moveTo(W / 2, H / 2 - 18); g.lineTo(W / 2, H / 2 + 18); g.stroke();
  for (const [x, y, dx, dy] of [[12, 12, 1, 1], [W - 12, 12, -1, 1], [12, H - 12, 1, -1], [W - 12, H - 12, -1, -1]]) {
    g.beginPath(); g.moveTo(x + dx * 24, y); g.lineTo(x, y); g.lineTo(x, y + dy * 24); g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.font = '12px Menlo, monospace';
  const t = combat.stats.time, d = combat.def;
  g.fillText(`${d.code}  FRAME 0042  T+${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`, 20, 30);
  g.fillText(`ALT ${Math.round(ac.t.agl * 3.28)} FT AGL  HDG ${String(Math.round(ac.t.heading)).padStart(3, '0')}`, 20, H - 20);
  combat.recon.photo = c.toDataURL('image/jpeg', 0.85);
  showToast('📷 偵察写真を撮影しました ─ 帰還せよ（RTB）', 3500);
}
syncHelp();
restart();
help.classList.add('hidden');      // 起動時はタイトル（作戦選択）から
title.show(combat.missionId);
const FLIGHT_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'KeyR', 'KeyX', 'KeyV', 'PadAny',
]);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const PHYS_DT = 1 / 120;
let flareHold = 0;
let acc = 0;
const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  // デバッグ: __game.freeze = true で実時間の進行を止める（step() だけで進める）
  if (window.__game?.freeze) { renderer.render(scene, camera); if (cockpit.group.visible) cockpit.render(renderer, camera); killcam.render(renderer, scene); }
  else tick(dt, true);
  requestAnimationFrame(frame);
}

function tick(dt, render) {
  const halted = state.paused || state.helpOpen || state.titleOpen;
  input.update(halted ? 0 : dt);
  for (const code of input.consume()) {
    // タイトル：作戦選択だけ
    if (state.titleOpen) { title.handle(code); continue; }
    // デブリーフィング：× / Enter = もう一度、△ / N = 次の作戦、○ / Esc = 作戦選択
    if (!debrief.classList.contains('hidden')) {
      if (code === 'Enter' || code === 'Pad0') debriefAct('again');
      else if (code === 'KeyN' || code === 'Pad3') debriefAct('next');
      else if (code === 'Escape' || code === 'Pad1') debriefAct('title');
      continue;
    }
    if (code === 'Escape') { openTitle(); continue; }
    // ヘルプ表示中に操縦したらヘルプを閉じて再開（そのキーの動作はしない）
    if (state.helpOpen && FLIGHT_KEYS.has(code)) { closeHelp(); continue; }
    if (code === 'KeyX' || code === 'KeyM') { if (!state.paused) combat.fireMissile(); }
    else if (code === 'KeyV') { if (!state.paused) { combat.flareProgram(2); flareHold = 0; } }
    else if (code === 'KeyC') { rig.toggle(); state.cockpit = rig.mode === 'cockpit'; }
    else if (code === 'KeyP') state.paused = !state.paused;
    else if (code === 'Enter') restart();
    else if (code === 'KeyB') ac.speedbrake = !ac.speedbrake;
    else if (code === 'KeyH') { if (state.helpOpen) closeHelp(); else openHelp(); }
    else if (code === 'KeyI') input.invertPitch = !input.invertPitch;
    else if (code === 'KeyU') hud.visible = !hud.visible;
    else if (code === 'KeyN') hud.showData = !hud.showData;
    else if (code === 'KeyK') {
      clips.setEnabled(!clips.enabled);
      showToast(!clips.supported ? 'このブラウザでは録画できません' : `🎬 撃墜クリップの自動保存: ${clips.enabled ? 'ON' : 'OFF'}`);
    }
    else if (code === 'Tab') hud.tacMode = { small: 'large', large: 'off', off: 'small' }[hud.tacMode];
    else if (code === 'KeyT') combat.cycleTarget();
    else if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3') {
      const key = { Digit1: 'rookie', Digit2: 'veteran', Digit3: 'ace' }[code];
      combat.setSkill(key);
      syncHelp();
      showToast(`敵の腕前: ${SKILLS[key].name}`);
    }
  }

  // フレアボタンを押し続けると 0.5 秒ごとに 2 発
  if (input.flare && !halted) {
    flareHold += dt;
    if (flareHold > 0.5) { combat.flareProgram(2); flareHold = 0; }
  }

  if (!halted) {
    acc += dt;
    // G-LOC（失神）中は操縦できない
    if (geff.unconscious) { input.pitch = 0; input.roll = 0; input.yaw = 0; input.gun = false; }
    while (acc >= PHYS_DT) {
      ac.update(PHYS_DT, input, world.heightAt);
      combat.step(PHYS_DT, input.gun);
      acc -= PHYS_DT;
    }
    fx.update(dt);
    combat.frame(dt);
    // 撃墜・墜落：残骸の演出を始める（地面に激突したときは落下なしで爆発）
    if (ac.crashed && !wreck.active) {
      wreck.start(ac, jet, ac.hp > 0, world.heightAt);
      state.dead = true;
    }
    wreck.update(dt, world.heightAt);
    // 敵を撃墜したらキルカメラ（自機が落ちている間は出さない）
    if (combat.killEvent) {
      if (!state.dead) killcam.start(combat.killEvent.w, combat.killEvent.text);
      clips.kill(combat.killEvent.text);
      combat.killEvent = null;
    }
    killcam.update(dt);
    geff.update(dt, ac);
    // ミッション終了：完了なら 4 秒後、撃墜なら残骸を見送ってから 7 秒後にデブリーフィング
    const ms = combat.mission;
    if (ms.state !== 'active' && debrief.classList.contains('hidden') && !ms.shown
      && ms.endT > (ms.state === 'complete' ? 4 : 7)) {
      ms.shown = true;
      showDebrief();
    }
    sound.setDim(geff.unconscious ? 0.15 : 1 - 0.6 * Math.max(0, geff.stress - 0.5));
  }

  if (wreck.active) {
    // 燃えながら落ちる機体（地面に落ちたら消える）
    jet.group.position.copy(wreck.pos);
    jet.group.quaternion.copy(wreck.quat);
    jet.group.visible = !wreck.landed;
  } else {
    jet.group.position.copy(ac.pos);
    jet.group.quaternion.copy(ac.quat);
    jet.group.visible = true;              // コクピット視点でも主翼・機首が見える
  }
  cockpit.group.visible = rig.mode === 'cockpit' && !wreck.active;
  if (cockpit.group.visible) {
    cockpit.group.position.copy(ac.pos);     // 内装は別シーン：機体と同じ位置・姿勢に置く
    cockpit.group.quaternion.copy(ac.quat);
    cockpit.update(dt, { ac, combat });
  }
  jet.update(wreck.active ? { engine: 0 } : ac, halted ? 0 : dt);
  if (!halted && !wreck.active) fx.vapor(jet, ac, dt);

  combat.render(halted ? 0 : dt);
  gun.render(ac);

  if (wreck.active) wreck.updateCamera(camera, halted ? 0 : dt, world.heightAt);
  else rig.update(dt, ac, input);
  if ((gun.firing || combat.hitFlash > 0) && !halted) {
    // 射撃・被弾の振動
    const k = (rig.mode === 'cockpit' ? 0.004 : 0.0025) * (combat.hitFlash > 0 ? 3 : 1);
    camera.rotation.x += (Math.random() - 0.5) * k;
    camera.rotation.y += (Math.random() - 0.5) * k;
  }
  world.update(camera);
  const sk = combat.seeker.state;
  sound.setTone(halted || ac.crashed ? 'off' : sk === 'lock' || sk === 'search' ? sk : 'off');
  sound.setRwr(halted || ac.crashed ? 'off'
    : combat.incoming.length ? 'missile' : combat.rwr.some((c) => c.locked) ? 'lock' : 'off');
  clips.update(dt, halted);
  sound.update(dt, {
    player: ac, camera, enemies: combat.enemies, ground: combat.ground, gunFiring: gun.firing,
    paused: halted, cockpit: rig.mode === 'cockpit',
  });
  if (!render) return;
  if (combat.photoRequest) { combat.photoRequest = false; capturePhoto(); }
  renderer.render(scene, camera);
  if (cockpit.group.visible) cockpit.render(renderer, camera);
  if (!state.dead) killcam.render(renderer, scene); else killcam.stop();
  // コクピット視点で横・上を向いたら HUD は見えない（HUD は機体に固定されている）
  state.lookAway = rig.mode === 'cockpit' && (Math.abs(rig.lookYaw) > 0.4 || Math.abs(rig.lookPitch) > 0.35);
  hud.canvas.style.visibility = state.helpOpen ? 'hidden' : '';   // ヘルプの HUD 図と重ならないように
  hud.draw(ac, state, camera, halted ? 0 : dt, combat);
  clips.capture();
}
requestAnimationFrame(frame);

// デバッグ用
// step(秒): 画面が非表示でも時間を進めて確認できる
window.__game = {
  ac, input, camera, rig, world, hud, gun, fx, combat, sound, restart, renderer, jet, scene, buildJet, wreck, state, openHelp, closeHelp, killcam, geff, showDebrief, clips,
  title, openTitle, startMission,
  freeze: false,
  // 機体の見た目確認：view('f22' | 'su57', 方位°, 仰角°, 距離m)。freeze 中に使う
  view(which, azDeg, elDeg, dist = 20) {
    const j = which === 'f22' ? jet : combat.enemies[0]?.jet;
    if (!j) return 'no jet';
    const base = ac.pos.clone().add(new THREE.Vector3(0, 200, 0));
    jet.group.visible = j === jet;
    for (const e of combat.enemies) e.jet.group.visible = e.jet === j;
    j.group.position.copy(base);
    j.group.quaternion.identity();
    const az = THREE.MathUtils.degToRad(azDeg), el = THREE.MathUtils.degToRad(elDeg);
    camera.position.copy(base).add(new THREE.Vector3(
      Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, -Math.cos(az) * Math.cos(el) * dist));
    camera.lookAt(base);
    hud.ctx.clearRect(0, 0, innerWidth, innerHeight);
    return 'ok';
  },
  step(sec, fn) {
    for (let t = 0; t < sec; t += 1 / 60) { fn?.(); tick(1 / 60, t + 1 / 60 >= sec); }
  },
};

// URL に #freeze を付けると、停止状態・ヘルプ非表示で起動（確認作業用）
if (location.hash.includes('freeze')) {
  window.__game.freeze = true;
  title.hide();
  state.titleOpen = false;
  closeHelp();
}
