#!/usr/bin/env python3
"""Purrimeter level validator + target-score optimizer.

Mirrors the Swift engine exactly:
- Grid of cells: grass '.', water '~', rock '#'
- Cat 'C' (on grass), items on grass: y=yarn(+3), t=tuna(+10), u=cucumber(-5),
  1/2 = box portal pair (cat teleports between them)
- Player places fences on any non-water, non-rock, non-cat cell (items ok; a
  fenced item tile is blocked and its bonus is lost).
- Reachability: BFS from cat, 4-dir, blocked by water/rock/fence. Standing on a
  box teleports to the paired box (if pair not fenced).
- Escape: any reachable cell on the grid border -> escaped, score 0.
- Score: each reachable cell = 1 point, + item bonus on that cell.
"""
import random, sys
from collections import deque

BONUS = {'y': 3, 't': 10, 'u': -5}

class Level:
    def __init__(self, name, walls, rows):
        self.name, self.walls = name, walls
        self.rows = rows
        self.h, self.w = len(rows), len(rows[0])
        assert all(len(r) == self.w for r in rows), name
        self.cat = None
        self.boxes = {}
        for r in range(self.h):
            for c in range(self.w):
                ch = rows[r][c]
                if ch == 'C': self.cat = (r, c)
                if ch in '12': self.boxes.setdefault(ch, []).append((r, c))
        assert self.cat, name
        for k, v in self.boxes.items():
            assert len(v) == 2, (name, k, v)

    def ch(self, rc):
        return self.rows[rc[0]][rc[1]]

    def legal_fence_cells(self):
        out = []
        for r in range(self.h):
            for c in range(self.w):
                if self.rows[r][c] not in '~#C':
                    out.append((r, c))
        return out

def evaluate(lv, fences):
    """Return score (0 if escaped)."""
    fences = set(fences)
    blocked = fences
    seen = {lv.cat}
    q = deque([lv.cat])
    pair = {}
    for k, (a, b) in lv.boxes.items():
        pair[a] = b; pair[b] = a
    escaped = False
    while q:
        cur = q.popleft()
        r, c = cur
        if r == 0 or c == 0 or r == lv.h - 1 or c == lv.w - 1:
            escaped = True
        nxt = []
        if cur in pair and pair[cur] not in blocked:
            nxt.append(pair[cur])
        for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < lv.h and 0 <= nc < lv.w:
                nxt.append((nr, nc))
        for n in nxt:
            if n in seen or n in blocked: continue
            if lv.ch(n) in '~#': continue
            seen.add(n); q.append(n)
    if escaped: return 0, seen
    s = 0
    for cell in seen:
        s += 1 + BONUS.get(lv.ch(cell), 0)
    return s, seen

def optimize(lv, iters=30000, restarts=12, seed=1):
    rng = random.Random(seed)
    cells = lv.legal_fence_cells()
    best, best_f = 0, frozenset()
    for _ in range(restarts):
        f = set(rng.sample(cells, min(lv.walls, len(cells))))
        cur, _ = evaluate(lv, f)
        T = 3.0
        for i in range(iters):
            T = max(0.02, T * 0.9997)
            g = set(f)
            m = rng.random()
            if m < 0.55 and g:
                g.remove(rng.choice(list(g))); g.add(rng.choice(cells))
            elif m < 0.8 and len(g) < lv.walls:
                g.add(rng.choice(cells))
            elif g:
                g.remove(rng.choice(list(g)))
            if len(g) > lv.walls: continue
            ns, _ = evaluate(lv, g)
            if ns >= cur or rng.random() < pow(2.718, (ns - cur) / T):
                f, cur = g, ns
                if cur > best:
                    best, best_f = cur, frozenset(f)
    return best, best_f

def show(lv, fences, seen):
    out = []
    for r in range(lv.h):
        row = ''
        for c in range(lv.w):
            if (r, c) in fences: row += 'F'
            elif (r, c) in seen and lv.ch((r,c)) == '.': row += '*'
            else: row += lv.ch((r, c))
        out.append(row)
    return '\n'.join(out)

LEVELS = [
    Level("Cozy Corner", 4, [
        "~~~~...",
        "~.C....",
        "~......",
        "~~.....",
        ".......",
        ".......",
        ".......",
    ]),
    Level("Stretch Out", 8, [
        ".......",
        ".......",
        "...C...",
        "..~~...",
        "..~....",
        ".......",
        ".......",
    ]),
    Level("Yarn Day", 7, [
        "........",
        "..y.....",
        ".~~.y...",
        ".~C.....",
        ".~......",
        "....y...",
        "........",
    ]),
    Level("Tuna Heist", 8, [
        "........",
        ".##.....",
        ".#t.....",
        "........",
        "..C.....",
        ".~~.....",
        ".~....y.",
        "........",
    ]),
    Level("Cucumber Patch", 9, [
        ".........",
        "..u......",
        "....y....",
        ".u..C..~~",
        "....y..~.",
        "..u......",
        "....u....",
        ".........",
    ]),
    Level("Box Magic", 6, [
        "........",
        ".~~~....",
        ".~1y....",
        ".~y.....",
        ".~~.....",
        "...##...",
        "...#C1..",
        "...##...",
        "........",
    ]),
    Level("Garden Party", 8, [
        ".........",
        ".t...~~..",
        ".....~...",
        "..C......",
        ".~~....u.",
        ".~..y....",
        "....u..y.",
        ".........",
    ]),
    Level("Masterpiece", 9, [
        "..........",
        ".y..##..t.",
        "....#.....",
        "..1...C...",
        ".~~.......",
        ".~...u.u..",
        "..y...u...",
        ".....1....",
        ".t........",
        "..........",
    ]),
]

if __name__ == '__main__':
    for lv in LEVELS:
        best, f = optimize(lv)
        _, seen = evaluate(lv, f)
        print(f"=== {lv.name} ({lv.h}x{lv.w}, walls {lv.walls}) best={best}")
        print(show(lv, f, seen))
        print()
