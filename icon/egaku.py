"""縁側屋の絵を、標準ライブラリだけで打つための道具箱。

なぜ道具箱を切り出したか：Xのアイコン（丸）とヘッダー（横長）で、同じ縁側を
別の寸法で二度打つことになった。線を引く・丸を塗る・縮める、をそれぞれの
ファイルに書くと、片方だけ直して食い違う（この家が何度も踏んだ病）。

方針は母屋のアイコン（engawaya_icon.py）と同じ。
  ・Pillowを入れない（憲法①の精神。入れれば済む話だが、入れない作りは残る）
  ・いったん大きく打ってから縮める＝斜めの線のギザギザが消える
  ・線の端をわずかに揺らす＝定規で引いた線に見せない
    （手描きのぶれは「会社ではなく人が作った」の一番強い証拠になる）
  ・揺らしの乱数の種は固定。毎回ちがう絵が出ると「前のに戻したい」が効かない
"""
import random


class E:
    """絵を打つ紙。座標は仕上がり寸法で書く（内部で k 倍して打つ）"""

    def __init__(self, w, h, k=4, tane=20260907):
        self.w, self.h, self.k = w, h, k
        self.W, self.H = w * k, h * k
        self.px = [(255, 255, 255)] * (self.W * self.H)
        self.rnd = random.Random(tane)

    # ── 座標まわり ──────────────────────────────────
    def P(self, v):
        return int(round(v * self.k))

    def yure(self, v, amp=1.6):
        return v + self.rnd.uniform(-amp, amp)

    # ── 塗る ────────────────────────────────────────
    def sora(self, ue, shita, tome=0.62):
        """上から下へのグラデーション。tome は色が下の色に行き着く高さの割合"""
        for y in range(self.H):
            t = min(1.0, y / (self.H * tome))
            c = (int(ue[0] + (shita[0]-ue[0])*t),
                 int(ue[1] + (shita[1]-ue[1])*t),
                 int(ue[2] + (shita[2]-ue[2])*t))
            row = y * self.W
            for x in range(self.W):
                self.px[row+x] = c

    def rect(self, x0, y0, x1, y1, c):
        x0, x1 = max(0, self.P(x0)), min(self.W, self.P(x1))
        y0, y1 = max(0, self.P(y0)), min(self.H, self.P(y1))
        for y in range(y0, y1):
            row = y * self.W
            for x in range(x0, x1):
                self.px[row+x] = c

    def sen(self, x0, y0, x1, y1, c, w, yureru=True):
        """太さ w の直線。端は丸めない（角ばった線のほうが図面らしい）"""
        if yureru:
            x0, y0, x1, y1 = self.yure(x0), self.yure(y0), self.yure(x1), self.yure(y1)
        x0, y0, x1, y1 = self.P(x0), self.P(y0), self.P(x1), self.P(y1)
        pw = max(1, self.P(w))
        hw = pw // 2
        dx, dy = abs(x1-x0), abs(y1-y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx - dy
        while True:
            xa, xb = max(0, x0-hw), min(self.W, x0-hw+pw)
            ya, yb = max(0, y0-hw), min(self.H, y0-hw+pw)
            for y in range(ya, yb):
                row = y * self.W
                for x in range(xa, xb):
                    self.px[row+x] = c
            if x0 == x1 and y0 == y1:
                break
            e2 = err * 2
            if e2 > -dy:
                err -= dy; x0 += sx
            if e2 < dx:
                err += dx; y0 += sy

    def maru(self, cx, cy, r, c):
        cx, cy, r = self.P(cx), self.P(cy), self.P(r)
        for y in range(max(0, cy-r), min(self.H, cy+r+1)):
            dy = y - cy
            if abs(dy) > r:
                continue
            hh = int((r*r - dy*dy) ** 0.5)
            row = y * self.W
            for x in range(max(0, cx-hh), min(self.W, cx+hh+1)):
                self.px[row+x] = c

    def senaka(self, cx_ue, cx_shita, y_ue, y_shita, haba_ue, haba_shita, c):
        """腰かけた後ろ姿の胴。上が肩、下が腰。段ごとに幅を変えて丸みを出す。
        0.7乗にしてあるのは、肩まわりを早く広げて撫で肩にするため"""
        y0, y1 = self.P(y_ue), self.P(y_shita)
        for y in range(max(0, y0), min(self.H, y1)):
            t = (y - y0) / max(1, (y1 - y0))
            haba = (haba_ue + (haba_shita - haba_ue) * (t ** 0.7)) * self.k
            cx = (cx_ue + (cx_shita - cx_ue) * t) * self.k
            row = y * self.W
            for x in range(max(0, int(cx-haba)), min(self.W, int(cx+haba))):
                self.px[row+x] = c

    # ── 仕上げ ──────────────────────────────────────
    def shiage(self, ow=None, oh=None):
        """k倍で打った絵を、仕上がり寸法へ縮めて返す（平均をとる＝なめらかになる）"""
        ow = ow or self.w
        oh = oh or self.h
        return chijimeru(self.px, self.W, self.H, ow, oh)


def chijimeru(src, w, h, ow, oh):
    out = []
    rx, ry = w / ow, h / oh
    for y in range(oh):
        y0, y1 = int(y*ry), max(int(y*ry)+1, int((y+1)*ry))
        for x in range(ow):
            x0, x1 = int(x*rx), max(int(x*rx)+1, int((x+1)*rx))
            n = R = G = B = 0
            for sy in range(y0, y1):
                row = sy * w
                for sx in range(x0, x1):
                    p = src[row+sx]
                    R += p[0]; G += p[1]; B += p[2]; n += 1
            out.append((R//n, G//n, B//n))
    return out
