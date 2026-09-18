/* Build du site — vérifie le catalogue et génère les pages depuis data/products.json.

   Quatre sorties : les régions de l'accueil (index.html, réécrit en place), celles de 404.html
   (réécrite en place elle aussi), la boutique et ses pages pièce (boutique/, dossier généré et
   ignoré par git, vidé à chaque build) et sitemap.xml.

   La navigation et le pied de page ne sont écrits qu'une fois, dans templates/partials/ : build.js
   les injecte dans les quatre pages (KD-100). Les liens de contact et de boutiques viennent de
   data/site.json, les entrées de navigation de la liste NAV_ITEMS ci-dessous.

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
var SITE_FILE = path.join(ROOT, 'data', 'site.json');
var SHIPPING_FILE = path.join(ROOT, 'data', 'shipping.json');
var INDEX_FILE = path.join(ROOT, 'index.html');
var NOT_FOUND_FILE = path.join(ROOT, '404.html');
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

// L'instant du build, heure de Paris pour toutes les règles de dates (catalog.js) : une réservation
// échue est rendue disponible, une vente ne peut pas être datée de demain.
var BUILD_TIME = new Date();

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
    if (catalog.isFutureDay(product.sale.date, BUILD_TIME)) fail(where + ' : « sale.date » est dans le futur (' + product.sale.date + ', nous sommes le ' + catalog.todayInParis(BUILD_TIME) + ' à Paris)');
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

/* ── data/site.json : ce que Prescilia peut changer elle-même ──

   Uniquement ses coordonnées et ses boutiques : c'est le fichier que l'écran de réglages de KD-79
   écrira. La navigation n'y est pas — elle n'a pas à pouvoir être écrasée par cet écran. */

function readSite() {
  var site = readJson(SITE_FILE, 'data/site.json');
  if (!site || typeof site !== 'object' || Array.isArray(site)) fail('data/site.json doit contenir un objet');

  var contact = site.contact;
  if (!contact || typeof contact !== 'object' || Array.isArray(contact)) fail('data/site.json : « contact » manquant');
  ['email', 'phone', 'phoneLabel', 'whatsapp'].forEach(function(key) {
    if (typeof contact[key] !== 'string' || !contact[key].trim()) {
      fail('data/site.json : « contact.' + key + ' » doit être une chaîne non vide');
    }
  });
  if (contact.email.indexOf('@') === -1) fail('data/site.json : « contact.email » n\'est pas une adresse');
  if (contact.phone.charAt(0) !== '+') fail('data/site.json : « contact.phone » doit être au format international (+33…) — c\'est ce qui part dans le lien tel:');

  if (!Array.isArray(site.shops) || !site.shops.length) fail('data/site.json : « shops » doit être un tableau d\'au moins une boutique');
  site.shops.forEach(function(shop, index) {
    var where = 'data/site.json : boutique n° ' + (index + 1);
    if (!shop || typeof shop !== 'object' || Array.isArray(shop)) fail(where + ' doit être un objet');
    if (typeof shop.name !== 'string' || !shop.name.trim()) fail(where + ' : « name » doit être une chaîne non vide');
    if (typeof shop.url !== 'string' || !/^https?:\/\//.test(shop.url)) fail(where + ' : « url » doit commencer par http:// ou https://');
  });

  return site;
}

/* Les tarifs d'envoi : la seule source (KD-99). La Poste change ses prix chaque année, alors aucun
   montant n'est écrit dans une page — la FAQ est générée d'ici, et KD-64 y lira les frais du panier.
   Un seul mode est « standard » : c'est lui que la rétractation rembourse (art. L221-24), et le seul
   qui peut être offert à partir d'un montant (freeFrom). */
function readShipping() {
  var shipping = readJson(SHIPPING_FILE, 'data/shipping.json');
  if (!shipping || typeof shipping !== 'object' || Array.isArray(shipping)) fail('data/shipping.json doit contenir un objet');
  if (!Array.isArray(shipping.methods) || !shipping.methods.length) fail('data/shipping.json : « methods » doit être un tableau d\'au moins un mode d\'envoi');

  var ids = {}, standards = 0;
  shipping.methods.forEach(function(method, index) {
    var where = 'data/shipping.json : mode n° ' + (index + 1);
    if (!method || typeof method !== 'object' || Array.isArray(method)) fail(where + ' doit être un objet');
    if (typeof method.id !== 'string' || !ID_PATTERN.test(method.id)) fail(where + ' : « id » doit être un slug (lettres minuscules, chiffres, tirets)');
    if (ids[method.id]) fail('data/shipping.json : « id » en double : ' + method.id);
    ids[method.id] = true;
    where = 'data/shipping.json : « ' + method.id + ' »';
    if (typeof method.label !== 'string' || !method.label.trim()) fail(where + ' : « label » doit être une chaîne non vide');
    if (typeof method.price !== 'number' || !(method.price >= 0)) fail(where + ' : « price » doit être un nombre positif ou nul (3.9, pas « 3,90 »)');
    if (method.standard !== undefined && method.standard !== true) fail(where + ' : « standard » ne peut valoir que true, ou être absent');
    if (method.freeFrom !== undefined && (typeof method.freeFrom !== 'number' || !(method.freeFrom > 0))) fail(where + ' : « freeFrom » doit être un nombre strictement positif, ou absent');
    if (method.freeFrom !== undefined && !method.standard) fail(where + ' : seul le mode standard peut être offert (« freeFrom »)');
    if (method.standard) standards += 1;
  });
  if (standards !== 1) fail('data/shipping.json : exactement un mode doit porter « standard: true » (trouvé ' + standards + ')');

  return shipping;
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

/* ── Rendu des pages ── */

var SITE_URL = 'https://kel-empreinte.pages.dev';
var TEMPLATES_DIR = path.join(ROOT, 'templates');
var PARTIALS_DIR = path.join(TEMPLATES_DIR, 'partials');
var SHOP_DIR = path.join(ROOT, 'boutique');
var SITEMAP_FILE = path.join(ROOT, 'sitemap.xml');

var esc = catalog.escapeHtml;

// Une page versionnée, réécrite en place entre ses marqueurs : index.html et 404.html.
function readPage(file, label) {
  var text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    fail('impossible de lire ' + label + ' (' + err.message + ')');
  }
  return { name: label, text: text, eol: eolOf(text) };
}

function readTemplate(name) {
  var file = path.join(TEMPLATES_DIR, name);
  var text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    fail('impossible de lire le gabarit templates/' + name + ' (' + err.message + ')');
  }
  return { name: 'templates/' + name, text: text, eol: eolOf(text) };
}

// Un partiel est injecté dans des pages qui n'ont pas forcément ses fins de ligne : on le ramène
// en LF à la lecture, et replaceRegion le convertit ensuite à celles de la page cible. Sans ça un
// partiel en CRLF injecté dans un fichier LF sèmerait des \r orphelins, invisibles à la relecture.
// Le commentaire de tête du fichier explique le partiel à qui l'ouvre : il n'est pas injecté,
// sinon il se retrouverait dans le source des vingt pages générées.
function readPartial(name) {
  var file = path.join(PARTIALS_DIR, name);
  var text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    fail('impossible de lire le partiel templates/partials/' + name + ' (' + err.message + ')');
  }
  text = text.replace(/\r\n/g, '\n').replace(/^\s*<!--[\s\S]*?-->\s*/, '').replace(/\s+$/, '');
  if (!text) fail('le partiel templates/partials/' + name + ' est vide');
  return { name: 'templates/partials/' + name, text: text, eol: '\n' };
}

// Remplit une région d'un gabarit et renvoie le gabarit mis à jour (les appels s'enchaînent).
// Contenu vide → un commentaire : replaceRegion refuse un bloc vide, mais « aucune pièce » est un
// état légitime du catalogue, pas une erreur de génération.
function fill(page, name, content, indent) {
  var text = replaceRegion(page.text, name, content.trim() ? content : (indent || '') + '<!-- aucune pièce -->', page.eol, page.name);
  return { name: page.name, text: text, eol: page.eol };
}

function indentLines(text, indent) {
  return text.split('\n').map(function(line) { return line ? indent + line : line; }).join('\n');
}

// JSON destiné à un <script type="application/json"> : « < » échappé, pour qu'un nom ne puisse
// jamais fermer la balise
function jsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function pluralize(count, singular, plural) {
  return count + '\u00a0' + (count > 1 ? plural : singular);
}

/* ── Navigation et pied de page communs (KD-100) ──

   Écrits une seule fois : la coque dans templates/partials/, les entrées ici, les liens dans
   data/site.json. Les quatre pages (accueil, boutique, pièce, 404) les reçoivent au build. */

// Les entrées de la navigation, dans l'ordre d'affichage. Pour en ajouter une, la renommer, la
// déplacer ou la retirer : ici, et nulle part ailleurs.
//   href     : ancre de l'accueil (« #… ») ou chemin absolu
//   awayHref : adresse à utiliser hors accueil quand elle ne se déduit pas de href
//   homeOnly : entrée réservée à l'accueil — la pilule est plus courte sur les autres pages
// KD-75 : « Commander » mène à une section qui décrit encore le parcours par devis, faux depuis le
// pivot. Retirer ou renommer cette entrée se fait sur cette ligne, sans toucher aux pages.
var NAV_ITEMS = [
  { label: 'Accueil', href: '#hero', awayHref: '/' },
  { label: 'Boutique', href: '/boutique/' },
  { label: 'À la une', href: '#pieces', homeOnly: true },
  { label: 'Savoir-faire', href: '#process' },
  { label: 'Commander', href: '#commander', homeOnly: true },
  { label: 'L\'atelier', href: '#video' },
  { label: 'Avis', href: '#avis', homeOnly: true },
  { label: 'FAQ', href: '#faq' },
  { label: 'Contact', href: '#signature' }
];

// L'entrée marquée « active » est désignée par son adresse, jamais par son libellé : renommer une
// entrée ne doit pas éteindre silencieusement la mise en évidence.
var NAV_VARIANTS = {
  home: { away: false, active: '#hero' },        // index.html : toutes les entrées, ancres locales
  shop: { away: true, active: '/boutique/' },    // boutique et pages pièce
  plain: { away: true, active: null }            // 404.html : aucune page courante à désigner
};

function navHref(item, variant) {
  if (!variant.away) return item.href;
  if (item.awayHref) return item.awayHref;
  return item.href.charAt(0) === '#' ? '/' + item.href : item.href;
}

function navItemsFor(variant) {
  return NAV_ITEMS.filter(function(item) { return variant.away ? !item.homeOnly : true; });
}

// La pilule porte data-text (effet de survol) et la classe active ; le menu mobile est un simple
// empilement de liens, sans état actif — c'est le balisage existant, repris tel quel.
function renderNav(partial, variantName) {
  var variant = NAV_VARIANTS[variantName];
  if (!variant) fail('variante de navigation inconnue : ' + variantName);
  var items = navItemsFor(variant);

  var pill = items.map(function(item) {
    var href = navHref(item, variant);
    var active = variant.active && href === variant.active ? ' class="active"' : '';
    return '<a href="' + esc(href) + '"' + active + ' data-text="' + esc(item.label) + '"><span>' + esc(item.label) + '</span></a>';
  });
  var mobile = items.map(function(item) {
    return '<a href="' + esc(navHref(item, variant)) + '">' + esc(item.label) + '</a>';
  });

  var text = replaceRegion(partial.text, 'nav-pill', indentLines(pill.join('\n'), '  '), partial.eol, partial.name);
  return replaceRegion(text, 'nav-mobile', indentLines(mobile.join('\n'), '  '), partial.eol, partial.name);
}

function contactLinks(site, indent) {
  var contact = site.contact;
  return [
    indent + '<a href="mailto:' + esc(contact.email) + '">' + esc(contact.email) + '</a>',
    indent + '<span aria-hidden="true">\u00b7</span>',
    indent + '<a href="tel:' + esc(contact.phone) + '">' + esc(contact.phoneLabel) + '</a>',
    indent + '<span aria-hidden="true">\u00b7</span>',
    indent + '<a href="' + esc(contact.whatsapp) + '" target="_blank" rel="noopener noreferrer">WhatsApp</a>'
  ].join('\n');
}

function shopLinks(site, indent) {
  return site.shops.map(function(shop) {
    return indent + '<a href="' + esc(shop.url) + '" class="cta-link" target="_blank" rel="noopener noreferrer">' + esc(shop.name) + '</a>';
  }).join('\n');
}

function renderFooter(partial, site) {
  var text = replaceRegion(partial.text, 'footer-contact', contactLinks(site, '    '), partial.eol, partial.name);
  return replaceRegion(text, 'footer-shops', shopLinks(site, '    '), partial.eol, partial.name);
}

// Remplit une région dont le contenu ne peut pas être vide — navigation, pied de page,
// coordonnées. Contrairement à `fill`, un bloc vide fait échouer le build (replaceRegion) au lieu
// de devenir « aucune pièce » : une nav absente est une erreur de génération, pas un état du
// catalogue.
function put(page, name, content) {
  return { name: page.name, text: replaceRegion(page.text, name, content, page.eol, page.name), eol: page.eol };
}

// Injecte la navigation, et le pied de page quand la page en a un (l'accueil n'en a pas).
function withCommon(page, nav, footer) {
  page = put(page, 'nav', nav);
  return footer ? put(page, 'footer', footer) : page;
}

// L'accueil n'a pas de <footer> : ses coordonnées vivent dans la section « #signature », avec un
// balisage à elle. Mêmes données, autre habillage.
function renderSignatureContact(site, indent) {
  var contact = site.contact;
  return indent + '<a href="mailto:' + esc(contact.email) + '" class="signature-email">' + esc(contact.email) + '</a>\n' +
    indent + '<div class="signature-phone"><a href="tel:' + esc(contact.phone) + '">' + esc(contact.phoneLabel) + '</a> ' +
    '<span aria-hidden="true">\u00b7</span> <a href="' + esc(contact.whatsapp) + '" target="_blank" rel="noopener noreferrer">WhatsApp</a></div>';
}

/* Boutique */

function renderChip(value, label, count) {
  return '<button type="button" class="shop-chip" data-value="' + esc(value) + '" aria-pressed="false">' +
    '<span class="shop-chip-label">' + esc(label) + '</span><span class="shop-chip-count">' + count + '</span></button>';
}

// Une pièce « mixte » compte pour les deux publics ; un type sans pièce n'a pas de puce
function renderAudienceChips(shown, indent) {
  return catalog.AUDIENCES.filter(function(a) { return a.id !== 'mixte'; }).map(function(audience) {
    var count = shown.filter(function(p) { return p.audience === audience.id || p.audience === 'mixte'; }).length;
    return indent + renderChip(audience.id, audience.label, count);
  }).join('\n');
}

function renderCategoryChips(shown, indent) {
  return catalog.CATEGORIES.map(function(category) {
    var count = shown.filter(function(p) { return p.category === category.id; }).length;
    return count ? indent + renderChip(category.id, category.plural, count) : '';
  }).filter(Boolean).join('\n');
}

var SHOP_EMPTY = '<li class="shop-grid-empty">Toutes les pièces ont trouvé preneur — de nouvelles créations arrivent. ' +
  'En attendant, <a href="https://wa.me/33768728002" class="cta-link" target="_blank" rel="noopener noreferrer">écrivez-moi sur WhatsApp</a>.</li>';

function renderShopPage(page, shown, collections) {
  var names = collections.map(function(c) { return { id: c.id, name: c.name }; });
  page = fill(page, 'shop-chips-audience', renderAudienceChips(shown, '      '), '      ');
  page = fill(page, 'shop-chips-category', renderCategoryChips(shown, '      '), '      ');
  page = fill(page, 'shop-count', '    <p class="shop-count">' + pluralize(shown.length, 'pièce', 'pièces') + '</p>');
  page = fill(page, 'shop-cards', shown.length ? catalog.renderShopCards(shown, '    ') : '    ' + SHOP_EMPTY);
  page = fill(page, 'shop-collections-json', jsonForHtml(names));
  return page.text;
}

/* Page pièce */

var GENERIC_DESCRIPTION = 'Pièce unique en résine et fleurs séchées, faite main en France.';

// Ce que WhatsApp montre sous le lien : le prix, le type, puis la première ligne de sa description
function pieceSummary(product) {
  var parts = [];
  if (!catalog.isSold(product) && catalog.hasPrice(product)) parts.push(catalog.formatPrice(product));
  parts.push(catalog.categoryLabel(product.category, true));
  var firstLine = String(product.desc || '').split('\n').map(function(l) { return l.trim(); }).filter(Boolean)[0];
  parts.push(firstLine || GENERIC_DESCRIPTION);
  var text = parts.join(' · ');
  return text.length > 200 ? text.slice(0, 197).replace(/\s+\S*$/, '') + '…' : text;
}

function renderPieceHead(product) {
  var title = product.name + ' · Kel\'Empreinte';
  var summary = pieceSummary(product);
  var url = SITE_URL + catalog.pieceUrl(product);
  var image = SITE_URL + catalog.imageUrl(product.images[0]);
  var lines = [
    '<title>' + esc(title) + '</title>',
    '<meta name="description" content="' + esc(summary) + '">',
    '<meta property="og:type" content="product">',
    '<meta property="og:site_name" content="Kel\'Empreinte">',
    '<meta property="og:title" content="' + esc(title) + '">',
    '<meta property="og:description" content="' + esc(summary) + '">',
    '<meta property="og:url" content="' + esc(url) + '">',
    '<meta property="og:image" content="' + esc(image) + '">',
    '<meta property="og:image:alt" content="' + esc(product.images[0].alt) + '">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<link rel="canonical" href="' + esc(url) + '">'
  ];
  if (!catalog.isSold(product) && catalog.hasPrice(product)) {
    var amount = catalog.hasPromo(product) ? product.promoPrice : product.price;
    lines.push('<meta property="product:price:amount" content="' + amount + '">');
    lines.push('<meta property="product:price:currency" content="EUR">');
  }
  return lines.join('\n');
}

function optionLabels(product) {
  var options = product.customization && Array.isArray(product.customization.options) ? product.customization.options : [];
  return options.map(function(id) {
    var option = catalog.CUSTOMIZATION_OPTIONS.filter(function(o) { return o.id === id; })[0];
    return option ? option.label.toLowerCase() : id;
  });
}

function joinFr(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' et ' + items[items.length - 1];
}

function renderPieceArticle(product, collections) {
  var name = esc(product.name);
  var images = product.images;
  // Une réservée porte son échéance et ses deux visages (voir catalog.js, renderShopCard) : le
  // navigateur montre l'un ou l'autre selon le jour à Paris, sans attendre un déploiement.
  var lines = ['<article class="piece-article" data-availability="' + esc(product.availability) + '"' + catalog.reservedAttrs(product) + '>'];

  // Galerie : la première photo en grand, les autres en vignettes
  lines.push('  <div class="piece-gallery">');
  lines.push('    <button type="button" class="piece-main" aria-label="Agrandir la photo">');
  lines.push('      <img src="' + esc(catalog.imageUrl(images[0])) + '" alt="' + esc(images[0].alt) + '">');
  if (catalog.isReserved(product)) lines.push('      <span class="shop-card-badge shop-card-badge--reserved" data-while-reserved>Réservée</span>');
  if (catalog.isSold(product)) lines.push('      <span class="shop-card-badge shop-card-badge--sold">Vendue</span>');
  lines.push('    </button>');
  if (images.length > 1) {
    lines.push('    <div class="piece-thumbs" role="group" aria-label="Toutes les photos">');
    images.forEach(function(image, i) {
      lines.push('      <button type="button" class="piece-thumb' + (i === 0 ? ' is-active' : '') + '" data-src="' + esc(catalog.imageUrl(image)) +
        '" data-alt="' + esc(image.alt) + '" aria-label="Photo ' + (i + 1) + '"><img src="' + esc(catalog.imageUrl(image)) + '" alt="" loading="lazy"></button>');
    });
    lines.push('    </div>');
  }
  lines.push('  </div>');

  lines.push('  <div class="piece-info">');
  var eyebrow = [catalog.categoryLabel(product.category, true), catalog.audienceLabel(product.audience)];
  (product.collections || []).forEach(function(id) {
    var collection = collections.filter(function(c) { return c.id === id; })[0];
    if (collection) eyebrow.push(collection.name);
  });
  lines.push('    <p class="piece-eyebrow">' + eyebrow.map(esc).join(' · ') + '</p>');
  lines.push('    <h1 class="piece-name">' + name + '</h1>');
  if (product.reference) lines.push('    <p class="piece-ref">Réf.\u00a0' + esc(product.reference) + '</p>');

  if (catalog.isSold(product)) {
    lines.push('    <p class="piece-state piece-state--sold">Vendue</p>');
    lines.push('    <div class="piece-actions">');
    lines.push('      <a class="piece-cta" href="' + esc(catalog.buildSimilarPieceLink(product)) + '" target="_blank" rel="noopener noreferrer">Une pièce semblable&nbsp;?</a>');
    lines.push('      <a class="cta-link cta-link--dark" href="/boutique/">Voir les pièces disponibles</a>');
    lines.push('    </div>');
  } else {
    var price = '    <p class="piece-price">';
    if (catalog.hasPromo(product)) price += '<s class="piece-price-old">' + esc(catalog.formatOriginalPrice(product)) + '</s>';
    price += esc(catalog.formatPrice(product)) + '</p>';
    lines.push(price);
    if (catalog.isReserved(product)) lines.push('    <p class="piece-state piece-state--reserved" data-while-reserved>' + esc(catalog.formatReservedUntil(product)) + '</p>');
    // « Ajouter au panier » arrive avec KD-64 ; d'ici là la commande passe par WhatsApp. Sur une
    // réservée le bloc attend, caché, l'échéance.
    lines.push('    <div class="piece-actions"' + (catalog.isReserved(product) ? ' data-after-reservation hidden' : '') + '>');
    lines.push('      <a class="piece-cta" href="' + esc(catalog.buildWhatsAppLink(product)) + '" target="_blank" rel="noopener noreferrer">Commander sur WhatsApp</a>');
    lines.push('      <a class="cta-link cta-link--dark" href="/boutique/">Voir d\'autres pièces</a>');
    lines.push('    </div>');
  }

  // Sa description, telle qu'elle l'écrit : retours à la ligne et emojis conservés (pre-line)
  if (product.desc && product.desc.trim()) lines.push('    <p class="piece-desc">' + esc(product.desc.trim()) + '</p>');

  var materials = Array.isArray(product.materials) ? product.materials : [];
  if (materials.length || product.dimensions) {
    lines.push('    <dl class="piece-details">');
    if (materials.length) lines.push('      <dt>Matières</dt><dd>' + esc(materials.join(', ')) + '</dd>');
    if (product.dimensions) lines.push('      <dt>Dimensions</dt><dd>' + esc(product.dimensions) + '</dd>');
    lines.push('    </dl>');
  }

  var options = optionLabels(product);
  if (options.length && !catalog.isSold(product)) {
    lines.push('    <div class="piece-custom">');
    lines.push('      <h2 class="piece-custom-title">Personnalisation</h2>');
    lines.push('      <p class="piece-custom-text">Cette pièce peut être adaptée&nbsp;: ' + esc(joinFr(options)) + '. Sur devis, réponse sous 72&nbsp;h.</p>');
    lines.push('      <a class="cta-link" href="' + esc(catalog.buildCustomizationLink(product)) + '" target="_blank" rel="noopener noreferrer">Demander un devis</a>');
    lines.push('    </div>');
  }

  lines.push('    <p class="piece-note">Pièce unique, faite main dans mon atelier à Vieux-Condé. Les photos sont celles de la pièce elle-même&nbsp;; de légères variations de couleur sont possibles à l\'écran.</p>');
  lines.push('  </div>');
  lines.push('</article>');
  return lines.join('\n');
}

function renderPiecePage(page, product, collections) {
  var html = replaceRegion(page.text, 'piece-head', renderPieceHead(product), page.eol, page.name);
  return replaceRegion(html, 'piece', indentLines(renderPieceArticle(product, collections), '  '), page.eol, page.name);
}

/* Accueil : pièces mises en avant, bandes de collections */

var HOME_FEATURED_FALLBACK = 4;   // dernières ajoutées quand rien n'est mis en avant
var HOME_LATEST_COUNT = 8;        // taille de « Nouveautés »
var HOME_BAND_MAX = 8;            // pièces par bande de collection

var HOME_EMPTY = '<p class="shop-grid-empty">Toutes les pièces ont trouvé preneur — de nouvelles créations arrivent. ' +
  'En attendant, <a href="https://wa.me/33768728002" class="cta-link" target="_blank" rel="noopener noreferrer">écrivez-moi sur WhatsApp</a>.</p>';

// Les pièces qu'elle a cochées, en vente ; sinon les dernières ajoutées, et le titre le dit
function renderHomeFeatured(products, indent) {
  var chosen = products.some(function(p) { return p.featured === true && catalog.isVisibleOnHome(p); });
  var pieces = catalog.featuredPieces(products, HOME_FEATURED_FALLBACK);
  var lines = [
    indent + '<div class="home-section-head">',
    indent + '  <div>',
    indent + '    <h2 class="home-section-title">' + (chosen ? 'Pièces mises en avant' : 'Les dernières créations') + '</h2>'
  ];
  if (!chosen && pieces.length) lines.push(indent + '    <p class="home-section-note">Les dernières pièces arrivées à l\'atelier.</p>');
  lines.push(
    indent + '  </div>',
    indent + '  <a href="/boutique/" class="cta-link">Toute la boutique</a>',
    indent + '</div>'
  );
  if (pieces.length) {
    lines.push(indent + '<ul class="shop-grid">', catalog.renderShopCards(pieces, indent + '  '), indent + '</ul>');
  } else {
    lines.push(indent + HOME_EMPTY);
  }
  return lines.join('\n');
}

function renderBand(title, tagline, cover, pieces, href, linkText, indent) {
  var lines = [
    indent + '<div class="home-band">',
    indent + '  <div class="home-band-head">',
    indent + '    <h2 class="home-band-title">' + esc(title) + '</h2>',
    indent + '    <a class="cta-link" href="' + esc(href) + '">' + esc(linkText) + '</a>'
  ];
  if (tagline) lines.push(indent + '    <p class="home-band-tagline">' + esc(tagline) + '</p>');
  lines.push(indent + '  </div>', indent + '  <ul class="home-band-track">');
  if (cover) {
    lines.push(indent + '    <li class="home-band-cover"><a href="' + esc(href) + '" aria-label="' + esc(linkText) + '"><img src="' + esc('/' + catalog.normalizeImagePath(cover)) + '" alt="" loading="lazy"></a></li>');
  }
  lines.push(catalog.renderShopCards(pieces, indent + '    '), indent + '  </ul>', indent + '</div>');
  return lines.join('\n');
}

// « Nouveautés » d'abord (automatique), puis les collections dans leur ordre ; une collection sans
// pièce en vente n'a pas de bande. Rien du tout → commentaire, la section se masque (shop.css).
function renderHomeCollections(products, collections, indent) {
  var bands = [];
  var latest = catalog.latest(products, HOME_LATEST_COUNT);
  if (latest.length) bands.push(renderBand('Nouveautés', null, null, latest, '/boutique/', 'Toute la boutique', indent));
  collections.forEach(function(collection) {
    var pieces = catalog.collectionPieces(products, collection.id).slice(0, HOME_BAND_MAX);
    if (!pieces.length) return;
    bands.push(renderBand(collection.name, collection.tagline, collection.cover, pieces,
      '/boutique/?collection=' + encodeURIComponent(collection.id), 'Voir la collection', indent));
  });
  return bands.join('\n');
}

/* Plan du site */

function renderSitemap(shown) {
  var lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url><loc>' + SITE_URL + '/</loc></url>', '  <url><loc>' + SITE_URL + '/boutique/</loc></url>'];
  shown.forEach(function(product) {
    lines.push('  <url><loc>' + esc(SITE_URL + catalog.pieceUrl(product)) + '</loc><lastmod>' + esc(product.createdAt) + '</lastmod></url>');
  });
  lines.push('</urlset>', '');
  return lines.join('\n');
}

/* ── Écriture ── */

function writeFile(file, content) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  } catch (err) {
    fail('impossible d\'écrire ' + path.relative(ROOT, file) + ' (' + err.message + ')');
  }
}

// Le dossier boutique/ est entièrement généré (et ignoré par git) : on le vide avant d'écrire,
// sinon la page d'une pièce passée en brouillon ou retirée survivrait au build précédent.
function resetShopDir() {
  try {
    fs.rmSync(SHOP_DIR, { recursive: true, force: true });
    fs.mkdirSync(SHOP_DIR, { recursive: true });
  } catch (err) {
    fail('impossible de vider boutique/ (' + err.message + ')');
  }
}

/* ── Programme ── */

var site = readSite();
var shipping = readShipping();
var data = readCatalog();
// Validé tel qu'écrit, rendu tel que réglé : une réservation échue à l'instant du build est une
// pièce disponible pour toutes les pages (le fichier n'est pas touché ; l'écran de gestion, lui,
// applique la même règle à la lecture)
var products = data.products.map(function(product) { return catalog.settleReservation(product, BUILD_TIME); });
var settledCount = products.filter(function(product, i) { return product !== data.products[i]; }).length;
var collections = data.collections;
var shown = catalog.sortForShop(products);

var indexHtml = readPage(INDEX_FILE, 'index.html');
var notFoundHtml = readPage(NOT_FOUND_FILE, '404.html');

// Tout est rendu en mémoire avant la première écriture : un échec ne laisse rien à moitié généré.

var navPartial = readPartial('nav.html');
var footerPartial = readPartial('footer.html');
var navHome = renderNav(navPartial, 'home');
var navShop = renderNav(navPartial, 'shop');
var navPlain = renderNav(navPartial, 'plain');
var footer = renderFooter(footerPartial, site);

var indexPage = withCommon(indexHtml, navHome, null);
indexPage = put(indexPage, 'signature-contact', renderSignatureContact(site, '      '));
indexPage = put(indexPage, 'signature-links', shopLinks(site, '        '));
indexPage = fill(indexPage, 'home-featured', renderHomeFeatured(products, '    '), '    ');
indexPage = fill(indexPage, 'home-collections', renderHomeCollections(products, collections, '    '), '    ');
var indexOutput = indexPage.text;

var notFoundOutput = withCommon(notFoundHtml, navPlain, footer).text;

var shopPage = renderShopPage(withCommon(readTemplate('boutique.html'), navShop, footer), shown, collections);
var pieceTemplate = withCommon(readTemplate('piece.html'), navShop, footer);
var piecePages = shown.map(function(product) {
  return { file: path.join(SHOP_DIR, product.id, 'index.html'), html: renderPiecePage(pieceTemplate, product, collections) };
});
var sitemap = renderSitemap(shown);

if (indexOutput !== indexHtml.text) fs.writeFileSync(INDEX_FILE, indexOutput, 'utf8');
if (notFoundOutput !== notFoundHtml.text) fs.writeFileSync(NOT_FOUND_FILE, notFoundOutput, 'utf8');
resetShopDir();
writeFile(path.join(SHOP_DIR, 'index.html'), shopPage);
piecePages.forEach(function(page) { writeFile(page.file, page.html); });
writeFile(SITEMAP_FILE, sitemap);

var counts = {};
products.forEach(function(product) { counts[product.availability] = (counts[product.availability] || 0) + 1; });
console.log('build.js : catalogue — ' + products.length + ' pièces (' +
  catalog.AVAILABILITIES.filter(function(s) { return counts[s]; }).map(function(s) { return counts[s] + ' ' + s; }).join(', ') + ')' +
  (settledCount ? ', dont ' + settledCount + ' réservation(s) échue(s) rendue(s) disponible(s) — ' + catalog.todayInParis(BUILD_TIME) + ' à Paris' : ''));
console.log('build.js : pages — accueil (' + catalog.featuredPieces(products, HOME_FEATURED_FALLBACK).length + ' pièces en avant), boutique/index.html + ' +
  piecePages.length + ' pages pièce, sitemap.xml (' + (shown.length + 2) + ' URL)' +
  (indexOutput === indexHtml.text ? ', index.html déjà à jour' : ', index.html mis à jour') +
  (notFoundOutput === notFoundHtml.text ? ', 404.html déjà à jour' : ', 404.html mis à jour'));

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
