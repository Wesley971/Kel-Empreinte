/* /api/admin/products — la liste des pièces (GET) et l'ajout d'une pièce (POST).

   GET : la liste lue sur GitHub, dans l'ordre d'affichage, et les collections. L'écran « Mes
   bijoux » (/admin/) et le formulaire de pièce partent d'ici et non du data/products.json servi
   avec le site : ce dernier a jusqu'à deux minutes de retard sur le dépôt (durée d'un
   déploiement), et Prescilia verrait revenir un état qu'elle vient de changer. La réponse est la
   vérité du dépôt, sur la branche que ce déploiement sert.

   `branch` dit sur quelle branche une écriture partirait : c'est la vérification à faire
   avant la première bascule sur un nouvel environnement (preview → sa branche, production →
   master). null : ce déploiement ne peut pas écrire (voir functions/_lib/build-info.js).

   POST (KD-93) : une nouvelle pièce, depuis le formulaire — JSON { piece, photos } : la fiche,
   et les photos ajoutées déjà en base64 (`photos["photo-1"]`, …). Voir functions/_lib/piece.js
   pour les règles et functions/_lib/photos.js pour les photos. Réponses :
   - 200 { product, commit, deploys } : écrit — `deploys` dit si un déploiement suit (false
                                       pour un brouillon : commit marqué « ne pas déployer »)
   - 400 requête illisible, champ inattendu, photo citée sans contenu ou contenu sans photo
   - 413 photo trop lourde · 415 format de photo inconnu
   - 422 ce que Prescilia doit corriger, en une phrase (nom, référence déjà portée, mise en
         vente sans photo ou prix, état), ou la règle du modèle (celle de build.js)
   - 409 / 502 / 503 : GitHub (voir catalogFailure)

   Derrière Cloudflare Access et le middleware du dossier : jamais mise en cache. */

import { json, error, methodNotAllowed } from '../../../_lib/http.js';
import { deploymentBranch, readRepoFile } from '../../../_lib/github.js';
import { loadProducts, sortForDisplay, catalogFailure } from '../../../_lib/products.js';
import { readPieceRequest } from '../../../_lib/photos.js';
import { checkPieceBody, savePiece } from '../../../_lib/piece.js';

const COLLECTIONS_FILE = 'data/collections.json';

export async function onRequest(context) {
  const method = context.request.method;
  if (method === 'GET') return list(context);
  if (method === 'POST') return create(context);
  return methodNotAllowed(['GET', 'POST']);
}

async function list(context) {
  try {
    const [{ products }, collectionsFile] = await Promise.all([
      loadProducts(context.env),
      readRepoFile(context.env, COLLECTIONS_FILE),
    ]);
    const collections = JSON.parse(collectionsFile.content);
    return json({ branch: deploymentBranch(), products: sortForDisplay(products), collections: Array.isArray(collections) ? collections : [] });
  } catch (err) {
    console.error('products : lecture impossible — ' + (err && err.message ? err.message : err));
    return catalogFailure(err);
  }
}

async function create(context) {
  const request = await readPieceRequest(context.request);
  if (request.error) return error(request.error.status, request.error.message);
  const checked = checkPieceBody(request.piece);
  if (checked.error) return error(checked.error.status, checked.error.message);

  try {
    return await savePiece(context.env, { id: null, piece: checked.piece, uploads: request.uploads });
  } catch (err) {
    console.error('products : ajout impossible — ' + (err && err.message ? err.message : err));
    return catalogFailure(err);
  }
}
