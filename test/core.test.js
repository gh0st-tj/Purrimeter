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
