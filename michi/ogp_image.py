"""道のおすそわけ（michi/）の看板画像 ogp.png（1200x630）を打つ。

なぜこの絵か：LINE がリンクをカードに作り替えるとき、最初は母屋の
家のアイコンが出ていた。それだと「不動産の情報かと思うかも」
（2026-07-30 施主の実地試験の声）。ここは道をおすそわけする場所
なので、看板も道の絵にする——出発の緑、到着の赤、くねる一本道。

受け取った人の「その道の簡略図」をカードに出すことはできない
（カードの絵は LINE の機械が先に取りに来る固定画像で、道のデータを
読めるのは開いた人の端末だけ）。だから看板は「道の絵が届く場所だ」と
一目で伝わる、代表の一本を打つ。

作法は母屋のアイコン（icon/engawaya_icon.py）と同じ：
  外の道具（Pillow）を入れず、icon/png.py（標準ライブラリだけの
  PNG書き）で、点をひとつずつ打つ。色は夕方の値。縁側は夕方に座る
  場所だから、看板も夕方の色で揃える。
  右下のものさし（寸法線）は母屋のアイコンと同じ「図面である」の印。

使い方：  python3 ogp_image.py   →  ogp.png ができる
"""
import sys, os, math

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icon"))
import png

W, H = 1200, 630          # OGP の定番寸法（約1.91:1）。LINE も Slack もこの札を使う

# 色（index.html の CSS 変数・夕方の値から）
SKY_T = (243, 207, 162)   # #f3cfa2 空の上
SKY_B = (250, 231, 205)   # #fae7cd 空の下
ROUTE = (15, 118, 110)    # #0f766e 道の線（ページの --route と同じ）
START = (26, 127, 55)     # #1a7f37 出発の緑
GOAL  = (192, 57, 43)     # #c0392b 到着の赤
INK_S = (107, 98, 90)     # #6b625a ものさし


def sky():
    """夕方の空。母屋のアイコンと同じく 62% で下の色へ溶ける。"""
    img = []
    for y in range(H):
        t = min(1.0, y / (H * 0.62))
        c = (int(SKY_T[0] + (SKY_B[0] - SKY_T[0]) * t),
             int(SKY_T[1] + (SKY_B[1] - SKY_T[1]) * t),
             int(SKY_T[2] + (SKY_B[2] - SKY_T[2]) * t))
        img.append([c] * W)
    return img


def dot(img, cx, cy, r, color):
    """塗りつぶした丸をひとつ打つ。"""
    for y in range(max(0, int(cy - r)), min(H, int(cy + r) + 1)):
        for x in range(max(0, int(cx - r)), min(W, int(cx + r) + 1)):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                img[y][x] = color


def brush(img, pts, r, color):
    """点の列に沿って、丸い筆でなぞる（2pxごとに丸を置く＝角も丸くつながる）。"""
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        length = math.hypot(x1 - x0, y1 - y0)
        steps = max(1, int(length / 2))
        for i in range(steps + 1):
            t = i / steps
            dot(img, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, color)


def main():
    img = sky()

    # くねる一本道。左下（出発）から右上（到着）へ。
    # タクシーの道らしく、まっすぐ行かずに角を二つ三つ曲がる形にした。
    road = [(150, 500), (280, 470), (350, 396), (316, 316), (420, 250),
            (560, 274), (700, 214), (830, 240), (920, 172), (1040, 150)]
    brush(img, road, 14, ROUTE)

    # 出発（緑）と到着（赤）。ページの絵と同じ言葉づかい。
    dot(img, road[0][0], road[0][1], 30, START)
    dot(img, road[-1][0], road[-1][1], 30, GOAL)

    # ものさし（右下）。母屋のアイコンが寸法線を残しているのと同じ、
    # 「これは図面の仲間だ」と伝える印。
    bx, by, bl = 900, 560, 210
    brush(img, [(bx, by), (bx + bl, by)], 4, INK_S)
    brush(img, [(bx, by - 14), (bx, by + 14)], 4, INK_S)
    brush(img, [(bx + bl, by - 14), (bx + bl, by + 14)], 4, INK_S)

    # png.write は「y*W+x で引く一列の並び」を受け取る（icon/png.py の作法）。
    # 描くあいだは行の入れ子のほうが分かりやすいので、最後にここで並べ直す。
    flat = [c for row in img for c in row]
    png.write(os.path.join(os.path.dirname(os.path.abspath(__file__)), "ogp.png"), W, H, flat)
    print("書きました ogp.png (1200x630)")


if __name__ == "__main__":
    main()
