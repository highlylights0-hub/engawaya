// 画面のつなぎ。骨格（コード進行）→ メロディ生成 → 再生 / キープ / MIDI 書き出し。
import { parseMidi, writeMidi } from './midi.js';
import { analyze, chordsInRange } from './analyze.js';
import { generateMelody } from './compose.js';
import { arrange, DRUM_NOTE } from './arrange.js';
import { Player } from './synth.js';
import { chordName, keyName, parseChord, guessKeyFromChords, pcOf } from './theory.js';

const $ = (id) => document.getElementById(id);
const player = new Player();

const state = {
  source: 'manual',     // 'manual' | 'midi'
  fileName: '',
  an: null,             // analyze() の結果（手入力でも同じ形に揃える）
  startBar: 0,
  nBars: 8,
  bpm: 160,
  density: 1,
  register: 0,
  seed: 1,
  melody: [],
  parts: { lead: true, guitar: true, bass: true, drums: true },
  keeps: [],
  playing: null,        // 'full' | 'bone' | 'orig' | keep のインデックス
};

// ── 骨格を作る ──
function manualAnalysis(text) {
  const bars = text.split(/[\s|]+/).filter(Boolean);
  if (!bars.length) throw new Error('コードを入れてください（例：Am F G E）');
  if (bars.length > 32) throw new Error('32 小節までにしてください');
  const segments = [];
  bars.forEach((tok, i) => {
    const parts = tok.split('-');
    const halves = parts.length >= 2 ? [parts[0], parts[1]] : [parts[0], parts[0]];
    halves.forEach((s, h) => {
      const c = parseChord(s);
      if (!c) throw new Error(`「${s}」が読めませんでした`);
      segments.push({ start: i * 4 + h * 2, len: 2, cands: [{ ...c, score: 1 }], pick: 0 });
    });
  });
  const key = guessKeyFromChords(segments.map((s) => s.cands[0]));
  return { bpm: state.bpm, beatsPerBar: 4, key, bars: bars.length, segLen: 2, segments, notes: [] };
}

function setInfo(msg, err = false) {
  $('info').textContent = msg;
  $('info').classList.toggle('err', err);
}

function useAnalysis(an, source, fileName = '') {
  player.stop();
  state.an = an;
  state.source = source;
  state.fileName = fileName;
  state.startBar = 0;
  if (source === 'midi') {
    state.nBars = Math.min(8, an.bars);
    state.bpm = Math.max(60, Math.min(220, an.bpm));
    setInfo(`${fileName} ／ キー ${keyName(an.key)} ・テンポ ${an.bpm} ・${an.beatsPerBar}拍子 ・全 ${an.bars} 小節`);
  } else {
    state.nBars = an.bars;
    setInfo(`キー ${keyName(an.key)} ・${an.bars} 小節`);
  }
  $('range').hidden = source !== 'midi';
  $('startBar').max = an.bars;
  $('startBar').value = 1;
  $('playOrig').hidden = source !== 'midi';
  syncControls();
  refresh();
}

async function loadFile(file) {
  try {
    const an = analyze(parseMidi(await file.arrayBuffer()));
    useAnalysis(an, 'midi', file.name);
  } catch (e) {
    setInfo(e.message, true);
  }
}

// ── いまの状態から和音・メロディを作る ──
const bpb = () => state.an.beatsPerBar;
const currentChords = () => chordsInRange(state.an, state.startBar, state.nBars);

function regenerate() {
  state.melody = generateMelody({
    chords: currentChords(), key: state.an.key, beatsPerBar: bpb(), nBars: state.nBars,
    density: state.density, register: state.register, seed: state.seed,
  });
  $('seedInfo').textContent = `候補 #${state.seed}`;
}

function refresh() {
  regenerate();
  renderChords();
  drawRoll();
}

function buildSong(kind, src = null) {
  const s = src || { chords: currentChords(), melody: state.melody, bpm: state.bpm, beatsPerBar: bpb(), nBars: state.nBars };
  const L = s.nBars * s.beatsPerBar, ev = [];
  if (kind === 'orig') {
    const a = state.startBar * bpb();
    for (const n of state.an.notes) {
      const b = n.beat - a;
      if (b < 0 || b >= L) continue;
      ev.push({ beat: b, inst: 'orig', pitch: n.pitch, dur: Math.min(n.dur, L - b), vel: n.vel });
    }
  } else {
    const arr = arrange(s);
    const P = src ? { lead: true, guitar: true, bass: true, drums: true } : state.parts;
    if (P.guitar) for (const n of arr.guitar) ev.push({ ...n, inst: 'guitar' });
    if (P.bass) for (const n of arr.bass) ev.push({ ...n, inst: 'bass' });
    if (P.drums) for (const d of arr.drums) ev.push({ beat: d.beat, inst: d.drum, vel: d.vel });
    if (kind === 'full' && P.lead) for (const n of s.melody) ev.push({ ...n, inst: 'lead' });
  }
  ev.sort((x, y) => x.beat - y.beat);
  return { bpm: s.bpm, lengthBeats: L, events: ev };
}

function play(kind) {
  if (kind === 'orig' && state.source !== 'midi') return;
  state.playing = kind;
  player.play(() => buildSong(kind));   // 周ごとに作り直す＝鳴らしながらの変更が次の周から効く
  markPlaying();
}

function markPlaying() {
  for (const [id, k] of [['playFull', 'full'], ['playBone', 'bone'], ['playOrig', 'orig']]) {
    $(id).classList.toggle('on', state.playing === k && player.playing);
  }
}

// ── 表示：コード進行 ──
function renderChords() {
  const box = $('chords');
  box.innerHTML = '';
  const an = state.an, b0 = state.startBar, perBar = an.beatsPerBar / an.segLen;
  const multi = an.segments.some((s) => s.cands.length > 1);
  $('chordHint').textContent = multi ? 'コードをタップすると、別の候補に変わります（金色＝入れ替えた所）' : 'ギターで弾くならこのコードです';
  for (let bar = b0; bar < b0 + state.nBars; bar++) {
    const el = document.createElement('div');
    el.className = 'bar';
    el.innerHTML = `<span class="n">${bar + 1}</span><div class="chips"></div>`;
    const segIdx = [];
    for (let k = 0; k < perBar; k++) segIdx.push(bar * perBar + k);
    const name = (i) => { const s = an.segments[i]; return s ? chordName(s.cands[s.pick]) : ''; };
    const groups = segIdx.every((i) => name(i) === name(segIdx[0])) ? [segIdx] : segIdx.map((i) => [i]);
    for (const g of groups) {
      const s = an.segments[g[0]];
      if (!s) continue;
      const chip = document.createElement('div');
      chip.className = 'chip' + (s.pick ? ' alt' : '');
      chip.textContent = name(g[0]);
      chip.title = s.cands.map(chordName).join(' / ');
      if (s.cands.length > 1) {
        chip.style.cursor = 'pointer';
        chip.onclick = () => {
          const next = (s.pick + 1) % s.cands.length;
          for (const i of g) if (an.segments[i]) an.segments[i].pick = Math.min(next, an.segments[i].cands.length - 1);
          refresh();
        };
      }
      el.querySelector('.chips').appendChild(chip);
    }
    box.appendChild(el);
  }
}

// ── 表示：ピアノロール ──
function drawRoll() {
  const cv = $('roll'), dpr = devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const L = state.nBars * bpb(), top = 22;
  const mel = state.melody;
  const ps = mel.map((n) => n.pitch);
  const lo = Math.min(...ps, 60) - 2, hi = Math.max(...ps, 72) + 2;
  const x = (b) => (b / L) * W, y = (p) => top + ((hi - p) / (hi - lo)) * (H - top - 6);
  const rowH = (H - top - 6) / (hi - lo);

  // 白鍵/黒鍵の段
  for (let p = lo; p <= hi; p++) {
    if ([1, 3, 6, 8, 10].includes(pcOf(p))) { g.fillStyle = '#0c0d14'; g.fillRect(0, y(p) - rowH / 2, W, rowH); }
  }
  // 小節線と和音名
  const chords = currentChords();
  g.font = '13px DotGothic16, monospace';
  g.textBaseline = 'middle';
  for (const c of chords) {
    g.fillStyle = '#1c1e2b';
    g.fillRect(x(c.start) + 1, 2, x(c.len) - 2, top - 5);
    g.fillStyle = '#ffcc33';
    g.fillText(chordName(c), x(c.start) + 5, top / 2);
  }
  for (let b = 0; b <= L; b++) {
    g.fillStyle = b % bpb() === 0 ? '#3a3e5a' : '#1e2030';
    g.fillRect(Math.round(x(b)), top, 1, H - top);
  }
  // 音符
  const pos = player.position();
  const playingMel = state.playing === 'full' && pos >= 0;
  for (const n of mel) {
    const active = playingMel && pos >= n.beat && pos < n.beat + n.dur;
    g.fillStyle = active ? '#ffffff' : n.vel > 100 ? '#4fd1ff' : '#3b9fc4';
    const w = Math.max(3, x(n.dur) - 2);
    g.beginPath();
    g.roundRect(x(n.beat) + 1, y(n.pitch) - rowH / 2 + 1, w, Math.max(4, rowH - 2), 3);
    g.fill();
  }
  // 再生位置
  if (pos >= 0 && typeof state.playing === 'string') {
    g.fillStyle = '#ff5f7e';
    g.fillRect(x(pos % L), 0, 2, H);
  }
}

function animate() {
  if (player.playing) drawRoll();
  else if (state.playing !== null) { state.playing = null; markPlaying(); drawRoll(); }
  requestAnimationFrame(animate);
}

// ── キープと書き出し ──
function snapshot() {
  return {
    name: `#${state.seed} ${keyName(state.an.key)} ${state.bpm}`,
    chords: currentChords(), melody: state.melody, bpm: state.bpm, beatsPerBar: bpb(),
    nBars: state.nBars, key: state.an.key, seed: state.seed,
  };
}

function saveKeeps() {
  try { localStorage.setItem('midikobo.keeps', JSON.stringify(state.keeps)); } catch {}
}

function renderKeeps() {
  const ul = $('keeps');
  ul.innerHTML = '';
  if (!state.keeps.length) { ul.innerHTML = '<li class="muted">気に入ったメロディは ⭐ キープ で残しておけます</li>'; return; }
  state.keeps.forEach((k, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="name"></span><button>▶</button><button>⬇ MIDI</button><button>✕</button>`;
    li.querySelector('.name').textContent = `${k.name}　${k.chords.map(chordName).join(' ')}`;
    const [bPlay, bDl, bDel] = li.querySelectorAll('button');
    bPlay.onclick = () => { state.playing = i; player.play(() => buildSong('full', k)); markPlaying(); };
    bDl.onclick = () => download(k);
    bDel.onclick = () => { state.keeps.splice(i, 1); saveKeeps(); renderKeeps(); };
    ul.appendChild(li);
  });
}

function download(s) {
  const arr = arrange(s);
  const bytes = writeMidi({
    bpm: s.bpm, beatsPerBar: s.beatsPerBar, key: s.key,
    tracks: [
      { name: 'Melody', ch: 0, program: 80, notes: s.melody },
      { name: 'Guitar', ch: 1, program: 30, notes: arr.guitar },
      { name: 'Bass', ch: 2, program: 33, notes: arr.bass },
      { name: 'Drums', ch: 9, program: 0, notes: arr.drums.map((d) => ({ beat: d.beat, dur: 0.1, pitch: DRUM_NOTE[d.drum], vel: d.vel })) },
    ],
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'audio/midi' }));
  a.download = `midi-kobo_${keyName(s.key).replace('♭', 'b')}_${s.bpm}bpm_${s.seed}.mid`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── 操作 ──
function segSelect(id, value, on) {
  const el = $(id);
  for (const b of el.querySelectorAll('button')) {
    b.classList.toggle('on', Number(b.dataset.v) === value);
    b.onclick = () => { on(Number(b.dataset.v)); segSelect(id, Number(b.dataset.v), on); };
  }
}

function syncControls() {
  $('bpm').value = state.bpm;
  $('bpmOut').textContent = state.bpm;
  segSelect('lenSeg', state.nBars, (v) => { state.nBars = Math.min(v, state.an.bars - state.startBar); refresh(); });
  segSelect('densSeg', state.density, (v) => { state.density = v; refresh(); });
  segSelect('regSeg', state.register, (v) => { state.register = v; refresh(); });
}

$('file').onchange = (e) => e.target.files[0] && loadFile(e.target.files[0]);
const drop = $('drop');
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
};
// ドロップがページの外れに落ちても、ブラウザがファイルを開いてしまわないように
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => e.preventDefault());

$('useProg').onclick = () => {
  try { useAnalysis(manualAnalysis($('prog').value), 'manual'); } catch (e) { setInfo(e.message, true); }
};
$('prog').onkeydown = (e) => { if (e.key === 'Enter') $('useProg').click(); };
$('sample').onclick = async () => {
  const r = await fetch('samples/kurodo-test.mid');
  loadFile(new File([await r.arrayBuffer()], 'kurodo-test.mid'));
};
$('startBar').onchange = () => {
  const v = Math.max(1, Math.min(state.an.bars, Number($('startBar').value) || 1));
  $('startBar').value = v;
  state.startBar = v - 1;
  state.nBars = Math.min(Number($('lenSeg').querySelector('.on')?.dataset.v || 8), state.an.bars - state.startBar);
  refresh();
};
$('bpm').oninput = () => { state.bpm = Number($('bpm').value); $('bpmOut').textContent = state.bpm; };
$('gen').onclick = () => {
  state.seed = 1 + Math.floor(Math.random() * 99999);
  refresh();
  if (!player.playing || state.playing !== 'full') play('full');
};
$('playFull').onclick = () => play('full');
$('playBone').onclick = () => play('bone');
$('playOrig').onclick = () => play('orig');
$('stop').onclick = () => { player.stop(); };
for (const b of document.querySelectorAll('.tog')) {
  b.onclick = () => { const p = b.dataset.part; state.parts[p] = !state.parts[p]; b.classList.toggle('on', state.parts[p]); };
}
$('keep').onclick = () => { state.keeps.unshift(snapshot()); saveKeeps(); renderKeeps(); };
$('export').onclick = () => download(snapshot());
addEventListener('resize', drawRoll);
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); player.playing ? player.stop() : play('full'); }
});

try { state.keeps = JSON.parse(localStorage.getItem('midikobo.keeps') || '[]'); } catch { state.keeps = []; }
renderKeeps();
useAnalysis(manualAnalysis($('prog').value), 'manual');
document.fonts.ready.then(drawRoll);
requestAnimationFrame(animate);

window.__kobo = { state, player, buildSong, refresh };   // デバッグ用
