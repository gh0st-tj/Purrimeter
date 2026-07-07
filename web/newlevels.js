// Design + validate 8 new campaign levels
const C = require('./core.js');

const DEFS = [
  { name: 'Tight Squeeze', tip: 'A tiny garden. Every single fence counts here.', walls: 5, map: [
    '......',
    '.#.y..',
    '.#C...',
    '......',
    '.~~...',
    '......',
  ]},
  { name: 'The Corridor', tip: 'The rocks form a hallway. Seal the ends — mind the side gaps!', walls: 7, map: [
    '............',
    '.####.####..',
    '.C.......t..',
    '.####.####..',
    '............',
    '............',
  ]},
  { name: 'Twin Ponds', tip: 'Two ponds, lots of yarn. Which bank is worth fencing?', walls: 8, map: [
    '.........',
    '..~~.y...',
    '..~......',
    '....C....',
    '.y....~~.',
    '.....y~..',
    '.t.......',
    '.........',
    '.........',
  ]},
  { name: 'Double Trouble', tip: 'TWO box pairs. The cat can hop across the whole garden.', walls: 8, map: [
    '.........',
    '.~~~.....',
    '.~1y.....',
    '.~~......',
    '...###...',
    '....C12..',
    '...###...',
    '.~~~.....',
    '.~2t~....',
    '.........',
  ]},
  { name: 'Cucumber Alley', tip: 'A wall of cucumbers guards the tuna. Through, around… or on top?', walls: 10, map: [
    '........',
    '.y.u....',
    '...u....',
    '.C.u..t.',
    '...u....',
    '.~~u....',
    '.~.u....',
    '...u..y.',
    '........',
    '........',
  ]},
  { name: 'The Moat', tip: 'The pond nearly encircles her. But the riches are outside…', walls: 6, map: [
    '..........',
    '..~~~~~...',
    '..~...~...',
    '..~.C.~...',
    '..~...~t..',
    '..~~.~~...',
    '..........',
    '....y...y.',
    '..........',
    '..........',
  ]},
  { name: 'Rock Maze', tip: 'Rocks everywhere — free walls if you pick the right pocket.', walls: 10, map: [
    '...........',
    '.#..y..#...',
    '...##......',
    '.t.....#.u.',
    '...#.C.....',
    '.#.....#...',
    '...#.....y.',
    '.u...#.....',
    '.y.....#.t.',
    '...#.......',
    '...........',
  ]},
  { name: 'Grand Garden', tip: 'The final exam. Ponds, boxes, tuna, cucumbers — and 12 fences.', walls: 12, map: [
    '...........',
    '.y.....u...',
    '..~~....u..',
    '...~y...1..',
    '.##..t.....',
    '.#..C..~~..',
    '.......~...',
    '...u.y.....',
    '.u1.....t..',
    '...........',
    '...........',
  ]},
];

for (const def of DEFS) {
  let lv;
  try { lv = C.parseLevel(def); } catch (e) { console.log('PARSE FAIL', def.name, e.message); continue; }
  let best = 0, bf = new Set();
  for (const seed of [7, 99, 1234]) {
    const s = C.solve(lv, { iters: 22000, restarts: 6, seed });
    if (s.best > best) { best = s.best; bf = s.fences; }
  }
  const ev = C.evaluate(lv, bf);
  let items = { y: 0, t: 0, u: 0, box: 0 };
  for (const k of ev.reachable) {
    const ch = C.cellCh(lv, Math.floor(k / 100), k % 100);
    if (ch === 'y') items.y++; else if (ch === 't') items.t++;
    else if (ch === 'u') items.u++; else if (ch >= '1' && ch <= '3') items.box++;
  }
  console.log(`=== ${lv.name} (${lv.rows}x${lv.cols}, walls ${lv.walls}) target=${best} fences=${bf.size} in:{yarn:${items.y},tuna:${items.t},cuke:${items.u},box:${items.box}}`);
  // solution map
  const out = [];
  for (let r = 0; r < lv.rows; r++) {
    let row = '';
    for (let c = 0; c < lv.cols; c++) {
      const k = C.key(r, c);
      if (bf.has(k)) row += 'F';
      else if (ev.reachable.has(k) && lv.map[r][c] === '.') row += '*';
      else row += lv.map[r][c];
    }
    out.push(row);
  }
  console.log(out.join('\n') + '\n');
}
