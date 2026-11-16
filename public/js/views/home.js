// Accueil : film à l'affiche, reprises, recommandations et rangées par genre.
import { h, icon, fmtMinutes } from '../dom.js';
import { api } from '../api.js';
import { store, indexOf, genresOf, favorites, continueWatching, tasteSeeds } from '../store.js';
import { posterRow, row, wideCard, channelCard, empty, hue } from '../components.js';
import { similarTo, forYou } from '/shared/recommend.js';

function pickFeatured() {
  const recent = store.movies.filter((m) => m.added && m.rating >= 6.5).sort((a, b) => b.added - a.added).slice(0, 40);
  const pool = recent.length >= 5 ? recent : [...store.movies].sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 40);
  // Les films disposant d'une grande image passent en premier.
  return pool.sort((a, b) => !!b.backdrop - !!a.backdrop).slice(0, 6);
}

function hero(ctx, items) {
  const imgs = [h('img', { alt: '', referrerpolicy: 'no-referrer' }), h('img', { alt: '', referrerpolicy: 'no-referrer' })];
  const eyebrow = h('div', { class: 'eyebrow' });
  const title = h('h1');
  const meta = h('div', { class: 'meta' });
  const plot = h('p', { class: 'plot' });
  const play = h('a', { class: 'btn primary', 'data-autofocus': true }, icon('play'), 'Lecture');
  const info = h('a', { class: 'btn' }, 'Plus d\'infos');
  const dots = h('div', { class: 'dots' }, items.map((_, i) => h('button', { tabindex: '-1', 'aria-label': `Film ${i + 1}`, onclick: () => show(i, true) })));
  for (const img of imgs) img.addEventListener('error', () => img.classList.remove('on'));
  const el = h('section', { class: `hero ${items.some((m) => m.backdrop || m.poster) ? '' : 'compact'}`, 'data-scroll-top': true },
    h('div', { class: 'hero-bg' }, imgs),
    h('div', { class: 'hero-body' }, eyebrow, title, meta, plot, h('div', { class: 'actions', 'data-lane': true }, play, info), dots),
  );

  let current = -1;
  let flip = 0;
  let timer;
  async function show(i, manual) {
    current = i;
    const m = items[i];
    const src = m.backdrop || m.poster;
    // Sans image, un dégradé propre au film sert de décor.
    const hu = hue(m.title);
    el.style.setProperty('--h1', hu);
    el.style.setProperty('--h2', (hu + 48) % 360);
    const img = imgs[(flip ^= 1)];
    img.className = m.backdrop ? '' : 'blurred';
    if (src) {
      img.src = src;
      img.classList.add('on');
    }
    imgs[flip ^ 1].classList.remove('on');
    eyebrow.textContent = ['À l\'affiche', m.genres?.[0]].filter(Boolean).join(' · ');
    title.textContent = m.title;
    meta.textContent = [m.year, m.rating ? `★ ${m.rating.toFixed(1)}` : '', m.quality === '4K' ? '4K' : ''].filter(Boolean).join('  ·  ');
    plot.textContent = '';
    play.href = `#/lecture/${encodeURIComponent(m.id)}`;
    info.href = `#/film/${encodeURIComponent(m.id)}`;
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    if (manual) schedule();
    try {
      const d = (m.detail ??= await api.get(`/api/movie/${encodeURIComponent(m.id)}`));
      if (current !== i || !ctx.alive) return;
      plot.textContent = d.plot || '';
      const extra = fmtMinutes(d.duration);
      if (extra) meta.textContent = [m.year, extra, m.rating ? `★ ${m.rating.toFixed(1)}` : '', m.quality === '4K' ? '4K' : ''].filter(Boolean).join('  ·  ');
    } catch { /* le résumé est facultatif */ }
  }
  function schedule() {
    clearInterval(timer);
    if (items.length < 2) return;
    timer = setInterval(() => {
      // On ne change pas d'affiche pendant que l'utilisateur est dessus.
      if (el.contains(document.activeElement) || document.hidden) return;
      show((current + 1) % items.length);
    }, 9000);
  }
  ctx.onCleanup(() => clearInterval(timer));
  show(0);
  schedule();
  return el;
}

export function home(ctx) {
  const root = h('div', { class: 'home' });
  const { movies, series, channels } = store;

  if (!movies.length && !series.length && !channels.length) {
    root.append(empty('Votre catalogue est vide', 'Ajoutez une source ou actualisez le catalogue depuis les réglages.',
      h('a', { class: 'btn primary', href: '#/reglages', 'data-autofocus': true }, 'Ouvrir les réglages')));
    return root;
  }

  if (movies.length) root.append(hero(ctx, pickFeatured()));
  else root.classList.add('no-hero');

  const rows = h('div', { class: 'rows' });
  root.append(rows);
  const push = (el) => el && rows.append(el);

  const resume = continueWatching().slice(0, 20);
  push(row('Reprendre la lecture', resume.map((p) => wideCard({
    href: p.kind === 'episode' && p.parent ? `#/serie/${encodeURIComponent(p.parent)}` : `#/lecture/${encodeURIComponent(p.id)}`,
    image: store.byId.get(p.id)?.backdrop || p.poster,
    title: p.title || 'Lecture',
    sub: p.sub || (p.dur ? `Reste ${fmtMinutes(Math.max(1, (p.dur - p.pos) / 60))}` : ''),
    fraction: p.dur ? p.pos / p.dur : 0,
    fkey: `resume:${p.id}`,
  })), { shape: 'wide' }));

  push(posterRow('Ma liste', favorites().filter((it) => it.kind !== 'channel')));

  if (movies.length) {
    const index = indexOf('movie');
    const seeds = tasteSeeds();
    const seen = new Set(Object.entries(store.progress).filter(([, p]) => p.done).map(([id]) => id));
    push(posterRow('Pour vous', forYou(index, seeds, { limit: 30, exclude: seen }), { note: 'D\'après vos favoris et vos lectures' }));

    const last = Object.entries(store.progress)
      .filter(([id, p]) => p.kind === 'movie' && store.byId.has(id))
      .sort((a, b) => b[1].ts - a[1].ts)[0];
    if (last) {
      const ref = store.byId.get(last[0]);
      push(posterRow(`Parce que vous avez regardé ${ref.title}`, similarTo(index, ref.id, { limit: 24, exclude: seen })));
    }

    const recent = movies.filter((m) => m.added).sort((a, b) => b.added - a.added);
    push(posterRow('Ajouts récents', recent, { more: '#/films?tri=recent' }));
    const top = movies.filter((m) => m.rating > 0).sort((a, b) => b.rating - a.rating || b.added - a.added);
    push(posterRow('Les mieux notés', top, { more: '#/films?tri=note' }));
  }

  if (series.length) {
    const recentSeries = [...series].sort((a, b) => (b.added || 0) - (a.added || 0) || (b.rating || 0) - (a.rating || 0));
    push(posterRow('Séries', recentSeries, { more: '#/series' }));
  }

  for (const g of genresOf(movies).slice(0, 10)) {
    if (g.count < 4) continue;
    const list = movies.filter((m) => m.genres.includes(g.name)).sort((a, b) => (b.rating || 0) - (a.rating || 0) || b.added - a.added);
    push(posterRow(g.name, list, { more: `#/films?genre=${encodeURIComponent(g.name)}` }));
  }

  const favChannels = favorites('channel');
  push(row('Chaînes favorites', favChannels.map((c) => channelCard(c, favChannels, 'fav')), { shape: 'channel' }));
  if (channels.length && !favChannels.length) {
    push(row('TV en direct', channels.slice(0, 20).map((c) => channelCard(c, channels, 'tv')), { shape: 'channel', more: '#/tv' }));
  }
  return root;
}
