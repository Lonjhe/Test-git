// Catalogue de démonstration : titres fictifs, affiches générées, clip de test.
// Permet de découvrir l'interface sans abonnement.

const FILMS = {
  Action: ['Ligne Rouge', 'Dernier Convoi', 'Les Gardiens de l\'Aube', 'Les Gardiens de l\'Aube 2 : Représailles', 'Point de Rupture', 'Opération Mistral', 'Sans Retour', 'La Traque'],
  'Science-Fiction': ['Orbite Zéro', 'Les Jardins de Titan', 'Signal Perdu', 'Chronos', 'L\'Archipel des Machines', 'Après la Poussière', 'Colonie 7', 'Orbite Zéro : Dérive'],
  Comédie: ['Week-end à Trois Francs', 'Mon Voisin le Maire', 'Belle-Famille & Compagnie', 'Les Bras Cassés', 'Tout Sauf Ça', 'Un Mariage de Trop', 'Le Stagiaire de 50 Ans', 'Camping Palace'],
  Drame: ['Les Heures Grises', 'Ce Que Disent les Vagues', 'La Maison d\'Hiver', 'Un Été à Roubaix', 'Le Silence des Blés', 'Derniers Jours de Septembre', 'Loin des Autres', 'La Promesse d\'Elsa'],
  Thriller: ['Angle Mort', 'La Chambre 314', 'Faux Témoin', 'Nuit Blanche à Marseille', 'Le Dossier Kessler', 'Écran de Fumée', 'Personne ne Viendra', 'Double Fond'],
  Horreur: ['Le Puits', 'Ceux d\'en Bas', 'La Veillée', 'Sous la Glace', 'Le Pensionnat', 'Minuit, Rue des Ormes'],
  Animation: ['Pip et la Comète', 'Le Royaume des Lucioles', 'Capitaine Moustache', 'La Forêt qui Chantait', 'Robots & Confitures', 'Le Voyage de Nour'],
  Aventure: ['L\'Or du Tassili', 'La Carte des Vents', 'Au-delà du Col', 'Les Naufragés de Kerguelen', 'Expédition Amarante', 'Le Trésor de la Lagune'],
  Romance: ['Un Hiver à Lisbonne', 'Lettres à Camille', 'Trois Rendez-vous', 'Le Dernier Train pour Biarritz', 'Avant l\'Orage', 'Deux Fois Juin'],
  Documentaire: ['Abysses', 'La Route du Sel', 'Géants de Pierre', 'Une Saison chez les Loups', 'Lumière sur la Ville'],
  Fantastique: ['La Tisseuse d\'Ombres', 'Le Septième Sceau de Brume', 'Les Portes d\'Ys', 'Le Marchand de Minuit', 'L\'Enfant et le Dragon de Sel'],
  Western: ['Poussière et Plomb', 'Le Shérif de Santa Rosa', 'Dernière Diligence'],
};

const SECOND_GENRE = {
  Action: ['Thriller', 'Aventure'], 'Science-Fiction': ['Aventure', 'Thriller'], Comédie: ['Romance', 'Familial'],
  Drame: ['Romance', 'Histoire'], Thriller: ['Crime', 'Mystère'], Horreur: ['Thriller', 'Mystère'],
  Animation: ['Familial', 'Aventure'], Aventure: ['Action', 'Familial'], Romance: ['Drame', 'Comédie'],
  Documentaire: [], Fantastique: ['Aventure', 'Familial'], Western: ['Action', 'Drame'],
};

const PLOTS = {
  Action: 'Quand une mission de routine tourne au piège, {t} entraîne une poignée de survivants dans une course contre la montre où chaque allié peut cacher un adversaire.',
  'Science-Fiction': 'Aux confins du système solaire, un équipage découvre un signal qui n\'aurait jamais dû exister. {t} interroge ce qu\'il reste d\'humain quand la Terre n\'est plus qu\'un souvenir.',
  Comédie: 'Rien ne se passe comme prévu, et c\'est tant mieux. {t} enchaîne quiproquos et catastrophes domestiques avec une tendresse communicative.',
  Drame: 'Le temps d\'une saison, une famille doit réapprendre à se parler. {t} est le portrait délicat de ceux qui restent.',
  Thriller: 'Un détail ne colle pas, puis deux. Dans {t}, une enquête banale révèle un mensonge patiemment construit — et ceux qui tiennent à le protéger.',
  Horreur: 'Ils pensaient être seuls. {t} installe une peur sourde, de celles qui restent une fois la lumière rallumée.',
  Animation: 'Une aventure lumineuse pour petits et grands : {t} célèbre l\'amitié, le courage et les idées farfelues qui sauvent la mise.',
  Aventure: 'Une vieille carte, un pari insensé, un horizon à atteindre. {t} renoue avec le souffle des grands récits d\'exploration.',
  Romance: 'Deux trajectoires qui n\'auraient jamais dû se croiser. {t} raconte une rencontre, ses hésitations, et ce qu\'on ose enfin se dire.',
  Documentaire: 'Des images rares et un regard patient : {t} donne à voir un monde que l\'on croyait connaître.',
  Fantastique: 'Derrière le voile du quotidien, un autre royaume s\'éveille. {t} mêle légendes anciennes et quête initiatique.',
  Western: 'Une ville sans loi, un étranger sans passé. {t} ravive la poussière et la morale rugueuse de la Frontière.',
};

const SERIES = [
  ['Les Eaux Troubles', 'Thriller', 'Dans un port de la Manche, la disparition d\'un chalutier réveille de vieilles rancunes.'],
  ['Station Kepler', 'Science-Fiction', 'La vie quotidienne — et les secrets — d\'une station orbitale à bout de souffle.'],
  ['Rue du Marché', 'Comédie', 'Les commerçants d\'une petite rue se serrent les coudes, non sans se chamailler.'],
  ['La Lignée', 'Drame', 'Trois générations d\'une famille de vignerons face à un héritage empoisonné.'],
  ['Brigade de Nuit', 'Crime', 'Une équipe de police judiciaire travaille quand la ville dort.'],
  ['Les Petits Explorateurs', 'Animation', 'Chaque épisode, une nouvelle expédition au fond du jardin.'],
  ['Chroniques d\'Ys', 'Fantastique', 'La cité engloutie remonte à la surface, et avec elle ses anciens maîtres.'],
  ['Terres Sauvages', 'Documentaire', 'Un tour du monde des derniers espaces préservés.'],
];

const CHANNELS = {
  Généralistes: ['Démo Une', 'Démo Deux', 'Canal Découverte', 'Télé Soir', 'Six Démo'],
  Info: ['Info Continue', 'Le Fil 24', 'Monde Direct'],
  Sport: ['Sport Démo 1', 'Sport Démo 2', 'Stade Plus', 'Vélo TV'],
  Cinéma: ['Ciné Démo Premier', 'Ciné Classique', 'Ciné Frisson'],
  Jeunesse: ['Petits Loups', 'Toon Démo', 'Ado TV'],
  Musique: ['Tempo', 'Scène Live'],
};

// Générateur pseudo-aléatoire déterministe (le catalogue est identique à chaque lancement).
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function loadDemo(origin) {
  const rnd = mulberry(20240607);
  const now = Math.floor(Date.now() / 1000);
  const film = `${origin}/demo/media/film.mp4`;
  const live = `${origin}/demo/media/live/index.m3u8`;
  const art = (seed, title, shape) => `/demo/art/${seed}.svg?shape=${shape}&t=${encodeURIComponent(title)}`;

  const movies = [];
  let n = 0;
  for (const [genre, titles] of Object.entries(FILMS)) {
    for (const title of titles) {
      n++;
      const year = 1978 + Math.floor(rnd() ** 0.6 * 47);
      const rating = Math.round((5.2 + rnd() * 3.9) * 10) / 10;
      const extra = SECOND_GENRE[genre].filter(() => rnd() < 0.6);
      const base = {
        poster: art(n, title, 'poster'),
        backdrop: art(n, title, 'wide'),
        rating,
        added: now - Math.floor(rnd() * 200) * 86400,
        cat: genre,
        genres: [genre, ...extra],
        plot: PLOTS[genre].replace('{t}', `« ${title} »`),
        duration: 80 + Math.floor(rnd() * 70),
        url: film,
        ext: 'mp4',
      };
      movies.push({ key: `f${n}`, name: `${title} (${year})`, ...base });
      // Quelques films existent en plusieurs versions, comme chez un vrai fournisseur.
      if (n % 5 === 0) movies.push({ key: `f${n}k`, name: `${title} (${year}) 4K HDR`, ...base });
      if (n % 7 === 0) movies.push({ key: `f${n}v`, name: `${title} (${year}) VOSTFR`, ...base });
    }
  }

  const series = SERIES.map(([title, genre, plot], i) => {
    const seasons = 1 + Math.floor(rnd() * 3);
    const episodes = [];
    for (let s = 1; s <= seasons; s++) {
      const count = 4 + Math.floor(rnd() * 5);
      for (let e = 1; e <= count; e++) {
        episodes.push({
          key: `s${i}e${s}x${e}`, season: s, episode: e, title: `Épisode ${e}`,
          plot: 'Épisode de démonstration.', duration: 22 + Math.floor(rnd() * 30), url: film, ext: 'mp4',
          image: art(1000 + i * 100 + s * 10 + e, `${title} — S${s} É${e}`, 'wide'),
        });
      }
    }
    return {
      key: `s${i}`, name: title, poster: art(500 + i, title, 'poster'), backdrop: art(500 + i, title, 'wide'),
      rating: Math.round((6 + rnd() * 3) * 10) / 10, added: now - Math.floor(rnd() * 120) * 86400,
      cat: genre, genres: genre, plot, year: 2012 + Math.floor(rnd() * 13), episodes,
    };
  });

  const channels = [];
  let num = 0;
  for (const [cat, names] of Object.entries(CHANNELS)) {
    for (const name of names) {
      num++;
      channels.push({ key: `c${num}`, name, logo: art(2000 + num, name, 'logo'), cat, num, epgId: '', url: live });
    }
  }
  return { movies, series, channels };
}

export function demoEpg(name) {
  const slot = 3600;
  const start = Math.floor(Date.now() / 1000 / slot) * slot;
  const shows = ['Le Journal', 'Grand Format', 'Le Mag', 'Ciné Séance', 'Plateau Direct', 'Rétro'];
  const pick = (k) => shows[(name.length + k + Math.floor(start / slot)) % shows.length];
  return [0, 1].map((k) => ({
    title: pick(k), desc: 'Programme de démonstration.', start: start + k * slot, end: start + (k + 1) * slot,
  }));
}

const PALETTES = [
  ['#0f2027', '#2c5364', '#f6d365'], ['#1a2a6c', '#b21f1f', '#fdbb2d'], ['#141e30', '#35577d', '#f7797d'],
  ['#232526', '#5c258d', '#f093fb'], ['#0b3d2e', '#1f8a70', '#f2f7a1'], ['#3a1c71', '#d76d77', '#ffaf7b'],
  ['#16222a', '#3a6073', '#a8edea'], ['#42275a', '#734b6d', '#ffd89b'], ['#1e130c', '#9a8478', '#ffe29f'],
  ['#000428', '#004e92', '#89f7fe'], ['#200122', '#6f0000', '#ff9966'], ['#0f0c29', '#302b63', '#fbc2eb'],
];

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function wrap(title, max) {
  const lines = [];
  let cur = '';
  for (const word of title.split(/\s+/)) {
    if (cur && (cur + ' ' + word).length > max) { lines.push(cur); cur = word; } else cur = cur ? cur + ' ' + word : word;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

/** Illustration SVG abstraite (paysage stylisé) servant d'affiche de démonstration. */
export function demoArt(seed, title, shape) {
  const rnd = mulberry(seed * 7919 + 13);
  const [c1, c2, accent] = PALETTES[seed % PALETTES.length];
  const [w, h] = shape === 'wide' ? [1280, 720] : shape === 'logo' ? [640, 360] : [600, 900];
  const font = 'font-family="-apple-system, \'Segoe UI\', Helvetica, Arial, sans-serif"';

  if (shape === 'logo') {
    const initials = title.split(/\s+/).map((x) => x[0]).join('').slice(0, 3).toUpperCase();
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.82}" cy="${h * 0.2}" r="${h * 0.5}" fill="${accent}" opacity=".16"/><text x="50%" y="50%" dy=".35em" text-anchor="middle" ${font} font-size="150" font-weight="800" fill="#fff" letter-spacing="6">${esc(initials)}</text></svg>`;
  }

  const sunX = w * (0.2 + rnd() * 0.6);
  const sunY = h * (0.22 + rnd() * 0.18);
  const sunR = Math.min(w, h) * (0.1 + rnd() * 0.1);
  let hills = '';
  for (let layer = 0; layer < 4; layer++) {
    const baseY = h * (0.5 + layer * 0.11);
    let d = `M0 ${h} L0 ${baseY}`;
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const x = (w / steps) * i;
      const y = baseY + (rnd() - 0.5) * h * 0.16;
      const cx = x - w / steps / 2;
      const cy = baseY + (rnd() - 0.5) * h * 0.22;
      d += ` Q${cx.toFixed(0)} ${cy.toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)}`;
    }
    d += ` L${w} ${h} Z`;
    hills += `<path d="${d}" fill="#000" opacity="${(0.22 + layer * 0.17).toFixed(2)}"/>`;
  }
  let text = '';
  if (shape === 'poster') {
    const lines = wrap(title, 13);
    const size = lines.some((l) => l.length > 11) ? 60 : 70;
    const startY = h - 70 - (lines.length - 1) * size * 1.08;
    text = lines.map((l, i) => `<text x="44" y="${(startY + i * size * 1.08).toFixed(0)}" ${font} font-size="${size}" font-weight="800" fill="#fff">${esc(l)}</text>`).join('');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${c2}"/><stop offset="1" stop-color="${c1}"/></linearGradient><radialGradient id="s"><stop offset="0" stop-color="${accent}"/><stop offset=".6" stop-color="${accent}" stop-opacity=".85"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${sunX.toFixed(0)}" cy="${sunY.toFixed(0)}" r="${(sunR * 2.6).toFixed(0)}" fill="${accent}" opacity=".12"/><circle cx="${sunX.toFixed(0)}" cy="${sunY.toFixed(0)}" r="${sunR.toFixed(0)}" fill="url(#s)"/>${hills}${text}</svg>`;
}
