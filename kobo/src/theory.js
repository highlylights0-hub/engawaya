// 音楽理論の小道具。音の高さは MIDI ノート番号（60 = 真ん中のド）、
// ピッチクラス（pc）は 0=C … 11=B。

// ギターで読みやすい書き方（シャープとフラットを混ぜる）
export const NOTE_NAMES = ['C', 'C#', 'D', 'E♭', 'E', 'F', 'F#', 'G', 'A♭', 'A', 'B♭', 'B'];

// コードの種類。tones は根音からの半音数、w は推定のときの重み（三和音を少し優先）
export const QUALITIES = {
  '':     { tones: [0, 4, 7], w: 1 },
  'm':    { tones: [0, 3, 7], w: 1 },
  '7':    { tones: [0, 4, 7, 10], w: 0.93 },
  'm7':   { tones: [0, 3, 7, 10], w: 0.93 },
  'maj7': { tones: [0, 4, 7, 11], w: 0.9 },
  'dim':  { tones: [0, 3, 6], w: 0.85 },
  'sus4': { tones: [0, 5, 7], w: 0.85 },
};

export const MAJOR = [0, 2, 4, 5, 7, 9, 11];
export const MINOR = [0, 2, 3, 5, 7, 8, 10];

export const pcOf = (p) => ((p % 12) + 12) % 12;

export function chordName(c) {
  return NOTE_NAMES[c.root] + c.quality;
}

export function chordTones(c) {
  return QUALITIES[c.quality].tones.map((t) => (c.root + t) % 12);
}

export function keyName(key) {
  return NOTE_NAMES[key.tonic] + (key.minor ? 'm' : '');
}

export function scalePcs(key) {
  return (key.minor ? MINOR : MAJOR).map((t) => (key.tonic + t) % 12);
}

const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUALITY_ALIAS = {
  '': '', 'M': '', 'maj': '', '5': '',
  'm': 'm', 'min': 'm', '-': 'm',
  '7': '7', 'm7': 'm7', 'min7': 'm7', '-7': 'm7',
  'maj7': 'maj7', 'M7': 'maj7', '△7': 'maj7',
  'dim': 'dim', 'o': 'dim', 'm7-5': 'dim', 'm7b5': 'dim',
  'sus4': 'sus4', 'sus': 'sus4',
};

// "Am" "F#m7" "Bb" "E♭" などを読む。読めなければ null
export function parseChord(s) {
  const m = /^([A-Ga-g])([#♯b♭]?)(.*)$/.exec(s.trim());
  if (!m) return null;
  let root = LETTER[m[1].toUpperCase()];
  if (m[2] === '#' || m[2] === '♯') root++;
  if (m[2] === 'b' || m[2] === '♭') root--;
  const q = QUALITY_ALIAS[m[3].split('/')[0]];
  if (q === undefined) return null;
  return { root: (root + 12) % 12, quality: q };
}

// 進行の中でいちばん多く鳴っている和音から、だいたいのキーを決める（手入力用）
export function guessKeyFromChords(chords) {
  const first = chords[0], last = chords[chords.length - 1];
  const c = last && last.root === first.root ? last : first;
  return { tonic: c.root, minor: c.quality === 'm' || c.quality === 'm7' };
}
