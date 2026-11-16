// Bibliothèque de films / séries : filtres par genre, collection, décennie,
// tri, et index alphabétique.
import { h, fill } from '../dom.js';
import { store, genresOf, watchedFraction } from '../store.js';
import { posterCard, lazyGrid, chips, empty } from '../components.js';

const SORTS = [
  { value: 'recent', label: 'Ajouts récents' },
  { value: 'note', label: 'Mieux notés' },
  { value: 'annee', label: 'Année' },
  { value: 'az', label: 'A – Z' },
];

function browse(ctx, { kind, title, route }) {
  const all = kind === 'series' ? store.series : store.movies;
  const q = ctx.query;
  const state = {
    genre: q.get('genre') || '',
    cat: q.get('collection') || '',
    decade: +q.get('decennie') || 0,
    sort: q.get('tri') || (all.some((m) => m.added) ? 'recent' : 'az'),
    letter: q.get('lettre') || '',
    uhd: q.get('4k') === '1',
    unseen: q.get('nonvus') === '1',
  };

  const root = h('div', { class: 'browse page' });
  if (!all.length) {
    root.append(h('h1', {}, title), empty(`Aucun contenu dans « ${title} »`, 'Votre source ne propose rien dans cette rubrique.'));
    return root;
  }

  const genres = genresOf(all);
  const catCounts = new Map();
  for (const m of all) if (m.cat) catCounts.set(m.cat, (catCounts.get(m.cat) || 0) + 1);
  const cats = [...catCounts].sort((a, b) => a[0].localeCompare(b[0], 'fr'));
  const showCats = cats.length > 1 && cats.some(([c]) => !genres.some((g) => g.name === c));
  const decades = [...new Set(all.filter((m) => m.year).map((m) => Math.floor(m.year / 10) * 10))].sort((a, b) => b - a);
  const has4k = kind === 'movie' && all.some((m) => m.quality === '4K' || m.versions?.some((v) => v.quality === '4K'));

  const head = h('div', { class: 'browse-head' });
  const body = h('div', { class: 'browse-body' });
  root.append(head, body);
  let grid;
  ctx.onCleanup(() => grid?.dispose());

  function syncUrl() {
    const p = new URLSearchParams();
    if (state.genre) p.set('genre', state.genre);
    if (state.cat) p.set('collection', state.cat);
    if (state.decade) p.set('decennie', state.decade);
    if (state.sort) p.set('tri', state.sort);
    if (state.letter) p.set('lettre', state.letter);
    if (state.uhd) p.set('4k', '1');
    if (state.unseen) p.set('nonvus', '1');
    ctx.replaceUrl(`#/${route}?${p}`);
  }

  function filtered() {
    let list = all.filter((m) =>
      (!state.genre || m.genres.includes(state.genre)) &&
      (!state.cat || m.cat === state.cat) &&
      (!state.decade || (m.year >= state.decade && m.year < state.decade + 10)) &&
      (!state.uhd || m.quality === '4K' || m.versions?.some((v) => v.quality === '4K')) &&
      (!state.unseen || watchedFraction(m.id) < 0.9));
    if (state.sort === 'az' && state.letter) {
      list = list.filter((m) => (state.letter === '#' ? !/^[a-z]/.test(m.search) : m.search.startsWith(state.letter.toLowerCase())));
    }
    const by = {
      recent: (a, b) => (b.added || 0) - (a.added || 0) || (b.year || 0) - (a.year || 0),
      note: (a, b) => (b.rating || 0) - (a.rating || 0) || (b.added || 0) - (a.added || 0),
      annee: (a, b) => (b.year || 0) - (a.year || 0) || (b.rating || 0) - (a.rating || 0),
      az: (a, b) => a.search.localeCompare(b.search),
    };
    return list.sort(by[state.sort] || by.recent);
  }

  function set(patch, keepFocus) {
    Object.assign(state, patch);
    syncUrl();
    render();
    if (keepFocus) root.querySelector(`[data-fkey="${CSS.escape(keepFocus)}"]`)?.focus({ preventScroll: true });
  }

  function render() {
    const list = filtered();
    const pick = (cls, key, toggle = true) => (value) => {
      const next = toggle && state[key] === value ? (typeof value === 'number' ? 0 : '') : value;
      set({ [key]: next, ...(key === 'sort' ? { letter: '' } : {}) }, `chip:${cls}:${value}`);
    };

    fill(head, 
      h('div', { class: 'title-line' }, h('h1', {}, title), h('span', { class: 'count' }, `${list.length.toLocaleString('fr-FR')} titre${list.length > 1 ? 's' : ''}`)),
      genres.length ? h('div', { class: 'filter' }, h('span', { class: 'filter-name' }, 'Genre'),
        chips([{ value: '', label: 'Tous' }, ...genres.map((g) => ({ value: g.name, label: g.name }))], state.genre, pick('genre', 'genre', false), { cls: 'genre' })) : null,
      showCats ? h('div', { class: 'filter' }, h('span', { class: 'filter-name' }, 'Collection'),
        chips([{ value: '', label: 'Toutes' }, ...cats.map(([c]) => ({ value: c, label: c }))], state.cat, pick('cat', 'cat', false), { cls: 'cat' })) : null,
      decades.length > 1 ? h('div', { class: 'filter' }, h('span', { class: 'filter-name' }, 'Époque'),
        chips([{ value: 0, label: 'Toutes' }, ...decades.map((d) => ({ value: d, label: `Années ${d}` }))], state.decade, pick('decade', 'decade', false), { cls: 'decade' })) : null,
      h('div', { class: 'filter' }, h('span', { class: 'filter-name' }, 'Trier'),
        h('div', { class: 'chips', 'data-lane': true },
          SORTS.map((s) => h('button', { class: `chip ${state.sort === s.value ? 'on' : ''}`, type: 'button', dataset: { fkey: `chip:sort:${s.value}` }, onclick: () => pick('sort', 'sort', false)(s.value) }, s.label)),
          h('span', { class: 'sep' }),
          has4k ? h('button', { class: `chip ${state.uhd ? 'on' : ''}`, type: 'button', dataset: { fkey: 'chip:uhd' }, onclick: () => set({ uhd: !state.uhd }, 'chip:uhd') }, '4K') : null,
          kind === 'movie' ? h('button', { class: `chip ${state.unseen ? 'on' : ''}`, type: 'button', dataset: { fkey: 'chip:unseen' }, onclick: () => set({ unseen: !state.unseen }, 'chip:unseen') }, 'Non vus') : null,
        )),
      state.sort === 'az' ? chips(['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((l) => ({ value: l, label: l })), state.letter, pick('letter', 'letter'), { cls: 'letter' }) : null,
    );

    grid?.dispose();
    if (!list.length) {
      grid = null;
      fill(body, empty('Aucun résultat', 'Essayez d\'élargir les filtres.',
        h('button', { class: 'btn', type: 'button', onclick: () => set({ genre: '', cat: '', decade: 0, letter: '', uhd: false, unseen: false }) }, 'Réinitialiser les filtres')));
      return;
    }
    grid = lazyGrid(list, (m) => posterCard(m, 'grid'));
    fill(body, grid);
  }

  render();
  return root;
}

export const films = (ctx) => browse(ctx, { kind: 'movie', title: 'Films', route: 'films' });
export const series = (ctx) => browse(ctx, { kind: 'series', title: 'Séries', route: 'series' });
