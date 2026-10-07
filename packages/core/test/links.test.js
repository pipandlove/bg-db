import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVideoLink, parseVideoTime, readMatch } from '../src/index.js';
import { read } from './helpers.js';

const ID = 'dQw4w9WgXcQ';
const ok = (x, o) => { const r = normalizeVideoLink(x, o); assert.equal(r.ok, true, JSON.stringify(r)); return r.link; };
const bad = (x) => { const r = normalizeVideoLink(x); assert.equal(r.ok, false, `should be refused: ${JSON.stringify(x)}`); return r.reason; };

test('the usual YouTube forms all reduce to the same canonical link', () => {
  const want = `https://www.youtube.com/watch?v=${ID}`;
  for (const u of [`https://youtu.be/${ID}`, `https://www.youtube.com/watch?v=${ID}`, `https://youtube.com/watch?v=${ID}&list=PL123&feature=share`,
    `https://m.youtube.com/watch?v=${ID}`, `https://www.youtube.com/shorts/${ID}`, `https://www.youtube.com/live/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`, `  https://youtu.be/${ID}  `]) {
    const l = ok(u);
    assert.equal(l.url, want, u);
    assert.deepEqual([l.type, l.provider, l.id], ['video', 'youtube', ID]);
  }
});

test('start times: 90, 90s, 1m30s, #t=, start=', () => {
  assert.equal(parseVideoTime('1h2m3s'), 3723);
  assert.equal(parseVideoTime('1m30s'), 90);
  assert.equal(parseVideoTime('90'), 90);
  assert.equal(parseVideoTime('abc'), null);
  assert.equal(parseVideoTime(''), null);
  for (const u of [`https://youtu.be/${ID}?t=95`, `https://youtu.be/${ID}?t=1m35s`, `https://www.youtube.com/watch?v=${ID}&start=95`, `https://www.youtube.com/watch?v=${ID}#t=95`]) {
    const l = ok(u);
    assert.equal(l.time, 95, u);
    assert.equal(l.url, `https://www.youtube.com/watch?v=${ID}&t=95s`);
  }
});

test('only https, only YouTube, only a single video, no credentials', () => {
  assert.match(bad(`http://youtu.be/${ID}`), /only https/);
  assert.match(bad(`https://vimeo.com/${ID}`), /only YouTube/);
  assert.match(bad(`https://youtube.com.evil.example/watch?v=${ID}`), /only YouTube/);
  assert.match(bad(`https://user:pw@youtu.be/${ID}`), /user name or password/);
  assert.match(bad('https://www.youtube.com/playlist?list=PL123'), /single YouTube video/);
  assert.match(bad('https://www.youtube.com/watch?v=short'), /single YouTube video/);
  assert.match(bad(`javascript:alert(1)`), /only https|valid link/);
  assert.match(bad('not a link'), /valid link/);
  assert.match(bad(''), /empty/);
  assert.match(bad({}), /empty/);
});

test('title and game are cleaned; nothing else from the submitted URL survives', () => {
  const l = ok({ url: `https://youtu.be/${ID}?si=TRACKING&utm_source=x`, title: '  Final \n  game <b>1</b>\u0007 ', game: 3, time: 10 });
  assert.equal(l.url, `https://www.youtube.com/watch?v=${ID}&t=10s`);
  assert.equal(l.title, 'Final game <b>1</b>');
  assert.equal(l.game, 3);
  assert.ok(!JSON.stringify(l).includes('TRACKING'));
  assert.equal(ok({ url: `https://youtu.be/${ID}`, title: 'x'.repeat(500) }).title.length, 120);
  assert.equal('game' in ok({ url: `https://youtu.be/${ID}`, game: 0 }), false);
});

test('hosts can be restricted by the configuration', () => {
  assert.equal(normalizeVideoLink(`https://youtu.be/${ID}`, { hosts: ['www.youtube.com'] }).ok, false);
});

test('a "Video" tag in the match header becomes a link; bad ones are dropped with a warning', () => {
  const base = read('foxamon/tester_vs_Osprey12_2026-08-10.mat');
  const text = `; [Video "https://youtu.be/${ID}?t=30"]\n; [Video "https://example.com/x"]\n; [Video "https://www.youtube.com/watch?v=${ID}&t=30s"]\n${base}`;
  const r = readMatch(text);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.match.links.map((l) => l.url), [`https://www.youtube.com/watch?v=${ID}&t=30s`], 'duplicates merged, bad link dropped');
  assert.equal(r.warnings.filter((w) => w.code === 'V-LINK').length, 1);
  assert.match(r.warnings.find((w) => w.code === 'V-LINK').message, /only YouTube/);
});

test('a link to a game that does not exist keeps the link and drops the game number', async () => {
  const { validateMatch, parseMat } = await import('../src/index.js');
  const m = parseMat(read('foxamon/tester_vs_Osprey12_2026-08-10.mat'));
  m.links = [{ url: `https://youtu.be/${ID}`, game: 9 }];
  const r = validateMatch(m);
  assert.equal(r.match.links.length, 1);
  assert.equal('game' in r.match.links[0], false);
  assert.ok(r.warnings.some((w) => w.code === 'V-LINK' && /game 9/.test(w.message)));
});
