/* Le catalogue vu des Functions — lire data/products.json sur GitHub, le modifier, le réécrire.

   Le fichier est la source de vérité du site et il est relu par des humains dans l'historique
   git : une écriture ne doit changer que ce qu'on a voulu changer. La sérialisation est celle de
   catalog.js (serializeProducts, partagée avec les scripts du dépôt) : indentation et ordre des
   clés reproduits, espaces insécables ré-échappés « \u00a0 », round-trip lecture → écriture
   identique octet pour octet (couvert par un test sur le vrai fichier). Toute autre normalisation
   (fichier indenté autrement à la main) se produira une fois, au premier enregistrement, et sera
   visible dans le diff de ce commit.

   Les règles d'état (quand une pièce peut passer « en vente », quelles transitions existent, la
   réservation de 14 jours à l'heure de Paris) viennent de catalog.js, le module partagé avec le
   site et l'écran de gestion : même règle, écrite une fois. */

import catalog from '../../catalog.js';
import { error } from './http.js';
import { GitHubError, readRepoFile, writeRepoFile } from './github.js';

export const PRODUCTS_FILE = 'data/products.json';

export const AVAILABILITIES = catalog.AVAILABILITIES;
export const STATE_LABELS = catalog.STATE_LABELS;
export const CHANNELS = catalog.CHANNELS;
export const sortForDisplay = catalog.sortForDisplay;
export const displayBlockers = catalog.displayBlockers;
export const saleBlockers = catalog.saleBlockers;
export const describeSaleBlockers = catalog.describeSaleBlockers;
export const canTransition = catalog.canTransition;
export const isReservationActive = catalog.isReservationActive;
export const isFutureDay = catalog.isFutureDay;
export const parseIsoDate = catalog.parseIsoDate;
export const formatDay = catalog.formatDay;
export const todayInParis = catalog.todayInParis;
export const reservationEnd = catalog.reservationEnd;

// SyntaxError dans les deux cas (JSON invalide, ou valide mais pas une liste) : pour
// catalogFailure, c'est la même situation — le fichier du dépôt n'est pas lisible tel quel.
export function parseProducts(content) {
  const products = JSON.parse(content);
  if (!Array.isArray(products)) throw new SyntaxError(PRODUCTS_FILE + ' : le contenu n\'est pas une liste de pièces');
  return products;
}

export const serializeProducts = catalog.serializeProducts;

export function findProduct(products, id) {
  return products.find((product) => product && product.id === id) || null;
}

// Une copie de la pièce dans son nouvel état, avec l'ordre des clés du fichier : `reservedUntil`
// juste après `availability`, `sale` en dernier — le diff du commit se lit d'un coup d'œil. Les
// données qui n'ont plus de sens dans le nouvel état disparaissent (la date d'une pièce qui n'est
// plus réservée, la vente d'une pièce qui n'est plus vendue) : build.js les refuserait.
// `today` : le jour à Paris — un brouillon qui passe en vente reçoit ce jour comme `createdAt`,
// la date de première mise en vente (le nom du champ est historique) ; toute autre transition
// garde la date, une pièce retirée puis remise en vente n'est pas une nouveauté. Même règle dans
// piece.js (assemble) pour le passage en vente depuis la fiche. Ce jour-là commence aussi
// l'historique de prix (KD-109) : la première entrée est le prix pratiqué dès la mise en vente —
// sans elle, build.js refuserait la pièce (un prix pratiqué sans son entrée).
export function withState(product, availability, { reservedUntil, sale, today } = {}) {
  const published = product.availability === 'brouillon' && availability !== 'brouillon';
  const updated = {};
  Object.keys(product).forEach((key) => {
    if (key === 'reservedUntil' || key === 'sale') return;
    updated[key] = product[key];
    if (key === 'availability') {
      updated.availability = availability;
      if (reservedUntil) updated.reservedUntil = reservedUntil;
    }
    if (key === 'createdAt' && published && today) updated.createdAt = today;
    if (key === 'priceHistory' && published && today) updated.priceHistory = catalog.recordPrice([], catalog.effectivePrice(product), today);
  });
  if (sale) updated.sale = sale;
  return updated;
}

// Renvoie aussi le sha : indispensable pour réécrire sans écraser une modification faite
// entre-temps (GitHub répond 409 si le sha n'est plus le bon).
export async function loadProducts(env) {
  const { content, sha } = await readRepoFile(env, PRODUCTS_FILE);
  return { products: parseProducts(content), sha };
}

export async function saveProducts(env, products, { sha, message }) {
  return writeRepoFile(env, PRODUCTS_FILE, { content: serializeProducts(products), sha, message });
}

// Traduit un échec de lecture ou d'écriture en réponse pour l'écran de gestion : une phrase
// en français, orientée action (voir http.js). Le détail technique est déjà dans les logs
// Cloudflare, écrit par la route avant d'appeler cette fonction.
export function catalogFailure(err) {
  if (err instanceof GitHubError) {
    // status 0 : configuration (token absent, branche du déploiement inconnue)
    if (err.status === 0) return error(503, "L'espace de gestion n'est pas configuré pour enregistrer depuis cet environnement.");
    if (err.status === 401 || err.status === 403) return error(502, "GitHub refuse l'accès au catalogue — le jeton d'accès a peut-être expiré.");
    if (err.status === 404) return error(502, 'Le catalogue est introuvable sur GitHub pour cet environnement (branche supprimée ?).');
    if (err.status === 409) return error(409, 'Une autre modification vient d\'être enregistrée. Rechargez la page et réessayez.');
    return error(502, "GitHub n'a pas pu enregistrer la modification. Réessayez dans un instant.");
  }
  if (err instanceof SyntaxError) return error(502, 'Le catalogue sur GitHub est illisible : vérifiez data/products.json.');
  return error(502, 'GitHub ne répond pas. Réessayez dans un instant.');
}
