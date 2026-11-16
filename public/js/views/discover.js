// « Découvrir » : l'outil de proposition. On choisit une envie (genres, époque,
// note) ou un film que l'on a aimé, et Séance propose des films à regarder.
import { h, icon, fill } from '../dom.js';
import { store, indexOf, genresOf, tasteSeeds, search as find } from '../store.js';
import { posterCard, chips, empty } from '../components.js';
import { suggest, similarTo, forYou } from '../../shared/recommend.js';

const saved = { genres: [], decade: 0, minRating: 0, unseen: true, like: '' };

export function discover(ctx) {
  const root = h('div', { class: 'discover page' });
  if (!store.movies.length) {
    root.append(h('h1', {}, 'Découvrir'), empty('Aucun film dans le catalogue', 'Les propositions s\'appuient sur vos films.'));
    return root;
  }
  const state = saved;
  const index = indexOf('movie');
  const genres = genresOf(store.movies).slice(0, 18);
  const decades = [...new Set(store.movies.filter((m) => m.year).map((m) => Math.floor(m.year / 10) * 10))].sort((a, b) => b - a);

  const controls = h('div', { class: 'discover-controls' });
  const out = h('div', { class: 'discover-out' });
  const likeInput = h('input', { type: 'search', class: 'field', placeholder: 'Un film que vous avez aimé…', 'aria-label': 'Un film que vous avez aimé', autocomplete: 'off' });
  const likeHits = h('div', { class: 'chips wrap like-hits' });
  root.append(
    h('h1', {}, 'Découvrir'),
    h('p', { class: 'lead' }, 'Dites ce dont vous avez envie, Séance propose. Relancez autant de fois que vous voulez.'),
    controls,
    out,
  );

  const seenIds = () => new Set(Object.entries(store.progress).filter(([, p]) => p.done || p.pos > 600).map(([id]) => id));

  function results() {
    const exclude = state.unseen ? seenIds() : undefined;
    if (state.like && store.byId.has(state.like)) {
      const ref = store.byId.get(state.like);
      let list = similarTo(index, ref.id, { limit: 60, exclude });
      list = list.filter((m) =>
        (!state.genres.length || state.genres.every((g) => m.genres.includes(g))) &&
        (!state.decade || (m.year >= state.decade && m.year < state.decade + 10)) &&
        (!state.minRating || m.rating >= state.minRating));
      return { title: `Dans le style de ${ref.title}`, list: list.slice(0, 18), shuffle: false };
    }
    const hasFilter = state.genres.length || state.decade || state.minRating;
    if (!hasFilter) {
      const mine = forYou(index, tasteSeeds(), { limit: 18, exclude });
      if (mine.length >= 6) return { title: 'Choisis pour vous', list: mine, shuffle: false, note: 'D\'après vos favoris et vos lectures — ajoutez des critères pour affiner.' };
    }
    return {
      title: hasFilter ? 'Nos propositions' : 'Au hasard, parmi les mieux notés',
      list: suggest(index, state, { limit: 18, exclude }),
      shuffle: true,
    };
  }

  function paintOut() {
    const r = results();
    if (!r.list.length) {
      fill(out, empty('Rien ne correspond', 'Retirez un critère pour élargir les propositions.'));
      return;
    }
    fill(out, 
      h('div', { class: 'title-line' },
        h('h2', {}, r.title),
        r.shuffle ? h('button', { class: 'btn', type: 'button', dataset: { fkey: 'again' }, onclick: () => { paintOut(); out.querySelector('[data-fkey="again"]')?.focus({ preventScroll: true }); } }, icon('shuffle'), 'Autres propositions') : null),
      r.note ? h('p', { class: 'lead' }, r.note) : null,
      h('div', { class: 'grid' }, r.list.map((m) => posterCard(m, 'disc'))),
    );
  }

  function paintLike() {
    if (state.like && store.byId.has(state.like)) {
      const ref = store.byId.get(state.like);
      fill(likeHits, h('button', { class: 'chip on', type: 'button', dataset: { fkey: 'like-clear' }, onclick: () => { state.like = ''; likeInput.value = ''; paintLike(); paintOut(); } }, `${ref.title}  ✕`));
      return;
    }
    const hits = likeInput.value.trim().length >= 2 ? find(store.movies, likeInput.value, 8) : [];
    fill(likeHits, ...hits.map((m) => h('button', {
      class: 'chip', type: 'button',
      onclick: () => { state.like = m.id; paintLike(); paintOut(); likeHits.querySelector('button')?.focus({ preventScroll: true }); },
    }, m.title, m.year ? h('span', { class: 'count' }, m.year) : null)));
  }
  likeInput.addEventListener('input', paintLike);

  function paintControls() {
    const refocus = (key) => controls.querySelector(`[data-fkey="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
    fill(controls, 
      h('div', { class: 'filter' }, h('span', { class: 'filter-name' }, 'Envie de'),
        h('div', { class: 'chips wrap' }, genres.map((g) => h('button', {
          class: `chip ${state.genres.includes(g.name) ? 'on' : ''}`, type: 'button', dataset: { fkey: `g:${g.name}` },
          onclick: () => {
            state.genres = state.genres.includes(g.name) ? state.genres.filter((x) => x !== g.name) : [...state.genres, g.name].slice(-3);
            paintControls(); paintOut(); refocus(`g:${g.name}`);
          },
        }, g.name)))),
      decades.length > 1 ? h('div', { class: 'filter' }, h('span', { class: 'filter-name' }, 'Époque'),
        chips([{ value: 0, label: 'Peu importe' }, ...decades.map((d) => ({ value: d, label: `Années ${d}` }))], state.decade,
          (d) => { state.decade = d; paintControls(); paintOut(); refocus(`chip:decade:${d}`); }, { cls: 'decade' })) : null,
      h('div', { class: 'filter' }, h('span', { class: 'filter-name' }, 'Note'),
        h('div', { class: 'chips', 'data-lane': true },
          [[0, 'Peu importe'], [6, '6 et +'], [7, '7 et +'], [8, '8 et +']].map(([v, label]) => h('button', {
            class: `chip ${state.minRating === v ? 'on' : ''}`, type: 'button', dataset: { fkey: `r:${v}` },
            onclick: () => { state.minRating = v; paintControls(); paintOut(); refocus(`r:${v}`); },
          }, label)),
          h('span', { class: 'sep' }),
          h('button', {
            class: `chip ${state.unseen ? 'on' : ''}`, type: 'button', dataset: { fkey: 'unseen' },
            onclick: () => { state.unseen = !state.unseen; paintControls(); paintOut(); refocus('unseen'); },
          }, 'Seulement les non vus'))),
      h('div', { class: 'filter' }, h('span', { class: 'filter-name' }, 'Comme'), h('div', { class: 'like' }, likeInput, likeHits)),
    );
  }

  paintControls();
  paintLike();
  paintOut();
  return root;
}
