/* Enregistrer une pièce depuis le formulaire (KD-93) — la logique commune à POST (ajout) et
   PUT (modification), et la suppression d'un brouillon.

   Une fiche arrive avec ses photos, en JSON (voir photos.js). Ce qu'on en fait, dans l'ordre :

   1. la forme du corps — champs connus, types simples, `promoPrice` refusé tant que KD-109
      n'existe pas (aucun prix réduit ne s'enregistre sans historique de prix) ;
   2. ce que Prescilia peut avoir fait et qu'une phrase doit lui dire : pas de nom, une
      référence déjà portée par une autre pièce (nommée), une mise en vente sans photo ou sans
      prix — les mêmes règles que l'écran (catalog.js), l'API reste le filet ;
   3. la règle complète du modèle, `catalog.validateProduct` — celle de build.js, aux mêmes
      messages : l'API n'écrit jamais un fichier que le build refuserait ;
   4. un seul commit (commitFiles) : les nouvelles photos, data/products.json, les photos
      retirées. Chaque enregistrement déploie, brouillon compris : un brouillon n'est nulle
      part sur le site, mais ses photos doivent être servies pour que « Mes bijoux » et la
      fiche les montrent — sans déploiement, Prescilia ne verrait jamais ce qu'elle vient
      d'enregistrer (recette du 19/09/2026). Seule la suppression d'un brouillon ne déploie pas.

   Tout ce qui dépend de la liste (id libre, référence libre, pièce existante, état) se juge
   sur une lecture faite AU commit de tête ; si la branche avance entre cette lecture et
   l'écriture, commitFiles répond 409 et on rejoue une fois depuis une lecture fraîche.

   L'état : une nouvelle pièce est « disponible » (par défaut) ou « brouillon » ; un brouillon
   modifié peut passer en vente ; une pièce publiée ne change pas d'état ici — c'est la liste
   « Mes bijoux » (PATCH) qui réserve, vend, retire. `reservedUntil`, `sale`, `createdAt` et
   `id` sont préservés côté serveur : le formulaire ne les envoie jamais. */

import catalog from '../../catalog.js';
import { json, error } from './http.js';
import { GitHubError, branchHead, readRepoFile, commitFiles } from './github.js';
import { PRODUCTS_FILE, parseProducts, serializeProducts } from './products.js';
import { MAX_PHOTOS, nextPhotoPath, ownedPhotoPattern } from './photos.js';

const COLLECTIONS_FILE = 'data/collections.json';

// Ce que le formulaire envoie dans `piece` ; tout autre champ est refusé
const PIECE_FIELDS = ['name', 'reference', 'category', 'audience', 'collections', 'desc', 'price', 'featured', 'images', 'availability'];
const NEW_STATES = ['disponible', 'brouillon'];

// Le marqueur qui dit à Cloudflare Pages de ne pas déployer un commit. Porté par la seule
// suppression d'un brouillon : rien à mettre en ligne ni à servir, et Pages n'a qu'un build à la
// fois (KD-72). Un enregistrement, lui, déploie toujours (voir l'en-tête). Parmi les cinq formes
// que Pages reconnaît, celle-ci et elle seule : les autres (« [CI Skip] »…) sont aussi lues par
// GitHub Actions, qui sauterait alors le garde-fou du catalogue (.github/workflows/catalog-guard.yml).
// Pages lit le message ENTIER, corps compris : un commit de code qui cite ce marqueur n'est pas
// déployé non plus — githooks/commit-msg le refuse (KD-93, 18/09/2026).
const PAGES_SKIP = '[CF-Pages-Skip]';

const isBlank = (value) => value === undefined || value === null;
const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/* ── 1. La forme du corps ── */

// { piece } normalisée (texte sans espaces autour, vides → null) ou { error: { status, message } }
export function checkPieceBody(piece) {
  if (!isPlainObject(piece)) return refuse(400, 'Requête illisible : la fiche doit être un objet.');
  if ('promoPrice' in piece) return refuse(400, 'Le prix réduit ne se saisit pas encore : il arrive avec l\'historique de prix (KD-109).');
  const unknown = Object.keys(piece).find((field) => PIECE_FIELDS.indexOf(field) === -1);
  if (unknown) return refuse(400, 'Champ inattendu dans la fiche : « ' + unknown + ' ».');

  const out = {};
  out.name = text(piece.name);
  if (!out.name) return refuse(422, 'Donnez un nom à la pièce, même en brouillon.');
  out.reference = text(piece.reference);
  if (!isBlank(piece.reference) && typeof piece.reference !== 'string') return refuse(422, 'La référence doit être un texte.');
  if (out.reference && !catalog.normalizeReference(out.reference)) return refuse(422, 'La référence doit contenir au moins une lettre ou un chiffre.');

  out.category = text(piece.category);
  out.audience = text(piece.audience);
  if (out.category && !catalog.CATEGORIES.some((c) => c.id === out.category)) return refuse(422, 'Type de pièce inconnu.');
  if (out.audience && !catalog.AUDIENCES.some((a) => a.id === out.audience)) return refuse(422, 'Public inconnu.');

  if (isBlank(piece.collections)) out.collections = [];
  else if (Array.isArray(piece.collections) && piece.collections.every((id) => typeof id === 'string')) out.collections = piece.collections.slice();
  else return refuse(422, 'Les collections doivent être une liste d\'identifiants.');

  if (isBlank(piece.desc)) out.desc = '';
  else if (typeof piece.desc === 'string') out.desc = piece.desc.replace(/\r\n/g, '\n').trim();
  else return refuse(422, 'La description doit être un texte.');

  if (isBlank(piece.price) || piece.price === '') out.price = null;
  else if (typeof piece.price === 'number' && isFinite(piece.price) && piece.price >= 0) out.price = piece.price;
  else return refuse(422, 'Le prix doit être un nombre positif (12.5, pas « 12,50 »).');

  if (isBlank(piece.featured)) out.featured = false;
  else if (typeof piece.featured === 'boolean') out.featured = piece.featured;
  else return refuse(422, 'La mise en avant doit valoir true ou false.');

  if (!Array.isArray(piece.images)) return refuse(422, 'Les photos doivent être une liste.');
  out.images = [];
  for (const entry of piece.images) {
    if (!isPlainObject(entry)) return refuse(422, 'Une photo de la liste est illisible.');
    if (typeof entry.src === 'string' && entry.src && entry.upload === undefined) out.images.push({ src: entry.src });
    else if (typeof entry.upload === 'string' && entry.upload && entry.src === undefined) out.images.push({ upload: entry.upload });
    else return refuse(422, 'Chaque photo est soit une photo existante (src), soit un fichier envoyé (upload).');
  }

  if (!isBlank(piece.availability)) {
    if (typeof piece.availability !== 'string') return refuse(422, 'L\'état doit être un texte.');
    out.availability = piece.availability;
  }
  return { piece: out };
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function refuse(status, message) {
  return { error: { status, message } };
}

/* ── 2 à 4. Enregistrer ── */

// id : null pour une création. Renvoie une Response (200 { product, commit, deploys }, ou l'erreur).
export async function savePiece(env, { id, piece, uploads }) {
  const uploadFields = Object.keys(uploads);
  // Chaque fichier envoyé doit être dans la liste, et chaque `upload` de la liste doit exister
  const referenced = piece.images.filter((image) => image.upload).map((image) => image.upload);
  const missing = referenced.find((field) => !uploads[field]);
  if (missing) return error(400, 'La liste des photos cite un fichier absent de la requête (« ' + missing + ' »).');
  const unused = uploadFields.find((field) => referenced.indexOf(field) === -1);
  if (unused) return error(400, 'Le fichier « ' + unused + ' » a été envoyé sans figurer dans la liste des photos.');
  if (referenced.length !== new Set(referenced).size) return error(400, 'Un même fichier figure deux fois dans la liste des photos.');

  for (let attempt = 1; attempt <= 2; attempt++) {
    const head = await branchHead(env);
    const [productsFile, collectionsFile] = await Promise.all([
      readRepoFile(env, PRODUCTS_FILE, { ref: head }),
      readRepoFile(env, COLLECTIONS_FILE, { ref: head }),
    ]);
    const products = parseProducts(productsFile.content);
    const collectionIds = parseCollectionIds(collectionsFile.content);
    const now = new Date();

    // La pièce d'avant, pour une modification
    let index = -1;
    let previous = null;
    if (id !== null) {
      index = products.findIndex((product) => product && product.id === id);
      if (index === -1) return error(404, 'Cette pièce n\'existe pas, ou n\'existe plus.');
      previous = products[index];
    }

    // L'état visé
    const state = targetState(previous, piece.availability);
    if (state.error) return error(state.status, state.error);

    // L'id d'une nouvelle pièce vient du nom ; celui d'une pièce existante ne change jamais
    let pieceId = id;
    if (pieceId === null) {
      pieceId = catalog.makeId(piece.name, products.map((product) => product.id));
      if (!pieceId) return error(422, 'Le nom doit contenir au moins une lettre ou un chiffre.');
    }

    // La référence : libre, ou portée par cette pièce même
    if (piece.reference) {
      const owner = catalog.referenceOwner(products, piece.reference, pieceId);
      if (owner) {
        return error(422, 'La référence ' + piece.reference + ' est déjà portée par « ' + owner.name + ' ». Si ce n\'est pas la même pièce, choisissez une autre référence.');
      }
    }

    // Les photos : celles gardées doivent être à cette pièce, les nouvelles reçoivent leur nom
    const previousSrcs = previous && Array.isArray(previous.images) ? previous.images.map((image) => image.src) : [];
    const taken = previousSrcs.slice();
    const files = [];
    const images = [];
    for (const entry of piece.images) {
      if (entry.src) {
        if (previousSrcs.indexOf(entry.src) === -1) return error(400, 'La photo « ' + entry.src + ' » n\'appartient pas à cette pièce.');
        if (images.some((image) => image.src === entry.src)) return error(400, 'La photo « ' + entry.src + ' » figure deux fois.');
        images.push({ src: entry.src, alt: previous.images.find((image) => image.src === entry.src).alt });
      } else {
        const upload = uploads[entry.upload];
        const src = nextPhotoPath(pieceId, taken, upload.kind);
        taken.push(src);
        files.push({ path: src, base64: upload.base64 });
        images.push({ src, alt: null });
      }
    }

    if (images.length > MAX_PHOTOS) return error(422, 'Au plus ' + MAX_PHOTOS + ' photos par pièce, celles déjà en place comprises.');

    // La pièce telle que le fichier l'attend
    const candidate = assemble(previous, pieceId, piece, images, state.value, now);
    candidate.images.forEach((image, i) => {
      // Le alt d'une photo ajoutée, ou dérivé auparavant (« …, photo n », ou le nom d'avant) : recalculé
      // d'après la position et le nom du jour. Un alt écrit à la main reste tel quel.
      const generated = image.alt === null || /, photo \d+$/.test(image.alt) || (previous && image.alt === catalog.photoAlt(previous, 1));
      if (generated) image.alt = catalog.photoAlt(candidate, i + 1);
    });

    // Ce que la phrase doit dire à Prescilia, avant la règle complète
    const human = humanCheck(candidate, previous);
    if (human) return error(422, human);

    // La règle du modèle, celle de build.js — les autres pièces comptent pour les doublons
    const seen = { ids: {}, references: {} };
    products.forEach((product) => {
      if (!product || product.id === pieceId) return;
      seen.ids[product.id] = true;
      if (typeof product.reference === 'string') {
        const normalized = catalog.normalizeReference(product.reference);
        if (normalized) seen.references[normalized] = product.id;
      }
    });
    const problems = catalog.validateProduct(candidate, { where: 'la pièce', seen, collectionIds, now });
    if (problems.length) return error(422, problems[0]);

    // Les photos retirées : seulement celles que la pièce possède par leur nom (photos.js)
    const owned = ownedPhotoPattern(pieceId);
    const kept = candidate.images.map((image) => image.src);
    previousSrcs.forEach((src) => {
      if (kept.indexOf(src) === -1 && owned.test(src)) files.push({ path: src, remove: true });
    });

    const list = products.slice();
    if (previous) list[index] = candidate;
    else list.unshift(candidate); // en tête du fichier : en tête de « Mes bijoux »
    files.push({ path: PRODUCTS_FILE, text: serializeProducts(list) });

    try {
      const { commit } = await commitFiles(env, {
        message: commitMessage(candidate, previous, uploadFields.length),
        parent: head,
        files,
      });
      return json({ product: candidate, commit, deploys: true });
    } catch (err) {
      if (err instanceof GitHubError && err.status === 409 && attempt === 1) continue;
      throw err;
    }
  }
  throw new GitHubError(409, 'conflit persistant sur ' + (id || 'la nouvelle pièce'));
}

// Un brouillon jamais publié se supprime : la pièce et les photos qu'elle possède, un commit
// sans mise en ligne. Une pièce publiée se retire (PATCH), sa référence reste prise.
export async function deleteDraft(env, id) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const head = await branchHead(env);
    const productsFile = await readRepoFile(env, PRODUCTS_FILE, { ref: head });
    const products = parseProducts(productsFile.content);
    const index = products.findIndex((product) => product && product.id === id);
    if (index === -1) return error(404, 'Cette pièce n\'existe pas, ou n\'existe plus.');
    const product = products[index];
    if (product.availability !== 'brouillon') return error(422, 'Seul un brouillon se supprime. Une pièce publiée se retire du site depuis la liste.');

    const owned = ownedPhotoPattern(id);
    const files = (Array.isArray(product.images) ? product.images : [])
      .filter((image) => owned.test(image.src))
      .map((image) => ({ path: image.src, remove: true }));
    const list = products.filter((_, i) => i !== index);
    files.push({ path: PRODUCTS_FILE, text: serializeProducts(list) });

    try {
      const { commit } = await commitFiles(env, {
        message: 'content(catalog): delete draft "' + product.name + '" ' + PAGES_SKIP + '\n\nBrouillon supprimé via l\'espace de gestion, jamais publié.',
        parent: head,
        files,
      });
      return json({ deleted: id, commit, deploys: false });
    } catch (err) {
      if (err instanceof GitHubError && err.status === 409 && attempt === 1) continue;
      throw err;
    }
  }
  throw new GitHubError(409, 'conflit persistant sur ' + id);
}

/* ── Détails ── */

// L'état résultant, ou pourquoi il est refusé
function targetState(previous, requested) {
  if (!previous) {
    if (isBlank(requested)) return { value: 'disponible' };
    if (NEW_STATES.indexOf(requested) === -1) return { status: 422, error: 'Une nouvelle pièce est en vente ou en brouillon ; les autres états se donnent depuis la liste.' };
    return { value: requested };
  }
  if (previous.availability === 'brouillon') {
    if (isBlank(requested)) return { value: 'brouillon' };
    if (NEW_STATES.indexOf(requested) === -1) return { status: 422, error: 'Un brouillon reste brouillon ou passe en vente ; les autres états se donnent depuis la liste.' };
    return { value: requested };
  }
  if (!isBlank(requested) && requested !== previous.availability) {
    return { status: 400, error: 'L\'état d\'une pièce publiée se change depuis la liste « Mes bijoux », pas depuis sa fiche.' };
  }
  return { value: previous.availability };
}

// La pièce dans l'ordre des clés du fichier. Une création prend la forme des entrées existantes
// (promoPrice, customization, materials, dimensions, featuredOrder posés, vides) ; une
// modification garde ce que le formulaire ne connaît pas (reservedUntil, sale, createdAt,
// promoPrice, customization, materials, dimensions, featuredOrder) tel quel.
function assemble(previous, id, piece, images, availability, now) {
  const base = previous || {
    id,
    reference: null,
    name: null,
    category: null,
    audience: null,
    collections: [],
    availability,
    price: null,
    promoPrice: null,
    customization: { options: [] },
    desc: '',
    materials: [],
    dimensions: null,
    images: [],
    featured: false,
    featuredOrder: null,
    createdAt: catalog.todayInParis(now),
  };
  const next = {
    reference: piece.reference,
    name: piece.name,
    category: piece.category,
    audience: piece.audience,
    collections: piece.collections,
    availability,
    price: piece.price,
    desc: piece.desc,
    images,
    featured: piece.featured,
  };
  const out = {};
  Object.keys(base).forEach((key) => { out[key] = key in next ? next[key] : base[key]; });
  // L'ordre parmi les pièces mises en avant ne se choisit pas ici : une pièce cochée garde le
  // sien (ou passe après celles qui en ont un), une pièce décochée le perd
  if (!out.featured) out.featuredOrder = null;
  return out;
}

// Ce qu'il faut dire à Prescilia, en une phrase, avant la règle générale
function humanCheck(candidate, previous) {
  const state = candidate.availability;
  if (state === 'brouillon') return null;
  if (!candidate.category || !candidate.audience) return 'Choisissez le type et le public de la pièce.';
  if (state === 'disponible' && (!previous || previous.availability === 'brouillon')) {
    const blockers = catalog.saleBlockers(candidate);
    if (blockers.length) return catalog.describeSaleBlockers(blockers);
  } else if (state === 'disponible' || state === 'reservee') {
    if (catalog.saleBlockers(candidate).length) return 'Une pièce en vente garde une photo et un prix. Pour la sortir du site, retirez-la depuis la liste.';
  } else if (state === 'vendue') {
    if (catalog.displayBlockers(candidate).length) return 'Une pièce vendue reste affichée en boutique : gardez-lui une photo.';
  }
  return null;
}

function parseCollectionIds(content) {
  const collections = JSON.parse(content);
  if (!Array.isArray(collections)) throw new SyntaxError(COLLECTIONS_FILE + ' : le contenu n\'est pas une liste de collections');
  return collections.map((collection) => collection && collection.id).filter((id) => typeof id === 'string');
}

// Sujet en anglais comme le reste de l'historique ; le corps dit d'où vient la modification.
// Jamais de marqueur ici : un enregistrement déploie, même en brouillon (ses photos).
function commitMessage(product, previous, uploaded) {
  const photos = uploaded ? ', ' + uploaded + ' photo' + (uploaded > 1 ? 's' : '') + ' ajoutée' + (uploaded > 1 ? 's' : '') : '';
  if (!previous) {
    return 'content(catalog): add "' + product.name + '"\n\n' +
      'Pièce ajoutée via l\'espace de gestion (' + product.availability + photos + ').';
  }
  const transition = previous.availability !== product.availability ? ', ' + previous.availability + ' → ' + product.availability : '';
  return 'content(catalog): update "' + product.name + '"\n\n' +
    'Fiche modifiée via l\'espace de gestion (' + product.availability + transition + photos + ').';
}
