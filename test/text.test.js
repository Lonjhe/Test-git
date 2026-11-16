import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTitle, parseEpisode, detectGenres, cleanCategory, normKey, titleTokens } from '../shared/text.js';

test('parseTitle nettoie les noms de flux IPTV', () => {
  const cases = [
    ['FR - Inception (2010)', { title: 'Inception', year: 2010, lang: 'FR' }],
    ['|FR| Inception 2010 4K', { title: 'Inception', year: 2010, quality: '4K' }],
    ['Inception [MULTI] HDR 1080p', { title: 'Inception', lang: 'MULTI', hdr: true, quality: 'FHD' }],
    ['EN: The Matrix (1999)', { title: 'The Matrix', year: 1999, lang: 'EN' }],
    ['4K-FR - Dune (2021)', { title: 'Dune', year: 2021, quality: '4K', lang: 'FR' }],
    ['Le Fabuleux Destin d\'Amélie Poulain', { title: 'Le Fabuleux Destin d\'Amélie Poulain', year: 0 }],
    ['1917 (2019)', { title: '1917', year: 2019 }],
    ['2012', { title: '2012', year: 0 }],
    ['Blade Runner 2049 (2017) VOSTFR', { title: 'Blade Runner 2049', year: 2017, lang: 'VOSTFR' }],
    ['Alien - 1979', { title: 'Alien', year: 1979 }],
    ['IT - Il Postino (1994)', { title: 'Il Postino', year: 1994, lang: 'IT' }],
    ['Spider-Man: No Way Home (2021) [4K HDR]', { title: 'Spider-Man: No Way Home', year: 2021, quality: '4K', hdr: true }],
    ['Up (2009)', { title: 'Up', year: 2009 }],
    ['WALL-E (2008) HD', { title: 'WALL-E', year: 2008, quality: 'HD' }],
  ];
  for (const [raw, want] of cases) {
    const got = parseTitle(raw);
    for (const [k, v] of Object.entries(want)) assert.equal(got[k], v, `${raw} → ${k}`);
  }
});

test('parseTitle ne renvoie jamais un titre vide', () => {
  for (const raw of ['4K', 'FR - ', '(2020)', '']) assert.equal(typeof parseTitle(raw).title, 'string');
  assert.ok(parseTitle('4K').title.length > 0);
});

test('parseEpisode reconnaît saisons et épisodes', () => {
  assert.deepEqual(parseEpisode('Dark S02 E05 - Titre'), { show: 'Dark', season: 2, episode: 5, title: 'Titre' });
  assert.deepEqual(parseEpisode('FR - Le Bureau des Légendes S01E10'), { show: 'FR - Le Bureau des Légendes', season: 1, episode: 10, title: '' });
  assert.deepEqual(parseEpisode('Kaamelott 3x12'), { show: 'Kaamelott', season: 3, episode: 12, title: '' });
  assert.equal(parseEpisode('Un film sans épisode'), null);
});

test('detectGenres déduit les genres des catégories fournisseur', () => {
  assert.deepEqual(detectGenres('FR | ACTION & AVENTURE'), ['Action', 'Aventure']);
  assert.deepEqual(detectGenres('Comédie romantique'), ['Comédie', 'Romance']);
  assert.deepEqual(detectGenres('Sci-Fi, Horror'), ['Science-Fiction', 'Horreur']);
  assert.deepEqual(detectGenres('NETFLIX'), []);
});

test('cleanCategory et normKey', () => {
  assert.equal(cleanCategory('FR | ACTION'), 'Action');
  assert.equal(cleanCategory('VOD - Films 2024'), 'Films 2024');
  assert.equal(normKey('Amélie & Cie : Le Retour !'), 'amelie and cie le retour');
  assert.deepEqual(titleTokens('Les Gardiens de l\'Aube 2 : Représailles'), ['gardiens', 'aube', 'represailles']);
});
