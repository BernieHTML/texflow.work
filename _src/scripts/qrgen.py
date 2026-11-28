"""A small QR encoder, byte mode, versions 1-7.

Written because this machine has no QR library and a QR code that is subtly
wrong is worse than no QR code at all. It is checked against a known-good code
already in the repo (see verify.py), which is the only reason to trust it.
"""

# ---------------------------------------------------------------- GF(256) ---
EXP = [0] * 512
LOG = [0] * 256
_x = 1
for _i in range(255):
    EXP[_i] = _x
    LOG[_x] = _i
    _x <<= 1
    if _x & 0x100:
        _x ^= 0x11D          # the QR primitive polynomial
for _i in range(255, 512):
    EXP[_i] = EXP[_i - 255]


def gmul(a, b):
    if a == 0 or b == 0:
        return 0
    return EXP[LOG[a] + LOG[b]]


def poly_mul(p, q):
    r = [0] * (len(p) + len(q) - 1)
    for i, a in enumerate(p):
        if a:
            for j, b in enumerate(q):
                r[i + j] ^= gmul(a, b)
    return r


def rs_generator(n):
    g = [1]
    for i in range(n):
        g = poly_mul(g, [1, EXP[i]])
    return g


def rs_remainder(data, n):
    g = rs_generator(n)
    rem = list(data) + [0] * n
    for i in range(len(data)):
        c = rem[i]
        if c:
            for j, gj in enumerate(g):
                rem[i + j] ^= gmul(gj, c)
    return rem[len(data):]


# ------------------------------------------------------------- the tables ---
# (ec codewords per block, [(block count, data codewords per block), ...])
BLOCKS = {
    (1, 'L'): (7,  [(1, 19)]),  (1, 'M'): (10, [(1, 16)]),
    (1, 'Q'): (13, [(1, 13)]),  (1, 'H'): (17, [(1, 9)]),
    (2, 'L'): (10, [(1, 34)]),  (2, 'M'): (16, [(1, 28)]),
    (2, 'Q'): (22, [(1, 22)]),  (2, 'H'): (28, [(1, 16)]),
    (3, 'L'): (15, [(1, 55)]),  (3, 'M'): (26, [(1, 44)]),
    (3, 'Q'): (18, [(2, 17)]),  (3, 'H'): (22, [(2, 13)]),
    (4, 'L'): (20, [(1, 80)]),  (4, 'M'): (18, [(2, 32)]),
    (4, 'Q'): (26, [(2, 24)]),  (4, 'H'): (16, [(4, 9)]),
    (5, 'L'): (26, [(1, 108)]), (5, 'M'): (24, [(2, 43)]),
    (5, 'Q'): (18, [(2, 15), (2, 16)]),
    (5, 'H'): (22, [(2, 11), (2, 12)]),
    (6, 'L'): (18, [(2, 68)]),  (6, 'M'): (16, [(4, 27)]),
    (6, 'Q'): (24, [(4, 19)]),  (6, 'H'): (28, [(4, 15)]),
    (7, 'L'): (20, [(2, 78)]),  (7, 'M'): (18, [(4, 31)]),
    (7, 'Q'): (18, [(2, 14), (4, 15)]),
    (7, 'H'): (26, [(4, 13), (1, 14)]),
}
ALIGN = {1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
         7: [6, 22, 38]}
ECL_BITS = {'L': 0b01, 'M': 0b00, 'Q': 0b11, 'H': 0b10}


def capacity(version, ecl):
    """Byte-mode capacity in characters."""
    data_cw = sum(c * d for c, d in BLOCKS[(version, ecl)][1])
    count_bits = 8 if version <= 9 else 16
    return (data_cw * 8 - 4 - count_bits) // 8


# -------------------------------------------------------------- the bits ----
def encode_data(text, version, ecl):
    data = text.encode('utf-8')
    assert len(data) <= capacity(version, ecl), 'too long for %d-%s' % (version, ecl)
    count_bits = 8 if version <= 9 else 16

    bits = []
    def put(value, n):
        for k in range(n - 1, -1, -1):
            bits.append((value >> k) & 1)

    put(0b0100, 4)                 # byte mode
    put(len(data), count_bits)
    for b in data:
        put(b, 8)

    total_data_cw = sum(c * d for c, d in BLOCKS[(version, ecl)][1])
    cap_bits = total_data_cw * 8
    put(0, min(4, cap_bits - len(bits)))        # terminator
    while len(bits) % 8:
        bits.append(0)
    pad = [0xEC, 0x11]
    i = 0
    while len(bits) < cap_bits:
        put(pad[i % 2], 8)
        i += 1

    codewords = [int(''.join(str(b) for b in bits[k:k + 8]), 2)
                 for k in range(0, len(bits), 8)]

    # split into blocks, then interleave data and then ec, as the spec wants
    ec_count, groups = BLOCKS[(version, ecl)]
    blocks, pos = [], 0
    for count, size in groups:
        for _ in range(count):
            blocks.append(codewords[pos:pos + size])
            pos += size
    ecs = [rs_remainder(b, ec_count) for b in blocks]

    out = []
    for i in range(max(len(b) for b in blocks)):
        for b in blocks:
            if i < len(b):
                out.append(b[i])
    for i in range(ec_count):
        for e in ecs:
            out.append(e[i])
    return out


# ------------------------------------------------------------ the matrix ----
def base_matrix(version):
    """Returns (modules, reserved); modules hold 0/1, reserved marks function
    patterns that data must skip."""
    size = 17 + 4 * version
    m = [[0] * size for _ in range(size)]
    res = [[False] * size for _ in range(size)]

    def finder(r0, c0):
        for dr in range(-1, 8):
            for dc in range(-1, 8):
                r, c = r0 + dr, c0 + dc
                if not (0 <= r < size and 0 <= c < size):
                    continue
                inner = 0 <= dr <= 6 and 0 <= dc <= 6
                on = inner and (dr in (0, 6) or dc in (0, 6)
                                or (2 <= dr <= 4 and 2 <= dc <= 4))
                m[r][c] = 1 if on else 0
                res[r][c] = True

    finder(0, 0)
    finder(0, size - 7)
    finder(size - 7, 0)

    for i in range(size):                      # timing
        if not res[6][i]:
            m[6][i] = 1 if i % 2 == 0 else 0
            res[6][i] = True
        if not res[i][6]:
            m[i][6] = 1 if i % 2 == 0 else 0
            res[i][6] = True

    centres = ALIGN[version]
    for r in centres:
        for c in centres:
            if res[r][c]:
                continue                        # overlaps a finder
            for dr in range(-2, 3):
                for dc in range(-2, 3):
                    on = max(abs(dr), abs(dc)) != 1
                    m[r + dr][c + dc] = 1 if on else 0
                    res[r + dr][c + dc] = True

    m[size - 8][8] = 1                          # the always-dark module
    res[size - 8][8] = True

    for i in range(9):                          # format info areas
        if not res[8][i]:
            res[8][i] = True
        if not res[i][8]:
            res[i][8] = True
    for i in range(8):
        res[8][size - 1 - i] = True
        res[size - 1 - i][8] = True

    if version >= 7:
        for i in range(6):
            for j in range(3):
                res[size - 11 + j][i] = True
                res[i][size - 11 + j] = True
    return m, res


def place_data(m, res, codewords, size):
    bits = []
    for cw in codewords:
        for k in range(7, -1, -1):
            bits.append((cw >> k) & 1)
    idx = 0
    col = size - 1
    upward = True
    while col > 0:
        if col == 6:                            # the vertical timing column
            col -= 1
        rows = range(size - 1, -1, -1) if upward else range(size)
        for row in rows:
            for c in (col, col - 1):
                if not res[row][c]:
                    m[row][c] = bits[idx] if idx < len(bits) else 0
                    idx += 1
        upward = not upward
        col -= 2
    return idx


MASKS = [
    lambda i, j: (i + j) % 2 == 0,
    lambda i, j: i % 2 == 0,
    lambda i, j: j % 3 == 0,
    lambda i, j: (i + j) % 3 == 0,
    lambda i, j: (i // 2 + j // 3) % 2 == 0,
    lambda i, j: (i * j) % 2 + (i * j) % 3 == 0,
    lambda i, j: ((i * j) % 2 + (i * j) % 3) % 2 == 0,
    lambda i, j: ((i + j) % 2 + (i * j) % 3) % 2 == 0,
]


def penalty(m):
    size = len(m)
    score = 0

    # rule 1: runs of five or more
    for line in list(m) + [list(col) for col in zip(*m)]:
        run, prev = 1, line[0]
        for v in line[1:]:
            if v == prev:
                run += 1
            else:
                if run >= 5:
                    score += 3 + (run - 5)
                run, prev = 1, v
        if run >= 5:
            score += 3 + (run - 5)

    # rule 2: 2x2 blocks of one colour
    for r in range(size - 1):
        for c in range(size - 1):
            if m[r][c] == m[r][c + 1] == m[r + 1][c] == m[r + 1][c + 1]:
                score += 3

    # rule 3: the finder-lookalike, either way round
    p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]
    p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]
    for line in list(m) + [list(col) for col in zip(*m)]:
        for i in range(size - 10):
            seg = list(line[i:i + 11])
            if seg == p1 or seg == p2:
                score += 40

    # rule 4: how far off a half-dark page it is
    dark = sum(sum(r) for r in m)
    pct = dark * 100.0 / (size * size)
    score += 10 * int(abs(pct - 50) / 5)
    return score


def format_bits(ecl, mask):
    v = (ECL_BITS[ecl] << 3) | mask
    rem = v << 10
    for i in range(4, -1, -1):
        if rem & (1 << (i + 10)):
            rem ^= 0b10100110111 << i
    return ((v << 10) | rem) ^ 0b101010000010010


def place_format(m, ecl, mask):
    """The 15 format bits go MSB first down each of the two runs below."""
    size = len(m)
    bits = [int(b) for b in format(format_bits(ecl, mask), '015b')]
    copy1 = [(8, 0), (8, 1), (8, 2), (8, 3), (8, 4), (8, 5), (8, 7), (8, 8),
             (7, 8), (5, 8), (4, 8), (3, 8), (2, 8), (1, 8), (0, 8)]
    copy2 = [(size - 1, 8), (size - 2, 8), (size - 3, 8), (size - 4, 8),
             (size - 5, 8), (size - 6, 8), (size - 7, 8),
             (8, size - 8), (8, size - 7), (8, size - 6), (8, size - 5),
             (8, size - 4), (8, size - 3), (8, size - 2), (8, size - 1)]
    for cells in (copy1, copy2):
        for b, (r, c) in zip(bits, cells):
            m[r][c] = b


def make(text, version, ecl, force_mask=None):
    codewords = encode_data(text, version, ecl)
    size = 17 + 4 * version
    best = None
    for mask in ([force_mask] if force_mask is not None else range(8)):
        m, res = base_matrix(version)
        place_data(m, res, codewords, size)
        for r in range(size):
            for c in range(size):
                if not res[r][c] and MASKS[mask](r, c):
                    m[r][c] ^= 1
        place_format(m, ecl, mask)
        p = penalty(m)
        if best is None or p < best[0]:
            best = (p, mask, m)
    return best[2], best[1], best[0]


def best_fit(text, prefer_levels=('H', 'Q', 'M', 'L'), max_version=7):
    """Smallest version that holds the text, at the strongest level it allows."""
    n = len(text.encode('utf-8'))
    for version in range(1, max_version + 1):
        for ecl in prefer_levels:
            if n <= capacity(version, ecl):
                return version, ecl
    raise ValueError('does not fit')
