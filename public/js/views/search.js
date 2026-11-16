// Recherche instantanée dans les films, séries et chaînes.
import { h, fill } from '../dom.js';
import { store, search as find, genresOf } from '../store.js';
import { posterCard, channelCard, empty } from '../components.js';
import { fold } from '../../shared/text.js';

export function search(ctx) {
  const root = h('div', { class: 'search page' });
  const results = h('div', { class: 'search-results' });
  const input = h('input', {
    type: 'search', class: 'field big', placeholder: 'Films, séries, chaînes…', 'aria-label': 'Rechercher',
    autocomplete: 'off', spellcheck: 'false', 'data-autofocus': true, value: ctx.query.get('q') || '',
  });
  root.append(h('h1', {}, 'Recherche'), input, results);

  let timer;
  ctx.onCleanup(() => clearTimeout(timer));

  function run() {
    const q = input.value.trim();
    ctx.replaceUrl(q ? `#/recherche?q=${encodeURIComponent(q)}` : '#/recherche');
    if (q.length < 2) {
      const genres = genresOf(store.movies).slice(0, 14);
      fill(results, genres.length
        ? h('div', {}, h('h2', {}, 'Parcourir par genre'), h('div', { class: 'chips wrap' }, genres.map((g) =>
          h('a', { class: 'chip', href: `#/films?genre=${encodeURIComponent(g.name)}` }, g.name, h('span', { class: 'count' }, g.count)))))
        : '');
      return;
    }
    const movies = find(store.movies, q, 48);
    const series = find(store.series, q, 24);
    const channels = find(store.channels, q, 36);
    const genre = genresOf(store.movies).find((g) => fold(g.name).startsWith(fold(q)));
    if (!movies.length && !series.length && !channels.length && !genre) {
      fill(results, empty(`Aucun résultat pour « ${q} »`, 'Vérifiez l\'orthographe ou essayez un autre titre.'));
      return;
    }
    const section = (title, cards, cls = '') => (cards.length ? h('section', {}, h('h2', {}, title), h('div', { class: `grid ${cls}` }, cards)) : null);
    fill(results, ...[
      genre ? h('div', { class: 'chips wrap' }, h('a', { class: 'chip', href: `#/films?genre=${encodeURIComponent(genre.name)}` }, `Genre : ${genre.name}`, h('span', { class: 'count' }, genre.count))) : null,
      section('Films', movies.map((m) => posterCard(m, 'sm'))),
      section('Séries', series.map((s) => posterCard(s, 'ss'))),
      section('Chaînes', channels.map((c) => channelCard(c, channels, 'sc')), 'channels'),
    ].filter(Boolean));
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 140);
  });
  run();
  // Sur ordinateur, on peut taper tout de suite.
  queueMicrotask(() => { if (ctx.alive) input.focus({ preventScroll: true }); });
  return root;
}
