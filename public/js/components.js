// Composants partagés : affiches, cartes, rangées défilantes.
import { h, icon } from './dom.js';
import { store, watchedFraction } from './store.js';

/** Teinte stable dérivée d'un texte (FNV-1a), pour les visuels de remplacement. */
export function hue(text) {
  let x = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) x = Math.imul(x ^ text.charCodeAt(i), 0x01000193);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  return (x >>> 0) % 360;
}

/**
 * Illustration : l'image si elle existe et se charge, sinon un visuel de
 * remplacement (dégradé + titre) pour que la grille reste lisible.
 */
export function art(src, title, extra = '') {
  const hu = hue(title || '');
  const box = h('div', { class: `art ${extra}`, style: `--h1:${hu};--h2:${(hu + 48) % 360}` }, h('span', { class: 'ph' }, title));
  if (src) {
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', draggable: 'false' });
    img.addEventListener('load', () => box.classList.add('loaded'), { once: true });
    img.addEventListener('error', () => img.remove(), { once: true });
    img.src = src;
    box.append(img);
  }
  return box;
}

const hrefOf = (item) => (item.kind === 'series' ? `#/serie/${encodeURIComponent(item.id)}` : `#/film/${encodeURIComponent(item.id)}`);

export function subline(item) {
  return [item.year || '', item.rating ? `★ ${item.rating.toFixed(1)}` : ''].filter(Boolean).join(' · ');
}

/** Carte « affiche » d'un film ou d'une série. */
export function posterCard(item, fkey = '') {
  const a = art(item.poster, item.title);
  const q = item.quality === '4K' || item.versions?.some((v) => v.quality === '4K') ? '4K' : '';
  if (q) a.append(h('span', { class: 'badge' }, q));
  const frac = item.kind === 'movie' ? watchedFraction(item.id) : 0;
  if (frac > 0.02) a.append(h('span', { class: 'bar' }, h('i', { style: `width:${Math.round(frac * 100)}%` })));
  return h('a', { class: 'card poster', href: hrefOf(item), dataset: { fkey: `${fkey}:${item.id}` } },
    a,
    h('div', { class: 'label' }, item.title),
    h('div', { class: 'sub' }, subline(item)),
  );
}

/** Carte large (reprise de lecture, épisodes…). */
export function wideCard({ href, image, title, sub, fraction, fkey, onclick }) {
  const a = art(image, title, 'wide');
  if (fraction > 0.02) a.append(h('span', { class: 'bar' }, h('i', { style: `width:${Math.round(fraction * 100)}%` })));
  a.append(h('span', { class: 'play-hint' }, icon('play')));
  return h('a', { class: 'card wide', href, dataset: { fkey: fkey || href }, onclick },
    a,
    h('div', { class: 'label' }, title),
    h('div', { class: 'sub' }, sub || ''),
  );
}

export function channelCard(ch, list, fkey = '') {
  return h('a', {
    class: 'card channel', href: `#/lecture/${encodeURIComponent(ch.id)}`, dataset: { fkey: `${fkey}:${ch.id}`, id: ch.id },
    onclick: () => { store.playContext = { id: ch.id, queue: list.map((c) => c.id) }; },
  },
  art(ch.logo, ch.name, 'logo'),
  h('div', { class: 'label' }, ch.name),
  );
}

/** Carte « Tout voir » en fin de rangée. */
function moreCard(href, shape) {
  return h('a', { class: `card ${shape} more`, href, dataset: { fkey: `more:${href}` } },
    h('div', { class: `art ${shape === 'wide' || shape === 'channel' ? 'wide' : ''}` }, h('span', { class: 'more-in' }, icon('next'), 'Tout voir')),
  );
}

/**
 * Rangée horizontale défilante.
 * opts.more : lien « Tout voir » ; opts.shape : poster | wide | channel.
 */
export function row(title, cards, opts = {}) {
  if (!cards.length) return null;
  const scroller = h('div', { class: 'row-scroller', 'data-lane': true }, cards);
  if (opts.more) scroller.append(moreCard(opts.more, opts.shape || 'poster'));
  const step = (dir) => scroller.scrollBy({ left: dir * scroller.clientWidth * 0.85, behavior: 'smooth' });
  return h('section', { class: 'row' },
    h('h2', {}, title, opts.note ? h('span', { class: 'note' }, opts.note) : null),
    h('div', { class: 'row-wrap' },
      h('button', { class: 'row-arrow left', tabindex: '-1', 'aria-label': 'Précédent', onclick: () => step(-1) }, icon('back')),
      scroller,
      h('button', { class: 'row-arrow right', tabindex: '-1', 'aria-label': 'Suivant', onclick: () => step(1) }, icon('next')),
    ),
  );
}

export function posterRow(title, items, opts = {}) {
  return row(title, items.slice(0, opts.limit || 30).map((it) => posterCard(it, title)), opts);
}

/**
 * Grille à chargement progressif : n'insère les cartes que par lots, à mesure
 * que l'on approche du bas (un catalogue IPTV compte vite 20 000 films).
 */
const gridDepth = new Map();

export function lazyGrid(items, renderCard, { batch = 60, cls = '' } = {}) {
  const grid = h('div', { class: `grid ${cls}` });
  const sentinel = h('div', { class: 'sentinel' });
  const wrap = h('div', {}, grid, sentinel);
  // On se souvient de la profondeur atteinte pour chaque page : au retour d'une
  // fiche, la grille est reconstruite jusqu'à l'endroit où l'on s'était arrêté.
  const memoKey = location.hash;
  let shown = 0;
  const more = (count = batch) => {
    const next = items.slice(shown, shown + count);
    shown += next.length;
    grid.append(...next.map(renderCard));
    gridDepth.set(memoKey, shown);
    if (gridDepth.size > 40) gridDepth.delete(gridDepth.keys().next().value);
    if (shown >= items.length) { observer.disconnect(); sentinel.remove(); }
  };
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) more();
  }, { rootMargin: '1200px 0px' });
  more(Math.max(batch, gridDepth.get(memoKey) || 0));
  if (shown < items.length) observer.observe(sentinel);
  wrap.dispose = () => observer.disconnect();
  // Le lot suivant doit aussi arriver quand on descend au clavier sans faire défiler.
  grid.addEventListener('focusin', (e) => {
    if (shown < items.length && grid.lastElementChild && e.target.offsetTop >= grid.lastElementChild.offsetTop - 10) more();
  });
  return wrap;
}

export function chips(options, selected, onPick, { lane = true, cls = '' } = {}) {
  return h('div', { class: `chips ${cls}`, 'data-lane': lane || null },
    options.map((o) => h('button', {
      class: `chip ${o.value === selected ? 'on' : ''}`, type: 'button', dataset: { fkey: `chip:${cls}:${o.value}` },
      onclick: () => onPick(o.value),
    }, o.label, o.count != null ? h('span', { class: 'count' }, o.count) : null)),
  );
}

export function empty(title, text, action) {
  return h('div', { class: 'empty' }, h('h2', {}, title), text ? h('p', {}, text) : null, action || null);
}

export function spinner(label) {
  return h('div', { class: 'loading' }, h('div', { class: 'spin' }), label ? h('p', {}, label) : null);
}
