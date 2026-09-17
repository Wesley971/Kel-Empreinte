/* Build du site — vérifie le catalogue et génère les pages depuis data/products.json.

   Exécuté par Cloudflare Pages à chaque déploiement (build command : `node build.js`,
   output et root directory laissés vides = racine du dépôt, Node figé par .node-version).
   Lancer `node build.js` en local pour rafraîchir le HTML avant de committer.

   Le script réécrit index.html EN PLACE, uniquement entre les marqueurs
   <!-- build:<nom>:start --> … <!-- build:<nom>:end -->. Tout ce qui est écrit à la main
   entre ces marqueurs est écrasé au déploiement.

   Il échoue bruyamment (exit 1) dès qu'une donnée est incohérente : un build qui
   « réussit » sans rien générer laisserait le site silencieusement périmé, alors qu'un
   build en échec laisse le dernier déploiement en ligne et déclenche la notification.
   Toute la validation précède la première écriture : un build en échec ne laisse rien
   de moitié généré.

   Aucune dépendance : Node natif uniquement (fs, path). */

'use strict';

var fs = require('fs');
var path = require('path');
var catalog = require('./catalog.js');

var ROOT = __dirname;
var PRODUCTS_FILE = path.join(ROOT, 'data', 'products.json');
var COLLECTIONS_FILE = path.join(ROOT, 'data', 'collections.json');
var INDEX_FILE = path.join(ROOT, 'index.html');
var BUILD_INFO_FILE = path.join(ROOT, 'functions', '_lib', 'build-info.js');

function fail(message) {
  console.error('build.js : ' + message);
  process.exit(1);
}

/* ── Lecture ── */

function readJson(file, label) {
  var raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    fail('impossible de lire ' + label + ' (' + err.message + ')');
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(label + ' n\'est pas un JSON valide (' + err.message + ')');
  }
}

// Windows ignore la casse des noms de fichiers, pas le Linux du build Cloudflare :
// un `images/Logo.jpg` pour un fichier `logo.jpg` passerait en local et casserait au
// déploiement. On exige donc le nom exact, segment par segment, quel que soit l'OS.
function fileExistsExactCase(file) {
  var relative = path.relative(ROOT, file);
  if (!relative || relative.indexOf('..') === 0 || path.isAbsolute(relative)) return false;
  var dir = ROOT;
  var segments = relative.split(path.sep);
  for (var i = 0; i < segments.length; i++) {
    var entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (err) {
      return false;
    }
    if (entries.indexOf(segments[i]) === -1) return false;
    dir = path.join(dir, segments[i]);
  }
  return fs.statSync(dir).isFile();
}

// Un chemin d'image du catalogue : relatif à la racine, sans remontée ni antislash, et le
// fichier doit exister avec cette casse exacte.
function checkImageFile(src, where) {
  var relative = catalog.normalizeImagePath(src);
  if (/(^|\/)\.\.(\/|$)/.test(relative) || relative.indexOf('\\') !== -1) fail(where + ' : chemin d\'image invalide — ' + src);
  if (!fileExistsExactCase(path.join(ROOT, relative))) fail(where + ' : fichier introuvable — ' + src);
}

/* ── Validation du modèle v2 ── */

// Les identifiants deviennent des segments d'URL (/boutique/<id>/) et des noms de dossiers
// générés : uniquement minuscules, chiffres et tirets simples — jamais de remontée possible.
var ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

var KNOWN_FIELDS = ['id', 'reference', 'name', 'category', 'audience', 'collections', 'availability', 'reservedUntil',
  'price', 'promoPrice', 'customization', 'desc', 'materials', 'dimensions', 'images', 'featured', 'featuredOrder',
  'createdAt', 'sale'];
// Champs du modèle v1 : leur présence dit que le fichier n'a pas été migré (KD-97)
var REMOVED_FIELDS = ['heading', 'plainName', 'badge', 'specs', 'priceType', 'priceConfirmed', 'customizable'];

var CATEGORY_IDS = catalog.CATEGORIES.map(function(c) { return c.id; });
var AUDIENCE_IDS = catalog.AUDIENCES.map(function(a) { return a.id; });
var CHANNEL_IDS = catalog.CHANNELS.map(function(c) { return c.id; });
var OPTION_IDS = catalog.CUSTOMIZATION_OPTIONS.map(function(o) { return o.id; });

function isBlank(value) { return value === undefined || value === null; }
function isText(value) { return typeof value === 'string' && value.trim() !== ''; }
function isAmount(value) { return typeof value === 'number' && isFinite(value) && value >= 0; }
function isIsoDate(value) { return catalog.parseIsoDate(value) !== null; }

// Un texte facultatif : absent, null ou chaîne — tout autre type est une erreur de saisie
function checkOptionalText(value, field, where) {
  if (!isBlank(value) && typeof value !== 'string') fail(where + ' : « ' + field + ' » doit être un texte');
}

function checkOneOf(value, allowed, field, where) {
  if (allowed.indexOf(value) === -1) {
    fail(where + ' : « ' + field + ' » doit valoir ' + allowed.join(', ') + ' (reçu : ' + JSON.stringify(value) + ')');
  }
}

function checkKnownKeys(object, allowed, where) {
  Object.keys(object).forEach(function(key) {
    if (allowed.indexOf(key) === -1) fail(where + ' : champ inconnu « ' + key + ' »');
  });
}

function checkImages(images, where) {
  if (!Array.isArray(images)) fail(where + ' : « images » doit être une liste');
  images.forEach(function(image, i) {
    var imgWhere = where + ', photo n° ' + (i + 1);
    if (!image || typeof image !== 'object') fail(imgWhere + ' : entrée invalide');
    checkKnownKeys(image, ['src', 'alt'], imgWhere);
    if (!isText(image.src)) fail(imgWhere + ' : chemin d\'image manquant');
    if (!isText(image.alt)) fail(imgWhere + ' : description (alt) manquante');
    checkImageFile(image.src, imgWhere);
  });
}

function validateProduct(product, index, seen, collectionIds) {
  var where = 'pièce n° ' + (index + 1) + (product && isText(product.id) ? ' (' + product.id + ')' : '');
  if (!product || typeof product !== 'object' || Array.isArray(product)) fail(where + ' : entrée invalide');

  REMOVED_FIELDS.forEach(function(field) {
    if (product[field] !== undefined) fail(where + ' : ancien format (champ « ' + field + ' ») — le catalogue doit être migré vers le modèle v2 (KD-97)');
  });
  if (product.availability === 'bientot') fail(where + ' : l\'état « bientot » n\'existe plus — une pièce sans photo est un « brouillon »');
  checkKnownKeys(product, KNOWN_FIELDS, where);

  if (!isText(product.id) || !ID_PATTERN.test(product.id)) fail(where + ' : « id » doit être un identifiant en minuscules-tirets (ex. herbier-jaune-velours)');
  if (seen.ids[product.id]) fail(where + ' : identifiant en double');
  seen.ids[product.id] = true;

  checkOneOf(product.availability, catalog.AVAILABILITIES, 'availability', where);
  var state = product.availability;
  var draft = state === 'brouillon';
  var onSale = state === 'disponible' || state === 'reservee';

  // Un brouillon est une saisie en cours : on ne vérifie que les types, jamais la présence
  if (draft) {
    checkOptionalText(product.name, 'name', where);
    if (!isBlank(product.category)) checkOneOf(product.category, CATEGORY_IDS, 'category', where);
    if (!isBlank(product.audience)) checkOneOf(product.audience, AUDIENCE_IDS, 'audience', where);
  } else {
    if (!isText(product.name)) fail(where + ' : champ « name » manquant');
    checkOneOf(product.category, CATEGORY_IDS, 'category', where);
    checkOneOf(product.audience, AUDIENCE_IDS, 'audience', where);
  }

  if (!isIsoDate(product.createdAt)) fail(where + ' : « createdAt » doit être une date AAAA-MM-JJ');

  // Référence : texte libre, unique une fois normalisée (BO023 = bo-023 = BO 023)
  checkOptionalText(product.reference, 'reference', where);
  if (typeof product.reference === 'string') {
    var normalized = catalog.normalizeReference(product.reference);
    if (!normalized) fail(where + ' : « reference » ne contient ni lettre ni chiffre');
    if (seen.references[normalized]) fail(where + ' : référence « ' + product.reference + '» déjà portée par ' + seen.references[normalized]);
    seen.references[normalized] = product.id;
  }

  if (!isBlank(product.collections)) {
    if (!Array.isArray(product.collections)) fail(where + ' : « collections » doit être une liste');
    var seenCollections = {};
    product.collections.forEach(function(id) {
      if (collectionIds.indexOf(id) === -1) fail(where + ' : collection inconnue « ' + id + ' » (voir data/collections.json)');
      if (seenCollections[id]) fail(where + ' : collection « ' + id + ' » en double');
      seenCollections[id] = true;
    });
  }

  // Prix : obligatoire pour une pièce en vente ou réservée ; les autres états le gardent s'il existe
  if (onSale) {
    if (!isAmount(product.price)) fail(where + ' : pièce ' + state + ' sans prix');
  } else if (!isBlank(product.price) && !isAmount(product.price)) {
    fail(where + ' : « price » doit être un nombre positif');
  }
  if (!isBlank(product.promoPrice)) {
    if (!isAmount(product.promoPrice)) fail(where + ' : « promoPrice » doit être un nombre positif');
    if (!isAmount(product.price) || product.promoPrice >= product.price) fail(where + ' : le prix promotionnel doit être inférieur au prix');
  }

  // Date de fin de réservation : exactement quand la pièce est réservée
  if (state === 'reservee') {
    if (!isIsoDate(product.reservedUntil)) fail(where + ' : pièce réservée sans « reservedUntil » (date AAAA-MM-JJ)');
  } else if (!isBlank(product.reservedUntil)) {
    fail(where + ' : « reservedUntil » n\'a de sens que pour une pièce réservée');
  }

  // Vente : montant, canal et date sont renseignés quand la pièce passe vendue (KD-98) ; une
  // pièce vendue avant l'espace de gestion peut ne pas les avoir
  if (!isBlank(product.sale)) {
    if (state !== 'vendue') fail(where + ' : « sale » n\'a de sens que pour une pièce vendue');
    if (typeof product.sale !== 'object' || Array.isArray(product.sale)) fail(where + ' : « sale » doit être un objet { amount, channel, date }');
    checkKnownKeys(product.sale, ['amount', 'channel', 'date'], where + ', vente');
    if (!isBlank(product.sale.amount) && !isAmount(product.sale.amount)) fail(where + ' : « sale.amount » doit être un nombre positif');
    if (!isBlank(product.sale.channel)) checkOneOf(product.sale.channel, CHANNEL_IDS, 'sale.channel', where);
    if (!isBlank(product.sale.date) && !isIsoDate(product.sale.date)) fail(where + ' : « sale.date » doit être une date AAAA-MM-JJ');
  }

  if (!isBlank(product.customization)) {
    if (typeof product.customization !== 'object' || Array.isArray(product.customization)) fail(where + ' : « customization » doit être un objet { options }');
    checkKnownKeys(product.customization, ['options'], where + ', personnalisation');
    if (!isBlank(product.customization.options)) {
      if (!Array.isArray(product.customization.options)) fail(where + ' : « customization.options » doit être une liste');
      var seenOptions = {};
      product.customization.options.forEach(function(option) {
        checkOneOf(option, OPTION_IDS, 'customization.options', where);
        if (seenOptions[option]) fail(where + ' : option de personnalisation « ' + option + ' » en double');
        seenOptions[option] = true;
      });
    }
  }

  checkOptionalText(product.desc, 'desc', where);
  checkOptionalText(product.dimensions, 'dimensions', where);
  if (!isBlank(product.materials)) {
    if (!Array.isArray(product.materials)) fail(where + ' : « materials » doit être une liste');
    product.materials.forEach(function(material) {
      if (!isText(material)) fail(where + ' : une matière est vide');
    });
  }

  if (!isBlank(product.featured) && typeof product.featured !== 'boolean') fail(where + ' : « featured » doit valoir true ou false');
  if (!isBlank(product.featuredOrder) && typeof product.featuredOrder !== 'number') fail(where + ' : « featuredOrder » doit être un nombre');

  checkImages(isBlank(product.images) ? [] : product.images, where);
  // Sa règle : une photo suffit à rendre une pièce disponible — et rien ne se montre sans photo.
  // Une pièce vendue reste affichée en boutique, il lui en faut une aussi.
  if ((onSale || state === 'vendue') && !catalog.hasPhoto(product)) fail(where + ' : pièce ' + state + ' sans photo');
}

function validateCollections(collections) {
  if (!Array.isArray(collections)) fail('data/collections.json doit contenir une liste de collections');
  var seen = {};
  collections.forEach(function(collection, index) {
    var where = 'collection n° ' + (index + 1) + (collection && isText(collection.id) ? ' (' + collection.id + ')' : '');
    if (!collection || typeof collection !== 'object' || Array.isArray(collection)) fail(where + ' : entrée invalide');
    checkKnownKeys(collection, ['id', 'name', 'order', 'tagline', 'cover'], where);
    if (!isText(collection.id) || !ID_PATTERN.test(collection.id)) fail(where + ' : « id » doit être un identifiant en minuscules-tirets');
    if (seen[collection.id]) fail(where + ' : identifiant en double');
    seen[collection.id] = true;
    if (!isText(collection.name)) fail(where + ' : champ « name » manquant');
    if (typeof collection.order !== 'number') fail(where + ' : « order » doit être un nombre');
    checkOptionalText(collection.tagline, 'tagline', where);
    checkOptionalText(collection.cover, 'cover', where);
    if (isText(collection.cover)) checkImageFile(collection.cover, where + ', couverture');
  });
  return collections.slice().sort(function(a, b) { return (a.order - b.order) || a.name.localeCompare(b.name, 'fr'); });
}

function readCatalog() {
  var collections = validateCollections(readJson(COLLECTIONS_FILE, 'data/collections.json'));
  var collectionIds = collections.map(function(c) { return c.id; });

  var products = readJson(PRODUCTS_FILE, 'data/products.json');
  if (!Array.isArray(products)) fail('data/products.json doit contenir un tableau de pièces');
  if (!products.length) fail('data/products.json est vide — aucune pièce à afficher');

  var seen = { ids: {}, references: {} };
  products.forEach(function(product, index) { validateProduct(product, index, seen, collectionIds); });

  return { products: products, collections: collections };
}

/* ── Remplacement entre marqueurs ── */

function replaceRegion(html, name, content, eol, file) {
  var start = '<!-- build:' + name + ':start';
  var end = '<!-- build:' + name + ':end -->';

  var startAt = html.indexOf(start);
  if (startAt === -1) fail('marqueur « ' + start + ' … --> » introuvable dans ' + file);
  if (html.indexOf(start, startAt + 1) !== -1) fail('marqueur « ' + start + ' … --> » présent plusieurs fois dans ' + file);
  var startClose = html.indexOf('-->', startAt);
  if (startClose === -1) fail('marqueur « ' + start + ' » jamais fermé');

  var endAt = html.indexOf(end);
  if (endAt === -1) fail('marqueur « ' + end + ' » introuvable dans ' + file);
  if (html.indexOf(end, endAt + 1) !== -1) fail('marqueur « ' + end + ' » présent plusieurs fois dans ' + file);
  if (endAt < startClose) fail('marqueurs « ' + name + ' » inversés dans ' + file);

  if (!content.trim()) fail('bloc « ' + name + ' » généré vide — rien ne serait affiché');

  // Le marqueur de fin garde l'indentation de la ligne qui le porte
  var endLineStart = html.lastIndexOf('\n', endAt) + 1;
  var endIndent = html.slice(endLineStart, endAt);

  return html.slice(0, startClose + 3) + eol + content.replace(/\n/g, eol) + eol + endIndent + html.slice(endAt);
}

// index.html est en CRLF sur les postes Windows et en LF sur Cloudflare : on suit le fichier
function eolOf(text) {
  return text.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
}

/* ── Programme ── */

var data = readCatalog();
var products = data.products;

var html;
try {
  html = fs.readFileSync(INDEX_FILE, 'utf8');
} catch (err) {
  fail('impossible de lire index.html (' + err.message + ')');
}
var eol = eolOf(html);

// Transitoire (lot A de KD-97) : la section « La Collection » de l'accueil est encore en place,
// elle reçoit les cartes de la boutique jusqu'à la refonte de l'accueil (lot C).
var shown = catalog.sortForShop(products);
var output = html;
output = replaceRegion(output, 'lookbook-count', '      <span class="lookbook-count">' + shown.length + ' pièces</span>', eol, 'index.html');
output = replaceRegion(output, 'lookbook-cards', catalog.renderShopCards(shown, '      '), eol, 'index.html');

if (output !== html) {
  fs.writeFileSync(INDEX_FILE, output, 'utf8');
}

var counts = {};
products.forEach(function(product) { counts[product.availability] = (counts[product.availability] || 0) + 1; });
console.log('build.js : catalogue — ' + products.length + ' pièces (' +
  catalog.AVAILABILITIES.filter(function(s) { return counts[s]; }).map(function(s) { return counts[s] + ' ' + s; }).join(', ') + '), ' +
  shown.length + ' cartes générées' + (output === html ? ', index.html déjà à jour' : ', index.html mis à jour'));

/* ── Branche du déploiement, pour les Functions ── */

// Cloudflare n'expose la branche qu'au build (CF_PAGES_BRANCH) ; les Functions en ont besoin
// à l'exécution pour écrire le catalogue sur la branche qu'elles servent — la production sur
// master, une preview sur la sienne. Écrit uniquement sur Pages (CF_PAGES=1) : en local le
// fichier commité (branche inconnue) reste tel quel, et aucune branche codée en dur ne peut
// se glisser dans un commit. Pages compile functions/ après la commande de build.
if (process.env.CF_PAGES === '1') {
  var info = {
    branch: process.env.CF_PAGES_BRANCH || null,
    commit: process.env.CF_PAGES_COMMIT_SHA || null
  };
  try {
    fs.writeFileSync(BUILD_INFO_FILE,
      '/* Généré par build.js au déploiement Cloudflare Pages — ne pas modifier à la main. */\n' +
      'export const buildInfo = ' + JSON.stringify(info, null, 2) + ';\n', 'utf8');
  } catch (err) {
    fail('impossible d\'écrire ' + BUILD_INFO_FILE + ' (' + err.message + ')');
  }
  // Branche absente : le site se déploie quand même, seules les écritures de l'espace de
  // gestion sont refusées (github.js) — le site public ne dépend pas de cette information.
  if (info.branch) {
    console.log('build.js : build-info — branche ' + info.branch + ', commit ' + String(info.commit).slice(0, 7));
  } else {
    console.warn('build.js : CF_PAGES_BRANCH absent — les Functions refuseront d\'écrire sur ce déploiement');
  }
}
