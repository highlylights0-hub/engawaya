"""標準ライブラリだけのPNG読み書き。Pillowを入れずに済ませるための最小実装。

Ochi-geeの素材は RGB(colour type 2) + tRNS の単色透過なので、そこだけ確実に扱えればよい。
（tRNSを落とすとブロックが「白い板」になるので、透過色は必ず拾う）
"""
import zlib, struct


def read(path):
    """PNGを読んで (w, h, pixels, trns) を返す。pixels は [(r,g,b), ...] の平坦な列。
    trns は単色透過の (r,g,b)、無ければ None。"""
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'PNGではない'

    pos = 8
    idat = b''
    plte = None
    trns = None
    w = h = depth = ctype = None

    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos+4])[0]
        typ = data[pos+4:pos+8]
        body = data[pos+8:pos+8+ln]
        pos += 12 + ln                      # 長さ4 + 型4 + 本体 + CRC4

        if typ == b'IHDR':
            w, h, depth, ctype = struct.unpack('>IIBB', body[:10])
        elif typ == b'PLTE':
            plte = [tuple(body[i:i+3]) for i in range(0, len(body), 3)]
        elif typ == b'tRNS':
            if ctype == 2 and len(body) >= 6:
                # 16bit値で入っているので上位バイトだけ取る
                trns = (body[1], body[3], body[5])
        elif typ == b'IDAT':
            idat += body
        elif typ == b'IEND':
            break

    assert depth == 8, f'8bit以外は未対応 (depth={depth})'
    raw = zlib.decompress(idat)

    nch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    stride = w * nch

    # フィルタ解除。PNGは行ごとに5種類の差分方式のどれかで圧縮されている
    out = bytearray()
    prev = bytearray(stride)
    p = 0
    for _ in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p+stride]); p += stride
        if f == 1:      # Sub
            for i in range(nch, stride):
                line[i] = (line[i] + line[i-nch]) & 255
        elif f == 2:    # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:    # Average
            for i in range(stride):
                a = line[i-nch] if i >= nch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:    # Paeth
            for i in range(stride):
                a = line[i-nch] if i >= nch else 0
                b = prev[i]
                c = prev[i-nch] if i >= nch else 0
                pa, pb, pc = abs(b-c), abs(a-c), abs(a+b-2*c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out += line
        prev = line

    px = []
    for i in range(w * h):
        s = i * nch
        if ctype == 2:
            px.append((out[s], out[s+1], out[s+2]))
        elif ctype == 6:
            px.append((out[s], out[s+1], out[s+2], out[s+3]))
        elif ctype == 3:
            px.append(plte[out[s]])
        elif ctype == 0:
            v = out[s]; px.append((v, v, v))
        elif ctype == 4:
            v = out[s]; px.append((v, v, v, out[s+1]))
    return w, h, px, trns


def write(path, w, h, px):
    """RGB(アルファ無し)でPNGを書く。App Storeのアイコンは透過禁止なので常に不透明。"""
    raw = bytearray()
    for y in range(h):
        raw.append(0)                       # フィルタなし。潰れて困る絵ではない
        for x in range(w):
            r, g, b = px[y*w + x][:3]
            raw += bytes((r, g, b))

    def chunk(typ, body):
        return (struct.pack('>I', len(body)) + typ + body
                + struct.pack('>I', zlib.crc32(typ + body) & 0xffffffff))

    out = b'\x89PNG\r\n\x1a\n'
    out += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    out += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    out += chunk(b'IEND', b'')
    open(path, 'wb').write(out)
