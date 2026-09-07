"""X（旧Twitter）のプロフィール用アイコン（丸）。

■ なぜ母屋のアイコン（engawaya_1024.png）をそのまま使わないか
  ・Xのアイコンは丸く切り抜かれる。あの絵は寸法線が左右の端まで伸びているので、
    両端の矢が真っ先に切り落とされる。
  ・タイムラインでの表示は48px前後。図面の細い線はそこで灰色のかすれになり、
    何の絵か分からなくなる。
  ・そして何より、左右対称に整ったロゴは見た瞬間「企業の公式」と読まれる。
    このアカウントで解きたいのは「何か売りつけられるのでは」の警戒心なので、
    屋号のロゴを掲げるのは逆向きの手当てになる。

■ 丸に入れるのは屋号ではなく、K'Ad（施主）と蔵人のふたり
  ・背を向けている＝目が合わない。店先で目が合うと人は断れなくなる。その逆。
  ・何もしていない＝売る側には絶対にできない姿勢。売る人は必ず何かしている。
  ・ふたりで先に座っている＝こちらは通りかかっただけの人になれる。ひとりが
    座って待つ絵は「待たれている」になり、断りづらさが生まれる。
  ・右が空けてある。ただし湯呑みは置いていない。用意して待ってはいないが
    座る場所はある、という距離をとるため。

■ 一枚目からの直し（48pxで溶けたので）
  ・家を全部入れるのをやめ、縁側に寄った。ふたりの背丈を1.6倍に。
  ・屋根は丸の上のほうに畳んで、軒下に居ることだけ伝える。
  ・背に障子（ガラス戸）を入れた。「ガラス張りの開発」——中で仕事している
    のが外から見える場所、が縁側という言葉の元の意味なので。ただし薄く。
    48pxまで縮むとほぼ消える濃さにしてあり、消えて構わない。

■ 役割を分ける
  丸＝人、横長（ヘッダー）＝家と仕事場。両方に家を出すと二回名乗ることになり、
  また「公式」の匂いが戻る。だから丸に屋号も寸法線も入れない。

  出力
    x_icon_400.png    ← Xに上げるのはこれ（推奨400x400）
    x_icon_見え方.png  ← 白い画面と黒い画面で、丸に切った姿を大中小で並べた確認用
"""
import egaku
import png

W = 400

INK   = (107,  98,  90)   # #6b625a  線
WOOD  = (198, 154, 109)   # #c69a6d  縁板
SKY_T = (236, 193, 142)   # 母屋より少し濃い。白いタイムラインで輪郭が溶けないため
SKY_B = (249, 228, 199)
AKARI = (253, 241, 216)   # 障子の向こうの灯り。空より明るくないと面に見えない
HAIR  = ( 86,  78,  70)   # 後ろ姿なので頭は髪の色
AI    = ( 77,  94, 112)   # K'Ad（藍）
CHA   = (124,  86,  62)   # 蔵人（焦茶）

LW, THIN, HOSO = 7, 5.5, 3.5
ITA_UE, ITA_SHITA = 296, 326      # 縁板の上面と下面。人はこの上面に腰かける


def hito(e, cx, atama_zure, cloth):
    """縁側に腰かけた後ろ姿ひとり。顔は描かない（誰でもない代わりに誰でもある）"""
    ATAMA_Y, ATAMA_R = 174, 23
    KATA_Y = 190
    KATA_H, KOSHI_H = 32, 42
    F = 4                         # 縁取りの太さ。48pxでも人影として残るように
    # 先に一回り大きい影を打ち、内側を服の色で塗る＝それが輪郭になる
    e.senaka(cx+atama_zure, cx, KATA_Y-F, ITA_UE, KATA_H+F, KOSHI_H+F, INK)
    e.maru(cx+atama_zure, ATAMA_Y, ATAMA_R+F, INK)
    e.senaka(cx+atama_zure, cx, KATA_Y, ITA_UE, KATA_H, KOSHI_H, cloth)
    e.maru(cx+atama_zure, ATAMA_Y, ATAMA_R, HAIR)


def yunomi(e, cx):
    e.rect(cx-9, 281, cx+9, ITA_UE, INK)
    e.rect(cx-6, 284, cx+6, ITA_UE, (236, 230, 218))


def kaku():
    e = egaku.E(W, W)
    e.sora(SKY_T, SKY_B)

    # 障子（ガラス戸）。中に灯りがついている＝人が居て、仕事をしている。
    # 縦の桟は入れない——三本入れたら、ふたりが檻に入って見えた。
    # そして右（272から先）は障子を張らずに開けてある。壁が途切れて空が見える
    # ぶん、その先の縁板が「空いている場所」として読める。
    e.rect(60, 112, 272, ITA_UE, AKARI)
    for x in (60, 272):
        e.sen(x, 112, x, ITA_UE, INK, HOSO)
    for y in (112, 204):
        e.sen(60, y, 272, y, INK, HOSO)

    # 縁板の木。線で囲う前に塗る
    e.rect(28, ITA_UE, 372, ITA_SHITA, WOOD)

    # 地面。丸の外まで伸ばす＝切られた先も続いているように見える
    e.sen(-14, 368, 414, 368, INK, LW)

    # 束石
    for bx in (96, 272):
        e.sen(bx,    ITA_SHITA, bx,    368, INK, THIN)
        e.sen(bx+36, ITA_SHITA, bx+36, 368, INK, THIN)

    # 縁板の輪郭
    e.sen(28, ITA_UE,    372, ITA_UE,    INK, LW)
    e.sen(28, ITA_SHITA, 372, ITA_SHITA, INK, LW)

    # 柱・桁・屋根（人より先に。人が手前に座る）
    e.sen(72,  ITA_UE, 72,  102, INK, THIN)
    e.sen(328, ITA_UE, 328, 102, INK, THIN)
    e.sen(56, 102, 344, 102, INK, LW)
    e.sen(40, 102, 200,  48, INK, LW)
    e.sen(200, 48, 360, 102, INK, LW)

    # 湯呑みはふたりの側だけ。右の空いた所には何も置かない
    yunomi(e, 56)
    yunomi(e, 152)

    # ふたり。中心から左へ寄せる（左右対称は「図面」に見えて固くなる）
    hito(e, 100, +4, AI)     # K'Ad。少し右へ傾く＝隣を向いている
    hito(e, 206, -3, CHA)    # 蔵人
    # 右（248〜372）は障子も無く、縁板が空いたまま。ここが空席

    return e.shiage()


def miekata(icon):
    """確認用。Xに上げる前に「48pxで人影が残っているか」を目で確かめる紙"""
    SW, SH = 720, 300
    SHIRO, KURO = (255, 255, 255), (21, 32, 43)   # Xの明るい画面／暗い画面
    sheet = []
    for _ in range(SH):
        sheet.extend([SHIRO]*360 + [KURO]*360)

    def haru(size, x0, y0, ox):
        small = egaku.chijimeru(icon, W, W, size, size)
        r = size / 2
        for y in range(size):
            for x in range(size):
                if (x-r+0.5)**2 + (y-r+0.5)**2 <= r*r:      # 丸く切る
                    sheet[(y0+y)*SW + (x0+x+ox)] = small[y*size+x]

    for ox in (0, 360):
        haru(200, 24, 50, ox)
        haru(96, 248, 62, ox)
        haru(48, 248, 190, ox)
    return SW, SH, sheet


if __name__ == '__main__':
    icon = kaku()
    png.write('x_icon_400.png', W, W, icon)
    sw, sh, sheet = miekata(icon)
    png.write('x_icon_見え方.png', sw, sh, sheet)
    print('書きました x_icon_400.png / x_icon_見え方.png')
