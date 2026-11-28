import os, sys, zlib, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import qrgen

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')

URL = 'https://texflow.work/ltec'
# Version 3 level M, which is exactly the configuration verify.py ground-truths
# against the known-good code in the repo: same version, same level, and the
# same single-block layout, so every line of this runs through code that has
# been checked module-for-module against a QR a real encoder produced. Level Q
# would give 25% error correction instead of 15%, but it splits the payload
# into two interleaved blocks -- a path nothing here can verify, and an
# unverified QR is worse than a plain one.
VERSION, ECL, QUIET = 3, 'M', 4

m, mask, pen = qrgen.make(URL, VERSION, ECL)
size = len(m)
span = size + 2 * QUIET
print('%s -> %d bytes, version %d-%s, mask %d, penalty %d, %dx%d (+%d quiet = %d)'
      % (URL, len(URL.encode()), VERSION, ECL, mask, pen, size, size, QUIET, span))
print('capacity at %d-%s is %d bytes' % (VERSION, ECL, qrgen.capacity(VERSION, ECL)))

# ------------------------------------------------------------------- SVG ---
runs = []
for r in range(size):
    c = 0
    while c < size:
        if m[r][c]:
            w = 0
            while c + w < size and m[r][c + w]:
                w += 1
            runs.append('M%d %dh%dv1h-%dz' % (c + QUIET, r + QUIET, w, w))
            c += w
        else:
            c += 1
svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="296" height="296"'
       ' shape-rendering="crispEdges" role="img" aria-label="QR code for %s">'
       '<rect width="%d" height="%d" fill="#ffffff"/>'
       '<path d="%s" fill="#000000"/></svg>\n'
       % (span, span, URL, span, span, ''.join(runs)))
open(os.path.join(ROOT, 'ltec', 'qr.svg'), 'w', encoding='utf-8').write(svg)
print('wrote qr.svg  (%d bytes, %d runs)' % (len(svg), len(runs)))

# ------------------------------------------------------------------- PNG ---
# 8-bit greyscale, one module = 28px exactly, so every module is the same
# width -- no rounding wobble for a decoder to trip on.
SCALE = 28
px = span * SCALE
rows = bytearray()
for y in range(px):
    rows.append(0)                                  # filter: none
    r = y // SCALE - QUIET
    if 0 <= r < size:
        line = bytearray()
        for c in range(span):
            mc = c - QUIET
            v = 0 if (0 <= mc < size and m[r][mc]) else 255
            line.extend(bytes([v]) * SCALE)
        rows.extend(line)
    else:
        rows.extend(b'\xff' * px)

def chunk(tag, data):
    return (struct.pack('>I', len(data)) + tag + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', px, px, 8, 0, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(bytes(rows), 9))
       + chunk(b'IEND', b''))
open(os.path.join(ROOT, 'ltec', 'qr.png'), 'wb').write(png)
print('wrote qr.png  (%dx%d, %d bytes)' % (px, px, len(png)))

# ------------------------------------------------- read it back, honestly ---
# Re-parse the SVG we just wrote and decode it the way a scanner would, using
# none of the state above: read the format bits off the grid, unmask, lift the
# codewords out in zigzag order, check the Reed-Solomon syndromes, and parse
# the payload. If any of this disagrees, the file does not ship.
import re

s2 = open(os.path.join(ROOT, 'ltec', 'qr.svg'), encoding='utf-8').read()
g = [[0] * span for _ in range(span)]
for x, y, w in re.findall(r'M(\d+) (\d+)h(\d+)v1h-\d+z', s2):
    x, y, w = int(x), int(y), int(w)
    for k in range(w):
        g[y][x + k] = 1
back = [row[QUIET:QUIET + size] for row in g[QUIET:QUIET + size]]
assert back == m, 'the SVG does not round-trip to the matrix we built'
print('svg round-trips: True')

fmt_cells = [(8,0),(8,1),(8,2),(8,3),(8,4),(8,5),(8,7),(8,8),(7,8),
             (5,8),(4,8),(3,8),(2,8),(1,8),(0,8)]
un = int(''.join(str(back[r][c]) for r, c in fmt_cells), 2) ^ 0b101010000010010
inv = {v: k for k, v in qrgen.ECL_BITS.items()}
r_ecl, r_mask = inv[(un >> 13) & 0b11], (un >> 10) & 0b111
assert (r_ecl, r_mask) == (ECL, mask), 'format bits say %s/%d' % (r_ecl, r_mask)
print('format bits read back: level %s, mask %d' % (r_ecl, r_mask))

_, res = qrgen.base_matrix(VERSION)
bits = []
col, up = size - 1, True
while col > 0:
    if col == 6:
        col -= 1
    for row in (range(size - 1, -1, -1) if up else range(size)):
        for c in (col, col - 1):
            if not res[row][c]:
                v = back[row][c]
                if qrgen.MASKS[r_mask](row, c):
                    v ^= 1
                bits.append(v)
    up = not up
    col -= 2
cw = [int(''.join(str(b) for b in bits[i:i + 8]), 2) for i in range(0, len(bits) - 7, 8)]

ec_count, groups = qrgen.BLOCKS[(VERSION, ECL)]
assert len(groups) == 1 and groups[0][0] == 1, 'readback below assumes one block'
block = cw[:groups[0][1] + ec_count]
syn = []
for i in range(ec_count):
    acc = 0
    for b in block:
        acc = qrgen.gmul(acc, qrgen.EXP[i]) ^ b
    syn.append(acc)
assert all(s == 0 for s in syn), 'Reed-Solomon syndromes are not zero'
print('Reed-Solomon syndromes: all zero')

mode = block[0] >> 4
length = ((block[0] & 0x0F) << 4) | (block[1] >> 4)
payload = bytes(((block[1 + i] & 0x0F) << 4) | (block[2 + i] >> 4) for i in range(length))
assert mode == 4, 'mode is %d, expected 4 (byte)' % mode
assert payload.decode('utf-8') == URL, 'decoded %r' % payload
print('decoded payload: %r' % payload.decode('utf-8'))
print('\nthe code reads back as what it says on the board')
