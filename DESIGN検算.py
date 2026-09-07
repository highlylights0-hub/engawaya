# -*- coding: utf-8 -*-
"""見た目の見張り。DESIGN.md と、実際のHTMLを突き合わせます。

⚠️ 色・字・寸法・リンクまわりを直したら、必ずこれを通すこと。
   [FAIL] が出たら commit しない。

    python3 DESIGN検算.py

■ なぜ機械に数えさせるか
この家は憲法①（外から何も読み込まない）のせいで、**共通のCSSファイルを持てません**。
棟が増えるたび、色の表がまるごと写されます。写しが増えれば必ず食い違う——
しかも食い違いは、読んでいるだけでは気づけません。
「a に色を当てる規則が、このページには無い」は、目で追っても見つからないのです。
実際、素の青いリンク（#0000EE）は六つの棟に三十四日以上ありました。
誰も嘘をついていません。人の目が、**無いものを見つけられない**だけです。

■ 見張る八項目
  一）色表と実物が合っているか（DESIGN.md 1-1／1-2／1-3 と各ページの宣言）
  二）共通の表を使っているのに、棟割り（1-4）に名前が無いページはないか
  三）リンクの色を決める「総括の a」があるか（素の青の予防）
  四）持つべき暗い顔を持っているか（母屋なら night、手引きなら暗い側の塊）
  五）焦点の枠を消しっぱなしにしていないか
  六）暗い側の塊が、明るい側より「あと」に置かれているか
  七）憲法①：外から読み込んでいないか
  八）憲法②：画面に出るところに絵文字が無いか

■ 例外と宿題
DESIGN.md の「1-5 表と違えている棟」と「2. まだ床に届いていない組」に、
**理由と日付つきで**載っているものは [宿題] として数え、[FAIL] にしません。
理由が書けないものは、食い違いではなく、ただの直し忘れです。

■ この見張りは、建てた日に八項目とも一つずつ壊して、
   ぜんぶ鳴ることを確かめてあります。項目を足す日も、同じように
   鳴らしてから通すこと。鳴らない見張りは、無いのと同じです。
"""
import os
import re
import sys

ココ = os.path.dirname(os.path.abspath(__file__))
正典 = os.path.join(ココ, 'DESIGN.md')

失敗 = []
宿題 = []


def だめ(番号, 言うこと):
    失敗.append(f'[FAIL] {番号}　{言うこと}')


def 保留(言うこと):
    宿題.append(f'[宿題] {言うこと}')


# ────────────────────────────────────────────────────────────
#  下ごしらえ
# ────────────────────────────────────────────────────────────

def 表を読む(本文, 目印):
    """DESIGN.md の <!-- 検算:… --> の直後にある表を、行の配列で返す。

    印を打っておかないと、見出しの文字を変えた日に見張りが黙って外れます。
    目印はコメントなので、読む人の邪魔にもなりません。
    """
    i = 本文.find(f'<!-- 検算:{目印} -->')
    if i < 0:
        return []
    行 = []
    for l in 本文[i:].splitlines()[1:]:
        l = l.strip()
        if not l:
            if 行:
                break
            continue
        if not l.startswith('|'):
            if 行:
                break
            continue
        欄 = [c.strip() for c in l.strip('|').split('|')]
        if all(set(c) <= set('-: ') for c in 欄):   # 表の区切り線
            continue
        行.append(欄)
    return 行[1:] if 行 else []                     # 一行目は見出し


def 値(欄):
    """`#aabbcc` のような書き方から、色だけ取り出す。「—」は None"""
    m = re.search(r'`(#[0-9a-fA-F]{3,8})`', 欄)
    return m.group(1).lower() if m else None


def 名(欄):
    m = re.search(r'`(--[a-z0-9-]+)`', 欄)
    return m.group(1) if m else None


def 棟の名(欄):
    return re.findall(r'`([^`]+)`', 欄)


def 見える文字(h):
    """HTMLから、画面に出る文字だけを取り出す（板書・style・script を落とす）"""
    h = re.sub(r'<!--.*?-->|<style.*?</style>|<script.*?</script>', ' ', h, flags=re.S)
    h = re.sub(r'<[^>]+>', ' ', h)
    return re.sub(r'\s+', ' ', h)


# 「絵として出る」のが既定の記号のうち、この家に出てきそうなもの。
# ⚠️ここは記号ぜんぶを禁じる場所ではありません。
#   憲法②が止めたいのは「**見る機械によって絵柄が変わるもの**」だけ。
#   矢印（← → ↑ ↓）・丸数字（①②）・図形（□ ● ▼）・鍵の字（⌘ ⌥ ⇧）・
#   チェック（✓ ✕）は、どこで見ても同じ形の**字**なので、通します。
#   実際この家は「→」を43枚で使っています。これを鳴らす見張りは、
#   すぐ切られて、無いのと同じになります。
絵が既定 = {
    '✊', '✋', '✌', '✅', '❌', '❎',
    '➕', '➖', '➗', '❓', '❔', '❕', '❗',
    '❤', '⭐', '⭕', '⏰', '⏳', '⁉', '‼',
}


def 絵文字を探す(文字):
    """画面に出る文字から、絵として出るものだけを拾う。

    見分け方は二つ。
      ・U+1F000 より上（絵文字のために作られた区画）
      ・うしろに異体字（U+FE0F）が付いている＝「**絵として出せ**」という指定
    それに、絵が既定の少数（上の表）を足します。
    """
    出 = set()
    for i, ch in enumerate(文字):
        cp = ord(ch)
        if cp in (0xFE0F, 0xFE0E, 0x200D):
            continue
        絵として出せ = (i + 1 < len(文字) and 文字[i + 1] == '️')
        if cp >= 0x1F000 or 絵として出せ or ch in 絵が既定:
            出.add(ch + ('️' if 絵として出せ else ''))
    return 出


def かたまり(css, 頭):
    """`頭` から始まる塊を、波かっこの数を数えて切り出す。位置と中身を返す"""
    i = css.find(頭)
    if i < 0:
        return None, None
    j = css.find('{', i)
    深さ, k = 0, j
    while k < len(css):
        if css[k] == '{':
            深さ += 1
        elif css[k] == '}':
            深さ -= 1
            if 深さ == 0:
                return i, css[j + 1:k]
        k += 1
    return i, css[j + 1:]


def 印刷を除く(css):
    """@media print の塊を落とす。印刷用の a{color:#000} を「総括の a」と
       数えてしまうと、三）が素通りになるため"""
    出 = css
    while True:
        i = 出.find('@media print')
        if i < 0:
            return 出
        j = 出.find('{', i)
        深さ, k = 0, j
        while k < len(出):
            if 出[k] == '{':
                深さ += 1
            elif 出[k] == '}':
                深さ -= 1
                if 深さ == 0:
                    break
            k += 1
        出 = 出[:i] + 出[k + 1:]


def style(h):
    return '\n'.join(re.findall(r'<style[^>]*>(.*?)</style>', h, flags=re.S))


def 板書を落とす(css):
    return re.sub(r'/\*.*?\*/', ' ', css, flags=re.S)


def 宣言(css, セレクタ):
    """`セレクタ { --名: 値; }` を辞書で返す。見つからなければ None"""
    m = re.search(re.escape(セレクタ) + r'\s*\{([^{}]*)\}', css)
    if not m:
        return None
    return {a: b.strip().lower() for a, b in
            re.findall(r'(--[a-z0-9-]+)\s*:\s*([^;]+);', m.group(1))}


# ────────────────────────────────────────────────────────────

def main():
    if not os.path.exists(正典):
        print('[FAIL] DESIGN.md が見つかりません')
        return 1
    正 = open(正典, encoding='utf-8').read()

    # ---- 正典から表を起こす ----
    母屋 = {}       # 変数 -> {顔: 値}
    for r in 表を読む(正, '色表:母屋'):
        n = 名(r[0])
        if n:
            母屋[n] = dict(zip(('素', '朝', '昼', '夕', '夜'), [値(c) for c in r[2:7]]))
    選 = {}
    for r in 表を読む(正, '色表:選'):
        n = 名(r[0])
        if n:
            選[n] = {'黒地': 値(r[2]), '白地': 値(r[3])}
    遊 = {}
    for r in 表を読む(正, '色表:遊'):
        n = 名(r[0])
        if n:
            遊[n] = {'素': 値(r[2])}

    棟割り = {}
    for r in 表を読む(正, '棟割り'):
        表名 = r[0].strip()
        for t in 棟の名(r[1]):
            棟割り[t.rstrip('/') or t] = 表名

    # 例外表：(棟, 変数, 実物) の組を許す
    許す = set()
    for r in 表を読む(正, '例外'):
        棟 = (棟の名(r[0]) or [''])[0].rstrip('/')
        for v in re.findall(r'`(--[a-z0-9-]+)`', r[1]) or ['*']:
            for 実 in re.findall(r'`(#[0-9a-fA-F]{3,8})`', r[3]) or ['*']:
                許す.add((棟, v, 実.lower()))
        # 「変数の名」の行＝名前だけの違い。値では突き合わせない
        if '名' in r[1]:
            for v in re.findall(r'`(--[a-z0-9-]+)`', r[2] + ' ' + r[3]):
                許す.add((棟, v, '*'))

    # 絵文字の例外：まだ抜けていない絵と、その理由・日付
    絵の例外 = set()
    for r in 表を読む(正, '憲法例外'):
        棟名 = (棟の名(r[0]) or [''])[0].rstrip('/')
        for ch in 絵文字を探す(r[1]):
            絵の例外.add((棟名, ch))

    if not (母屋 and 選 and 遊 and 棟割り):
        print('[FAIL] DESIGN.md の表が読めません（<!-- 検算:… --> の印を消していませんか）')
        return 1

    # ---- 家じゅうのHTMLを集める ----
    頁 = []
    for 根, _, 名前ら in os.walk(ココ):
        if '/.git' in 根:
            continue
        for f in 名前ら:
            if f.endswith('.html'):
                p = os.path.join(根, f)
                頁.append((os.path.relpath(p, ココ), open(p, encoding='utf-8').read()))
    頁.sort()

    def 棟(み):
        """そのページが、どの棟として棟割り表に載っているか"""
        for 鍵 in (み, os.path.dirname(み), os.path.dirname(み) + '/'):
            k = 鍵.rstrip('/')
            if k in 棟割り:
                return k, 棟割り[k]
        if み.startswith('kad/tebiki'):
            return 'kad/tebiki', '手引き'
        return None, None

    共有の名 = set(母屋) | set(選) | set(遊)

    for み, h in 頁:
        鍵, どの表 = 棟(み)
        css = 板書を落とす(style(h))
        素 = 宣言(css, ':root') or {}

        # ── 二）共通の表を使っているのに、棟割りに載っていない ──
        # 新しい棟を建てて、正典に名乗り出るのを忘れた日に鳴る。
        使っている = {k for k in 素 if k in 共有の名}
        if 使っている and どの表 is None:
            だめ('二）棟割り', f'{み}：共通の色（{"、".join(sorted(使っている))}）を'
                               '使っていますが、DESIGN.md 1-4 に名前がありません')
            continue
        if どの表 is None:
            continue

        # ── 一）色表と実物が合っているか ──
        def 突き合わせ(表, 顔, セレクタ):
            宣 = 宣言(css, セレクタ)
            if 宣 is None:
                return
            for n, v in 宣.items():
                if n not in 表:
                    continue
                期待 = 表[n][顔]
                if 期待 is None:                       # 「—」＝その顔では変えない
                    期待 = 表[n].get('素')
                if 期待 is None or v == 期待:
                    continue
                if (鍵, n, v) in 許す or (鍵, n, '*') in 許す:
                    保留(f'{み}：{n}（{顔}）が {v}。表は {期待}'
                         '（DESIGN.md 1-5 に理由つきで載っています）')
                else:
                    だめ('一）色表', f'{み}：{n}（{顔}）が {v}。'
                                     f'DESIGN.md の表は {期待} です')

        if どの表 == '母屋':
            突き合わせ(母屋, '素', ':root')
            for 顔, セル in (('朝', 'morning'), ('昼', 'day'), ('夕', 'evening'), ('夜', 'night')):
                突き合わせ(母屋, 顔, f'html[data-time="{セル}"]')
        elif どの表 == '選ばせる':
            突き合わせ(選, '黒地', ':root')
            突き合わせ(選, '白地', 'html.shiroi')
        elif どの表 == '遊び場':
            突き合わせ(遊, '素', ':root')

        # ── 三）リンクの色を決める総括の a があるか ──
        # 「どこそこの a」で数え上げると必ず数え落とす。総括で受けているか見る。
        if re.search(r'<a\s[^>]*href=', h):
            見る = 印刷を除く(css)
            総括 = re.search(r'(?:^|[};])\s*a\s*(?:,[^{};]*)?\{[^{}]*\bcolor\s*:', 見る)
            if not 総括:
                だめ('三）リンクの色', f'{み}：リンクがあるのに「a {{ color: … }}」が'
                                       'ありません。閲覧機の既定の青（#0000EE）が出ます')

        # ── 四）持つべき暗い顔を持っているか ──
        if どの表 == '母屋' and 'html[data-time="night"]' not in css:
            だめ('四）暗い顔', f'{み}：母屋の表の棟なのに、夜の顔'
                               '（html[data-time="night"]）がありません')
        if どの表 == '手引き' and 'prefers-color-scheme' not in css:
            だめ('四）暗い顔', f'{み}：手引きなのに、暗い側の塊がありません')

        # ── 五）焦点の枠を消しっぱなしにしていないか ──
        if re.search(r'outline\s*:\s*none', css):
            代わり = re.search(r':focus-visible[^{}]*\{[^{}]*outline\s*:\s*(?!none)', css)
            if not 代わり:
                だめ('五）焦点の枠', f'{み}：outline:none を書いていますが、'
                                     ':focus-visible の代わりの枠がありません')

        # ── 六）暗い側の塊が、いちばんあとに置かれているか ──
        # 同じ強さの規則は、あとに書いたほうが勝つ。先に書くと塊ごと死ぬ。
        if 'prefers-color-scheme' in css:
            # ⚠️位置を測る紙と、切り出す紙は同じものにすること。
            #   印刷を落とす前の位置で、落としたあとの文字列を切ると、ずれます
            #   （建てた日に実際にやりました。34枚ぜんぶが誤って鳴りました）。
            見る = 印刷を除く(css)
            位置, _ = かたまり(見る, '@media (prefers-color-scheme')
            if 位置 is None:
                位置, _ = かたまり(見る, '@media(prefers-color-scheme')
            あと = 見る[位置:] if 位置 is not None else ''
            # 暗い塊より後ろに、メディアに入っていない素の規則が残っていないか
            残り = re.sub(r'@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}', ' ', あと)
            if re.search(r'[};]\s*[^{}@\s][^{}]*\{[^{}]*(?:color|background)\s*:', 残り):
                だめ('六）カスケード', f'{み}：暗い側の塊のうしろに、明るい側の指定が'
                                       '残っています。あとの規則が勝つので、暗い側が死にます')

        # ── 七）憲法①：外から読み込んでいないか ──
        外 = []
        if re.search(r'@import', h):
            外.append('@import')
        if re.search(r'@font-face', h):
            外.append('@font-face')
        if re.search(r'url\(\s*["\']?https?:', h):
            外.append('url(https:…)')
        if re.search(r'<link[^>]+rel=["\']?stylesheet[^>]*href=["\']https?:', h):
            外.append('外部のstylesheet')
        if re.search(r'<script[^>]+src=["\']https?:', h):
            外.append('外部のscript')
        if re.search(r'<img[^>]+src=["\']https?:', h):
            外.append('外部の画像')
        if 外:
            だめ('七）憲法①', f'{み}：外から読み込んでいます（{"、".join(外)}）')

        # ── 八）憲法②：画面に出るところに絵文字が無いか ──
        絵 = 絵文字を探す(見える文字(h))
        for ch in sorted(絵):
            if (鍵, ch) in 絵の例外 or (鍵, '*') in 絵の例外:
                保留(f'{み}：画面に絵文字「{ch}」が出ています'
                     '（DESIGN.md 1-6 に理由つきで載っています）')
            else:
                だめ('八）憲法②', f'{み}：画面に絵文字「{ch}」が出ています。'
                                  '見る機械で絵柄が変わります。点を打って描くこと')

    # ---- 宿題（床に届いていない組）を数えて出す ----
    床 = 表を読む(正, '宿題')
    for r in 床:
        保留(f'読めることの床：{r[0]}　実測 {r[1]}　（{r[3]}）')

    if 宿題:
        print('\n'.join(宿題))
        print()
    if 失敗:
        print('\n'.join(失敗))
        print(f'\n[FAIL] {len(失敗)} 件。直してから commit してください。')
        return 1

    print(f'[OK] {len(頁)} 枚。八項目とも通りました。'
          + (f'（宿題 {len(宿題)} 件は、理由つきで DESIGN.md に載っています）' if 宿題 else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
