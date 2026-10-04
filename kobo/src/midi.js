// MIDI ファイル（SMF）の読み書き。
// 読む：音符（いつ・どの高さ・どれだけ・どの強さ・どのチャンネル）とテンポ・拍子だけ取り出す。
// 書く：GarageBand などで開ける フォーマット1 の SMF。

function decodeName(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {}
  try { return new TextDecoder('shift_jis').decode(bytes); } catch {}
  return '';
}

export function parseMidi(buf) {
  const d = new DataView(buf);
  let p = 0;
  const u8 = () => d.getUint8(p++);
  const u16 = () => { const v = d.getUint16(p); p += 2; return v; };
  const u32 = () => { const v = d.getUint32(p); p += 4; return v; };
  const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(u8()); return s; };
  const vlq = () => { let v = 0, b; do { b = u8(); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

  if (buf.byteLength < 14 || str(4) !== 'MThd') throw new Error('MIDI ファイルではないようです');
  const hlen = u32();
  const format = u16(), ntracks = u16(), division = u16();
  p += hlen - 6;
  if (division & 0x8000) throw new Error('SMPTE 形式の MIDI には、まだ対応していません');

  const ppq = division, tempos = [], timeSigs = [], tracks = [];
  for (let t = 0; t < ntracks && p + 8 <= d.byteLength; t++) {
    const id = str(4), len = u32(), end = Math.min(p + len, d.byteLength);
    if (id !== 'MTrk') { p = end; continue; }
    let tick = 0, status = 0, name = '';
    const on = new Map(), notes = [];
    const close = (key, o, at) => {
      if (at > o.tick) notes.push({ tick: o.tick, dur: at - o.tick, pitch: key & 127, vel: o.vel, ch: key >> 7 });
    };
    while (p < end) {
      tick += vlq();
      if (d.getUint8(p) & 0x80) status = u8();   // そうでなければランニングステータス
      const type = status & 0xf0, ch = status & 0x0f;
      if (status === 0xff) {
        const mt = u8(), ml = vlq(), s = p;
        if (mt === 0x51 && ml >= 3) tempos.push({ tick, usPerQ: (d.getUint8(s) << 16) | (d.getUint8(s + 1) << 8) | d.getUint8(s + 2) });
        else if (mt === 0x58 && ml >= 2) timeSigs.push({ tick, num: d.getUint8(s), den: 1 << d.getUint8(s + 1) });
        else if (mt === 0x03 && !name) name = decodeName(new Uint8Array(buf, s, ml));
        p = s + ml;
        status = 0;
        if (mt === 0x2f) break;
      } else if (status === 0xf0 || status === 0xf7) {
        p += vlq();
        status = 0;
      } else if (type === 0x90 || type === 0x80) {
        const k = u8(), v = u8(), key = (ch << 7) | k;
        const o = on.get(key);
        if (o) { close(key, o, tick); on.delete(key); }
        if (type === 0x90 && v > 0) on.set(key, { tick, vel: v });
      } else if (type === 0xc0 || type === 0xd0) {
        p += 1;
      } else if (type >= 0xa0) {
        p += 2;
      } else {
        throw new Error('MIDI の中身が壊れているようです');
      }
    }
    for (const [key, o] of on) close(key, o, tick);
    p = end;
    notes.sort((a, b) => a.tick - b.tick);
    tracks.push({ name, notes });
  }
  tempos.sort((a, b) => a.tick - b.tick);
  timeSigs.sort((a, b) => a.tick - b.tick);
  return { format, ppq, tempos, timeSigs, tracks };
}

// tracks: [{ name, ch, program, notes:[{ beat, dur, pitch, vel }] }]（beat は四分音符単位）
// 調号のシャープ(+)／フラット(-)の数。長調の主音のピッチクラスから引く（短調は平行長調＝主音+3 で引く）
const SHARPS = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };

export function writeMidi({ bpm, beatsPerBar = 4, key = null, tracks }) {
  const PPQ = 480;
  const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const vlq = (v) => { const b = [v & 0x7f]; while ((v >>>= 7)) b.unshift((v & 0x7f) | 0x80); return b; };
  const ascii = (s) => Array.from(new TextEncoder().encode(s));
  const chunk = (events) => {
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const data = [];
    let last = 0;
    for (const e of events) { data.push(...vlq(e.tick - last), ...e.bytes); last = e.tick; }
    data.push(0, 0xff, 0x2f, 0);
    return [0x4d, 0x54, 0x72, 0x6b, ...u32(data.length), ...data];
  };

  const us = Math.round(60e6 / bpm);
  const conductor = chunk([
    { tick: 0, order: 0, bytes: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] },
    { tick: 0, order: 0, bytes: [0xff, 0x58, 4, beatsPerBar, 2, 24, 8] },
    // キー（GarageBand などがこれを見て Am などと表示する。無いと C のまま）
    ...(key ? [{ tick: 0, order: 0, bytes: [0xff, 0x59, 2, SHARPS[(key.tonic + (key.minor ? 3 : 0)) % 12] & 255, key.minor ? 1 : 0] }] : []),
  ]);

  const chunks = [conductor];
  for (const tr of tracks) {
    const name = ascii(tr.name);
    const ev = [{ tick: 0, order: 0, bytes: [0xff, 0x03, ...vlq(name.length), ...name] }];
    if (tr.ch !== 9) ev.push({ tick: 0, order: 0, bytes: [0xc0 | tr.ch, tr.program] });
    for (const n of tr.notes) {
      const on = Math.round(n.beat * PPQ), off = Math.max(on + 1, Math.round((n.beat + n.dur) * PPQ));
      ev.push({ tick: on, order: 2, bytes: [0x90 | tr.ch, n.pitch, n.vel] });
      ev.push({ tick: off, order: 1, bytes: [0x80 | tr.ch, n.pitch, 0] });
    }
    chunks.push(chunk(ev));
  }

  const header = [0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 1, 0, chunks.length, PPQ >> 8, PPQ & 255];
  return new Uint8Array([...header, ...chunks.flat()]);
}
