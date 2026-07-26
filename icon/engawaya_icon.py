"""縁側屋（母屋）のホーム画面アイコン。

絵は描き起こしていない。トップページに既にある縁側の図（index.html の
class="kanban" のSVG）の座標を、そのまま写して打っている。
あの12本の線が縁側屋の看板なので、別の絵を用意する理由がない。

  出典 viewBox 0 0 430 190
    地面    M24 143 H406
    束石    74,116 26x27 / 308,116 26x27
    縁板    58,103 292x13（木の色で塗ってから線で囲う）
    柱      100,103 V44 / 308,103 V44
    桁      84,44 H324
    屋根    70,44 L204 14 L338 44
    寸法    58,120 V172 / 350,120 V172 / 58,166 H350 と両端の矢
    文字    1,820

  色（index.html の CSS 変数から）
    線     --ink-soft  #6b625a
    寸法   --accent    #a95c2a（夕方の値）
    木     --wood-1    #c69a6d
    地     --sky-top #f3cfa2 → --sky-bottom #fae7cd（夕方の値）

夕方の色を選んだ理由：縁側は夕方に座る場所だから。それと、白いホーム画面に
並べたとき、淡い生成りより温かい飴色のほうが見つけやすい。

「1,820」の数字は落とした。180pxまで縮めると読めない汚れになるため。
寸法線と矢は残してあるので「図面である」ことは伝わる。
"""
import png

SIZE = 1024

INK   = (107, 98, 90)      # #6b625a  線
ACC   = (169, 92, 42)      # #a95c2a  寸法
WOOD  = (198, 154, 109)    # #c69a6d  縁板
SKY_T = (243, 207, 162)    # #f3cfa2
SKY_B = (250, 231, 205)    # #fae7cd

# ── 出典のviewBoxから、この四角の中への写し ──────────────
#   横は 58〜350（縁側の幅）を 880px に伸ばす
#   縦は 14〜172（屋根の頂点から寸法線の下まで）を、その倍率のまま中央へ
SRC_X0, SRC_X1 = 58, 350
SRC_Y0, SRC_Y1 = 14, 172
S  = 880 / (SRC_X1 - SRC_X0)
OX = 72
OY = (SIZE - (SRC_Y1 - SRC_Y0) * S) / 2

LW   = 13    # 線の太さ。出典は1.4だが、それをそのまま縮めると180pxで消える
THIN = 8     # 寸法線


def X(x): return OX + (x - SRC_X0) * S
def Y(y): return OY + (y - SRC_Y0) * S


def sky():
    img = []
    for y in range(SIZE):
        t = min(1.0, y / (SIZE * 0.62))          # 出典のグラデーションと同じ 62%
        c = (int(SKY_T[0] + (SKY_B[0] - SKY_T[0]) * t),
             int(SKY_T[1] + (SKY_B[1] - SKY_T[1]) * t),
             int(SKY_T[2] + (SKY_B[2] - SKY_T[2]) * t))
        img.extend([c] * SIZE)
    return img


def fill(img, x0, y0, x1, y1, c):
    x0, x1 = max(0, int(x0)), min(SIZE, int(x1))
    y0, y1 = max(0, int(y0)), min(SIZE, int(y1))
    for y in range(y0, y1):
        row = y * SIZE
        for x in range(x0, x1):
            img[row + x] = c


def line(img, x0, y0, x1, y1, c, w):
    """太さ w の直線。端は丸めない（角ばった線のほうが図面らしい）。"""
    x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
    dx, dy = abs(x1 - x0), abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx - dy
    h = w // 2
    while True:
        fill(img, x0 - h, y0 - h, x0 - h + w, y0 - h + w, c)
        if x0 == x1 and y0 == y1:
            break
        e2 = err * 2
        if e2 > -dy:
            err -= dy; x0 += sx
        if e2 < dx:
            err += dx; y0 += sy


def poly(img, pts, c, w, close=False):
    for i in range(len(pts) - 1):
        line(img, X(pts[i][0]), Y(pts[i][1]), X(pts[i+1][0]), Y(pts[i+1][1]), c, w)
    if close:
        line(img, X(pts[-1][0]), Y(pts[-1][1]), X(pts[0][0]), Y(pts[0][1]), c, w)


def shrink(src, w, box):
    out = []
    r = w / box
    for y in range(box):
        y0, y1 = int(y * r), max(int(y * r) + 1, int((y + 1) * r))
        for x in range(box):
            x0, x1 = int(x * r), max(int(x * r) + 1, int((x + 1) * r))
            n = R = G = B = 0
            for sy in range(y0, y1):
                row = sy * w
                for sx in range(x0, x1):
                    p = src[row + sx]
                    R += p[0]; G += p[1]; B += p[2]; n += 1
            out.append((R // n, G // n, B // n))
    return out


if __name__ == '__main__':
    img = sky()

    # 木を先に塗る（線で囲う前に。出典でも最後に「実体になる」のはここ）
    fill(img, X(58), Y(103), X(350), Y(116), WOOD)

    # 地面。出典は24〜406だが、この四角では左右の端まで伸ばす
    line(img, 40, Y(143), SIZE - 40, Y(143), INK, LW)

    # 束石（左右）
    for bx in (74, 308):
        poly(img, [(bx, 116), (bx+26, 116), (bx+26, 143), (bx, 143)], INK, LW, close=True)

    # 縁板
    poly(img, [(58, 103), (350, 103), (350, 116), (58, 116)], INK, LW, close=True)

    # 柱
    poly(img, [(100, 103), (100, 44)], INK, LW)
    poly(img, [(308, 103), (308, 44)], INK, LW)

    # 桁
    poly(img, [(84, 44), (324, 44)], INK, LW)

    # 屋根
    poly(img, [(70, 44), (204, 14), (338, 44)], INK, LW)

    # 寸法（補助線・寸法線・両端の矢）
    poly(img, [(58, 120), (58, 172)], ACC, THIN)
    poly(img, [(350, 120), (350, 172)], ACC, THIN)
    poly(img, [(58, 166), (350, 166)], ACC, THIN)
    poly(img, [(64, 162), (58, 166), (64, 170)], ACC, THIN)
    poly(img, [(344, 162), (350, 166), (344, 170)], ACC, THIN)

    png.write('engawaya_1024.png', SIZE, SIZE, img)
    for n in (180, 152, 120, 32):
        png.write(f'engawaya_{n}.png', n, n, shrink(img, SIZE, n))
    print('書きました engawaya_1024 / 180 / 152 / 120 / 32')
