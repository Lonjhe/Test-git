// Fiches film et série : résumé, lecture, versions, « dans le même style ».
import { h, icon, fmtMinutes, toast, fill } from '../dom.js';
import { api } from '../api.js';
import { store, indexOf, isFav, toggleFav, watchedFraction, clearProgress } from '../store.js';
import { posterRow, art, chips, empty, spinner, hue } from '../components.js';
import { similarTo } from '../../shared/recommend.js';

function favButton(id) {
  const btn = h('button', { class: 'btn', type: 'button', dataset: { fkey: 'fav' } });
  const paint = () => fill(btn, icon(isFav(id) ? 'check' : 'plus'), isFav(id) ? 'Dans ma liste' : 'Ma liste');
  btn.addEventListener('click', () => {
    toast(toggleFav(id) ? 'Ajouté à votre liste' : 'Retiré de votre liste');
    paint();
  });
  paint();
  return btn;
}

function trailerLink(trailer) {
  const id = String(trailer || '').match(/[\w-]{11}/)?.[0];
  if (!id) return null;
  return h('a', { class: 'btn', href: `https://www.youtube.com/watch?v=${id}`, target: '_blank', rel: 'noopener noreferrer' }, 'Bande-annonce');
}

function shell(item) {
  const hu = hue(item.title);
  const bg = h('div', { class: 'detail-bg', style: `--h1:${hu};--h2:${(hu + 48) % 360}` });
  const src = item.backdrop || item.poster;
  if (src) {
    const img = h('img', { alt: '', referrerpolicy: 'no-referrer', class: item.backdrop ? '' : 'blurred' });
    img.addEventListener('load', () => img.classList.add('on'));
    img.addEventListener('error', () => img.remove());
    img.src = src;
    bg.append(img);
  }
  return bg;
}

function metaLine(item, extra = []) {
  return h('div', { class: 'meta' },
    [item.year, ...extra, item.rating ? `★ ${item.rating.toFixed(1)}` : ''].filter(Boolean).map((t) => h('span', {}, t)),
    item.quality === '4K' || item.versions?.some((v) => v.quality === '4K') ? h('span', { class: 'tag' }, '4K') : null,
  );
}

function credits(d) {
  return h('div', { class: 'credits' },
    d.director ? h('p', {}, h('b', {}, 'Réalisation '), d.director) : null,
    d.cast?.length ? h('p', {}, h('b', {}, 'Avec '), d.cast.slice(0, 6).join(', ')) : null,
  );
}

export function movieDetail(ctx) {
  const movie = store.byId.get(ctx.arg);
  const root = h('div', { class: 'detail' });
  if (!movie || movie.kind !== 'movie') {
    root.append(empty('Film introuvable', 'Il n\'est plus proposé par votre source.', h('a', { class: 'btn primary', href: '#/films', 'data-autofocus': true }, 'Voir les films')));
    return root;
  }

  let version = store.progress[movie.id]?.play || movie.id;
  if (!movie.versions?.some((v) => v.id === version)) version = movie.id;

  const plot = h('p', { class: 'plot' });
  const meta = h('div');
  const cred = h('div');
  const actions = h('div', { class: 'actions', 'data-lane': true });
  const extraActions = h('span', { class: 'extra' });
  const versions = h('div', { class: 'versions' });
  const similar = h('div', { class: 'rows' });

  function paintActions() {
    const frac = watchedFraction(movie.id);
    const p = store.progress[movie.id];
    const inProgress = p && !p.done && frac > 0.02;
    const href = `#/lecture/${encodeURIComponent(version)}`;
    fill(actions, 
      h('a', { class: 'btn primary', href, 'data-autofocus': true, dataset: { fkey: 'play' } }, icon('play'),
        inProgress ? `Reprendre${p.dur ? ` · reste ${fmtMinutes(Math.max(1, (p.dur - p.pos) / 60))}` : ''}` : 'Lecture'),
      inProgress ? h('a', { class: 'btn', href: `${href}?t=0`, dataset: { fkey: 'restart' } }, icon('replay'), 'Recommencer') : null,
      favButton(movie.id),
      extraActions,
      p ? h('button', { class: 'btn ghost', type: 'button', onclick: () => { clearProgress(movie.id); paintActions(); toast('Marqué comme non vu'); } }, 'Marquer comme non vu') : null,
    );
  }
  function paintVersions() {
    if (!movie.versions) return;
    fill(versions, h('span', { class: 'filter-name' }, 'Version'),
      chips(movie.versions.map((v) => ({ value: v.id, label: v.label })), version, (id) => {
        version = id;
        paintVersions();
        paintActions();
        versions.querySelector('.chip.on')?.focus({ preventScroll: true });
      }, { cls: 'version' }));
  }
  function paintSimilar(recTmdbIds = []) {
    const list = similarTo(indexOf('movie'), movie.id, { limit: 30, recTmdbIds });
    fill(similar, ...[posterRow('Dans le même style', list)].filter(Boolean));
  }
  function paintMeta(d) {
    fill(meta, metaLine({ ...movie, ...d }, [fmtMinutes(d.duration)]),
      h('div', { class: 'genres', 'data-lane': true }, (d.genres || []).map((g) => h('a', { class: 'chip small', href: `#/films?genre=${encodeURIComponent(g)}` }, g))));
  }

  paintMeta(movie);
  paintActions();
  paintVersions();
  paintSimilar();

  root.append(
    shell(movie),
    h('div', { class: 'detail-head', 'data-scroll-top': true },
      h('div', { class: 'detail-text' }, h('h1', {}, movie.title), meta, plot, cred, actions, versions),
      art(movie.poster, movie.title, 'detail-poster')),
    similar,
  );

  api.get(`/api/movie/${encodeURIComponent(movie.id)}`).then((d) => {
    if (!ctx.alive) return;
    plot.textContent = d.plot || '';
    if (d.tagline) plot.before(h('p', { class: 'tagline' }, d.tagline));
    paintMeta(d);
    fill(cred, credits(d));
    const t = trailerLink(d.trailer);
    if (t) fill(extraActions, t);
    if (d.recTmdbIds?.length) paintSimilar(d.recTmdbIds);
  }).catch(() => {});
  return root;
}

export function seriesDetail(ctx) {
  const serie = store.byId.get(ctx.arg);
  const root = h('div', { class: 'detail' });
  if (!serie || serie.kind !== 'series') {
    root.append(empty('Série introuvable', 'Elle n\'est plus proposée par votre source.', h('a', { class: 'btn primary', href: '#/series', 'data-autofocus': true }, 'Voir les séries')));
    return root;
  }

  const plot = h('p', { class: 'plot' }, serie.plot || '');
  const cred = h('div');
  const actions = h('div', { class: 'actions', 'data-lane': true }, favButton(serie.id));
  const seasonsEl = h('div', { class: 'seasons' });
  const episodesEl = h('div', { class: 'episodes' }, spinner('Chargement des épisodes…'));
  const similar = h('div', { class: 'rows' });
  const list = similarTo(indexOf('series'), serie.id, { limit: 24 });
  const simRow = posterRow('Dans le même style', list);
  if (simRow) similar.append(simRow);

  root.append(
    shell(serie),
    h('div', { class: 'detail-head', 'data-scroll-top': true },
      h('div', { class: 'detail-text' }, h('h1', {}, serie.title),
        metaLine(serie),
        h('div', { class: 'genres', 'data-lane': true }, (serie.genres || []).map((g) => h('a', { class: 'chip small', href: `#/series?genre=${encodeURIComponent(g)}` }, g))),
        plot, cred, actions),
      art(serie.poster, serie.title, 'detail-poster')),
    h('div', { class: 'page-pad' }, seasonsEl, episodesEl),
    similar,
  );

  api.get(`/api/series/${encodeURIComponent(serie.id)}`).then((d) => {
    if (!ctx.alive) return;
    if (d.plot) plot.textContent = d.plot;
    fill(cred, credits(d));
    const eps = d.episodes || [];
    if (!eps.length) {
      fill(episodesEl, empty('Aucun épisode disponible', ''));
      return;
    }
    const label = (e) => `S${e.season} · É${e.episode}${e.title ? ` — ${e.title}` : ''}`;
    const startPlay = (e) => {
      const i = eps.indexOf(e);
      store.playContext = {
        id: e.id, kind: 'episode', parent: serie.id, title: serie.title, poster: e.image || serie.backdrop || serie.poster,
        queue: eps.slice(i).map((x) => ({ id: x.id, sub: label(x), poster: x.image || serie.backdrop || serie.poster })),
      };
    };

    // Reprise : dernier épisode entamé, sinon le premier non vu.
    const started = eps.filter((e) => store.progress[e.id]).sort((a, b) => store.progress[b.id].ts - store.progress[a.id].ts)[0];
    let target = eps[0];
    if (started) {
      const p = store.progress[started.id];
      target = p.done ? eps[eps.indexOf(started) + 1] || started : started;
    }
    actions.prepend(h('a', {
      class: 'btn primary', href: `#/lecture/${encodeURIComponent(target.id)}`, 'data-autofocus': true, dataset: { fkey: 'play' },
      onclick: () => startPlay(target),
    }, icon('play'), started ? `Reprendre S${target.season} · É${target.episode}` : 'Lecture'));
    const t = trailerLink(d.trailer);
    if (t) actions.append(t);
    if (ctx.wantsFocus()) actions.firstChild.focus({ preventScroll: true });

    const seasons = [...new Set(eps.map((e) => e.season))];
    let season = target.season;
    const paint = () => {
      fill(seasonsEl, seasons.length > 1
        ? chips(seasons.map((s) => ({ value: s, label: `Saison ${s}` })), season, (s) => {
          season = s;
          paint();
          seasonsEl.querySelector('.chip.on')?.focus({ preventScroll: true });
        }, { cls: 'season' })
        : h('h2', {}, 'Épisodes'));
      fill(episodesEl, ...eps.filter((e) => e.season === season).map((e) => {
        const frac = watchedFraction(e.id);
        const a = art(e.image || serie.backdrop, `Épisode ${e.episode}`, 'wide');
        if (frac > 0.02) a.append(h('span', { class: 'bar' }, h('i', { style: `width:${Math.round(frac * 100)}%` })));
        return h('a', { class: 'episode', href: `#/lecture/${encodeURIComponent(e.id)}`, dataset: { fkey: `ep:${e.id}` }, onclick: () => startPlay(e) },
          a,
          h('div', { class: 'ep-text' },
            h('div', { class: 'ep-title' }, `${e.episode}. ${e.title || `Épisode ${e.episode}`}`),
            h('div', { class: 'sub' }, [fmtMinutes(e.duration), frac >= 1 ? 'Vu' : ''].filter(Boolean).join(' · ')),
            e.plot ? h('p', {}, e.plot) : null,
          ));
      }));
    };
    paint();
  }).catch((err) => {
    if (ctx.alive) fill(episodesEl, empty('Épisodes indisponibles', err.message));
  });
  return root;
}
