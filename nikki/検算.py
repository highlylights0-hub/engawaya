#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""開発日記の見張り（縁側屋・2026-08-20 新設）

なぜ要るか＝この帳面を建てた日に、書いた蔵人（私）が自分で二つ間違えたからです。
  ⑴ 8月20日の一件を、8月19日の記事より下に置いた（日付の順が崩れた）
  ⑵ 「まだ配っていない」と書いた工事が、その数分後にはもう配られていた
どちらも**読んでいるだけでは気づけない**種類の間違いです。目で確かめるのではなく、
機械に数えさせる——これは母屋（K'Ad蔵人）の検査台と同じ作法です。

使い方：  python3 nikki/検算.py
        （縁側屋のどこで打っても構いません。全部 [OK] なら、そのまま commit してよい）

⚠️見張りは「鳴ること」を確かめて初めて見張りになります。この見張りも、作った日に
  わざと壊して[FAIL]が出ることを確かめてあります。項目を足す日も同じようにしてください。
"""
import re, sys, datetime, pathlib, subprocess

HERE = pathlib.Path(__file__).resolve().parent
HTML = HERE / "index.html"
FUDA = {"jotai-todoke": "お届けずみ", "jotai-tsuzuku": "つくっている途中", "jotai-miokuri": "見送りました"}

ok = fail = 0
def miru(namae, jouken, kuwashiku=""):
    global ok, fail
    if jouken:
        ok += 1;  print(f"  [OK]   {namae}")
    else:
        fail += 1; print(f"  [FAIL] {namae}" + (f"  … {kuwashiku}" if kuwashiku else ""))

s = HTML.read_text(encoding="utf-8")

# 「画面に出る字」＝板書（コメント）と script/style を外したもの。
# ⚠️札の検査はここを見る。帳面の本体（記事の列）だけを見ていると、
#   読み方の板に四つ目の札が生えても気づけない（実際、見張りを作った日に
#   壊して確かめたら、そこだけ鳴らなかった）。
mieru = re.sub(r"<!--.*?-->", "", s, flags=re.S)
mieru = re.sub(r"<script.*?</script>", "", mieru, flags=re.S)
mieru = re.sub(r"<style.*?</style>", "", mieru, flags=re.S)

# 記事の列は、板書にも雛形が入っているので「▼」より後ろだけを見る
honbun = s.split("▼ 新しい日記は、この下へ")[-1]
kiji = re.findall(r'<article class="hi">(.*?)</article>', honbun, re.S)

def hiku(a, cls):
    m = re.search(r'class="' + cls + r'[^"]*">([^<]*)<', a)
    return m.group(1).strip() if m else ""

print(f"\n開発日記の検算（{HTML}）  記事 {len(kiji)} 件\n")

# ① 日付が新しい順（上が新しい）
def hidzuke(j):
    m = re.match(r'(\d+)年(\d+)月(\d+)日', j)
    return datetime.date(*map(int, m.groups())) if m else None
hi = [hidzuke(hiku(a, "hi-date")) for a in kiji]
miru("日付が新しい順に並んでいる",
     all(h is not None for h in hi) and all(hi[i] >= hi[i+1] for i in range(len(hi)-1)),
     "上から順に " + " / ".join(str(h) for h in hi))

# ② 札は三つだけ（四つ目を作らない）
shiranai = set(re.findall(r'class="hi-jotai ([a-z0-9_-]+)"', mieru)) - set(FUDA)
miru("札は三種類だけ（増やしていない）", not shiranai, f"知らない札: {shiranai}")

# ③ どの記事にも 日付・道具・札・見出し・署名 がある
kakete = [i+1 for i, a in enumerate(kiji)
          if not (hiku(a, "hi-date") and hiku(a, "hi-dougu") and hiku(a, "hi-jotai")
                  and "<h2>" in a and "hi-sho" in a)]
miru("どの記事にも 日付・道具・札・見出し・署名 がある", not kakete, f"欠けている記事: {kakete}")

# ④ K'Ad蔵人の「お届けずみ」には版（窯の号数）が要る
#    ⚠️版の無い「お届けずみ」は、読む人が自分の版と見くらべられない＝この帳面の値打ちが消える
nashi = [i+1 for i, a in enumerate(kiji)
         if hiku(a, "hi-dougu") == "K'Ad蔵人" and "jotai-todoke" in a and "号窯" not in hiku(a, "hi-ban")]
miru("K'Adの「お届けずみ」には窯の号数が書いてある", not nashi, f"号数の無い記事: {nashi}")

# ⑤ 「つくっている途中」に号数を書いていない（まだ世に出ていない番号を名乗らない）
nanotta = [i+1 for i, a in enumerate(kiji) if "jotai-tsuzuku" in a and "号窯" in hiku(a, "hi-ban")]
miru("「つくっている途中」が、まだ出ていない号数を名乗っていない", not nanotta, f"名乗っている記事: {nanotta}")

# ⑥ 縁側屋の憲法①＝外から何も読み込まない
soto = [u for u in re.findall(r'(?:src|href)\s*=\s*["\'](https?://[^"\']+)', s)]
miru("外から何も読み込んでいない（憲法①）", not soto, f"外への読み込み: {soto}")

# ⑦ 縁側屋の憲法②＝絵文字を使わない（絵はドットで打つ）
#    ⚠️見るのは**画面に出る字だけ**。板書（コメント）の中の ⚠️ や ① は蔵人が読む字なので数えない。
#    ⌘・丸数字・▼は「絵文字」ではなく記号＝機械が変わっても形が変わらないので通す
#    （kad は前から ⌘ を使っている）。捕まえたいのは 🍦 のように機械ごとに絵柄が変わる字と、
#    ⚠️ のような絵文字化する記号（U+FE0F が付くと絵になる）です。
emoji = sorted({c for c in mieru if ord(c) >= 0x1F300 or ord(c) == 0xFE0F or 0x2600 <= ord(c) <= 0x27BF})
miru("画面に絵文字を出していない（憲法②）", not emoji, f"見つかった絵: {emoji}")

# ⑧ リンクの行き先が、この家に本当にあるか
saki = [h for h in re.findall(r'href="(/[^"#]*)"', s)]
nai = [h for h in saki if not (HERE.parent / h.lstrip("/") / "index.html").exists()
                       and not (HERE.parent / h.lstrip("/")).exists()
                       and h != "/"]
miru("リンクの行き先が実在する", not nai, f"見つからない行き先: {nai}")

# ⑨ 日記の号数が、本当に配られている版と合っているか
#    📌これが、この見張りでいちばん効く一項です。2026-08-20（建てた日）に、家の札が
#      二枚とも古くなっていた——母屋の表が百二十五号、kad の札が百二十四号、
#      ところが実物は**百二十六号窯**でした。札は黙って古くなる。人は気づけない。
#    ⚠️見るのは origin/main（＝GitHubが配っている実物）。手元のファイルは、焼いた直後で
#      まだ押されていないことがあります。コミットの題も当てになりません
#      （配る.sh が母屋の題を借りるので、同じ題が二回並ぶ）。だからバイトを数えます。
kiban = pathlib.Path.home() / "Desktop" / "gcad-web"
kama = set()
if (kiban / "index.wasm").exists():
    r = subprocess.run(["git", "-C", str(kiban), "show", "origin/main:index.wasm"],
                       capture_output=True)
    b = r.stdout
    for off in range(4):                      # 4バイトの境目が分からないので四通り試す
        t = b[off:len(b) - ((len(b) - off) % 4)].decode("utf-32-le", "ignore")
        kama |= set(re.findall(r"十五期[一二三四五六七八九十百千]+号窯", t))

if kama:
    ue = next((hiku(a, "hi-ban") for a in kiji
               if hiku(a, "hi-dougu") == "K'Ad蔵人" and "jotai-todoke" in a), "")
    miru("日記のいちばん上の版＝いま配られている版",
         ue.replace(" ", "").replace("\u3000", "") in kama,
         f"配られているのは {' '.join(kama)} ／ 日記のいちばん上は「{ue}」"
         "  ← 焼いた日に日記を書き足し忘れていませんか")
else:
    print("  [--]   配られている版との照合（手元に gcad-web が無いので見送りました）")

print(f"\n  {ok} 件 [OK] / {fail} 件 [FAIL]\n")
sys.exit(1 if fail else 0)
