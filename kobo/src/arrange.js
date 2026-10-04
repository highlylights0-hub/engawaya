// 骨格の伴奏：ゲームロックの型（ギターのパワーコード刻み、ベースの8分刻み、8ビートのドラム）。
// 再生と MIDI 書き出しで同じものを使う。
import { pcOf } from './theory.js';

export const DRUM_NOTE = { kick: 36, snare: 38, hat: 42, crash: 49 };

export function arrange({ chords, beatsPerBar: bpb, nBars }) {
  const bass = [], guitar = [], drums = [];
  const len = nBars * bpb;

  for (const c of chords) {
    const b = 28 + pcOf(c.root - 4);   // E1〜E♭2
    const g = 40 + pcOf(c.root - 4);   // E2〜E♭3（ギターの6弦ルートの音域）
    const power = [g, g + (c.quality === 'dim' ? 6 : 7), g + 12];
    const end = Math.min(c.start + c.len, len);
    for (let t = c.start; t < end - 1e-6; t += 0.5) {
      // ベース：8分刻み。小節の最後の8分はオクターブ上に跳ねる
      const lastEighth = Math.abs((t % bpb) - (bpb - 0.5)) < 1e-6 && t + 0.5 >= end - 1e-6;
      bass.push({ beat: t, dur: 0.45, pitch: lastEighth ? b + 12 : b, vel: t === c.start ? 110 : 96 });
    }
    // ギター：和音が変わった頭は1拍伸ばして鳴らし、あとはミュートで刻む
    const ring = Math.min(1, end - c.start);
    for (const p of power) guitar.push({ beat: c.start, dur: ring, pitch: p, vel: 118 });
    for (let t = c.start + ring; t < end - 1e-6; t += 0.5) for (const p of power) guitar.push({ beat: t, dur: 0.28, pitch: p, vel: 88, mute: true });
  }

  for (let bar = 0; bar < nBars; bar++) {
    const s = bar * bpb, fill = bar === nBars - 1 && bpb >= 3;
    if (bar % 4 === 0) drums.push({ beat: s, drum: 'crash', vel: 110 });
    for (let k = 0; k < bpb; k++) {
      const t = s + k;
      if (fill && k === bpb - 1) {   // 最後の小節の最後の拍はスネアのフィル
        [0, 0.25, 0.5, 0.75].forEach((o, i) => drums.push({ beat: t + o, drum: 'snare', vel: 80 + i * 12 }));
        continue;
      }
      drums.push({ beat: t, drum: k % 2 === 0 ? 'kick' : 'snare', vel: k === 0 ? 120 : 108 });
      if (k === 2 && bpb >= 4) drums.push({ beat: t + 0.5, drum: 'kick', vel: 100 });
      drums.push({ beat: t, drum: 'hat', vel: 90 }, { beat: t + 0.5, drum: 'hat', vel: 70 });
    }
  }
  return { bass, guitar, drums };
}
