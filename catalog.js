/* Catalogue — module partagé entre le navigateur et le build.

   Chargé par index.html avant tooplate-ivory-script.js (global `KelCatalog`),
   par build.js en Node (`require('./catalog.js')`), par l'espace de gestion
   (/gestion/gestion.js) et par les Pages Functions (functions/_lib/products.js,
   import ESM d'un module CommonJS, résolu par le bundler de Cloudflare). Tout ce
   qui touche à la présentation ou aux règles d'état d'un produit vit ici, une
   seule fois, pour que le carrousel, le lookbook, le build, l'écran de gestion
   et l'API ne divergent jamais.

   Les espaces insécables s'y écrivent \u00a0 et jamais &nbsp; : les valeurs produites ici
   alimentent aussi des textContent (fiche produit, légende de la lightbox), où une entité
   HTML s'afficherait telle quelle. */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KelCatalog = factory();
  }
}(this, function() {
  'use strict';

  function whatsAppUrl(message) {
    return 'https://wa.me/33768728002?text=' + encodeURIComponent(message);
  }

  // Demande d'achat : phrase neutre en genre (KD-78), la personne qui commande n'est pas
  // forcément une femme. Un seul gabarit pour les trois entrées : lookbook, fiche, buy-circle.
  function buildWhatsAppLink(pieceName) {
    return whatsAppUrl('Bonjour, cette pièce m\'intéresse : ' + pieceName);
  }

  // Demande de personnalisation : message volontairement générique (couleur ou
  // autre, la marque ne détaille pas les options) et neutre en genre.
  function buildCustomizationLink(pieceName) {
    return whatsAppUrl('Bonjour, j\'aimerais personnaliser cette pièce : ' + pieceName + '. Est-ce possible ?');
  }

  // Pièce vendue : elle reste visible pour donner envie, et le lien propose d'en
  // refaire une semblable — même base neutre que la demande d'achat.
  function buildSimilarPieceLink(pieceName) {
    return whatsAppUrl('Bonjour, cette pièce m\'intéresse : ' + pieceName + '. Est-il possible d\'en réaliser une semblable ?');
  }

  /* ── États d'une pièce ── */

  // « disponible » : en vente ; « bientot » : annoncée, pas encore de photo ;
  // « vendue » : partie, affichée sans prix ni commande. build.js refuse toute autre valeur.
  var AVAILABILITIES = ['disponible', 'bientot', 'vendue'];

  function isSold(product) {
    return product.availability === 'vendue';
  }

  function hasPhoto(product) {
    return !!(product.images && product.images.length);
  }

  // Ce qui empêche une pièce d'être réellement « en vente » sur le site : sans photo elle
  // prend le visuel d'attente (isComingSoon), et à prix fixe sans prix le build échoue
  // (build.js). Partagé entre l'écran de gestion (interrupteur désactivé, raison affichée)
  // et l'API (refus 422) : la même règle, écrite une fois. Renvoie une liste de codes.
  function saleBlockers(product) {
    var blockers = [];
    if (!hasPhoto(product)) blockers.push('photo');
    if (product.priceType === 'fixe' && !(typeof product.price === 'number' && product.price >= 0)) blockers.push('prix');
    return blockers;
  }

  // Phrase affichée telle quelle à Prescilia : une action, pas un code.
  function describeSaleBlockers(blockers) {
    if (!blockers.length) return '';
    if (blockers.length === 2) return 'Ajoutez une photo et un prix avant de mettre cette pièce en vente.';
    return blockers[0] === 'photo'
      ? 'Ajoutez une photo avant de mettre cette pièce en vente.'
      : 'Renseignez un prix avant de mettre cette pièce en vente.';
  }

  // Ordre d'affichage, lookbook comme écran de gestion : les pièces en vente ou à venir
  // dans l'ordre du fichier, puis les vendues dans l'ordre du fichier. Deux filtres plutôt
  // qu'un tri : l'ordre relatif est garanti quel que soit le moteur.
  function sortForDisplay(products) {
    return products.filter(function(p) { return !isSold(p); })
      .concat(products.filter(isSold));
  }

  function formatPrice(product) {
    if (product.priceType === 'devis') return 'Sur devis';
    return typeof product.price === 'number' ? product.price + '\u00a0€' : '';
  }

  // Le champ est un texte libre saisi dans le CMS ; l'espace insécable évite un
  // retour à la ligne entre « Dimensions » et les deux-points
  function formatDimensions(dimensions) {
    return dimensions ? 'Dimensions\u00a0: ' + dimensions : '';
  }

  /* ── Rendu du lookbook (HTML généré au déploiement par build.js) ── */

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Sveltia écrit les chemins d'images avec un slash initial (/images/…) ;
  // le site est servi depuis la racine, un chemin relatif suffit partout.
  function normalizeImagePath(src) {
    return String(src).replace(/^\/+/, '');
  }

  // Numérotation « No. 01 » : deux chiffres minimum, comme le HTML d'origine
  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  // Une pièce « bientôt », ou sans photo quel que soit son état, prend le visuel
  // d'attente ; le dégradé dépend de la catégorie (voir .lookbook-card-visual--*)
  function isComingSoon(product) {
    return product.availability === 'bientot' || !hasPhoto(product);
  }

  var SOON_VISUAL_BY_CATEGORY = {
    'pendentif': 'lookbook-card-visual--pendant',
    'bracelet': 'lookbook-card-visual--bracelet',
    'bague': 'lookbook-card-visual--ring'
  };

  // La classe reste exactement « lookbook-card » sur toutes les cartes : check-site.js
  // compte `class="lookbook-card"` pour comparer le site au dépôt. L'état est porté par
  // data-availability, qui sert aussi d'accroche CSS (photo d'une pièce vendue).
  function renderLookbookCard(product, index, indent) {
    indent = indent || '';
    var name = escapeHtml(product.name);
    var open = '<div class="lookbook-card" data-availability="' + escapeHtml(product.availability) + '"';
    var label = indent + '  <span class="lookbook-card-label">No. ' + pad2(index + 1) + ' — ' + name + '</span>';

    if (isComingSoon(product)) {
      var visual = 'lookbook-card-visual lookbook-card-visual--soon';
      if (SOON_VISUAL_BY_CATEGORY[product.category]) visual += ' ' + SOON_VISUAL_BY_CATEGORY[product.category];
      return [
        indent + open + '>',
        indent + '  <div class="' + visual + '">',
        indent + '    <span class="lookbook-card-soon">' + (isSold(product) ? 'Vendue' : 'Bientôt') + '</span>',
        indent + '  </div>',
        label,
        indent + '</div>'
      ].join('\n');
    }

    var image = product.images[0];
    // Détails lus par la lightbox (légende sous la photo agrandie) ; absents si vides
    var details = '';
    if (product.desc) details += ' data-desc="' + escapeHtml(product.desc) + '"';
    if (product.dimensions) details += ' data-dimensions="' + escapeHtml(product.dimensions) + '"';
    var lines = [
      indent + open + ' data-piece-name="' + name + '"' + details + '>',
      indent + '  <img src="' + escapeHtml(normalizeImagePath(image.src)) + '" alt="' + escapeHtml(image.alt) + '" loading="lazy">'
    ];

    // Vendue : la photo reste (elle donne envie), sans prix ni commande ; le lien propose une
    // pièce semblable. Classe distincte du CTA de commande : tooplate-ivory-script.js réécrit
    // le href de tout .lookbook-card-cta au chargement. Pas de badge « Personnalisable » :
    // le lien dit déjà la même chose.
    if (isSold(product)) {
      lines.push(
        label,
        indent + '  <span class="lookbook-card-price lookbook-card-price--sold">Vendue</span>',
        indent + '  <a href="' + escapeHtml(buildSimilarPieceLink(product.name)) + '" class="lookbook-card-similar cta-link" target="_blank" rel="noopener noreferrer" aria-label="Demander une pièce semblable à ' + name + ' sur WhatsApp">Une pièce semblable ?</a>',
        indent + '</div>'
      );
      return lines.join('\n');
    }

    if (product.customizable === true) {
      // draggable="false" : un <a> posé sur la photo ne doit pas déclencher le drag natif du lien
      lines.push(indent + '  <a href="' + escapeHtml(buildCustomizationLink(product.name)) + '" class="lookbook-card-badge" target="_blank" rel="noopener noreferrer" draggable="false" aria-label="Demander une personnalisation pour ' + name + ' sur WhatsApp">Personnalisable</a>');
    }
    lines.push(
      label,
      indent + '  <span class="lookbook-card-price">' + escapeHtml(formatPrice(product)) + '</span>',
      indent + '  <a href="' + escapeHtml(buildWhatsAppLink(product.name)) + '" class="lookbook-card-cta cta-link" target="_blank" rel="noopener noreferrer">Commander</a>',
      indent + '</div>'
    );
    return lines.join('\n');
  }

  function renderLookbookCards(products, indent) {
    return products.map(function(product, index) {
      return renderLookbookCard(product, index, indent);
    }).join('\n');
  }

  function renderLookbookCount(products, indent) {
    return (indent || '') + '<span class="lookbook-count">01 — ' + pad2(products.length) + '</span>';
  }

  return {
    AVAILABILITIES: AVAILABILITIES,
    buildWhatsAppLink: buildWhatsAppLink,
    buildCustomizationLink: buildCustomizationLink,
    buildSimilarPieceLink: buildSimilarPieceLink,
    formatPrice: formatPrice,
    formatDimensions: formatDimensions,
    escapeHtml: escapeHtml,
    normalizeImagePath: normalizeImagePath,
    isComingSoon: isComingSoon,
    isSold: isSold,
    hasPhoto: hasPhoto,
    saleBlockers: saleBlockers,
    describeSaleBlockers: describeSaleBlockers,
    sortForDisplay: sortForDisplay,
    renderLookbookCard: renderLookbookCard,
    renderLookbookCards: renderLookbookCards,
    renderLookbookCount: renderLookbookCount
  };
}));
