import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSigner, rewriteManifest } from '../server/proxy.js';
import { groupMovies } from '../server/catalog.js';

test('les liens HLS signés sont vérifiés', () => {
  const s = makeSigner('secret');
  const link = new URL(s.sign('http://cdn.example/seg1.ts?x=1'), 'http://localhost');
  const u = link.searchParams.get('u');
  const sig = link.searchParams.get('s');
  assert.equal(s.verify(u, sig), 'http://cdn.example/seg1.ts?x=1');
  assert.equal(s.verify(u, sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A')), null);
  assert.equal(s.verify(Buffer.from('http://evil.example/').toString('base64url'), sig), null);
  assert.equal(makeSigner('autre').verify(u, sig), null);
  assert.equal(s.verify(null, null), null);
});

test('rewriteManifest fait passer segments, variantes et clés par le relais', () => {
  const sign = (u) => `/hls?u=${u}`;
  const out = rewriteManifest([
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x1',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="fr",URI="audio/fr.m3u8"',
    '#EXTINF:4,',
    'seg1.ts',
    'https://autre.example/abs/seg2.ts',
    '',
  ].join('\n'), 'http://host.example/live/u/p/1.m3u8', sign).split('\n');
  assert.equal(out[1], '#EXT-X-KEY:METHOD=AES-128,URI="/hls?u=http://host.example/live/u/p/key.bin",IV=0x1');
  assert.equal(out[2], '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="fr",URI="/hls?u=http://host.example/live/u/p/audio/fr.m3u8"');
  assert.equal(out[4], '/hls?u=http://host.example/live/u/p/seg1.ts');
  assert.equal(out[5], '/hls?u=https://autre.example/abs/seg2.ts');
});

test('groupMovies réunit les versions d\'un même film', () => {
  const v = (id, title, year, extra = {}) => ({ id, title, year, quality: '', hdr: false, lang: '', ext: 'mp4', poster: '', rating: 0, added: 0, cat: 'Action', genres: [], ...extra });
  const movies = groupMovies([
    v('a', 'Heat', 1995, { rating: 8.2 }),
    v('b', 'Heat', 1995, { quality: '4K', hdr: true, poster: 'p.jpg' }),
    v('c', 'heat', 0, { lang: 'VOSTFR', ext: 'mkv' }),
    v('d', 'Dune', 1984),
    v('e', 'Dune', 2021),
    v('f', 'Dune', 0),
  ]);
  assert.equal(movies.length, 4);
  const heat = movies.find((m) => m.title.toLowerCase() === 'heat');
  assert.equal(heat.versions.length, 3, 'la version sans année rejoint la fiche datée');
  assert.equal(heat.id, 'a', 'la version standard est proposée par défaut');
  assert.equal(heat.poster, 'p.jpg');
  assert.equal(heat.rating, 8.2);
  assert.equal(new Set(heat.versions.map((x) => x.label)).size, 3);
  assert.equal(movies.filter((m) => m.title === 'Dune').length, 3, 'deux films homonymes de dates différentes restent séparés');
});
