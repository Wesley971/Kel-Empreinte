/* Amorçage de l'historique de prix (KD-109) — à lancer une fois, après la reprise du catalogue
   WhatsApp de Prescilia (KD-44 et les ~100 pièces), jamais avant.

     node seed-price-history.js <AAAA-MM-JJ> [--yes]

   La date limite est obligatoire, sans défaut. Avant d'écrire, le script dit ce qu'il va faire
   (fichier, date limite, pièces touchées) et attend « oui » ; `--yes` tient lieu de réponse pour
   un lancement non interactif. Sortie 1 = rien n'est écrit.

   Le prix barré obéit à la règle des 30 jours (catalog.js, « Historique de prix ») : sans
   référence démontrable, rien n'est barré. Les pièces reprises de WhatsApp arrivent avec leur
   ancien prix (« Prix ») et, souvent, le prix courant (« Prix réduit ») ; l'API n'écrit que le prix
   pratiqué au jour de la saisie, elle ne peut pas savoir depuis quand l'ancien prix l'était.
   Prescilia l'a dit par écrit le 18/09/2026 : depuis mars-avril 2026. On retient la borne la plus
   tardive, le 1er avril — la lecture prudente. Ce script pose cette entrée, une fois, et c'est sa
   confirmation écrite qui en est la preuve ; l'historique git prend le relais ensuite.

   Pour chaque pièce publiée (pas un brouillon) dont `createdAt` ne dépasse pas la date limite :
     - historique vide            → [{ price, 2026-04-01 }], puis { promoPrice, aujourd'hui } si un
                                    prix réduit est posé (git porte la vraie date de la baisse)
     - déjà amorcé (1re entrée au 2026-04-01) → rien : le script se relance sans risque
     - 1re entrée au montant du prix → son `from` devient 2026-04-01
     - sinon (1re entrée = le prix réduit, ou prix corrigé après la saisie) → { price, 2026-04-01 }
                                    antéposé

   La date limite est le garde-fou : une pièce créée après elle ne reçoit jamais une entrée
   d'avril 2026 — ce serait fabriquer la fausse référence que la règle interdit. Un brouillon à la
   date du script n'est pas amorcé : son historique naît à sa mise en vente, sa référence viendra
   après 30 jours de vente.

   Le résultat est validé (catalog.validateProduct, la règle du build) avant de demander
   confirmation ; au moindre problème, sortie 1 et fichier intact. Le commit est fait à la main.
   Aucune dépendance. */

'use strict';

var fs = require('fs');
var path = require('path');
var readline = require('readline');
var catalog = require(path.join(__dirname, 'catalog.js'));

var PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');
var COLLECTIONS_FILE = path.join(__dirname, 'data', 'collections.json');
var SEED_DATE = '2026-04-01'; // décision KD-109 (18/09/2026) : « mars-avril 2026 », borne la plus tardive

function fail(message) {
  console.error('seed-price-history.js : ' + message);
  process.exit(1);
}

var args = process.argv.slice(2);
var yes = args.indexOf('--yes') !== -1;
var cutoff = args.filter(function(arg) { return arg !== '--yes'; })[0];
if (!cutoff) fail('date limite manquante — node seed-price-history.js <AAAA-MM-JJ> [--yes] (les pièces créées après ne sont pas touchées)');
if (!catalog.parseIsoDate(cutoff)) fail('date limite illisible « ' + cutoff + ' » — AAAA-MM-JJ attendu');
if (cutoff < SEED_DATE) fail('date limite antérieure au ' + SEED_DATE + ' : rien à amorcer');

var products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
var collectionIds = JSON.parse(fs.readFileSync(COLLECTIONS_FILE, 'utf8')).map(function(collection) { return collection.id; });
var today = catalog.todayInParis();
if (cutoff > today) fail('date limite dans le futur (' + cutoff + ', nous sommes le ' + today + ' à Paris)');

// Ce que le script fait à une pièce, ou pourquoi il la laisse
function seed(product) {
  if (product.availability === 'brouillon') return { skip: 'brouillon — son historique naîtra à la mise en vente' };
  if (!catalog.parseIsoDate(product.createdAt)) return { skip: 'createdAt illisible' };
  if (product.createdAt > cutoff) return { skip: 'créée le ' + product.createdAt + ', après la date limite' };
  if (!catalog.hasPrice(product)) return { skip: 'sans prix' };
  var history = Array.isArray(product.priceHistory) ? product.priceHistory : [];
  if (history.length && history[0].from === SEED_DATE) return { skip: 'déjà amorcée' };

  var seeded;
  if (!history.length) {
    seeded = [{ amount: product.price, from: SEED_DATE }];
    if (catalog.hasReducedPrice(product)) seeded.push({ amount: product.promoPrice, from: today });
  } else if (history[0].amount === product.price) {
    seeded = history.map(function(entry, i) { return i ? entry : { amount: entry.amount, from: SEED_DATE }; });
  } else {
    seeded = [{ amount: product.price, from: SEED_DATE }].concat(history);
  }
  return { history: seeded };
}

var changed = 0;
var out = products.map(function(product) {
  var verdict = seed(product);
  if (verdict.skip) {
    console.log('  – ' + product.id + ' : ' + verdict.skip);
    return product;
  }
  changed++;
  console.log('  ✓ ' + product.id + ' : ' + JSON.stringify(product.priceHistory || []) + ' → ' + JSON.stringify(verdict.history));
  var next = {};
  Object.keys(product).forEach(function(key) { next[key] = key === 'priceHistory' ? verdict.history : product[key]; });
  if (!('priceHistory' in next)) next.priceHistory = verdict.history;
  return next;
});

// Jamais un fichier que le build refuserait
var seen = { ids: {}, references: {} };
var problems = [];
out.forEach(function(product, index) {
  problems = problems.concat(catalog.validateProduct(product, { where: 'pièce n° ' + (index + 1), seen: seen, collectionIds: collectionIds, now: new Date() }));
});
if (problems.length) fail('le résultat ne passe pas la règle du build, rien n\'est écrit :\n  ' + problems.join('\n  '));

if (!changed) {
  console.log('seed-price-history.js : rien à faire (' + products.length + ' pièces, aucune à amorcer).');
  process.exit(0);
}

// Ce script réécrit la source de vérité du catalogue : jamais sans un « oui » — ou --yes, posé
// sciemment. Une entrée fermée (pipe, tâche) n'est pas une confirmation.
console.log('');
console.log('Va réécrire ' + PRODUCTS_FILE);
console.log('  date limite : ' + cutoff + ' (createdAt au plus tard)');
console.log('  ' + changed + ' pièce(s) amorcée(s) au ' + SEED_DATE + ', ' + (products.length - changed) + ' laissée(s) telle(s) quelle(s), sur ' + products.length);
function write() {
  fs.writeFileSync(PRODUCTS_FILE, catalog.serializeProducts(out));
  console.log('seed-price-history.js : écrit — relisez le diff, puis commit.');
}
if (yes) {
  write();
} else {
  var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  var answered = false;
  rl.question('Écrire ? Tapez oui pour confirmer : ', function(answer) {
    answered = true;
    rl.close();
    if (answer.trim().toLowerCase() === 'oui') write();
    else fail('pas de confirmation, rien n\'est écrit');
  });
  rl.on('close', function() {
    if (!answered) fail('aucune réponse (entrée fermée), rien n\'est écrit — relancez avec --yes pour un lancement non interactif');
  });
}
