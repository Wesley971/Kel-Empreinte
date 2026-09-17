/* Catalogue — module partagé entre le navigateur, le build, l'espace de gestion et les Functions.

   Chargé par les pages du site avant leurs scripts (global `KelCatalog`), par build.js en Node
   (`require('./catalog.js')`), par l'espace de gestion (/gestion/gestion.js) et par les Pages
   Functions (functions/_lib/products.js, import ESM d'un module CommonJS, résolu par le bundler
   de Cloudflare). Tout ce qui touche à la présentation ou aux règles d'état d'une pièce vit ici,
   une seule fois, pour que l'accueil, la boutique, les pages pièce, le build, l'écran de gestion
   et l'API ne divergent jamais.

   Modèle v2 (KD-97) : une pièce est unique. Elle a un prix, un public, un type ; elle peut porter
   la référence que Prescilia lui donne (« BO-023 ») et appartenir à des collections. Cinq états,
   voir AVAILABILITIES. Le rendu des cartes (boutique, accueil) est généré au déploiement.

   La réservation (KD-98) suit une règle de dates écrite une seule fois ici — 14 jours fixes,
   heure de Paris, retour automatique en vente à l'échéance — que build.js applique au
   déploiement, le navigateur entre deux déploiements et la Function de checkout (KD-64) au
   paiement : le même verdict à la même seconde, quel que soit le fuseau de la machine.

   Les espaces insécables s'y écrivent \u00a0 et jamais &nbsp; : les valeurs produites ici
   alimentent aussi des textContent (écran de gestion), où une entité HTML s'afficherait telle
   quelle. */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KelCatalog = factory();
  }
}(this, function() {
  'use strict';

  /* ── Vocabulaire ── */

  // « disponible » : en vente ; « reservee » : quelqu'un a jusqu'à `reservedUntil` inclus pour
  // payer, puis la pièce redevient disponible d'elle-même (voir Réservation) ; « vendue » :
  // partie, visible en boutique sans prix ni achat ; « brouillon » : en cours de saisie, jamais
  // publiée, invisible ; « retiree » : publiée puis sortie du site sans être vendue ni supprimée —
  // sa référence reste prise, elle ne sera jamais réutilisée (KD-74). build.js refuse toute
  // autre valeur.
  var AVAILABILITIES = ['disponible', 'reservee', 'vendue', 'brouillon', 'retiree'];

  var STATE_LABELS = {
    disponible: 'En vente',
    reservee: 'Réservée',
    vendue: 'Vendue',
    brouillon: 'Brouillon',
    retiree: 'Retirée'
  };

  // Ordre des types = ordre des puces de la boutique. Un type sans pièce n'a pas de puce.
  var CATEGORIES = [
    { id: 'boucles-oreilles', label: 'Boucles d\'oreilles', plural: 'Boucles d\'oreilles' },
    { id: 'collier', label: 'Collier', plural: 'Colliers' },
    { id: 'noeud-papillon', label: 'Nœud papillon', plural: 'Nœuds papillon' },
    { id: 'bague', label: 'Bague', plural: 'Bagues' },
    { id: 'bracelet', label: 'Bracelet', plural: 'Bracelets' },
    { id: 'cravate', label: 'Cravate', plural: 'Cravates' },
    { id: 'broche', label: 'Broche', plural: 'Broches' }
  ];

  // « mixte » sort sous les deux puces Femme et Homme.
  var AUDIENCES = [
    { id: 'femme', label: 'Femme' },
    { id: 'homme', label: 'Homme' },
    { id: 'mixte', label: 'Mixte' }
  ];

  // Canal d'une vente (champ `sale.channel`, écrit quand une pièce passe « vendue »).
  var CHANNELS = [
    { id: 'site', label: 'Le site' },
    { id: 'sumup', label: 'Boutique SumUp' },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'etsy', label: 'Etsy' },
    { id: 'vinted', label: 'Vinted' },
    { id: 'physique', label: 'En personne' }
  ];

  // Ce qui peut être personnalisé sur une pièce (`customization.options`). Jamais de prix :
  // la personnalisation est un devis, répondu sous 72 h sur WhatsApp.
  var CUSTOMIZATION_OPTIONS = [
    { id: 'fleurs', label: 'Fleurs' },
    { id: 'couleur', label: 'Couleur' },
    { id: 'taille', label: 'Taille' },
    { id: 'forme', label: 'Forme' }
  ];

  function findById(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function categoryLabel(id, plural) {
    var category = findById(CATEGORIES, id);
    if (!category) return id || '';
    return plural ? category.plural : category.label;
  }

  function audienceLabel(id) {
    var audience = findById(AUDIENCES, id);
    return audience ? audience.label : (id || '');
  }

  /* ── Liens WhatsApp ── */

  function whatsAppUrl(message) {
    return 'https://wa.me/33768728002?text=' + encodeURIComponent(message);
  }

  // Nom suivi de la référence quand elle existe : c'est ainsi que Prescilia reconnaît la pièce
  // d'un coup d'œil dans la conversation (« Herbier Jaune Velours (BO-023) »).
  function pieceLabel(product) {
    return product.reference ? product.name + ' (' + product.reference + ')' : product.name;
  }

  // Demande d'achat : phrase neutre en genre (KD-78), la personne qui commande n'est pas
  // forcément une femme.
  function buildWhatsAppLink(product) {
    return whatsAppUrl('Bonjour, cette pièce m\'intéresse : ' + pieceLabel(product));
  }

  // Demande de personnalisation : devis sous 72 h, les options possibles sont sur la page.
  function buildCustomizationLink(product) {
    return whatsAppUrl('Bonjour, j\'aimerais personnaliser cette pièce : ' + pieceLabel(product) + '. Est-ce possible ?');
  }

  // Pièce vendue : elle reste visible pour donner envie, et le lien propose d'en
  // refaire une semblable — même base neutre que la demande d'achat.
  function buildSimilarPieceLink(product) {
    return whatsAppUrl('Bonjour, cette pièce m\'intéresse : ' + pieceLabel(product) + '. Est-il possible d\'en réaliser une semblable ?');
  }

  /* ── États et règles ── */

  function isSold(product) { return product.availability === 'vendue'; }
  function isReserved(product) { return product.availability === 'reservee'; }
  function isDraft(product) { return product.availability === 'brouillon'; }
  function isRetired(product) { return product.availability === 'retiree'; }

  function hasPhoto(product) {
    return !!(product.images && product.images.length);
  }

  function hasPrice(product) {
    return typeof product.price === 'number' && product.price >= 0;
  }

  // Prix barré : un prix promotionnel n'a de sens que sous le prix de référence.
  function hasPromo(product) {
    return hasPrice(product) && typeof product.promoPrice === 'number' && product.promoPrice >= 0 && product.promoPrice < product.price;
  }

  // L'accueil ne montre que ce qui s'achète tout de suite.
  function isVisibleOnHome(product) {
    return product.availability === 'disponible';
  }

  // La boutique montre aussi les réservées et les vendues ; brouillons et retirées n'existent
  // nulle part sur le site (pas même une page).
  function isVisibleInShop(product) {
    return product.availability === 'disponible' || product.availability === 'reservee' || product.availability === 'vendue';
  }

  function isText(value) {
    return typeof value === 'string' && value.trim() !== '';
  }

  // Ce qui empêche une pièce d'être montrée sur le site, quel que soit son état visible (en
  // vente, réservée, vendue) : une photo, un nom, un type, un public — ce que build.js exige
  // d'une pièce qui n'est pas un brouillon. Renvoie une liste de codes.
  function displayBlockers(product) {
    var blockers = [];
    if (!hasPhoto(product)) blockers.push('photo');
    if (!isText(product.name)) blockers.push('nom');
    if (!findById(CATEGORIES, product.category)) blockers.push('type');
    if (!findById(AUDIENCES, product.audience)) blockers.push('public');
    return blockers;
  }

  // Ce qui empêche une pièce d'être mise en vente : ce qui la montre, plus un prix — sa règle à
  // elle (« une photo suffit à rendre une pièce disponible »). Partagé entre l'écran de gestion
  // (action désactivée, raison affichée), l'API (refus 422) et build.js (échec du build) : l'API
  // ne doit jamais écrire un fichier que le build refuserait.
  function saleBlockers(product) {
    var blockers = displayBlockers(product);
    if (!hasPrice(product)) blockers.push('prix');
    return blockers;
  }

  var BLOCKER_LABELS = { photo: 'une photo', prix: 'un prix', nom: 'un nom', type: 'un type', public: 'un public' };

  // Phrase affichée telle quelle à Prescilia : une action, pas un code. Les deux cas courants
  // gardent leur formulation validée ; les autres listent ce qui manque.
  function describeSaleBlockers(blockers, action) {
    action = action || 'de mettre cette pièce en vente';
    if (!blockers.length) return '';
    if (blockers.length === 1 && blockers[0] === 'photo') return 'Ajoutez une photo avant ' + action + '.';
    if (blockers.length === 1 && blockers[0] === 'prix') return 'Renseignez un prix avant ' + action + '.';
    if (blockers.length === 2 && blockers.indexOf('photo') !== -1 && blockers.indexOf('prix') !== -1) return 'Ajoutez une photo et un prix avant ' + action + '.';
    var labels = blockers.map(function(code) { return BLOCKER_LABELS[code] || code; });
    return 'Il manque ' + labels.join(', ') + ' ' + action.replace(/^de /, 'pour ') + '.';
  }

  // Ordre de l'écran de gestion et de l'API : les pièces dans l'ordre du fichier, les vendues
  // à la fin. Deux filtres plutôt qu'un tri : l'ordre relatif est garanti quel que soit le moteur.
  function sortForDisplay(products) {
    return products.filter(function(p) { return !isSold(p); })
      .concat(products.filter(isSold));
  }

  // Comparaison des références telle que Prescilia les écrit : « BO023 », « bo-023 » et
  // « BO 023 » désignent la même pièce. Casse, espaces, tirets et points ne comptent pas.
  function normalizeReference(reference) {
    return String(reference == null ? '' : reference).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /* ── Dates ── */

  // Les dates du catalogue sont des jours (« 2026-10-01 »), sans heure ni fuseau : on les lit en
  // heure locale pour qu'un 1er octobre ne devienne pas un 30 septembre quelque part.
  function parseIsoDate(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    var date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
    return date;
  }

  // « 1er octobre » / « 1er oct. » : le premier du mois prend « 1er », les autres jours le nombre.
  function formatDay(date, short) {
    var text = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: short ? 'short' : 'long' }).format(date);
    return text.replace(/^1 /, '1er ');
  }

  function formatReservedUntil(product, short) {
    var date = parseIsoDate(product.reservedUntil);
    if (!date) return '';
    return (short ? 'Jusqu\'au ' : 'Réservée jusqu\'au ') + formatDay(date, short);
  }

  /* ── Réservation : 14 jours fixes, heure de Paris ── */

  // La règle de Prescilia : une pièce réservée le 1er reste réservée jusqu'au 14 inclus et
  // redevient disponible le 15 à 00 h 00, heure de Paris — jamais UTC, jamais l'heure de la
  // machine. Rien ne se saisit : `reservedUntil` est le dernier jour réservé, calculé (jour de la
  // réservation + 13), et aucune date de réservation ne se modifie à la main.
  var TIME_ZONE = 'Europe/Paris';
  var RESERVATION_DAYS = 14;

  // Le jour civil « AAAA-MM-JJ » à Paris pour un instant donné (par défaut : maintenant). Le
  // fuseau est écrit ici, jamais pris sur l'appareil : le téléphone d'une visiteuse à l'étranger et
  // le Worker de Cloudflare (en UTC) doivent trouver le même jour.
  function todayInParis(now) {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now || new Date());
    var value = {};
    parts.forEach(function(part) { value[part.type] = part.value; });
    return value.year + '-' + value.month + '-' + value.day;
  }

  // Jour + n, en calendrier : Date.UTC ne connaît pas les changements d'heure, le résultat ne peut
  // pas glisser d'un jour. Entrée illisible : chaîne vide.
  function addDays(isoDay, days) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDay || ''));
    if (!match) return '';
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days)).toISOString().slice(0, 10);
  }

  // Le dernier jour réservé pour une réservation prise un jour donné
  function reservationEnd(reservedOn) {
    return addDays(reservedOn, RESERVATION_DAYS - 1);
  }

  // Une réservation tient tant que le jour à Paris n'a pas dépassé `reservedUntil` : les jours
  // « AAAA-MM-JJ » se comparent comme des chaînes. Sans date lisible, elle ne tient pas.
  function isReservationActive(product, now) {
    if (product.availability !== 'reservee' || !parseIsoDate(product.reservedUntil)) return false;
    return todayInParis(now) <= product.reservedUntil;
  }

  // Une réservée dont l'échéance est passée est revenue en vente d'elle-même
  function isReservationExpired(product, now) {
    return product.availability === 'reservee' && !isReservationActive(product, now);
  }

  // L'état à traiter, pour le site comme pour l'écran de gestion : « disponible » pour une
  // réservation échue, l'état du fichier sinon. La Function de checkout (KD-64) juge sur celui-ci.
  function effectiveAvailability(product, now) {
    return isReservationExpired(product, now) ? 'disponible' : product.availability;
  }

  // Une copie de la pièce réglée à l'instant donné : build.js rend le catalogue ainsi, une
  // réservation échue devient une pièce disponible sans date. Le fichier, lui, garde « reservee »
  // et sa date jusqu'à la prochaine action de Prescilia.
  function settleReservation(product, now) {
    if (!isReservationExpired(product, now)) return product;
    var settled = {};
    Object.keys(product).forEach(function(key) { if (key !== 'reservedUntil') settled[key] = product[key]; });
    settled.availability = 'disponible';
    return settled;
  }

  // Le jour où une réservation échue a remis la pièce en vente : le lendemain de l'échéance
  function returnedToSaleOn(product) {
    return addDays(product.reservedUntil, 1);
  }

  function formatReturnedToSale(product) {
    var date = parseIsoDate(returnedToSaleOn(product));
    return date ? 'Remise en vente le ' + formatDay(date, true) : '';
  }

  // Un jour « AAAA-MM-JJ » postérieur au jour courant à Paris : une vente ne se date pas au futur
  function isFutureDay(isoDay, now) {
    return parseIsoDate(isoDay) !== null && isoDay > todayInParis(now);
  }

  /* ── Vente ── */

  function channelLabel(id) {
    var channel = findById(CHANNELS, id);
    return channel ? channel.label : (id || '');
  }

  // La vente est complète quand le montant encaissé est connu : c'est le rappel demandé (KD-74)
  function isSaleComplete(product) {
    return !!(product.sale && typeof product.sale.amount === 'number' && product.sale.amount >= 0);
  }

  // « Vendue le 3 oct. · 45 € · Etsy » : ce qui manque est omis, sauf le montant, qui est réclamé
  function formatSale(product, short) {
    var sale = product.sale || {};
    var date = parseIsoDate(sale.date);
    var parts = ['Vendue' + (date ? ' le ' + formatDay(date, short) : '')];
    parts.push(isSaleComplete(product) ? formatAmount(sale.amount) : 'montant à compléter');
    if (sale.channel) parts.push(channelLabel(sale.channel));
    return parts.join('\u00a0· ');
  }

  /* ── Transitions ── */

  // Ce que Prescilia peut faire d'une pièce selon son état effectif : la table unique de l'écran
  // de gestion (les actions proposées) et de l'API (422 pour tout le reste). Une pièce publiée ne
  // redevient jamais un brouillon ; une réservée active ne se réserve pas à nouveau (ce serait
  // une prolongation déguisée) ; « disponible » depuis disponible range une réservation échue
  // (le fichier perd sa date) ; « vendue » depuis vendue complète la vente sans changer d'état.
  var TRANSITIONS = {
    disponible: ['disponible', 'reservee', 'vendue', 'retiree'],
    reservee: ['disponible', 'vendue'],
    vendue: ['disponible', 'vendue'],
    brouillon: ['disponible'],
    retiree: ['disponible']
  };

  function allowedTransitions(product, now) {
    return (TRANSITIONS[effectiveAvailability(product, now)] || []).slice();
  }

  function canTransition(product, target, now) {
    return allowedTransitions(product, now).indexOf(target) !== -1;
  }

  /* ── Prix et textes ── */

  // « 50 € », « 12,50 € » : entier tel quel, sinon deux décimales à la française.
  function formatAmount(amount) {
    if (typeof amount !== 'number' || !(amount >= 0)) return '';
    var text = Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace('.', ',');
    return text + '\u00a0€';
  }

  // Le prix affiché : le prix promotionnel s'il y en a un, sinon le prix.
  function formatPrice(product) {
    if (hasPromo(product)) return formatAmount(product.promoPrice);
    return hasPrice(product) ? formatAmount(product.price) : '';
  }

  // Le prix barré, uniquement en promotion.
  function formatOriginalPrice(product) {
    return hasPromo(product) ? formatAmount(product.price) : '';
  }

  // Le champ est un texte libre ; l'espace insécable évite un retour à la ligne entre
  // « Dimensions » et les deux-points.
  function formatDimensions(dimensions) {
    return dimensions ? 'Dimensions\u00a0: ' + dimensions : '';
  }

  /* ── Ordre et sélection ── */

  var SHOP_ORDER = { disponible: 0, reservee: 1, vendue: 2 };

  function createdTime(product) {
    var date = parseIsoDate(product.createdAt);
    return date ? date.getTime() : 0;
  }

  // Tri stable : à état et date égaux, l'ordre du fichier départage.
  function byIndexed(compare) {
    return function(a, b) { return compare(a.product, b.product) || a.index - b.index; };
  }

  function indexed(products) {
    return products.map(function(product, index) { return { product: product, index: index }; });
  }

  function unwrap(list) {
    return list.map(function(entry) { return entry.product; });
  }

  // Ordre de la boutique : disponibles, puis réservées, puis vendues ; les plus récentes
  // d'abord dans chaque groupe.
  function sortForShop(products) {
    var visible = indexed(products).filter(function(entry) { return isVisibleInShop(entry.product); });
    visible.sort(byIndexed(function(a, b) {
      return (SHOP_ORDER[a.availability] - SHOP_ORDER[b.availability]) || (createdTime(b) - createdTime(a));
    }));
    return unwrap(visible);
  }

  // Les `count` dernières pièces en vente : la collection automatique « Nouveautés », et le repli
  // de l'accueil quand rien n'est mis en avant. Un compte, pas une fenêtre de jours : la section
  // ne se vide jamais.
  function latest(products, count) {
    var onSale = indexed(products).filter(function(entry) { return isVisibleOnHome(entry.product); });
    onSale.sort(byIndexed(function(a, b) { return createdTime(b) - createdTime(a); }));
    return unwrap(onSale).slice(0, count);
  }

  // Les pièces mises en avant sur l'accueil, en vente seulement (une pièce réservée ou vendue en
  // sort d'elle-même), dans l'ordre choisi ; si aucune, les dernières ajoutées.
  function featuredPieces(products, fallbackCount) {
    var featured = indexed(products).filter(function(entry) { return entry.product.featured === true && isVisibleOnHome(entry.product); });
    featured.sort(byIndexed(function(a, b) {
      return (typeof a.featuredOrder === 'number' ? a.featuredOrder : Infinity) - (typeof b.featuredOrder === 'number' ? b.featuredOrder : Infinity);
    }));
    return featured.length ? unwrap(featured) : latest(products, fallbackCount);
  }

  // Les pièces en vente d'une collection, les plus récentes d'abord.
  function collectionPieces(products, collectionId) {
    return latest(products.filter(function(product) {
      return Array.isArray(product.collections) && product.collections.indexOf(collectionId) !== -1;
    }), Infinity);
  }

  /* ── Rendu (HTML généré au déploiement par build.js) ── */

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Les chemins d'images du fichier sont relatifs à la racine (« images/… »), parfois écrits
  // avec un slash initial par l'ancien CMS ; les pages vivent à plusieurs profondeurs
  // (/, /boutique/, /boutique/<id>/), on sert donc toujours un chemin absolu.
  function normalizeImagePath(src) {
    return String(src).replace(/^\/+/, '');
  }

  function imageUrl(image) {
    return '/' + normalizeImagePath(image.src);
  }

  function pieceUrl(product) {
    return '/boutique/' + encodeURIComponent(product.id) + '/';
  }

  // Une pièce réservée est rendue avec ses deux visages : ce qui se montre tant que la réservation
  // tient (data-while-reserved) et ce qui la remplace à l'échéance (data-after-reservation, caché).
  // Le navigateur bascule l'un vers l'autre à la seconde près (shop.js) sans construire de HTML ;
  // `data-reserved-until` porte l'échéance qu'il compare au jour à Paris.
  function reservedAttrs(product) {
    return isReserved(product) ? ' data-reserved-until="' + escapeHtml(product.reservedUntil) + '"' : '';
  }

  // La carte d'une pièce : boutique et « Pièces mises en avant » de l'accueil. La classe reste
  // exactement « shop-card » sur toutes les cartes : check-site.js compte `class="shop-card"`
  // pour comparer le site au dépôt. L'état et les critères de filtre sont portés par des
  // attributs data-*, qui servent d'accroche à shop.js (filtres, échéance) et au CSS (photo d'une
  // vendue).
  function renderShopCard(product, indent) {
    indent = indent || '';
    var name = escapeHtml(product.name);
    var url = escapeHtml(pieceUrl(product));
    var image = product.images[0];
    var collections = (product.collections || []).map(escapeHtml).join(' ');
    var lines = [
      indent + '<li class="shop-card" data-id="' + escapeHtml(product.id) + '" data-availability="' + escapeHtml(product.availability) + '"' +
        ' data-category="' + escapeHtml(product.category) + '" data-audience="' + escapeHtml(product.audience) + '"' +
        ' data-collections="' + collections + '"' + reservedAttrs(product) + '>',
      indent + '  <a class="shop-card-photo" href="' + url + '" aria-label="' + name + '">',
      indent + '    <img src="' + escapeHtml(imageUrl(image)) + '" alt="' + escapeHtml(image.alt) + '" loading="lazy">'
    ];
    if (isReserved(product)) lines.push(indent + '    <span class="shop-card-badge shop-card-badge--reserved" data-while-reserved>Réservée</span>');
    if (isSold(product)) lines.push(indent + '    <span class="shop-card-badge shop-card-badge--sold">Vendue</span>');
    lines.push(
      indent + '  </a>',
      indent + '  <div class="shop-card-body">',
      indent + '    <a class="shop-card-name" href="' + url + '">' + name + '</a>'
    );
    if (product.reference) lines.push(indent + '    <span class="shop-card-ref">' + escapeHtml(product.reference) + '</span>');

    if (isSold(product)) {
      // Vendue : pas de prix, la photo reste (elle donne envie) et le lien propose une pièce semblable
      lines.push(indent + '    <a class="shop-card-similar cta-link" href="' + escapeHtml(buildSimilarPieceLink(product)) + '" target="_blank" rel="noopener noreferrer">Une pièce semblable ?</a>');
    } else {
      var price = indent + '    <p class="shop-card-price">';
      if (hasPromo(product)) price += '<s class="shop-card-price-old">' + escapeHtml(formatOriginalPrice(product)) + '</s> ';
      price += '<span class="shop-card-price-now">' + escapeHtml(formatPrice(product)) + '</span></p>';
      lines.push(price);
      if (isReserved(product)) lines.push(indent + '    <p class="shop-card-until" data-while-reserved>' + escapeHtml(formatReservedUntil(product, true)) + '</p>');
      // « Ajouter » (au panier) arrive avec KD-64 ; d'ici là le bouton mène à la page de la pièce.
      // Sur une réservée il attend, caché, l'échéance.
      lines.push(indent + '    <a class="shop-card-action" href="' + url + '"' + (isReserved(product) ? ' data-after-reservation hidden' : '') + '>Voir la pièce</a>');
    }
    lines.push(indent + '  </div>', indent + '</li>');
    return lines.join('\n');
  }

  function renderShopCards(products, indent) {
    return products.map(function(product) { return renderShopCard(product, indent); }).join('\n');
  }

  return {
    AVAILABILITIES: AVAILABILITIES,
    STATE_LABELS: STATE_LABELS,
    CATEGORIES: CATEGORIES,
    AUDIENCES: AUDIENCES,
    CHANNELS: CHANNELS,
    CUSTOMIZATION_OPTIONS: CUSTOMIZATION_OPTIONS,
    categoryLabel: categoryLabel,
    audienceLabel: audienceLabel,
    pieceLabel: pieceLabel,
    buildWhatsAppLink: buildWhatsAppLink,
    buildCustomizationLink: buildCustomizationLink,
    buildSimilarPieceLink: buildSimilarPieceLink,
    isSold: isSold,
    isReserved: isReserved,
    isDraft: isDraft,
    isRetired: isRetired,
    hasPhoto: hasPhoto,
    hasPrice: hasPrice,
    hasPromo: hasPromo,
    isVisibleOnHome: isVisibleOnHome,
    isVisibleInShop: isVisibleInShop,
    displayBlockers: displayBlockers,
    saleBlockers: saleBlockers,
    describeSaleBlockers: describeSaleBlockers,
    sortForDisplay: sortForDisplay,
    sortForShop: sortForShop,
    latest: latest,
    featuredPieces: featuredPieces,
    collectionPieces: collectionPieces,
    normalizeReference: normalizeReference,
    parseIsoDate: parseIsoDate,
    formatDay: formatDay,
    formatReservedUntil: formatReservedUntil,
    TIME_ZONE: TIME_ZONE,
    RESERVATION_DAYS: RESERVATION_DAYS,
    todayInParis: todayInParis,
    addDays: addDays,
    reservationEnd: reservationEnd,
    isReservationActive: isReservationActive,
    isReservationExpired: isReservationExpired,
    effectiveAvailability: effectiveAvailability,
    settleReservation: settleReservation,
    returnedToSaleOn: returnedToSaleOn,
    formatReturnedToSale: formatReturnedToSale,
    isFutureDay: isFutureDay,
    channelLabel: channelLabel,
    isSaleComplete: isSaleComplete,
    formatSale: formatSale,
    allowedTransitions: allowedTransitions,
    canTransition: canTransition,
    reservedAttrs: reservedAttrs,
    formatAmount: formatAmount,
    formatPrice: formatPrice,
    formatOriginalPrice: formatOriginalPrice,
    formatDimensions: formatDimensions,
    escapeHtml: escapeHtml,
    normalizeImagePath: normalizeImagePath,
    imageUrl: imageUrl,
    pieceUrl: pieceUrl,
    renderShopCard: renderShopCard,
    renderShopCards: renderShopCards
  };
}));
