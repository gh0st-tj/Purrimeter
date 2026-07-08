'use strict';

// Server tests. The pure-helper tests run whenever the server deps are installed
// (`cd server && npm ci`). The integration tests additionally require a MongoDB
// reachable via MONGODB_URI (CI provides a service container); otherwise skipped.
const test = require('node:test');
const assert = require('node:assert');

let server = null;
try {
  server = require('../server/src/index');
} catch (e) {
  // Server dependencies (fastify, mongodb, …) not installed — skip server tests.
}

const noServer = server ? false : 'server deps not installed (run: cd server && npm ci)';

test('starCount uses 3 / ceil(80%) / else thresholds', { skip: noServer }, () => {
  assert.equal(server.starCount(10, 10), 3);
  assert.equal(server.starCount(11, 10), 3);
  assert.equal(server.starCount(8, 10), 2); // ceil(8) = 8
  assert.equal(server.starCount(9, 10), 2);
  assert.equal(server.starCount(7, 10), 1);
});

test('validateName enforces the 3–14 charset rule', { skip: noServer }, () => {
  assert.equal(server.validateName('Mochi'), 'Mochi');
  assert.equal(server.validateName('  Mo  chi '), 'Mo chi');
  assert.equal(server.validateName('ab'), null);
  assert.equal(server.validateName('x'.repeat(15)), null);
  assert.equal(server.validateName('bad*name'), null);
});

test('signed friend codes round-trip and reject tampering', { skip: noServer }, () => {
  const secret = 'unit-test-secret';
  const id = '507f1f77bcf86cd799439011';
  const code = server.signedFriendCode(id, secret);
  assert.match(code, /^PURR2-/);
  assert.equal(server.parseFriendCode(code, secret), id);
  assert.equal(server.parseFriendCode(code, 'other-secret'), null);
  assert.equal(server.parseFriendCode(code.slice(0, -1) + '0', secret), null);
  assert.equal(server.parseFriendCode('not-a-code', secret), null);
});

const noDb = noServer || (process.env.MONGODB_URI ? false : 'no MONGODB_URI (integration test skipped)');

test('daily submit: abuse paths are rejected, valid solve scores once', { skip: noDb }, async (t) => {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-session-secret';
  process.env.SHARE_SECRET = process.env.SHARE_SECRET || 'ci-share-secret';
  const core = require('../shared/core');

  const app = await server.buildServer();
  t.after(() => app.close());

  const reg = await app.inject({ method: 'POST', url: '/api/register', payload: {} });
  assert.equal(reg.statusCode, 200);
  const token = reg.json().token;
  const headers = { authorization: 'Bearer ' + token };

  // Missing token → 401.
  const noAuth = await app.inject({ method: 'GET', url: '/api/daily' });
  assert.equal(noAuth.statusCode, 401);

  const daily = await app.inject({ method: 'GET', url: '/api/daily', headers });
  assert.equal(daily.statusCode, 200);
  const d = daily.json();
  const lv = core.parseLevel(d.def);

  // No fences → the cat escapes → 422.
  const escaped = await app.inject({
    method: 'POST', url: '/api/daily/submit', headers,
    payload: { day: d.day, fences: [] },
  });
  assert.equal(escaped.statusCode, 422);

  // A real enclosing solution → 200 with a positive score.
  const sol = core.solve(lv, { iters: 6000, restarts: 3, seed: 1 });
  const first = await app.inject({
    method: 'POST', url: '/api/daily/submit', headers,
    payload: { day: d.day, fences: [...sol.fences] },
  });
  assert.equal(first.statusCode, 200);
  const body = first.json();
  assert.ok(body.score > 0);
  assert.ok(body.stars >= 1 && body.stars <= 3);

  // Second submit for the same day → 409 (one submission per player).
  const again = await app.inject({
    method: 'POST', url: '/api/daily/submit', headers,
    payload: { day: d.day, fences: [...sol.fences] },
  });
  assert.equal(again.statusCode, 409);

  // Invalid friend code → 400.
  const badFriend = await app.inject({
    method: 'POST', url: '/api/friends', headers,
    payload: { code: 'definitely-not-valid' },
  });
  assert.equal(badFriend.statusCode, 400);

  // Friends list has the expected shape.
  const friends = await app.inject({ method: 'GET', url: '/api/friends', headers });
  assert.equal(friends.statusCode, 200);
  assert.ok(Array.isArray(friends.json().friends));
});

test('friendships are mutual and removable', { skip: noDb }, async (t) => {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-session-secret';
  process.env.SHARE_SECRET = process.env.SHARE_SECRET || 'ci-share-secret';

  const app = await server.buildServer();
  t.after(() => app.close());

  const makePlayer = async () => {
    const reg = await app.inject({ method: 'POST', url: '/api/register', payload: {} });
    const token = reg.json().token;
    const headers = { authorization: 'Bearer ' + token };
    const me = await app.inject({ method: 'GET', url: '/api/me', headers });
    return { headers, ...me.json() };
  };

  const a = await makePlayer();
  const b = await makePlayer();

  // A adds B by B's signed friend code.
  const add = await app.inject({
    method: 'POST', url: '/api/friends', headers: a.headers,
    payload: { code: b.friendCode },
  });
  assert.equal(add.statusCode, 200);
  assert.equal(add.json().friend.playerId, b.playerId);

  // Both directions exist (mutual).
  const aFriends = await app.inject({ method: 'GET', url: '/api/friends', headers: a.headers });
  const bFriends = await app.inject({ method: 'GET', url: '/api/friends', headers: b.headers });
  assert.deepEqual(aFriends.json().friends.map(f => f.playerId), [b.playerId]);
  assert.deepEqual(bFriends.json().friends.map(f => f.playerId), [a.playerId]);

  // Removing from one side clears the relationship both ways.
  const del = await app.inject({ method: 'DELETE', url: '/api/friends/' + b.playerId, headers: a.headers });
  assert.equal(del.statusCode, 200);
  const aAfter = await app.inject({ method: 'GET', url: '/api/friends', headers: a.headers });
  const bAfter = await app.inject({ method: 'GET', url: '/api/friends', headers: b.headers });
  assert.equal(aAfter.json().friends.length, 0);
  assert.equal(bAfter.json().friends.length, 0);
});
