// MIDI から骨格を取り出す：テンポ・拍子・キー・コード進行（半小節ごとに候補3つ）。
// ドラム（チャンネル10）は使わない。メロディ自体は使わず、骨格だけを借りる。
import { QUALITIES, pcOf, scalePcs } from './theory.js';

// Krumhansl のキー・プロファイル
const KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a, b) {
  const ma = a.reduce((s, x) => s + x, 0) / 12, mb = b.reduce((s, x) => s + x, 0) / 12;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db || 1);
}

function detectKey(chroma) {
  let best = { tonic: 0, minor: false, r: -2 };
  for (let k = 0; k < 12; k++) {
    const rot = chroma.map((_, i) => chroma[(i + k) % 12]);
    const rM = corr(rot, KS_MAJ), rm = corr(rot, KS_MIN);
    if (rM > best.r) best = { tonic: k, minor: false, r: rM };
    if (rm > best.r) best = { tonic: k, minor: true, r: rm };
  }
  return { tonic: best.tonic, minor: best.minor };
}

function chordCandidates(chroma, bassPc, key) {
  const norm = Math.hypot(...chroma);
  if (norm < 1e-6) return null;
  const inKey = scalePcs(key);
  const out = [];
  for (let root = 0; root < 12; root++) {
    for (const [quality, q] of Object.entries(QUALITIES)) {
      let dot = 0;
      for (const t of q.tones) dot += chroma[(root + t) % 12];
      let score = (dot / (norm * Math.sqrt(q.tones.length))) * q.w;
      if (bassPc === root) score += 0.08;
      if (q.tones.every((t) => inKey.includes((root + t) % 12))) score += 0.04;
      out.push({ root, quality, score });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 3);
}

export function analyze(midi) {
  const { ppq } = midi;
  const usPerQ = midi.tempos.length ? midi.tempos[0].usPerQ : 500000;
  const bpm = Math.round(60e6 / usPerQ);
  const ts = midi.timeSigs[0] || { num: 4, den: 4 };
  const beatsPerBar = Math.max(2, Math.round((ts.num * 4) / ts.den));

  const notes = [];
  for (const tr of midi.tracks) {
    for (const n of tr.notes) {
      if (n.ch === 9) continue;
      notes.push({ beat: n.tick / ppq, dur: n.dur / ppq, pitch: n.pitch, vel: n.vel });
    }
  }
  if (!notes.length) throw new Error('音符が見つかりませんでした（ドラムだけの MIDI かもしれません）');
  notes.sort((a, b) => a.beat - b.beat);

  const total = new Array(12).fill(0);
  for (const n of notes) total[pcOf(n.pitch)] += n.dur * (n.vel / 127);
  const key = detectKey(total);

  const lastBeat = Math.max(...notes.map((n) => n.beat + n.dur));
  const bars = Math.ceil(lastBeat / beatsPerBar - 1e-6);
  const segLen = beatsPerBar % 2 === 0 ? beatsPerBar / 2 : beatsPerBar;
  const segments = [];
  for (let s = 0; s * segLen < bars * beatsPerBar; s++) {
    const a = s * segLen, b = a + segLen;
    const chroma = new Array(12).fill(0);
    let bass = null;
    for (let i = 0; i < notes.length && notes[i].beat < b; i++) {
      const n = notes[i];
      const ov = Math.min(b, n.beat + n.dur) - Math.max(a, n.beat);
      if (ov <= 0) continue;
      chroma[pcOf(n.pitch)] += ov * (n.vel / 127);
      if (ov >= segLen * 0.25 && (!bass || n.pitch < bass)) bass = n.pitch;
    }
    segments.push({ start: a, len: segLen, cands: chordCandidates(chroma, bass == null ? -1 : pcOf(bass), key), pick: 0 });
  }
  // 音のない区間は前の和音を引き継ぐ
  for (let i = 0; i < segments.length; i++) {
    if (!segments[i].cands) segments[i].cands = i > 0 ? segments[i - 1].cands : [{ root: key.tonic, quality: key.minor ? 'm' : '', score: 0 }];
  }

  // 原曲を鳴らす用（比べるため）
  return { bpm, beatsPerBar, key, bars, segLen, segments, notes };
}

// 区間 [startBar, startBar+nBars) の和音を、同じ和音が続くところはまとめて返す（beat は区間の頭が 0）
export function chordsInRange(an, startBar, nBars) {
  const a = startBar * an.beatsPerBar, b = a + nBars * an.beatsPerBar;
  const out = [];
  an.segments.forEach((s, idx) => {
    if (s.start < a || s.start >= b) return;
    const c = s.cands[s.pick];
    const prev = out[out.length - 1];
    if (prev && prev.root === c.root && prev.quality === c.quality) prev.len += s.len;
    else out.push({ start: s.start - a, len: s.len, root: c.root, quality: c.quality, seg: idx });
  });
  return out;
}
