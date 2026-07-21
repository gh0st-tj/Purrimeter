'use strict';

// Pure engine tests — no server dependencies, always runnable with `node --test`.
const test = require('node:test');
const assert = require('node:assert');
const core = require('../shared/core');

test('parseLevel derives dimensions and locates the cat', () => {
  const lv = core.parseLevel({ name: 't', walls: 4, map: ['....', '.C..', '....'] });
  assert.equal(lv.rows, 3);
  assert.equal(lv.cols, 4);
  assert.deepEqual(lv.cat, [1, 1]);
});

test('web/core.js stays byte-identical to shared/core.js', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const shared = fs.readFileSync(path.join(__dirname, '../shared/core.js'), 'utf8');
  const web = fs.readFileSync(path.join(__dirname, '../web/core.js'), 'utf8');
  assert.equal(web, shared, 'run the parts through verify:core-sync — the engines have drifted');
});

test('every campaign level is enclosed by its baked solution and hits its target', () => {
  assert.ok(core.CAMPAIGN.length > 0, 'expected a non-empty campaign');
  for (const lv of core.CAMPAIGN) {
    const parsed = core.parseLevel(lv);
    const ev = core.evaluate(parsed, new Set(lv.solution || []));
    assert.ok(!ev.escaped, `${lv.name}: baked solution should keep the cat enclosed`);
    assert.equal(ev.score, lv.target, `${lv.name}: solution score should equal the stated target`);
  }
});

test('campaign names are unique and late-game mechanics matter to their solutions', () => {
  const byName = new Map(core.CAMPAIGN.map(lv => [lv.name, lv]));
  assert.equal(byName.size, core.CAMPAIGN.length, 'campaign progress is keyed by unique level name');

  const inside = name => {
    const lv = byName.get(name);
    const ev = core.evaluate(lv, new Set(lv.solution));
    return [...ev.reachable].map(k => core.cellCh(lv, Math.floor(k / 100), k % 100));
  };
  const crown = byName.get('Cucumber Crown');
  assert.ok(crown.solution.some(k => core.cellCh(crown, Math.floor(k / 100), k % 100) === 'u'),
    'Cucumber Crown should reward fencing on a cucumber');
  assert.equal(inside('Pantry Portal').filter(ch => ch === '1').length, 2,
    'Pantry Portal should use both ends of its portal');
  assert.equal(inside('Three Wishes').filter(ch => ch >= '1' && ch <= '3').length, 4,
    'Three Wishes should make the optimum choose two of three portal pairs');
  assert.equal(byName.get('Diamond District').solution.length, 1,
    'Diamond District should keep its one-fence reveal');
  assert.equal(inside('Grand Garden').filter(ch => ch === '1').length, 2,
    'Grand Garden should use its portal pair');
  assert.equal(inside('Grand Garden').filter(ch => ch === 't').length, 2,
    'Grand Garden should claim both tuna rewards');
  assert.equal(inside('Grand Garden').filter(ch => ch === 'u').length, 0,
    'Grand Garden should avoid its cucumber shortcut');
});

test('clearing a migrated campaign level unlocks its immediate successor', () => {
  const levels = [{ name: 'Inserted Garden' }, { name: 'Tuna Lock' }, { name: 'Stepping Stones' }, { name: 'Later' }];
  const progress = { 'Tuna Lock': { score: 30, stars: 3 } };
  assert.ok(core.campaignLevelUnlocked(levels, 2, progress),
    'Next level should open after the currently cleared garden even when an inserted level is still uncleared');
  assert.equal(core.campaignLevelUnlocked(levels, 3, progress), false,
    'clearing one garden should not unlock non-adjacent later levels');
});

test('the cat escapes an open garden (no fences) on level 1', () => {
  const lv = core.parseLevel(core.CAMPAIGN[0]);
  const ev = core.evaluate(lv, new Set());
  assert.ok(ev.escaped, 'with no fences the cat should reach the edge');
});

test('solve() finds an enclosing solution for a generated daily', () => {
  const lv = core.generateLevel(core.dayNumber() * 2654435761 % 2 ** 31);
  const sol = core.solve(lv, { iters: 6000, restarts: 3, seed: 1 });
  const ev = core.evaluate(lv, new Set(sol.fences));
  assert.ok(!ev.escaped, 'solver output should enclose the cat');
  assert.ok(ev.score > 0, 'an enclosed garden should score above zero');
});
