// メロディ生成。借りるのはコード進行だけで、リズムと音の並びは新しく組む。
// 決まりごと：
//   ・強拍（小節の1・3拍目、和音が変わる瞬間、長い音）にはコードトーン
//   ・弱拍はスケールの音で順次進行（たまに同じ音の連打、たまにコードトーンへ跳ぶ）
//   ・4小節を一句として A A' A(またはB) 終止。A はモチーフ（リズム＋音の形）を繰り返し、和音に合わせて移す
//   ・句の山は3小節目あたり、2句目は少し高く。最後はキーの主音か和音の根音で長く伸ばす
import { chordTones, scalePcs, pcOf } from './theory.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 1拍ぶんのリズムの型 [拍の中の位置, 長さ]
const CELLS = {
  rest: [],
  q:    [[0, 1]],
  ee:   [[0, 0.5], [0.5, 0.5]],
  es:   [[0, 0.5], [0.5, 0.25], [0.75, 0.25]],
  se:   [[0, 0.25], [0.25, 0.25], [0.5, 0.5]],
  ssss: [[0, 0.25], [0.25, 0.25], [0.5, 0.25], [0.75, 0.25]],
  syn:  [[0, 0.25], [0.25, 0.5], [0.75, 0.25]],
  dq:   [[0, 0.75], [0.75, 0.25]],
  offE: [[0.5, 0.5]],
};
const CELLSETS = [
  [['q', 4], ['ee', 3], ['dq', 1.5], ['offE', 1.5], ['rest', 1]],                              // ゆったり
  [['ee', 4], ['q', 2], ['es', 2], ['se', 2], ['dq', 2], ['syn', 1.5], ['offE', 1]],          // ふつう
  [['ssss', 3], ['es', 3], ['se', 3], ['syn', 2], ['ee', 2], ['q', 0.5]],                     // 細かい
];

export function generateMelody({ chords, key, beatsPerBar: bpb, nBars, density = 1, register = 0, seed = 1 }) {
  const R = rng(seed);
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const wpick = (items) => {
    let s = 0;
    for (const [, w] of items) s += w;
    let x = R() * s;
    for (const [v, w] of items) if ((x -= w) <= 0) return v;
    return items[items.length - 1][0];
  };
  const nearest = (arr, p) => arr.reduce((b, x) => (Math.abs(x - p) < Math.abs(b - p) ? x : b), arr[0]);

  const center = 69 + register * 5;          // 中 = A4 あたり
  const lo = center - 9, hi = center + 12;
  const pitchesOf = (pcs) => { const a = []; for (let p = lo; p <= hi; p++) if (pcs.includes(pcOf(p))) a.push(p); return a; };
  const chordAt = (t) => chords.find((c) => t >= c.start - 1e-6 && t < c.start + c.len - 1e-6) || chords[chords.length - 1];

  // 短調で V が長三和音のときは、和声的短音階（7度を上げる）
  const scaleFor = (ch) => {
    const pcs = scalePcs(key);
    if (key.minor && (ch.root - key.tonic + 12) % 12 === 7 && chordTones(ch).includes((key.tonic + 11) % 12)) {
      return pcs.map((pc) => (pc === (key.tonic + 10) % 12 ? (key.tonic + 11) % 12 : pc));
    }
    return pcs;
  };
  const keyPitches = pitchesOf(scalePcs(key));
  const isStrong = (t, dur, ch) => {
    const onBeat = Math.abs(t - Math.round(t)) < 1e-6;
    return (onBeat && (Math.round(t) % bpb) % 2 === 0) || Math.abs(t - ch.start) < 1e-6 || dur >= 1;
  };

  // ── リズム ──
  const barRhythm = () => {
    const out = [];
    for (let b = 0; b < bpb; b++) for (const [off, d] of CELLS[wpick(CELLSETS[density])]) out.push({ beat: b + off, dur: d });
    if (!out.length) out.push({ beat: 0, dur: 1 });
    return out;
  };
  const varyRhythm = (r) => {   // 最後の1拍だけ替える ＝ 問いに対する答え
    const keep = r.filter((n) => n.beat < bpb - 1);
    for (const [off, d] of CELLS[wpick(CELLSETS[density])]) keep.push({ beat: bpb - 1 + off, dur: d });
    return keep;
  };
  const endRhythm = (final) => {
    let opts;
    if (bpb < 4) opts = [[[0, bpb]], [[0, 1], [1, bpb - 1]]];
    else if (final) opts = [[[0, bpb]], [[0, 0.5], [0.5, 0.5], [1, bpb - 1]], [[0, 1], [1, bpb - 1]]];
    else opts = [[[0, 1], [1, 1], [2, bpb - 2]], [[0, 0.5], [0.5, 0.5], [1, 1], [2, bpb - 2]], [[0, 1.5], [1.5, 0.5], [2, bpb - 2]]];
    return pick(opts).map(([beat, dur]) => ({ beat, dur }));
  };

  // ── 音の高さ ──
  let prev = center;
  const fresh = (t, dur, target) => {
    const ch = chordAt(t);
    const sp = pitchesOf(scaleFor(ch)), cp = pitchesOf(chordTones(ch));
    if (isStrong(t, dur, ch)) {
      return wpick(cp.map((p) => [p, (1 / (1 + Math.abs(p - prev))) * (1 / (1 + Math.abs(p - target) * 0.3))]));
    }
    const r = R();
    if (r < 0.18) return nearest(sp, prev);                                          // 連打（ロックっぽさ）
    if (r < 0.3) return wpick(cp.map((p) => [p, 1 / (1 + Math.abs(p - prev))]));     // コードトーンへ跳ぶ
    const i = sp.indexOf(nearest(sp, prev));
    const dir = target > prev + 1 ? 1 : target < prev - 1 ? -1 : R() < 0.5 ? 1 : -1;
    const step = (R() < 0.75 ? 1 : 2) * (R() < 0.75 ? dir : -dir);
    return sp[Math.max(0, Math.min(sp.length - 1, i + step))];
  };
  const fitToChord = (p, t, dur) => {   // モチーフを移したあと、和音とぶつかる音を直す
    const ch = chordAt(t);
    if (isStrong(t, dur, ch)) return nearest(pitchesOf(chordTones(ch)), p);
    const pcs = scaleFor(ch);
    return pcs.includes(pcOf(p)) ? p : nearest(pitchesOf(pcs), p);
  };

  const rA = barRhythm(), rA2 = varyRhythm(rA), rB = barRhythm();
  let motif = null;   // { first, degs:[] }（キーの音階の上での形）
  const notes = [];
  for (let bar = 0; bar < nBars; bar++) {
    const pos = bar % 4, phrase = Math.floor(bar / 4), last = bar === nBars - 1;
    const role = last || pos === 3 ? 'end' : pos === 0 ? 'A' : pos === 1 ? 'A2' : phrase % 2 === 0 ? 'A' : 'B';
    const rhythm = role === 'end' ? endRhythm(last) : role === 'A' ? rA : role === 'A2' ? rA2 : rB;
    const target = center + [-2, 3, 6, -1][pos] + (phrase % 2 ? 2 : 0);
    const base = bar * bpb;
    const barNotes = [];

    rhythm.forEach((r, i) => {
      const t = base + r.beat;
      let p;
      const useMotif = motif && (role === 'A' || (role === 'A2' && r.beat < bpb - 1)) && i < motif.degs.length;
      if (role === 'end' && i === rhythm.length - 1) {
        const ch = chordAt(t);
        const pcs = last && chordTones(ch).includes(key.tonic) ? [key.tonic] : [ch.root];
        p = nearest(pitchesOf(pcs), prev);
      } else if (useMotif) {
        if (i === 0) motif.start = keyPitches.indexOf(nearest(keyPitches, nearest(pitchesOf(chordTones(chordAt(t))), motif.first)));
        const idx = Math.max(0, Math.min(keyPitches.length - 1, motif.start + motif.degs[i]));
        p = fitToChord(keyPitches[idx], t, r.dur);
      } else {
        p = fresh(t, r.dur, target);
      }
      prev = p;
      barNotes.push({ beat: t, dur: r.dur, pitch: p, vel: isStrong(t, r.dur, chordAt(t)) ? 112 : 92 });
    });

    if (role === 'A' && !motif && barNotes.length) {
      const i0 = keyPitches.indexOf(nearest(keyPitches, barNotes[0].pitch));
      motif = { first: barNotes[0].pitch, degs: barNotes.map((n) => keyPitches.indexOf(nearest(keyPitches, n.pitch)) - i0) };
    }
    notes.push(...barNotes);
  }
  return notes;
}
