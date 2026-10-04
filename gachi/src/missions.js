// ミッションの定義と進み具合（クリアした作戦）
//   キャンペーン OPERATION NEEDLE：島の北の山奥に隠された核開発基地を、偵察 → 防空網の制圧 → 本丸の破壊 の順に叩く
//   kind: air = 空戦 / ground = 谷と基地のミッション

export const MISSIONS = [
  {
    id: 'm1', no: 1, kind: 'ground', camp: 'OPERATION NEEDLE', code: 'SHADOW EYE', title: '影を探せ',
    story: '北の山奥で、核開発が進んでいるという情報が入った。衛星写真には何も写っていない──谷の奥の盆地に隠れているらしい。'
      + '偵察ポッドを積んで谷を低く抜け、施設の真上を通って写真を撮り、生きて持ち帰れ。',
    objectives: ['味方の基地から離陸（A/B で滑走、約 150kt で機首上げ）', '谷を抜けて盆地の敵基地を見つける', '敵基地の真上を低く・水平に通過して空撮（高度 1200m 以下）', '味方の基地まで帰還（RTB）'],
    tips: '対空砲が待っている。谷底を低く飛べば尾根が隠してくれる。撮ったら長居は無用。',
    recon: true,
    aaa: [[700, -300]],
  },
  {
    id: 'm2', no: 2, kind: 'ground', camp: 'OPERATION NEEDLE', code: 'BROKEN FANG', title: '牙を折れ',
    story: '写真の解析で、基地のまわりに対空陣地と地対空ミサイルが並んでいるのが分かった。'
      + '本丸を叩く前に、その牙を折っておく。',
    objectives: ['味方の基地から離陸', '盆地を守る対空砲 2 基と、地対空ミサイル SA-15 を 1 基、すべて破壊', '味方の基地まで帰還（RTB）'],
    tips: '今回は AGM-88 HARM（敵のレーダー電波をたどるミサイル）を 4 発。谷から一瞬上がって見通しを取り、LOCK → SHOOT で撃ったら谷へ戻る（ポップアップ攻撃）。'
      + 'SA-15 のミサイルにフレアは効かない ── 尾根に隠れてレーダーの見通しを切るか、V のチャフで。',
    weapon: 'harm', msl: 4, killAll: true,
    aaa: [[700, -300], [-650, 450]],
    sam: [[1300, 750]],          // 盆地の東の縁：谷底を低く飛べば隠れ、1000m ほど上がると約 6km 先から見える
  },
  {
    id: 'm3', no: 3, kind: 'ground', camp: 'OPERATION NEEDLE', code: 'NEEDLE', title: '針の穴を通せ',
    story: '残された時間はない。谷を抜け、核開発施設そのものを破壊する。針の穴を通すような飛行になる。そして、全員で帰ってくること。',
    objectives: ['核開発施設を破壊', '味方の基地まで帰還（RTB）'],
    soon: true,
  },
  {
    id: 'felon', no: 0, kind: 'air', camp: 'FREE MISSION', code: 'FELON', title: '空戦訓練',
    story: '洋上での空戦訓練。Su-57 が次々と向かってくる。全 5 ウェーブ、最後はエース率いる FELON 編隊。',
    objectives: ['全 5 ウェーブの敵機を撃墜'],
    tips: '敵の後方 2〜4km が 9X の好位置。背後を取る練習には右下の戦術レーダー。',
  },
];

export const missionById = (id) => MISSIONS.find((m) => m.id === id) ?? MISSIONS[0];

// クリアした作戦（ブラウザに保存。読めない環境でも動くように）
const KEY = 'gachi-kusen.cleared';
export function loadCleared() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(); }
}
export function saveCleared(id) {
  const s = loadCleared();
  s.add(id);
  try { localStorage.setItem(KEY, JSON.stringify([...s])); } catch { /* 保存できなくても遊べる */ }
  return s;
}
