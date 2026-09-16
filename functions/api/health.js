/* GET /api/health — la brique serverless est-elle vivante, et parle-t-elle à GitHub ?

   Route de preuve de KD-90 : une réponse 200 démontre toute la chaîne Function → token
   Runtime → API GitHub → data/products.json. Elle est publique (hors /api/admin/*) pour
   être testable avant la mise en place de Cloudflare Access (KD-91), et pour qu'une sonde
   externe (check-site.js, KD-94) puisse détecter un token expiré ou révoqué : c'est le
   point de panne silencieux de tout l'espace de gestion.

   Publique, donc sobre : le nombre de pièces (déjà affiché sur le site) et un état.
   Jamais de sha, de nom de dépôt ni de message d'erreur GitHub — ceux-là vont dans les
   logs Cloudflare. Et mise en cache : un appel martelé ne doit pas consommer le quota
   GitHub du token, dont dépendent les écritures de Prescilia. */

import { json } from '../_lib/http.js';
import { readRepoFile } from '../_lib/github.js';

const PRODUCTS_FILE = 'data/products.json';
// Un succès change rarement ; un échec doit redevenir vert vite après correction.
const CACHE_OK_SECONDS = 300;
const CACHE_ERROR_SECONDS = 60;

export async function onRequestGet(context) {
  // Le cache est indexé par URL : on normalise pour qu'un « ?x=1 » ne le contourne pas.
  const cacheKey = new Request(new URL('/api/health', context.request.url).toString(), { method: 'GET' });
  const cache = globalThis.caches ? globalThis.caches.default : null;

  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  let body;
  let status;
  try {
    const { content } = await readRepoFile(context.env, PRODUCTS_FILE);
    const products = JSON.parse(content);
    body = { ok: true, github: 'ok', products: Array.isArray(products) ? products.length : null };
    status = 200;
  } catch (err) {
    console.error('health : ' + (err && err.message ? err.message : err));
    body = { ok: false, github: 'erreur', products: null };
    status = 503;
  }

  const response = json(body, status, {
    'Cache-Control': 'public, max-age=' + (status === 200 ? CACHE_OK_SECONDS : CACHE_ERROR_SECONDS),
  });
  if (cache) context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
