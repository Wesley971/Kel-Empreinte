/* /api/admin/products/:id — une pièce : changer son état (PATCH), modifier sa fiche (PUT),
   supprimer un brouillon (DELETE). Chaque écriture est un commit sur le dépôt.

   PUT et DELETE (KD-93) : le formulaire de pièce. PUT reçoit le même JSON que POST
   ({ piece, photos }) et réécrit la fiche entière ; l'état ne s'y change pas
   (sauf brouillon → en vente), `reservedUntil`, `sale`, `createdAt`, `priceHistory` et `id` sont
   préservés (un brouillon qui passe en vente, par PUT ou PATCH, prend ce jour comme `createdAt`
   et sa première entrée d'historique de prix — KD-109 ; jamais reçus, écrits par la machine).
   DELETE ne s'applique qu'à un brouillon jamais publié : la pièce et ses photos disparaissent,
   commit marqué « ne pas déployer ». Règles et réponses : functions/_lib/piece.js.

   PATCH — changer l'état. Corps attendu : { "availability": <état>, "sale"?: { amount, channel,
   date } } et rien d'autre. C'est l'écran « Mes bijoux » (KD-92, KD-98), pas l'éditeur de fiche.

   - Les transitions possibles sont celles de catalog.js (allowedTransitions), les mêmes que
     l'écran propose : une pièce publiée ne redevient jamais un brouillon, une réservée active ne
     se réserve pas à nouveau, une vendue se complète (« vendue » → « vendue » avec `sale`).
   - « reservee » : la date n'est jamais reçue — la Function la calcule (14 jours, heure de
     Paris, règle de catalog.js) et l'écrit dans `reservedUntil`. Un `reservedUntil` dans le
     corps est refusé : aucune date de réservation ne se choisit à la main.
   - « vendue » : `sale` porte le montant réellement encaissé (facultatif : Prescilia peut le
     compléter plus tard, l'écran le réclame), le canal (obligatoire) et le jour de la vente
     (obligatoire, jamais au futur).
   - Quitter un état retire ses données : plus de `reservedUntil` hors réservation, plus de
     `sale` hors vente. Le fichier reste ce que build.js accepte.

   Réponses :
   - 200 { product, commit }      : écrit — le site suivra au prochain déploiement (1 à 2 min)
   - 200 { product, unchanged }   : déjà dans cet état, rien à écrire
   - 400                          : corps illisible, champ inattendu, `reservedUntil` envoyé
   - 404                          : pièce inconnue
   - 422                          : état inconnu, transition refusée, vente mal renseignée, pièce
                                    qui ne peut pas passer en vente ou réservée (sans photo, nom,
                                    type, public ou prix) ni vendue (idem, prix excepté) — les
                                    règles de catalog.js, celles que le site et build.js appliquent
   - 409 / 502 / 503              : GitHub (voir catalogFailure)

   Lecture → modification → écriture avec le sha lu : si une autre écriture s'est glissée
   entre les deux, GitHub répond 409 et on rejoue une fois depuis une lecture fraîche — la
   transition est revérifiée sur cette lecture. Au second 409 on rend la main plutôt que de
   boucler. Chaque écriture est un commit atomique : pas d'état intermédiaire côté dépôt. */

import { json, error, methodNotAllowed } from '../../../_lib/http.js';
import { GitHubError } from '../../../_lib/github.js';
import { readPieceRequest } from '../../../_lib/photos.js';
import { checkPieceBody, savePiece, deleteDraft } from '../../../_lib/piece.js';
import {
  AVAILABILITIES, STATE_LABELS, CHANNELS, loadProducts, saveProducts, withState,
  displayBlockers, saleBlockers, describeSaleBlockers, canTransition, isReservationActive,
  isFutureDay, parseIsoDate, formatDay, todayInParis, reservationEnd, catalogFailure,
} from '../../../_lib/products.js';

const BODY_FIELDS = ['availability', 'sale'];
const SALE_FIELDS = ['amount', 'channel', 'date'];

export async function onRequest(context) {
  const method = context.request.method;
  if (method === 'PUT') return update(context);
  if (method === 'DELETE') return remove(context);
  if (method !== 'PATCH') return methodNotAllowed(['PATCH', 'PUT', 'DELETE']);

  let body;
  try {
    body = await context.request.json();
  } catch (_) {
    return error(400, 'Requête illisible : le corps doit être du JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return error(400, 'Requête illisible : un objet { availability, sale } est attendu.');
  }
  if ('reservedUntil' in body) {
    return error(400, 'La date de réservation se calcule toute seule (14 jours) : elle ne s\'envoie pas.');
  }
  if (Object.keys(body).some((field) => BODY_FIELDS.indexOf(field) === -1)) {
    return error(400, "Seuls l'état de la pièce (availability) et sa vente (sale) peuvent être modifiés ici.");
  }
  if (AVAILABILITIES.indexOf(body.availability) === -1) {
    return error(422, 'État inconnu. Valeurs possibles : ' + AVAILABILITIES.join(', ') + '.');
  }

  let sale = null;
  if (body.sale !== undefined) {
    if (body.availability !== 'vendue') return error(422, 'La vente ne se renseigne que pour une pièce vendue.');
    const checked = checkSale(body.sale);
    if (checked.error) return error(422, checked.error);
    sale = checked.sale;
  }

  try {
    return await changeState(context.env, context.params.id, body.availability, sale);
  } catch (err) {
    console.error('products : écriture impossible (' + context.params.id + ') — ' + (err && err.message ? err.message : err));
    return catalogFailure(err);
  }
}

// PUT : la fiche entière, depuis le formulaire (KD-93)
async function update(context) {
  const request = await readPieceRequest(context.request);
  if (request.error) return error(request.error.status, request.error.message);
  const checked = checkPieceBody(request.piece);
  if (checked.error) return error(checked.error.status, checked.error.message);
  try {
    return await savePiece(context.env, { id: context.params.id, piece: checked.piece, uploads: request.uploads });
  } catch (err) {
    console.error('products : modification impossible (' + context.params.id + ') — ' + (err && err.message ? err.message : err));
    return catalogFailure(err);
  }
}

// DELETE : un brouillon jamais publié, et lui seul (KD-93)
async function remove(context) {
  try {
    return await deleteDraft(context.env, context.params.id);
  } catch (err) {
    console.error('products : suppression impossible (' + context.params.id + ') — ' + (err && err.message ? err.message : err));
    return catalogFailure(err);
  }
}

// La vente telle que le fichier l'attend : { amount, channel, date }, montant vide = null (l'écran
// affiche « montant à compléter » jusqu'à ce qu'il le soit). Les messages sont pour Prescilia.
function checkSale(sale) {
  if (!sale || typeof sale !== 'object' || Array.isArray(sale)) return { error: 'La vente doit indiquer le canal et la date.' };
  if (Object.keys(sale).some((field) => SALE_FIELDS.indexOf(field) === -1)) return { error: 'La vente ne connaît que le montant, le canal et la date.' };
  const amount = sale.amount === undefined || sale.amount === null || sale.amount === '' ? null : sale.amount;
  if (amount !== null && !(typeof amount === 'number' && isFinite(amount) && amount >= 0)) {
    return { error: 'Le montant encaissé doit être un nombre positif, ou rester vide.' };
  }
  if (!CHANNELS.some((channel) => channel.id === sale.channel)) {
    return { error: 'Choisissez le canal de la vente : ' + CHANNELS.map((channel) => channel.label.toLowerCase()).join(', ') + '.' };
  }
  if (!parseIsoDate(sale.date)) return { error: 'La date de la vente doit être un jour au format AAAA-MM-JJ.' };
  if (isFutureDay(sale.date)) return { error: 'La date de la vente ne peut pas être dans le futur.' };
  return { sale: { amount, channel: sale.channel, date: sale.date } };
}

async function changeState(env, id, availability, sale) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { products, sha } = await loadProducts(env);
    const index = products.findIndex((product) => product && product.id === id);
    if (index === -1) return error(404, "Cette pièce n'existe pas, ou n'existe plus.");
    const product = products[index];
    const now = new Date();

    // Rien à écrire : même état, et rien de neuf (réserver à nouveau ou compléter une vente écrivent)
    if (product.availability === availability && availability !== 'reservee' && !sale) return json({ product, unchanged: true });
    if (!canTransition(product, availability, now)) return error(422, refusal(product, availability));

    // Jamais un fichier que build.js refuserait : en vente ou réservée = photo, nom, type, public
    // et prix ; vendue = les mêmes sans le prix (la pièce reste affichée en boutique)
    if (availability === 'disponible' || availability === 'reservee') {
      const blockers = saleBlockers(product);
      if (blockers.length) return error(422, describeSaleBlockers(blockers, availability === 'reservee' ? 'de réserver cette pièce' : undefined));
    }
    if (availability === 'vendue') {
      const blockers = displayBlockers(product);
      if (blockers.length) return error(422, describeSaleBlockers(blockers, 'de marquer cette pièce vendue'));
    }

    const previous = product.availability;
    const updated = withState(product, availability, {
      reservedUntil: availability === 'reservee' ? reservationEnd(todayInParis(now)) : undefined,
      sale: availability === 'vendue' ? (sale || product.sale) : undefined,
      today: todayInParis(now), // un brouillon mis en vente prend ce jour comme createdAt
    });
    products[index] = updated;
    try {
      const { commit } = await saveProducts(env, products, { sha, message: commitMessage(updated, previous) });
      return json({ product: updated, commit });
    } catch (err) {
      if (err instanceof GitHubError && err.status === 409 && attempt === 1) continue;
      throw err;
    }
  }
  // Second 409 : la boucle s'est arrêtée sans écrire
  throw new GitHubError(409, 'conflit persistant sur ' + id);
}

// Pourquoi la transition est refusée, en une phrase qui dit quoi faire
function refusal(product, availability) {
  const label = (state) => STATE_LABELS[state].toLowerCase();
  if (availability === 'brouillon') return 'Une pièce publiée ne redevient pas un brouillon.';
  if (availability === 'reservee' && isReservationActive(product)) {
    return 'Cette pièce est déjà réservée jusqu\'au ' + formatDay(parseIsoDate(product.reservedUntil)) + '. Attendez l\'échéance ou remettez-la en vente d\'abord.';
  }
  if (product.availability === 'brouillon') return 'Un brouillon ne peut que passer en vente : complétez-le, puis mettez-le en vente.';
  return 'Une pièce ' + label(product.availability) + ' ne peut pas passer « ' + label(availability) + ' » directement. Remettez-la en vente d\'abord.';
}

// Sujet en anglais comme le reste de l'historique ; le corps dit d'où vient la modification.
// Aucune identité personnelle : le dépôt est public (l'auteur est fixé dans github.js).
function commitMessage(product, previous) {
  const via = 'Modification enregistrée via l\'espace de gestion';
  if (previous === 'vendue' && product.availability === 'vendue') {
    return 'content(catalog): record the sale of "' + product.name + '"\n\n' + via + ' (montant, canal et date de la vente).';
  }
  const detail = product.availability === 'reservee' ? ' — réservée jusqu\'au ' + product.reservedUntil + ' inclus (14 jours)' : '';
  return 'content(catalog): mark "' + product.name + '" as ' + product.availability + '\n\n' +
    via + ' (' + previous + ' → ' + product.availability + ')' + detail + '.';
}
