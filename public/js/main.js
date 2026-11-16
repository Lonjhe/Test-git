// Séance — point d'entrée de l'interface : démarrage, routeur, barre de navigation.
import { h, icon, navFlags, go } from './dom.js';
import { store, loadStatus, loadCatalog, loadState } from './store.js';
import { initFocus, focusDefault, focusEl, keysMode } from './focus.js';
import { spinner, empty } from './components.js';
import { home } from './views/home.js';
import { films, series } from './views/browse.js';
import { movieDetail, seriesDetail } from './views/detail.js';
import { live } from './views/live.js';
import { search } from './views/search.js';
import { discover } from './views/discover.js';
import { settings } from './views/settings.js';
import { player } from './views/player.js';

const view = document.getElementById('view');
const nav = document.getElementById('nav');

const routes = {
  '': home, films, series, tv: live, recherche: search, decouvrir: discover,
  reglages: settings, film: movieDetail, serie: seriesDetail, lecture: player,
};
const TABS = [
  ['', 'Accueil', 'home'], ['films', 'Films', 'film'], ['series', 'Séries', 'series'], ['tv', 'Direct', 'tv'],
  ['decouvrir', 'Découvrir', 'sparkle'], ['recherche', 'Recherche', 'search'], ['reglages', 'Réglages', 'settings'],
];
const TAB_OF = { film: 'films', serie: 'series' };

const stack = [];
const memory = new Map();
let current = null;
let ready = false;

function parse() {
  const raw = location.hash.replace(/^#\/?/, '');
  const cut = raw.indexOf('?');
  const pathPart = cut < 0 ? raw : raw.slice(0, cut);
  const [name = '', ...rest] = pathPart.split('/');
  let arg = rest.join('/');
  try { arg = decodeURIComponent(arg); } catch { /* laissé tel quel */ }
  return { name, arg, query: new URLSearchParams(cut < 0 ? '' : raw.slice(cut + 1)) };
}

function paintNav(name) {
  const active = TAB_OF[name] ?? name;
  nav.replaceChildren(...TABS.map(([route, label, ico]) => h('a', {
    href: `#/${route}`, class: `tab ${route === active ? 'active' : ''} ${['recherche', 'reglages'].includes(route) ? 'icon-only' : ''}`,
    'aria-label': label, 'aria-current': route === active ? 'page' : null, dataset: { fkey: `nav:${route}` },
  }, icon(ico), h('span', {}, label))));
}

function leave() {
  if (!current) return;
  memory.set(current.key, { scroll: window.scrollY, fkey: document.activeElement?.dataset?.fkey || '' });
  if (memory.size > 60) memory.delete(memory.keys().next().value);
  current.alive = false;
  for (const fn of current.cleanups.splice(0)) {
    try { fn(); } catch (err) { console.error(err); }
  }
  current = null;
}

function render(back = false) {
  leave();
  const r = parse();
  const key = location.hash;
  const ctx = {
    ...r, key, alive: true, cleanups: [],
    onCleanup(fn) { this.cleanups.push(fn); },
    /** Met à jour l'adresse (filtres…) sans relancer l'affichage. */
    replaceUrl(hash) {
      if (!this.alive || location.hash === hash) return;
      history.replaceState(null, '', hash);
      this.key = hash;
      stack[stack.length - 1] = hash;
    },
    wantsFocus: () => keysMode() && (!document.activeElement || document.activeElement === document.body),
    reloadApp: (hash) => boot(hash || '#/', true),
  };
  current = ctx;

  const configured = store.status?.configured;
  const name = configured ? r.name : 'reglages';
  let el;
  try {
    el = (routes[name] || home)(ctx);
  } catch (err) {
    console.error(err);
    el = empty('Une erreur est survenue', err.message, h('a', { class: 'btn primary', href: '#/', 'data-autofocus': true }, 'Retour à l\'accueil'));
  }
  view.replaceChildren(el);
  document.body.dataset.route = name || 'accueil';
  nav.hidden = !configured || name === 'lecture';
  paintNav(name);

  const mem = back ? memory.get(key) : null;
  window.scrollTo(0, mem?.scroll || 0);
  if (name === 'lecture') return;
  if (keysMode()) {
    const target = mem?.fkey && document.querySelector(`[data-fkey="${CSS.escape(mem.fkey)}"]`);
    if (target) { target.focus({ preventScroll: true }); if (!mem.scroll) focusEl(target, false); } else focusDefault();
  } else if (name !== 'recherche') {
    document.activeElement?.blur?.();
  }
}

function onRoute() {
  if (!ready) return;
  const key = location.hash;
  let back = false;
  if (navFlags.replace) {
    navFlags.replace = false;
    stack[Math.max(0, stack.length - 1)] = key;
  } else if (stack.length >= 2 && stack[stack.length - 2] === key) {
    stack.pop();
    back = true;
  } else if (stack[stack.length - 1] !== key) {
    stack.push(key);
  }
  render(back);
}

function screen(...kids) {
  leave();
  nav.hidden = true;
  view.replaceChildren(h('div', { class: 'screen' }, ...kids));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * (Re)charge l'état depuis le serveur puis affiche la page demandée.
 * waitForCatalog : attendre la fin d'un rechargement du catalogue en cours.
 */
async function boot(target, waitForCatalog = false) {
  ready = false;
  screen(spinner('Ouverture de Séance…'));
  try {
    await loadStatus();
    if (store.status.configured) {
      const c = () => store.status.catalog;
      const started = Date.now();
      while (c().loading && (waitForCatalog || !c().updatedAt) && Date.now() - started < 10 * 60e3) {
        screen(spinner('Chargement de votre catalogue…'), h('p', { class: 'fine' }, 'La première fois, cela peut prendre une minute chez les gros fournisseurs.'));
        await sleep(1200);
        await loadStatus();
      }
      await Promise.all([loadCatalog(), loadState()]);
    }
  } catch (err) {
    screen(empty('Séance ne répond pas', `Le serveur est injoignable (${err.message}).`,
      h('button', { class: 'btn primary', type: 'button', 'data-autofocus': true, onclick: () => boot(target) }, 'Réessayer')));
    return;
  }
  ready = true;
  if (target && location.hash !== target) {
    navFlags.replace = true;
    location.replace(target);
    if (location.hash === target) return; // hashchange va déclencher l'affichage
  }
  if (!stack.length) stack.push(location.hash);
  navFlags.replace = false;
  render();
}

initFocus({
  onBack() {
    if (stack.length > 1) history.back();
    else if (parse().name) go('#/');
  },
});
window.addEventListener('hashchange', onRoute);

// La barre de navigation s'efface quand on descend dans la page et revient dès qu'on remonte.
let lastY = 0;
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  if (y < 140 || y < lastY - 6) nav.classList.remove('away');
  else if (y > lastY + 6) nav.classList.add('away');
  lastY = y;
}, { passive: true });

// Le catalogue peut évoluer en arrière-plan (rafraîchissement, classement TMDB) :
// on récupère la nouvelle version sans interrompre ce que fait l'utilisateur.
setInterval(async () => {
  if (!ready || document.hidden || !store.status?.configured || parse().name === 'lecture') return;
  try {
    await loadStatus();
    if (!store.status.catalog.loading && store.status.catalog.version !== store.version) await loadCatalog();
  } catch { /* serveur momentanément injoignable */ }
}, 30_000);

boot();
