/* PATCH /api/admin/products/:id — changer l'état d'une pièce, en un commit sur le dépôt.

   Corps attendu : { "availability": "disponible" | "vendue" | "brouillon" | "retiree" } et rien
   d'autre. Un seul champ modifiable : c'est l'écran de bascule de KD-92, pas un éditeur (KD-93).
   « reservee » est refusé ici : réserver demande une date de fin, c'est KD-98 qui l'apporte.

   Réponses :
   - 200 { product, commit }      : écrit — le site suivra au prochain déploiement (1 à 2 min)
   - 200 { product, unchanged }   : déjà dans cet état, rien à écrire
   - 400                          : corps illisible ou autre champ que availability
   - 404                          : pièce inconnue
   - 422                          : état inconnu ou « reservee », ou pièce qui ne peut pas passer
                                    « en vente » (sans photo ou sans prix) — les règles de
                                    catalog.js, celles que le site et build.js appliquent
   - 409 / 502 / 503              : GitHub (voir catalogFailure)

   Lecture → modification → écriture avec le sha lu : si une autre écriture s'est glissée
   entre les deux, GitHub répond 409 et on rejoue une fois depuis une lecture fraîche. Au
   second 409 on rend la main plutôt que de boucler. Chaque écriture est un commit atomique :
   pas d'état intermédiaire possible côté dépôt. */

import { json, error, methodNotAllowed } from '../../../_lib/http.js';
import { GitHubError } from '../../../_lib/github.js';
import {
  AVAILABILITIES, loadProducts, saveProducts, findProduct,
  saleBlockers, describeSaleBlockers, catalogFailure,
} from '../../../_lib/products.js';

export async function onRequest(context) {
  if (context.request.method !== 'PATCH') return methodNotAllowed(['PATCH']);

  let body;
  try {
    body = await context.request.json();
  } catch (_) {
    return error(400, 'Requête illisible : le corps doit être du JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return error(400, 'Requête illisible : un objet { availability } est attendu.');
  }
  const fields = Object.keys(body);
  if (fields.length !== 1 || fields[0] !== 'availability') {
    return error(400, "Seul l'état de la pièce (availability) peut être modifié ici.");
  }
  if (AVAILABILITIES.indexOf(body.availability) === -1) {
    return error(422, 'État inconnu. Valeurs possibles : ' + AVAILABILITIES.join(', ') + '.');
  }
  if (body.availability === 'reservee') {
    return error(422, 'Réserver une pièce demande une date de fin : cette action arrive bientôt dans l\'espace de gestion.');
  }

  try {
    return await setAvailability(context.env, context.params.id, body.availability);
  } catch (err) {
    console.error('products : écriture impossible (' + context.params.id + ') — ' + (err && err.message ? err.message : err));
    return catalogFailure(err);
  }
}

async function setAvailability(env, id, availability) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { products, sha } = await loadProducts(env);
    const product = findProduct(products, id);
    if (!product) return error(404, "Cette pièce n'existe pas, ou n'existe plus.");
    if (product.availability === availability) return json({ product, unchanged: true });

    if (availability === 'disponible') {
      const blockers = saleBlockers(product);
      if (blockers.length) return error(422, describeSaleBlockers(blockers));
    }

    const previous = product.availability;
    product.availability = availability;
    // Le fichier doit rester valide pour build.js : la date de réservation n'existe que sur une
    // pièce réservée, la vente que sur une pièce vendue. Quitter l'état retire la donnée.
    if (availability !== 'reservee') delete product.reservedUntil;
    if (availability !== 'vendue') delete product.sale;
    try {
      const { commit } = await saveProducts(env, products, { sha, message: commitMessage(product, previous) });
      return json({ product, commit });
    } catch (err) {
      if (err instanceof GitHubError && err.status === 409 && attempt === 1) continue;
      throw err;
    }
  }
  // Second 409 : la boucle s'est arrêtée sans écrire
  throw new GitHubError(409, 'conflit persistant sur ' + id);
}

// Sujet en anglais comme le reste de l'historique ; le corps dit d'où vient la modification.
// Aucune identité personnelle : le dépôt est public (l'auteur est fixé dans github.js).
function commitMessage(product, previous) {
  return 'content(catalog): mark "' + product.name + '" as ' + product.availability + '\n\n' +
    'Modification enregistrée via l\'espace de gestion (' + previous + ' → ' + product.availability + ').';
}
