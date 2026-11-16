// Réglages : sources IPTV, catalogue, enrichissement TMDB, options.
import { h, icon, toast, fill } from '../dom.js';
import { api, isStatic, clearLocalState } from '../api.js';
import { store, loadStatus } from '../store.js';

const TYPES = [
  { value: 'xtream', label: 'Compte Xtream Codes', hint: 'Adresse du serveur, identifiant et mot de passe fournis par votre abonnement.' },
  { value: 'm3u', label: 'Playlist M3U', hint: 'Un lien vers une playlist .m3u / .m3u8, ou un fichier à importer.' },
  { value: 'demo', label: 'Démonstration', hint: 'Un catalogue fictif pour découvrir l\'interface, sans abonnement.' },
];

export function settings(ctx) {
  const root = h('div', { class: 'settings page' });
  const welcome = !store.status?.configured;
  // En ligne, la démonstration est affichée tant qu'aucune source n'est ajoutée : pas de type « Démonstration ».
  const types = isStatic ? TYPES.filter((t) => t.value !== 'demo') : TYPES;
  let type = 'xtream';
  let busy = false;

  const sourcesEl = h('div');
  const formEl = h('form', { class: 'card-panel', novalidate: true });
  const catalogEl = h('div');
  const tmdbEl = h('div');
  const optionsEl = h('div');
  const relayEl = h('div');

  root.append(
    welcome
      ? h('div', { class: 'welcome' }, h('h1', {}, 'Bienvenue dans Séance'), h('p', { class: 'lead' }, 'Ajoutez votre source IPTV pour retrouver vos films, vos séries et vos chaînes dans une interface pensée pour le salon.'))
      : h('h1', {}, 'Réglages'),
    isStatic ? h('section', {}, h('div', { class: 'card-panel notice' },
      h('h3', {}, 'Version en ligne : votre navigateur se connecte directement à votre fournisseur'),
      h('p', { class: 'hint' }, 'Vos identifiants et votre catalogue restent dans ce navigateur ; rien n\'est envoyé ailleurs qu\'à votre fournisseur. '
        + 'Cela ne fonctionne que si celui-ci est accessible en HTTPS et accepte les connexions venant d\'un site web — ce n\'est pas le cas de tous.'),
      h('p', { class: 'hint' }, 'Si la connexion ou la lecture échoue, deux solutions : configurer un relais (rubrique « Relais » ci-dessous), ou installer Séance sur un ordinateur de la maison, dont le serveur fait l\'intermédiaire.'),
      h('a', { class: 'btn', href: 'https://github.com/Lonjhe/Test-git#démarrer', target: '_blank', rel: 'noopener noreferrer', dataset: { fkey: 'install' } }, 'Installer Séance chez moi'),
    )) : null,
    h('section', {}, welcome ? null : h('h2', {}, 'Sources'), sourcesEl, formEl),
    isStatic ? h('section', {}, h('h2', {}, 'Relais'), relayEl) : null,
    welcome ? null : h('section', {}, h('h2', {}, 'Catalogue'), catalogEl),
    welcome ? null : h('section', {}, h('h2', {}, 'Fiches et genres (TMDB)'), tmdbEl),
    welcome ? null : h('section', {}, h('h2', {}, 'Options'), optionsEl),
    isStatic ? h('section', {}, h('h2', {}, 'Données de ce navigateur'), h('div', { class: 'card-panel' },
      h('p', { class: 'hint' }, 'Votre liste et vos lectures en cours sont conservées dans ce navigateur uniquement.'),
      h('button', {
        class: 'btn', type: 'button', dataset: { fkey: 'reset' },
        onclick: async () => { clearLocalState(); toast('Liste et lectures effacées'); await ctx.reloadApp('#/reglages'); },
      }, 'Effacer ma liste et mes lectures'),
    )) : null,
    h('p', { class: 'fine' }, 'Séance est un lecteur : il ne fournit aucun contenu. Utilisez-le avec un abonnement ou des playlists dont vous disposez légalement.'),
  );

  const field = (name, label, attrs = {}) => h('label', { class: 'form-row' }, h('span', {}, label),
    h('input', { class: 'field', name, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', ...attrs }));

  function paintForm() {
    const error = h('p', { class: 'error', role: 'alert' });
    const fields = {
      xtream: [
        field('url', 'Adresse du serveur', { placeholder: 'http://exemple.tv:8080', inputmode: 'url', required: true }),
        field('username', 'Identifiant', { required: true }),
        field('password', 'Mot de passe', { type: 'password', required: true }),
        field('name', 'Nom (facultatif)', { placeholder: 'Mon abonnement' }),
      ],
      m3u: [
        field('url', 'Lien de la playlist', { placeholder: 'http://exemple.tv/playlist.m3u', inputmode: 'url' }),
        h('label', { class: 'form-row' }, h('span', {}, '… ou fichier'), h('input', { type: 'file', name: 'file', accept: '.m3u,.m3u8,.txt,audio/x-mpegurl' })),
        field('name', 'Nom (facultatif)', { placeholder: 'Ma playlist' }),
      ],
      demo: [],
    }[type];
    const submit = h('button', { class: 'btn primary', type: 'submit', disabled: busy || null }, busy ? 'Connexion…' : type === 'demo' ? 'Lancer la démonstration' : 'Ajouter cette source');
    fill(formEl, 
      h('h3', {}, welcome ? 'Choisissez votre source' : 'Ajouter une source'),
      h('div', { class: 'chips', 'data-lane': true }, types.map((t) => h('button', {
        class: `chip ${type === t.value ? 'on' : ''}`, type: 'button', dataset: { fkey: `type:${t.value}` },
        'data-autofocus': welcome && t.value === type ? true : null,
        onclick: () => { type = t.value; paintForm(); formEl.querySelector('.chip.on')?.focus({ preventScroll: true }); },
      }, t.label))),
      h('p', { class: 'hint' }, types.find((t) => t.value === type).hint),
      ...fields,
      error,
      submit,
    );
    formEl.onsubmit = async (e) => {
      e.preventDefault();
      if (busy) return;
      const data = Object.fromEntries([...new FormData(formEl)].filter(([, v]) => typeof v === 'string'));
      const body = { type, ...data };
      const file = formEl.elements.file?.files?.[0];
      if (file) {
        body.content = await file.text();
        body.name = body.name || file.name.replace(/\.[^.]+$/, '');
      }
      if (type === 'm3u' && !file && !body.url) { error.textContent = 'Indiquez un lien ou choisissez un fichier.'; return; }
      busy = true;
      submit.disabled = true;
      submit.textContent = 'Connexion…';
      try {
        await api.post('/api/sources', body);
        toast('Source ajoutée');
        await ctx.reloadApp();
      } catch (err) {
        busy = false;
        submit.disabled = false;
        submit.textContent = type === 'demo' ? 'Lancer la démonstration' : 'Ajouter cette source';
        error.textContent = err.message;
      }
    };
  }

  function paintStatus() {
    const s = store.status;
    if (!s) return;
    fill(sourcesEl, s.demo ? h('p', { class: 'hint demo-note' }, 'Aucune source pour l\'instant : c\'est le catalogue de démonstration qui est affiché. Ajoutez votre abonnement ci-dessous pour le remplacer.') : null, ...s.sources.map((src) => {
      const a = src.account;
      const details = [
        { xtream: 'Xtream Codes', m3u: 'Playlist M3U', demo: 'Catalogue fictif' }[src.type],
        src.host,
        src.username ? `Compte ${src.username}` : '',
        a?.expires ? `Expire le ${new Date(a.expires * 1000).toLocaleDateString('fr-FR')}` : '',
        a?.maxConnections ? `${a.maxConnections} connexion${a.maxConnections > 1 ? 's' : ''} simultanée${a.maxConnections > 1 ? 's' : ''}` : '',
      ].filter(Boolean).join(' · ');
      return h('div', { class: 'source' },
        h('div', {}, h('b', {}, src.name), h('div', { class: 'sub' }, details)),
        h('button', {
          class: 'btn ghost', type: 'button', 'aria-label': `Retirer ${src.name}`, dataset: { fkey: `rm:${src.id}` },
          onclick: async (e) => {
            const btn = e.currentTarget;
            if (btn.dataset.confirm !== '1') {
              btn.dataset.confirm = '1';
              fill(btn, 'Confirmer le retrait');
              setTimeout(() => { if (btn.isConnected) { btn.dataset.confirm = ''; fill(btn, icon('trash'), 'Retirer'); } }, 4000);
              return;
            }
            try { await api.del(`/api/sources/${src.id}`); toast('Source retirée'); await ctx.reloadApp(); } catch (err) { toast(err.message); }
          },
        }, icon('trash'), 'Retirer'));
    }));

    if (welcome) return;
    const c = s.catalog;
    const keep = document.activeElement?.dataset?.fkey;
    if (isStatic) paintRelay(s);
    fill(catalogEl, h('div', { class: 'card-panel' },
      h('p', {}, c.loading ? 'Chargement du catalogue en cours…'
        : [[c.counts.movies, 'film'], [c.counts.series, 'série'], [c.counts.channels, 'chaîne']]
          .map(([n, word]) => `${n.toLocaleString('fr-FR')} ${word}${n > 1 ? 's' : ''}`).join(' · ')),
      c.updatedAt ? h('p', { class: 'hint' }, `Dernière mise à jour : ${new Date(c.updatedAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}. ${s.demo ? 'Catalogue de démonstration.' : 'Le catalogue se rafraîchit seul toutes les 12 heures.'}`) : null,
      c.error ? h('p', { class: 'error' }, c.error) : null,
      ...c.warnings.map((w) => h('p', { class: 'error' }, w)),
      h('button', {
        class: 'btn', type: 'button', disabled: c.loading || s.demo || null, dataset: { fkey: 'refresh' },
        onclick: async () => { await api.post('/api/refresh'); toast('Actualisation lancée'); await ctx.reloadApp('#/reglages'); },
      }, 'Actualiser maintenant'),
    ));

    const e = s.enrichment;
    const pct = e.total ? Math.round((e.done / e.total) * 100) : 0;
    const keyInput = tmdbEl.querySelector('input') || h('input', { class: 'field', name: 'tmdb', type: 'password', autocomplete: 'off', dataset: { fkey: 'tmdb-key' }, 'aria-label': 'Clé TMDB', placeholder: s.settings.tmdb ? 'Clé enregistrée — saisir pour remplacer' : 'Clé API TMDB (v3) ou jeton v4' });
    const tmdbError = tmdbEl.querySelector('.error') || h('p', { class: 'error', role: 'alert' });
    fill(tmdbEl, h('div', { class: 'card-panel' },
      h('p', {}, s.settings.tmdb
        ? (e.running ? `Classement des films par genre en cours : ${e.done.toLocaleString('fr-FR')} / ${e.total.toLocaleString('fr-FR')} (${pct} %)` : 'TMDB est activé : genres précis, résumés en français, distribution et recommandations affinées.')
        : 'Facultatif. Avec une clé TMDB gratuite (themoviedb.org → Paramètres → API), chaque film reçoit ses vrais genres, un résumé en français et de meilleures recommandations.'),
      e.running ? h('div', { class: 'meter' }, h('i', { style: `width:${pct}%` })) : null,
      e.error ? h('p', { class: 'error' }, `Enrichissement interrompu : ${e.error}`) : null,
      h('div', { class: 'inline', 'data-lane': true }, keyInput,
        h('button', {
          class: 'btn', type: 'button', dataset: { fkey: 'tmdb-save' },
          onclick: async () => {
            tmdbError.textContent = '';
            try {
              await api.put('/api/settings', { tmdbKey: keyInput.value });
              keyInput.value = '';
              toast('Clé TMDB enregistrée');
              await loadStatus();
              paintStatus();
            } catch (err) { tmdbError.textContent = err.message; }
          },
        }, 'Enregistrer'),
        s.settings.tmdb ? h('button', {
          class: 'btn ghost', type: 'button', dataset: { fkey: 'tmdb-off' },
          onclick: async () => { await api.put('/api/settings', { tmdbKey: '' }); toast('TMDB désactivé'); await loadStatus(); paintStatus(); },
        }, 'Désactiver') : null),
      tmdbError,
    ));

    const toggle = (label, hint, on, fkey, apply) => h('div', { class: 'option' },
      h('div', {}, h('b', {}, label), h('div', { class: 'sub' }, hint)),
      h('button', { class: `switch ${on ? 'on' : ''}`, type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': label, dataset: { fkey }, onclick: apply }, h('i')));
    fill(optionsEl, h('div', { class: 'card-panel' },
      toggle('Afficher les catégories pour adultes', 'Masquées par défaut dans les films, séries et chaînes.', s.settings.showAdult, 'opt-adult', async () => {
        await api.put('/api/settings', { showAdult: !s.settings.showAdult });
        await ctx.reloadApp('#/reglages');
      }),
      toggle('Direct en MPEG-TS', 'À activer si les chaînes ne démarrent pas en HLS (réglage par défaut) chez votre fournisseur.', s.settings.liveFormat === 'ts', 'opt-ts', async () => {
        await api.put('/api/settings', { liveFormat: s.settings.liveFormat === 'ts' ? 'm3u8' : 'ts' });
        await ctx.reloadApp('#/reglages');
      }),
    ));
    if (keep && document.activeElement === document.body) root.querySelector(`[data-fkey="${CSS.escape(keep)}"]`)?.focus({ preventScroll: true });
  }

  function paintRelay(s) {
    const active = s.settings.relay;
    const urlInput = relayEl.querySelector('input[name=relayUrl]') || h('input', { class: 'field', name: 'relayUrl', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', dataset: { fkey: 'relay-url' }, 'aria-label': 'Adresse du relais', placeholder: 'https://seance-relais.votre-compte.workers.dev' });
    const keyInput = relayEl.querySelector('input[name=relayKey]') || h('input', { class: 'field', name: 'relayKey', type: 'password', autocomplete: 'off', dataset: { fkey: 'relay-key' }, 'aria-label': 'Clé du relais', placeholder: 'Clé choisie lors de l\'installation du relais' });
    const error = relayEl.querySelector('.error') || h('p', { class: 'error', role: 'alert' });
    fill(relayEl, h('div', { class: 'card-panel' },
      h('p', {}, active
        ? `Relais actif : ${active}. Les échanges avec votre fournisseur passent par lui.`
        : 'Facultatif. Si votre fournisseur ne répond pas depuis cette page (pas de HTTPS, ou connexions de sites web refusées), un relais fait l\'intermédiaire.'),
      h('p', { class: 'hint' }, 'Le relais est un petit programme gratuit que vous installez sur votre propre compte Cloudflare, en quelques minutes. ',
        h('a', { class: 'link', href: 'https://github.com/Lonjhe/Test-git/blob/claude/beautiful-maxwell-vvbats/relais/README.md', target: '_blank', rel: 'noopener noreferrer' }, 'Voir le guide d\'installation')),
      h('div', { class: 'form-row' }, h('span', {}, 'Adresse du relais'), urlInput),
      h('div', { class: 'form-row' }, h('span', {}, 'Clé'), keyInput),
      error,
      h('div', { class: 'inline', 'data-lane': true },
        h('button', {
          class: 'btn primary', type: 'button', dataset: { fkey: 'relay-save' },
          onclick: async (e) => {
            const btn = e.currentTarget;
            error.textContent = '';
            btn.disabled = true;
            try {
              await api.put('/api/settings', { relay: { url: urlInput.value, key: keyInput.value } });
              urlInput.value = '';
              keyInput.value = '';
              toast('Relais enregistré');
              await ctx.reloadApp('#/reglages');
            } catch (err) {
              btn.disabled = false;
              error.textContent = err.message;
            }
          },
        }, active ? 'Remplacer le relais' : 'Enregistrer le relais'),
        active ? h('button', {
          class: 'btn ghost', type: 'button', dataset: { fkey: 'relay-off' },
          onclick: async () => { await api.put('/api/settings', { relay: null }); toast('Relais désactivé'); await ctx.reloadApp('#/reglages'); },
        }, 'Désactiver') : null),
    ));
  }

  paintForm();
  paintStatus();

  // Suivi de l'avancement (chargement du catalogue, enrichissement).
  const timer = setInterval(async () => {
    const before = JSON.stringify([store.status?.catalog, store.status?.enrichment, store.status?.settings]);
    await loadStatus().catch(() => {});
    if (ctx.alive && before !== JSON.stringify([store.status?.catalog, store.status?.enrichment, store.status?.settings])) paintStatus();
  }, 2500);
  ctx.onCleanup(() => clearInterval(timer));
  return root;
}
