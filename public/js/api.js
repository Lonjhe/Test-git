// Appels à l'API de Séance.
//
// Deux modes :
//  - normal : l'interface parle au serveur Séance (sources IPTV, relais des flux) ;
//  - en ligne (GitHub Pages) : il n'y a pas de serveur. Les mêmes routes sont
//    servies par un « serveur » embarqué dans le navigateur (js/local.js), qui se
//    connecte directement au fournisseur IPTV.

export const isStatic = document.querySelector('meta[name="seance-static"]') !== null;

async function request(method, path, body) {
  // Les chemins sont résolus par rapport à la page : le site peut vivre dans un sous-dossier.
  const res = await fetch(new URL(path.replace(/^\//, ''), document.baseURI), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

let backend;
const local = async (method, path, body) => {
  backend ??= import('./local.js').then((m) => m.createBackend());
  return (await backend).handle(method, path, body);
};
const call = isStatic ? local : request;

export const api = {
  get: (path) => call('GET', path),
  post: (path, body = {}) => call('POST', path, body),
  put: (path, body = {}) => call('PUT', path, body),
  del: (path) => call('DELETE', path),
};

/** Efface la liste et les lectures conservées dans ce navigateur (version en ligne). */
export function clearLocalState() {
  try { localStorage.removeItem('seance-demo-state'); } catch { /* rien à effacer */ }
}
