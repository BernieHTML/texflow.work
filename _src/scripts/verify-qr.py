"""Check qrgen against a QR code we did not make.

qr-reference.svg is the code that used to sit at ltec/qr.svg, produced by some
other encoder entirely for the old /ltec-system URL. If qrgen reproduces it
module for module -- and picks the same mask on its own -- then the bit
stream, Reed-Solomon, interleaving, placement, masking and format bits are all
right. Nothing else in here is worth trusting on its own, so run this after
any change to qrgen.py.

    python3 _src/scripts/verify-qr.py
"""
import os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import qrgen

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'qr-reference.svg')
TEXT = 'https://texflow.work/ltec-system'

svg = open(SRC, encoding='utf-8').read()
vb = re.search(r'viewBox="0 0 (\d+) (\d+)"', svg)
span = int(vb.group(1))
runs = re.findall(r'M(\d+) (\d+)h(\d+)v1h-\d+z', svg)
assert runs, 'no runs parsed'

grid = [[0] * span for _ in range(span)]
for x, y, w in runs:
    x, y, w = int(x), int(y), int(w)
    for k in range(w):
        grid[y][x + k] = 1

# strip the quiet zone: find the tight bounding box of dark modules
rows = [r for r in range(span) if any(grid[r])]
cols = [c for c in range(span) if any(grid[r][c] for r in range(span))]
r0, r1, c0, c1 = min(rows), max(rows), min(cols), max(cols)
target = [row[c0:c1 + 1] for row in grid[r0:r1 + 1]]
size = len(target)
print('parsed %dx%d code (viewBox %d, quiet zone %d)' % (size, len(target[0]), span, r0))
assert size == len(target[0])
version = (size - 17) // 4
print('that is version', version, '-', len(TEXT.encode()), 'bytes of payload')

hit = None
for ecl in 'LMQH':
    if len(TEXT.encode()) > qrgen.capacity(version, ecl):
        print('  %s: payload does not fit (cap %d)' % (ecl, qrgen.capacity(version, ecl)))
        continue
    for mask in range(8):
        m, _, _ = qrgen.make(TEXT, version, ecl, force_mask=mask)
        if m == target:
            hit = (ecl, mask)
            print('  MATCH at level %s, mask %d' % (ecl, mask))
    if hit and hit[0] == ecl:
        auto, amask, _ = qrgen.make(TEXT, version, ecl)
        print('  (our own mask choice at %s would be %d)' % (ecl, amask))

if not hit:
    print('NO MATCH - the encoder is wrong, stop here')
    sys.exit(1)
print('\nencoder reproduces the existing code exactly')
