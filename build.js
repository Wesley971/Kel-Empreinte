/* Build du site — génère le HTML du lookbook depuis data/products.json.

   Exécuté par Cloudflare Pages à chaque déploiement (build command : `node build.js`,
   output et root directory laissés vides = racine du dépôt, Node figé par .node-version).
   Lancer `node build.js` en local pour rafraîchir index.html avant de committer.

   Le script réécrit index.html EN PLACE, uniquement entre les marqueurs
   <!-- build:<nom>:start --> … <!-- build:<nom>:end -->. Tout ce qui est écrit à la main
   entre ces marqueurs est écrasé au déploiement.

   Il échoue bruyamment (exit 1) dès qu'une donnée est incohérente : un build qui
   « réussit » sans rien générer laisserait le site silencieusement périmé, alors qu'un
   build en échec laisse le dernier déploiement en ligne et déclenche la notification.

   Aucune dépendance : Node natif uniquement (fs, path). */

'use strict';

var fs = require('fs');
var path = require('path');
var catalog = require('./catalog.js');

var ROOT = __dirname;
var PRODUCTS_FILE = path.join(ROOT, 'data', 'products.json');
var INDEX_FILE = path.join(ROOT, 'index.html');
var BUILD_INFO_FILE = path.join(ROOT, 'functions', '_lib', 'build-info.js');

// Les états vivent dans catalog.js, partagé avec l'écran de gestion et l'API : une valeur
// acceptée ici est une valeur que le site sait afficher.
var AVAILABILITIES = catalog.AVAILABILITIES;
var PRICE_TYPES = ['fixe', 'devis'];

function fail(message) {
  console.error('build.js : ' + message);
  process.exit(1);
}

/* ── Lecture et validation du catalogue ── */

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

function readProducts() {
  var raw;
  try {
    raw = fs.readFileSync(PRODUCTS_FILE, 'utf8');
  } catch (err) {
    fail('impossible de lire ' + PRODUCTS_FILE + ' (' + err.message + ')');
  }

  var products;
  try {
    products = JSON.parse(raw);
  } catch (err) {
    fail('data/products.json n\'est pas un JSON valide (' + err.message + ')');
  }

  if (!Array.isArray(products)) fail('data/products.json doit contenir un tableau de pièces');
  if (!products.length) fail('data/products.json est vide — aucune pièce à afficher');

  var seenIds = {};
  products.forEach(function(product, index) {
    var where = 'pièce n° ' + (index + 1) + (product && product.id ? ' (' + product.id + ')' : '');

    if (!product || typeof product !== 'object') fail(where + ' : entrée invalide');
    ['id', 'name', 'category'].forEach(function(field) {
      if (typeof product[field] !== 'string' || !product[field].trim()) fail(where + ' : champ « ' + field + ' » manquant');
    });
    if (seenIds[product.id]) fail(where + ' : identifiant en double');
    seenIds[product.id] = true;

    if (AVAILABILITIES.indexOf(product.availability) === -1) {
      fail(where + ' : « availability » doit valoir ' + AVAILABILITIES.join(' ou ') + ' (reçu : ' + product.availability + ')');
    }
    if (PRICE_TYPES.indexOf(product.priceType) === -1) {
      fail(where + ' : « priceType » doit valoir ' + PRICE_TYPES.join(' ou ') + ' (reçu : ' + product.priceType + ')');
    }
    if (product.availability === 'disponible' && product.priceType === 'fixe') {
      if (typeof product.price !== 'number' || !(product.price >= 0)) fail(where + ' : pièce disponible à prix fixe sans prix');
    }

    // Champs texte optionnels : absents, null ou chaîne — tout autre type est une erreur de saisie
    ['desc', 'dimensions'].forEach(function(field) {
      if (product[field] !== undefined && product[field] !== null && typeof product[field] !== 'string') {
        fail(where + ' : « ' + field + ' » doit être un texte');
      }
    });

    if (product.images !== undefined && !Array.isArray(product.images)) fail(where + ' : « images » doit être une liste');
    (product.images || []).forEach(function(image, i) {
      var imgWhere = where + ', photo n° ' + (i + 1);
      if (!image || typeof image.src !== 'string' || !image.src.trim()) fail(imgWhere + ' : chemin d\'image manquant');
      if (typeof image.alt !== 'string' || !image.alt.trim()) fail(imgWhere + ' : description (alt) manquante');
      var relativeSrc = catalog.normalizeImagePath(image.src);
      if (/(^|\/)\.\.(\/|$)/.test(relativeSrc) || relativeSrc.indexOf('\\') !== -1) fail(imgWhere + ' : chemin d\'image invalide — ' + image.src);
      if (!fileExistsExactCase(path.join(ROOT, relativeSrc))) fail(imgWhere + ' : fichier introuvable — ' + image.src);
    });
  });

  return products;
}

/* ── Remplacement entre marqueurs ── */

function replaceRegion(html, name, content, eol) {
  var start = '<!-- build:' + name + ':start';
  var end = '<!-- build:' + name + ':end -->';

  var startAt = html.indexOf(start);
  if (startAt === -1) fail('marqueur « ' + start + ' … --> » introuvable dans index.html');
  if (html.indexOf(start, startAt + 1) !== -1) fail('marqueur « ' + start + ' … --> » présent plusieurs fois dans index.html');
  var startClose = html.indexOf('-->', startAt);
  if (startClose === -1) fail('marqueur « ' + start + ' » jamais fermé');

  var endAt = html.indexOf(end);
  if (endAt === -1) fail('marqueur « ' + end + ' » introuvable dans index.html');
  if (html.indexOf(end, endAt + 1) !== -1) fail('marqueur « ' + end + ' » présent plusieurs fois dans index.html');
  if (endAt < startClose) fail('marqueurs « ' + name + ' » inversés dans index.html');

  if (!content.trim()) fail('bloc « ' + name + ' » généré vide — rien ne serait affiché');

  // Le marqueur de fin garde l'indentation de la ligne qui le porte
  var endLineStart = html.lastIndexOf('\n', endAt) + 1;
  var endIndent = html.slice(endLineStart, endAt);

  return html.slice(0, startClose + 3) + eol + content.replace(/\n/g, eol) + eol + endIndent + html.slice(endAt);
}

/* ── Programme ── */

var products = readProducts();

var html;
try {
  html = fs.readFileSync(INDEX_FILE, 'utf8');
} catch (err) {
  fail('impossible de lire index.html (' + err.message + ')');
}

// index.html est en CRLF sur les postes Windows et en LF sur Cloudflare : on suit le fichier
var eol = html.indexOf('\r\n') !== -1 ? '\r\n' : '\n';

// Les pièces vendues passent en fin de lookbook ; le fichier garde son ordre de saisie
var displayed = catalog.sortForDisplay(products);

var output = html;
output = replaceRegion(output, 'lookbook-count', catalog.renderLookbookCount(displayed, '      '), eol);
output = replaceRegion(output, 'lookbook-cards', catalog.renderLookbookCards(displayed, '      '), eol);

if (output !== html) {
  fs.writeFileSync(INDEX_FILE, output, 'utf8');
}

var sold = products.filter(catalog.isSold).length;
var soon = products.filter(function(product) { return !catalog.isSold(product) && catalog.isComingSoon(product); }).length;
console.log('build.js : lookbook — ' + products.length + ' cartes générées (' +
  (products.length - soon - sold) + ' disponibles, ' + soon + ' bientôt, ' + sold + ' vendues)' +
  (output === html ? ', index.html déjà à jour' : ', index.html mis à jour'));

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
