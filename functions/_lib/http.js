/* Réponses HTTP des Pages Functions — un seul endroit pour la forme des réponses JSON.

   Toutes les routes /api/* répondent en JSON, en français, et ne sont jamais mises en
   cache par le navigateur (Cache-Control: no-store) : ce sont des données vivantes
   (état du catalogue, résultat d'une écriture), pas des assets. Une route qui veut
   être cachée le dit explicitement en passant son propre Cache-Control.

   Les messages d'erreur sont destinés à être affichés tels quels dans l'espace de
   gestion : une phrase en français courant, orientée action, jamais un code ou un
   message technique brut (exigence de KD-84). Le détail technique va dans les logs
   Cloudflare via console.error, pas dans la réponse. */

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...BASE_HEADERS, ...headers },
  });
}

export function error(status, message) {
  return json({ error: message }, status);
}

// Une route qui existe mais pas pour cette méthode : 405 plutôt que le 404 du fourre-tout,
// pour qu'un appel mal formé se diagnostique en une lecture.
export function methodNotAllowed(allowed) {
  return json({ error: 'Méthode non autorisée.' }, 405, { Allow: allowed.join(', ') });
}
