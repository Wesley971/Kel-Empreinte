/* Sonde du site en ligne — compare ce qui est servi à ce que contient le dépôt.

   Lancée toutes les 6 heures par .github/workflows/site-check.yml, et à la main :
     node check-site.js                       (production)
     node check-site.js --url http://localhost:3000/   (copie locale ou preview)

   Elle répond à une question et une seule : « le site en ligne reflète-t-il le dépôt ? ».
   Un site statique sur CDN tombe rarement ; ce qui arrive vraiment, c'est qu'il réponde
   parfaitement avec un contenu périmé (build en échec, déploiement jamais parti) ou amputé.
   Un simple code HTTP 200 dirait « tout va bien » dans ces deux cas, d'où la comparaison
   du nombre de cartes servies avec data/products.json.

   Elle ne valide PAS les données du catalogue : c'est le travail de build.js, dont l'échec
   déclenche déjà la notification Cloudflare. Deux alertes pour un même incident useraient
   la confiance qu'on leur accorde.

   Depuis KD-91 elle pose aussi une seconde question, de même nature (« ce qui est servi est-il
   ce qu'on croit ? ») : l'espace de gestion et son API sont-ils toujours derrière Cloudflare
   Access ? Une protection qui disparaît ne casse rien de visible — le site répond, l'espace
   s'affiche —, elle rend juste l'espace public. Rien d'autre ne le remarquerait.

   Sortie 1 = alerte (e-mail GitHub). Aucune dépendance : Node natif uniquement. */

'use strict';

var fs = require('fs');
var path = require('path');
var execFileSync = require('child_process').execFileSync;

var ROOT = __dirname;
var PRODUCTS_FILE = path.join(ROOT, 'data', 'products.json');
var DEFAULT_URL = 'https://kel-empreinte.pages.dev/';

var CARDS_START = '<!-- build:lookbook-cards:start';
var CARDS_END = '<!-- build:lookbook-cards:end -->';
// Point de montage de Sveltia dans admin/index.html : preuve que c'est bien le CMS qui est servi.
var ADMIN_MARKER = 'id="nc-root"';
// Chemins que Cloudflare Access doit protéger (KD-91) : sans session, la bordure répond une
// redirection vers la page de connexion de l'équipe, avant même que Pages ne serve quoi que ce soit.
var PROTECTED_PATHS = ['gestion/', 'api/admin/'];
var ACCESS_LOGIN_HOST = '.cloudflareaccess.com';

// Un déploiement Cloudflare prend 1 à 2 min, davantage si un build attend son tour (un seul
// build à la fois sur le plan gratuit). Tant que le dernier commit est récent, un écart entre
// le site et le dépôt est un déploiement en cours, pas une panne.
var FRESH_COMMIT_MS = 15 * 60 * 1000;
var RETRY_NETWORK_MS = 10 * 1000;
// Sans délai maximal, un serveur qui accepte la connexion sans jamais répondre ferait pendre la
// sonde jusqu'au plafond du job : elle paraîtrait en cours alors qu'elle ne surveille plus rien.
var FETCH_TIMEOUT_MS = 15 * 1000;
var RETRY_DEPLOY_MS = 90 * 1000;

// Une alerte remonte jusqu'à main(), qui l'affiche et fixe le code de sortie. Surtout pas de
// process.exit() dans un script qui utilise fetch : sous Windows, sortir alors qu'une connexion
// est encore ouverte fait planter Node (assertion libuv) et le code de sortie devient 127.
function fail(message) {
  var err = new Error(message);
  err.alerte = true;  // distingue une alerte mesurée d'un plantage du script
  throw err;
}

function log(message) {
  console.log('check-site.js : ' + message);
}

function wait(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

/* ── Ce que le dépôt contient ── */

function expectedCount() {
  var products;
  try {
    products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
  } catch (err) {
    fail('impossible de lire data/products.json (' + err.message + ') — sonde inutilisable');
  }
  if (!Array.isArray(products) || !products.length) fail('data/products.json ne contient aucune pièce — sonde inutilisable');
  return products.length;
}

// Âge du dernier commit, ou null hors dépôt git : dans ce cas on ne tolère rien et on compare
// franchement, plutôt que de laisser passer un écart au nom d'une information qu'on n'a pas.
function lastCommitAgeMs() {
  try {
    var seconds = parseInt(execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), 10);
    if (!seconds) return null;
    return Date.now() - seconds * 1000;
  } catch (err) {
    return null;
  }
}

/* ── Ce que le site sert ── */

// Un appel, borné par un minuteur explicite plutôt qu'AbortSignal.timeout : il faut pouvoir
// l'éteindre dès la lecture finie, sinon il reste armé et Node plante en sortie quand la sonde
// s'arrête sur une alerte. Le corps est toujours lu, sous le même minuteur : un serveur qui envoie
// ses en-têtes puis se tait ferait pendre la sonde autrement, et un corps jamais consommé laisse
// une connexion ouverte — le cas exact où Node plante en sortie.
async function fetchOnce(url, redirect) {
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, FETCH_TIMEOUT_MS);
  try {
    var response = await fetch(url, {
      redirect: redirect,
      signal: controller.signal,
      headers: { 'User-Agent': 'kel-empreinte-check-site' }
    });
    return { response: response, body: await response.text() };
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? 'aucune réponse après ' + (FETCH_TIMEOUT_MS / 1000) + ' s' : err.message);
  } finally {
    clearTimeout(timer);
  }
}

async function get(url, what) {
  var why = '';
  // Une coupure réseau d'une seconde ne doit réveiller personne : un seul nouvel essai, puis on conclut.
  for (var attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) await wait(RETRY_NETWORK_MS);
    try {
      var result = await fetchOnce(url, 'follow');
      if (!result.response.ok) {
        why = 'HTTP ' + result.response.status;
        continue;
      }
      if (!result.body.trim()) {
        why = 'réponse vide';
        continue;
      }
      return result.body;
    } catch (err) {
      why = err.message;
    }
  }
  fail(what + ' — ' + url + ' : ' + why);
}

// Sans session Access, un chemin protégé répond une redirection vers *.cloudflareaccess.com. Tout
// autre résultat — en premier lieu un 200 — veut dire que la protection a disparu (application
// supprimée ou chemin retouché dans Zero Trust) et que l'espace de gestion est public. Le middleware
// des Functions refuserait encore les écritures ; l'écran, lui, serait visible. Ici on ne suit pas
// la redirection : c'est elle qu'on veut voir, et on ne réessaie qu'une panne réseau, jamais une
// réponse lue — un 200 n'est pas un accident de réseau.
async function expectAccessRedirect(url) {
  var why = '';
  for (var attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) await wait(RETRY_NETWORK_MS);
    var response;
    try {
      response = (await fetchOnce(url, 'manual')).response;
    } catch (err) {
      why = err.message;
      continue;
    }
    var location = response.headers.get('location') || '';
    if (response.status >= 300 && response.status < 400 && location.indexOf(ACCESS_LOGIN_HOST) !== -1) return;
    fail('espace de gestion sans protection Access — ' + url + ' : HTTP ' + response.status +
      (location ? ' vers ' + location : '') + ' au lieu d\'une redirection vers *' + ACCESS_LOGIN_HOST +
      '. Vérifier l\'application dans Zero Trust › Applications (voir README › Espace de gestion).');
  }
  fail('espace de gestion injoignable — ' + url + ' : ' + why);
}

// Le lookbook servi doit contenir les marqueurs de build.js : sans eux, la page est en ligne
// mais ce n'est plus la page attendue (refonte non répercutée ici, ou HTML tronqué).
function lookbookRegion(html, url) {
  var start = html.indexOf(CARDS_START);
  var end = html.indexOf(CARDS_END);
  if (start === -1 || end === -1 || end < start) {
    fail('page servie sans le lookbook attendu — ' + url + ' : marqueur « ' + CARDS_START +
      ' … --> » ou « ' + CARDS_END + ' » absent. Si le lookbook a été refondu, mettre à jour check-site.js.');
  }
  return html.slice(start, end);
}

function countCards(region) {
  return (region.match(/class="lookbook-card"/g) || []).length;
}

// Le compteur affiché (« 01 — 24 ») vient de la même source que les cartes : le vérifier aussi
// coûte une ligne et attrape un bloc généré à moitié.
function shownCount(html, url) {
  var match = html.match(/class="lookbook-count">([^<]*)</);
  if (!match) fail('page servie sans le compteur du lookbook — ' + url + ' : « class="lookbook-count" » absent');
  var numbers = match[1].match(/\d+/g);
  if (!numbers || !numbers.length) fail('compteur du lookbook illisible — ' + url + ' : « ' + match[1].trim() + ' »');
  return parseInt(numbers[numbers.length - 1], 10);
}

async function readSite(url, expected) {
  var html = await get(url, 'site injoignable');
  var cards = countCards(lookbookRegion(html, url));
  var shown = shownCount(html, url);
  return { cards: cards, shown: shown, matches: cards === expected && shown === expected };
}

/* ── Programme ── */

async function main() {
  var args = process.argv.slice(2);
  var urlAt = args.indexOf('--url');
  var base = urlAt === -1 ? DEFAULT_URL : args[urlAt + 1];
  if (!base) fail('option --url sans valeur');
  // On sonde exactement l'URL demandée : c'est ce qui permet de provoquer un échec sur commande
  // en visant un chemin qui ne rend pas le lookbook. La barre finale ne sert qu'à en dériver le CMS
  // et les chemins protégés.
  var root = base.slice(-1) === '/' ? base : base + '/';
  var adminUrl = root + 'admin/';

  var expected = expectedCount();
  var site = await readSite(base, expected);

  if (!site.matches) {
    var age = lastCommitAgeMs();
    var deploying = age !== null && age < FRESH_COMMIT_MS;
    if (deploying) {
      log('écart détecté ' + Math.round(age / 1000) + ' s après le dernier commit — déploiement probablement en cours, nouvel essai dans ' + (RETRY_DEPLOY_MS / 1000) + ' s');
      await wait(RETRY_DEPLOY_MS);
      site = await readSite(base, expected);
    }
    if (!site.matches) {
      var ecart = expected + ' pièces dans data/products.json, ' + site.cards + ' cartes servies, compteur à ' + site.shown;
      // Un écart alors que le dernier commit est vieux ne s'explique plus par un déploiement :
      // le build a échoué, ou n'est jamais parti, et le site est périmé depuis.
      if (!deploying) fail('le site ne reflète pas le dépôt — ' + base + ' : ' + ecart + '. Déploiement en échec ou jamais parti : voir les déploiements Cloudflare.');
      log('écart toujours présent mais le dernier commit a moins de ' + (FRESH_COMMIT_MS / 60000) + ' min (' + ecart + ') — déploiement en cours, pas d\'alerte');
    }
  }

  // Le CMS fait partie du site à surveiller : sans /admin, Prescilia ne peut plus rien publier.
  // Cloudflare Pages sert la page d'accueil, en 200, pour tout chemin qu'il ne connaît pas : un code
  // HTTP ne prouve donc rien ici. On exige le point de montage du CMS, sinon un /admin disparu du
  // déploiement passerait pour joignable.
  var adminHtml = await get(adminUrl, 'CMS injoignable');
  if (adminHtml.indexOf(ADMIN_MARKER) === -1) {
    fail('page servie à la place du CMS — ' + adminUrl + ' : « ' + ADMIN_MARKER + ' » absent (Cloudflare sert la page d\'accueil pour un chemin inconnu)');
  }

  // L'espace de gestion et son API (KD-91) doivent rester derrière Cloudflare Access.
  for (var i = 0; i < PROTECTED_PATHS.length; i++) {
    await expectAccessRedirect(root + PROTECTED_PATHS[i]);
  }
  var protectedNote = '/' + PROTECTED_PATHS.join(' et /') + ' protégés';

  // Le mot de la fin dit ce qui a vraiment été mesuré : un écart toléré reste un écart.
  if (site.matches) {
    log('site conforme au dépôt — ' + base + ' : ' + site.cards + ' cartes servies pour ' + expected + ' pièces, /admin/ joignable, ' + protectedNote);
  } else {
    log('écart toléré — ' + base + ' : ' + site.cards + ' cartes servies pour ' + expected + ' pièces, /admin/ joignable, ' + protectedNote + '. À revérifier au prochain passage.');
  }
}

main().catch(function(err) {
  console.error('check-site.js : ' + (err && err.alerte ? err.message : 'erreur inattendue (' + (err && err.stack ? err.stack : err) + ')'));
  process.exitCode = 1;
});
