/* Garde-fou du catalogue — repère une chute anormale du nombre de pièces.

   Lancé à chaque enregistrement dans /admin par .github/workflows/catalog-guard.yml, et à la main :
     node check-catalog-drop.js <avant.json> [après.json]   (après = data/products.json par défaut)

   Le cas visé est celui que rien d'autre ne voit : le JSON reste valide, le build réussit,
   le site se déploie normalement — mais la moitié du catalogue a disparu. Cloudflare ne peut
   pas le savoir (les données sont correctes) et la sonde non plus (le site reflète fidèlement
   le dépôt). Seule la comparaison avec l'état précédent le montre.

   Règle unique : alerte si le catalogue perd plus d'un quart de ses pièces en une fois,
   ou s'il passe sous 5 pièces.

   C'est une détection, pas un blocage : Cloudflare builde en parallèle de GitHub Actions, la
   version amputée sera donc publiée, puis signalée dans la minute. L'empêcher supposerait une
   branche protégée et un flux de pull requests, ce qui casserait l'écriture directe du CMS.

   Sortie 1 = alerte (e-mail GitHub). Aucune dépendance : Node natif uniquement. */

'use strict';

var fs = require('fs');
var path = require('path');

var DEFAULT_AFTER = path.join(__dirname, 'data', 'products.json');
var MAX_DROP_RATIO = 0.25;  // plus d'un quart perdu d'un coup
var FLOOR = 5;              // ou un catalogue qui passe sous ce nombre de pièces

function alert(message) {
  console.error('check-catalog-drop.js : ' + message);
  process.exit(1);
}

function log(message) {
  console.log('check-catalog-drop.js : ' + message);
}

// Renvoie le nombre de pièces, ou null si le fichier est absent ou illisible — jamais une
// alerte : on n'alerte que sur ce qu'on a vraiment mesuré.
function count(file) {
  var products;
  try {
    products = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return null;
  }
  return Array.isArray(products) ? products.length : null;
}

var beforeFile = process.argv[2];
var afterFile = process.argv[3] || DEFAULT_AFTER;

if (!beforeFile) alert('usage : node check-catalog-drop.js <avant.json> [après.json]');

var before = count(beforeFile);
if (before === null) {
  // Force push, première poussée d'une branche, historique tronqué : l'état précédent
  // n'est pas mesurable, on se tait plutôt que d'inventer une comparaison.
  log('état précédent indisponible (' + beforeFile + ') — aucune comparaison possible, rien à signaler');
  process.exit(0);
}

var after = count(afterFile);
if (after === null) {
  // Un JSON cassé fait déjà échouer le build et déclenche la notification Cloudflare :
  // une seconde alerte sur le même incident n'apprendrait rien.
  log('catalogue illisible (' + afterFile + ') — c\'est le build qui le signale, pas ce garde-fou');
  process.exit(0);
}

var lost = before - after;

if (lost > before * MAX_DROP_RATIO) {
  alert('le catalogue perd ' + lost + ' pièces d\'un coup (' + before + ' → ' + after +
    ') — plus d\'un quart. Vérifier la dernière modification dans /admin et revenir en arrière si besoin.');
}

if (after < FLOOR && before >= FLOOR) {
  alert('le catalogue tombe à ' + after + ' pièce(s) (' + before + ' → ' + after +
    ') — sous le seuil de ' + FLOOR + '. Vérifier la dernière modification dans /admin et revenir en arrière si besoin.');
}

log('catalogue cohérent : ' + before + ' → ' + after + ' pièces' + (lost > 0 ? ' (' + lost + ' retirée(s))' : ''));
