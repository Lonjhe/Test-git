import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, similarTo, forYou, suggest } from '../shared/recommend.js';

const movie = (id, title, year, genres, rating = 7, extra = {}) => ({ id, title, year, genres, rating, cat: genres[0] || '', ...extra });
const CATALOG = [
  movie('sf1', 'Orbite Zéro', 2015, ['Science-Fiction', 'Thriller'], 8),
  movie('sf2', 'Orbite Zéro : Dérive', 2019, ['Science-Fiction', 'Aventure'], 7.2),
  movie('sf3', 'Colonie 7', 2012, ['Science-Fiction', 'Thriller'], 7.5),
  movie('sf4', 'Signal Perdu', 1984, ['Science-Fiction'], 6.5),
  movie('co1', 'Camping Palace', 2016, ['Comédie'], 6),
  movie('co2', 'Un Mariage de Trop', 2014, ['Comédie', 'Romance'], 6.8),
  movie('ro1', 'Lettres à Camille', 2013, ['Romance', 'Drame'], 7.4),
  movie('th1', 'Angle Mort', 2016, ['Thriller', 'Crime'], 8.1, { tmdb: 99 }),
  movie('doc', 'Abysses', 2020, ['Documentaire'], 9),
  movie('nog', 'Film sans genre', 0, [], 0),
];
const index = buildIndex(CATALOG);

test('similarTo privilégie la saga puis les genres communs', () => {
  const ids = similarTo(index, 'sf1').map((m) => m.id);
  assert.equal(ids[0], 'sf2', 'la suite arrive en tête');
  assert.equal(ids[1], 'sf3', 'puis le film aux mêmes genres et à la même époque');
  assert.ok(ids.indexOf('sf4') > ids.indexOf('sf3'));
  assert.ok(!ids.includes('sf1'), 'le film de référence est exclu');
  assert.ok(!ids.includes('co1'), 'une comédie sans rapport n\'est pas proposée');
});

test('similarTo tient compte des recommandations TMDB', () => {
  const without = similarTo(index, 'co1').map((m) => m.id);
  assert.ok(!without.includes('th1'));
  const withRecs = similarTo(index, 'co1', { recTmdbIds: [99] }).map((m) => m.id);
  assert.equal(withRecs[0], 'th1');
});

test('similarTo respecte limit et exclude', () => {
  assert.equal(similarTo(index, 'sf1', { limit: 1 }).length, 1);
  assert.ok(!similarTo(index, 'sf1', { exclude: new Set(['sf2']) }).some((m) => m.id === 'sf2'));
  assert.deepEqual(similarTo(index, 'inconnu'), []);
});

test('forYou combine plusieurs goûts sans reproposer les films de départ', () => {
  const ids = forYou(index, [{ id: 'sf1', weight: 1 }, { id: 'co2', weight: 1 }]).map((m) => m.id);
  assert.ok(!ids.includes('sf1') && !ids.includes('co2'));
  assert.ok(ids.includes('sf3') && ids.includes('co1'), 'des films des deux univers sont proposés');
  assert.deepEqual(forYou(index, []), []);
});

test('suggest applique les critères', () => {
  const rng = () => 0.5;
  const sf = suggest(index, { genres: ['Science-Fiction'] }, { rng });
  assert.deepEqual(sf.map((m) => m.id).sort(), ['sf1', 'sf2', 'sf3', 'sf4']);
  assert.deepEqual(suggest(index, { genres: ['Science-Fiction'], decade: 1980 }, { rng }).map((m) => m.id), ['sf4']);
  assert.ok(suggest(index, { minRating: 8 }, { rng }).every((m) => m.rating >= 8));
  assert.deepEqual(suggest(index, { genres: ['Western'] }, { rng }), []);
});
