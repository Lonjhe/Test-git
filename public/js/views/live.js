// TV en direct : catégories à gauche, chaînes à droite, programme en cours.
import { h, fmtHour, fill } from '../dom.js';
import { api } from '../api.js';
import { store, favorites, search } from '../store.js';
import { channelCard, lazyGrid, empty } from '../components.js';

export function live(ctx) {
  const root = h('div', { class: 'live page' });
  const channels = store.channels;
  if (!channels.length) {
    root.append(h('h1', {}, 'TV en direct'), empty('Aucune chaîne', 'Votre source ne propose pas de chaînes en direct.'));
    return root;
  }

  const counts = new Map();
  for (const c of channels) counts.set(c.cat, (counts.get(c.cat) || 0) + 1);
  const cats = [...counts.keys()];
  let cat = ctx.query.get('cat') ?? (favorites('channel').length ? '★' : '');
  let filter = '';

  const side = h('nav', { class: 'live-cats' });
  const now = h('div', { class: 'now' });
  const body = h('div', { class: 'live-body' });
  const input = h('input', { type: 'search', class: 'field', placeholder: 'Filtrer les chaînes', 'aria-label': 'Filtrer les chaînes', oninput: () => { filter = input.value; paintGrid(); } });
  root.append(h('div', { class: 'title-line' }, h('h1', {}, 'TV en direct'), input), h('div', { class: 'live-cols' }, side, h('div', { class: 'live-main' }, now, body)));

  let grid;
  let epgTimer;
  let epgFor = '';
  ctx.onCleanup(() => { grid?.dispose(); clearTimeout(epgTimer); });

  function showEpg(id) {
    if (id === epgFor) return;
    epgFor = id;
    clearTimeout(epgTimer);
    const ch = store.byId.get(id);
    fill(now, h('b', {}, ch.name));
    epgTimer = setTimeout(async () => {
      const list = await api.get(`/api/epg/${encodeURIComponent(id)}`).catch(() => []);
      if (!ctx.alive || epgFor !== id) return;
      fill(now, h('b', {}, ch.name),
        ...(list.length
          ? list.map((p, i) => h('span', { class: i ? 'next' : '' }, `${i ? 'Ensuite' : 'En ce moment'} · ${fmtHour(p.start)} `, h('em', {}, p.title)))
          : [h('span', { class: 'next' }, 'Programme non communiqué')]));
    }, 350);
  }

  function current() {
    let list = cat === '★' ? favorites('channel') : cat ? channels.filter((c) => c.cat === cat) : channels;
    if (filter.trim()) list = search(list, filter, 2000);
    return list;
  }

  function paintSide() {
    const item = (value, label, count) => h('button', {
      class: `cat ${cat === value ? 'on' : ''}`, type: 'button', dataset: { fkey: `cat:${value}` },
      onclick: () => {
        cat = value;
        ctx.replaceUrl(`#/tv?cat=${encodeURIComponent(value)}`);
        paintSide();
        paintGrid();
        side.querySelector('.cat.on')?.focus({ preventScroll: true });
      },
    }, h('span', {}, label), h('span', { class: 'count' }, count));
    fill(side, 
      item('★', '★ Favoris', favorites('channel').length),
      item('', 'Toutes les chaînes', channels.length),
      ...cats.map((c) => item(c, c, counts.get(c))),
    );
  }

  function paintGrid() {
    grid?.dispose();
    const list = current();
    if (!list.length) {
      grid = null;
      fill(body, empty(cat === '★' ? 'Aucune chaîne favorite' : 'Aucune chaîne',
        cat === '★' ? 'Pendant la lecture d\'une chaîne, utilisez le bouton ★ pour l\'ajouter ici.' : 'Aucune chaîne ne correspond à ce filtre.'));
      return;
    }
    grid = lazyGrid(list, (c) => channelCard(c, list, 'live'), { batch: 90, cls: 'channels' });
    grid.querySelector('.card')?.setAttribute('data-autofocus', '');
    fill(body, grid);
  }

  const onPoint = (e) => {
    const card = e.target.closest?.('.card.channel');
    if (card?.dataset.id) showEpg(card.dataset.id);
  };
  body.addEventListener('focusin', onPoint);
  body.addEventListener('mouseover', onPoint);

  paintSide();
  paintGrid();
  fill(now, h('span', { class: 'next' }, 'Sélectionnez une chaîne pour voir le programme en cours'));
  return root;
}

