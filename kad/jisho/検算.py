# -*- coding: utf-8 -*-
"""コマンド辞書の見張り。

⚠️ kad/jisho/index.html を直したら、必ずこれを通すこと。
   [FAIL] が出たら commit しない。

■ なぜ機械に数えさせるか
この辞書は、手引き（＝K'Ad蔵人の中の教本と同じ文）から引き写した写しです。
写しが増えれば、いつか必ず食い違います。しかも食い違いは、読んでいるだけでは
気づけません——「TR は トリム」と書いてあれば、それが古かろうと正しく見える。
人の目に任せられないものは、機械に数えさせる。この家の作法です。

■ 見張る九項目
  一）項目の骨組みが揃っているか（名前・説明・手引きへの戸）
  二）用事が、決められた六つのどれかか
  三）しぼり込みの言葉に、自分の名前が入っているか
  四）手引きへの戸の先が、実在するか
  五）戸の札に書いた章の題が、その章の題と一致しているか
  六）同じ名前を二度載せていないか
  七）外から何も読み込んでいないか（憲法①）
  八）絵文字を使っていないか（憲法②）
  九）その名前が、手引きの本文に本当に出てくるか（＝写しのずれ）

■ この見張りは、建てた日に九項目とも一つずつ壊して、
   ぜんぶ鳴ることを確かめてあります。項目を足す日も、同じように
   鳴らしてから通すこと。鳴らない見張りは、無いのと同じです。
"""
import os
import re
import sys

KOKO = os.path.dirname(os.path.abspath(__file__))
JISHO = os.path.join(KOKO, 'index.html')
TEBIKI = os.path.normpath(os.path.join(KOKO, '..', 'tebiki'))

YOUJI = ('描く', '測る', '直す', '整える', '出す', 'キー')

shippai = []


def dame(no, hito):
    shippai.append(f'[FAIL] {no}　{hito}')


def moji_dake(h):
    """HTMLから、目に見える文字だけを取り出す"""
    h = re.sub(r'<!--.*?-->|<style.*?</style>|<script.*?</script>', ' ', h, flags=re.S)
    h = re.sub(r'<[^>]+>', ' ', h)
    return re.sub(r'\s+', ' ', h)


def aru(kotoba, honbun):
    """語として出てくるか。英数字の名前は、他の語の中に埋もれた分を数えない
    （'D' が 'DIM' の中で当たってしまうと、照合にならないため）"""
    if re.fullmatch(r'[A-Za-z0-9]+', kotoba):
        return re.search(r'(?<![A-Za-z0-9])' + re.escape(kotoba) + r'(?![A-Za-z0-9])', honbun) is not None
    return kotoba in honbun


def main():
    if not os.path.exists(JISHO):
        print('[FAIL] 辞書そのものがありません:', JISHO)
        return 1
    nama = open(JISHO, encoding='utf-8').read()

    # ── 七）外から何も読み込んでいないか（憲法①）────────────
    # 絵も字も飾りも、ぜんぶこのファイルの中にある約束。回線の細い場所で
    # 真っ白な画面が続かないための決まりなので、一つでも入れば崩れる。
    soto = re.findall(r'<(?:script|link|img|iframe|source)\b[^>]*?'
                      r'(?:src|href)\s*=\s*["\']((?:https?:)?//[^"\']+)', nama, re.I)
    for u in soto:
        dame('七）外から読み込み', f'{u} を外から取ってこようとしています')
    if re.search(r'@import|fonts\.googleapis|cdn\.|unpkg|jsdelivr', nama, re.I):
        dame('七）外から読み込み', '外の書体か部品を呼ぶ書き方が混じっています')

    # ── 八）絵文字を使っていないか（憲法②）──────────────────
    # 絵文字は見る機械によって絵柄が変わる。この道具を必要としている人は
    # たいてい Windows を使っている＝Macで見えている形とは別物が出る。
    # 見るのは「目に見える文字」だけ。板書（コメント）は画面に出ないので数えない。
    # ⌘ ⇧ → ■ のような記号は絵文字ではありません（どの機械でも同じ形で出る）。
    # 化けるのは絵文字のほうで、そこだけを止めます。
    for ch in moji_dake(nama):
        o = ord(ch)
        if (0x1F000 <= o <= 0x1FAFF) or (0x2600 <= o <= 0x27BF) or o in (0xFE0F, 0x200D):
            dame('八）絵文字', f'画面に出る絵文字が混じっています: {ch!r} (U+{o:04X})')
            break

    # ── 項目を一つずつ拾う ──────────────────────────────────
    # 板書（コメント）の中にも項目の書き方の見本が書いてある。先に落とす——
    # 落とさないと、見本を本物と数えて、直後の本物を呑み込んでしまう。
    mi = re.sub(r'<!--.*?-->', '', nama, flags=re.S)
    kos = re.findall(r'<li class="ko"([^>]*)>(.*?)</li>', mi, re.S)
    if not kos:
        dame('一）骨組み', '項目がひとつもありません')
        print('\n'.join(shippai)); return 1

    mita = {}
    sho_kyacshu = {}

    for zoku, naka in kos:
        yo   = (re.search(r'data-yo="([^"]*)"', zoku)   or [None, ''])[1]
        hiku = (re.search(r'data-hiku="([^"]*)"', zoku) or [None, ''])[1]
        tan  = re.search(r'<span class="ko-tan">(.*?)</span>', naka, re.S)
        sei  = re.search(r'<span class="ko-sei">(.*?)</span>', naka, re.S)
        setu = re.search(r'<p class="ko-setu">(.*?)</p>', naka, re.S)
        to   = re.search(r'<p class="ko-to"><a href="([^"]+)">(.*?)</a></p>', naka, re.S)

        na = tan.group(1).strip() if tan else ''
        mishirushi = na or '(名前なし)'

        # ── 一）骨組みが揃っているか ──────────────────────
        if not na:
            dame('一）骨組み', 'ko-tan（短い名前）が無い項目があります')
        if not setu or not setu.group(1).strip():
            dame('一）骨組み', f'{mishirushi}：ko-setu（説明）がありません')
        if not to:
            dame('一）骨組み', f'{mishirushi}：ko-to（手引きへの戸）がありません')

        # ── 二）用事が決められた六つのどれか ─────────────
        if yo not in YOUJI:
            dame('二）用事', f'{mishirushi}：用事が「{yo}」。'
                             f'使えるのは {"・".join(YOUJI)} だけです')

        # ── 三）しぼり込みの言葉に、自分の名前が入っているか ──
        if na and na not in hiku:
            dame('三）しぼり込み', f'{mishirushi}：data-hiku に自分の名前が入っていません'
                                   '（名前で引いても出てきません）')

        # ── 六）同じ名前を二度載せていないか ─────────────
        if na:
            if na in mita:
                dame('六）重複', f'{mishirushi} が二度出てきます')
            mita[na] = True

        if not to:
            continue
        saki, fuda = to.group(1), moji_dake(to.group(2)).strip()

        # ── 四）戸の先が実在するか ───────────────────────
        michi = os.path.normpath(os.path.join(KOKO, saki))
        if not os.path.exists(michi):
            dame('四）戸の先', f'{mishirushi}：{saki} が見あたりません')
            continue

        if michi not in sho_kyacshu:
            h = open(michi, encoding='utf-8').read()
            dai = re.search(r'<title>(.*?)</title>', h, re.S)
            sho_kyacshu[michi] = (
                (dai.group(1).split('—')[0].strip() if dai else ''),
                moji_dake(h),
            )
        sho_dai, sho_honbun = sho_kyacshu[michi]

        # ── 五）札の章名が、その章の題と合っているか ────────
        # 「手引き　8. 作図の手順 →」の、真ん中だけを見る
        fuda_dai = fuda.replace('手引き', '').replace('→', '').strip()
        if sho_dai and fuda_dai and fuda_dai != sho_dai:
            dame('五）章の題', f'{mishirushi}：札は「{fuda_dai}」'
                               f'／実物は「{sho_dai}」。食い違っています')

        # ── 九）その名前が、手引きの本文に本当に出てくるか ──
        # 写しがずれた時に、ここが鳴る。辞書だけ古い、を防ぐ最後の砦。
        if na and not aru(na, sho_honbun):
            dame('九）写しのずれ', f'{mishirushi}：{os.path.basename(saki)} の本文に'
                                   'この名前が出てきません')
        if sei:
            s = moji_dake(sei.group(1)).strip()
            if s and not aru(s, sho_honbun):
                dame('九）写しのずれ', f'{mishirushi}：正式名「{s}」が'
                                       f'{os.path.basename(saki)} の本文にありません')

    if shippai:
        print('\n'.join(shippai))
        print(f'\n[FAIL] {len(shippai)} 件。直してから commit してください。')
        return 1

    print(f'[OK] 項目 {len(kos)} 件。九項目とも通りました。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
