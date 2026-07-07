#!/usr/bin/env python3
"""Region-based optimizer: search over connected enclosures containing the cat."""
import random, math, sys
import levelcheck as L

DIRS = ((1,0),(-1,0),(0,1),(0,-1))

def solve(lv, iters=25000, restarts=8, seed=7):
    rng = random.Random(seed)
    pair = {}
    for k, (a, b) in lv.boxes.items():
        pair[a] = b; pair[b] = a

    def passable(p):
        return lv.ch(p) not in '~#'

    def interior_ok(p):
        r, c = p
        return 0 < r < lv.h-1 and 0 < c < lv.w-1 and passable(p)

    def cost_and_fences(R):
        """Fences = grass neighbors outside R (interior or border) + fenced twins."""
        f = set()
        for (r, c) in R:
            for dr, dc in DIRS:
                n = (r+dr, c+dc)
                if n in R: continue
                if not (0 <= n[0] < lv.h and 0 <= n[1] < lv.w): continue
                if passable(n): f.add(n)
            if (r, c) in pair and pair[(r, c)] not in R:
                f.add(pair[(r, c)])
        return f

    def score(R):
        return sum(1 + L.BONUS.get(lv.ch(p), 0) for p in R)

    def connected(R):
        it = iter(R); start = next(it)
        seen = {start}; st = [start]
        while st:
            r, c = st.pop()
            for dr, dc in DIRS:
                n = (r+dr, c+dc)
                if n in R and n not in seen:
                    seen.add(n); st.append(n)
                if (r,c) in pair and pair[(r,c)] in R and pair[(r,c)] not in seen:
                    seen.add(pair[(r,c)]); st.append(pair[(r,c)])
        return len(seen) == len(R)

    best_s, best_f = 0, None
    if not interior_ok(lv.cat):
        return 0, set()

    for _ in range(restarts):
        R = {lv.cat}
        cur_obj = -1e9
        T = 4.0
        for i in range(iters):
            T = max(0.05, T*0.9996)
            R2 = set(R)
            if rng.random() < 0.6 or len(R) <= 1:
                # grow: random frontier cell
                frontier = []
                for (r, c) in R:
                    for dr, dc in DIRS:
                        n = (r+dr, c+dc)
                        if n not in R and interior_ok(n): frontier.append(n)
                    if (r,c) in pair and pair[(r,c)] not in R and interior_ok(pair[(r,c)]):
                        frontier.append(pair[(r,c)])
                if not frontier: continue
                R2.add(rng.choice(frontier))
            else:
                cand = rng.choice(list(R))
                if cand == lv.cat: continue
                R2.discard(cand)
                if not connected(R2): continue
            f2 = cost_and_fences(R2)
            s2 = score(R2)
            over = max(0, len(f2) - lv.walls)
            obj = s2 - 12*over
            if obj >= cur_obj or rng.random() < math.exp((obj-cur_obj)/T):
                R, cur_obj = R2, obj
                if over == 0:
                    # cross-check with the real engine
                    real, _ = L.evaluate(lv, f2)
                    if real > best_s:
                        best_s, best_f = real, f2
    return best_s, best_f or set()

if __name__ == '__main__':
    lo, hi = int(sys.argv[1]), int(sys.argv[2])
    for lv in L.LEVELS[lo:hi]:
        s, f = solve(lv)
        _, seen = L.evaluate(lv, f)
        print(f'=== {lv.name} ({lv.h}x{lv.w}, walls {lv.walls}) best={s} fences_used={len(f)}')
        print(L.show(lv, f, seen)); print(flush=True)
