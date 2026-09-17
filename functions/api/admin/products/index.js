/* GET /api/admin/products — la liste des pièces, lue sur GitHub, dans l'ordre d'affichage.

   L'écran « Mes bijoux » (/admin/) part d'ici et non du data/products.json servi avec le
   site : ce dernier a jusqu'à deux minutes de retard sur le dépôt (durée d'un déploiement),
   et Prescilia verrait revenir un état qu'elle vient de changer. La réponse est la vérité du
   dépôt, sur la branche que ce déploiement sert.

   `branch` dit sur quelle branche une écriture partirait : c'est la vérification à faire
   avant la première bascule sur un nouvel environnement (preview → sa branche, production →
   master). null : ce déploiement ne peut pas écrire (voir functions/_lib/build-info.js).

   Derrière Cloudflare Access et le middleware du dossier : jamais mise en cache. */

import { json, methodNotAllowed } from '../../../_lib/http.js';
import { deploymentBranch } from '../../../_lib/github.js';
import { loadProducts, sortForDisplay, catalogFailure } from '../../../_lib/products.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return methodNotAllowed(['GET']);

  try {
    const { products } = await loadProducts(context.env);
    return json({ branch: deploymentBranch(), products: sortForDisplay(products) });
  } catch (err) {
    console.error('products : lecture impossible — ' + (err && err.message ? err.message : err));
    return catalogFailure(err);
  }
}
