"""宵の印（三日月と「縁」）から、家で使う三枚の札を書き出す。

    python3 icon/en-yoi.py

■ 正はどれか
  icon/en-yoi-1024.png（1024×1024）。博喜さんが X のアイコンに使っている絵と同じ一枚。
  元の絵（VectorCraft のファイル）は、デスクトップの「縁アイコン」フォルダにある。
  ⚠️書き出した三枚（下）を直接いじらない。絵を替えたい日は、1024 の一枚を替えてからこれを回す。

■ 書き出す三枚
  apple-touch-icon.png（180）… iPhone のホーム画面。角は iPhone が丸める＝四角いまま渡す。
  favicon.png（32）        … ブラウザのタブ。
  icon/en-yoi.png（192）   … 屋号の左の丸い印（kihon.css の .ie-mark::before が丸く切る）。

■ なぜ小さい札だけ、切り抜いてから縮めるか
  1024 の絵をそのまま 32 まで縮めると、まわりの余白のぶん「縁」の字が小さくなって潰れた。
  三日月がふちに触れるところまで寄ってから縮めると、字が二まわり大きく残る
  （2026-11-20、二通りを並べて見比べて決めた）。
"""
import os
from PIL import Image   # 絵を読み書きする道具（Pillow）

ココ = os.path.dirname(os.path.abspath(__file__))
ネ = os.path.dirname(ココ)

moto = Image.open(os.path.join(ココ, 'en-yoi-1024.png')).convert('RGB')

# LANCZOS＝縮めるときに、にじみの少ない計算のしかた
moto.resize((180, 180), Image.LANCZOS).save(os.path.join(ネ, 'apple-touch-icon.png'), optimize=True)
moto.resize((192, 192), Image.LANCZOS).save(os.path.join(ココ, 'en-yoi.png'), optimize=True)

# 小さい札：三日月いっぱいまで寄る（左 110・上 90 から、824 四方）
yori = moto.crop((110, 90, 934, 914))
yori.resize((32, 32), Image.LANCZOS).save(os.path.join(ネ, 'favicon.png'), optimize=True)

print('書き出しました：apple-touch-icon.png（180）・favicon.png（32）・icon/en-yoi.png（192）')
