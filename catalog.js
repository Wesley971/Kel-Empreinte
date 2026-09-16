/* Catalogue — module partagé entre le navigateur et le build.

   Chargé par index.html avant tooplate-ivory-script.js (global `KelCatalog`)
   et par build.js en Node (`require('./catalog.js')`). Tout ce qui touche à la
   présentation d'un produit vit ici, une seule fois, pour que le carrousel,
   le lookbook et le build ne divergent jamais.

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

  // Une pièce « bientôt », ou disponible mais sans photo, prend le visuel
  // d'attente ; le dégradé dépend de la catégorie (voir .lookbook-card-visual--*)
  function isComingSoon(product) {
    return product.availability === 'bientot' || !product.images || !product.images.length;
  }

  var SOON_VISUAL_BY_CATEGORY = {
    'pendentif': 'lookbook-card-visual--pendant',
    'bracelet': 'lookbook-card-visual--bracelet',
    'bague': 'lookbook-card-visual--ring'
  };

  function renderLookbookCard(product, index, indent) {
    indent = indent || '';
    var name = escapeHtml(product.name);
    var label = indent + '  <span class="lookbook-card-label">No. ' + pad2(index + 1) + ' — ' + name + '</span>';

    if (isComingSoon(product)) {
      var visual = 'lookbook-card-visual lookbook-card-visual--soon';
      if (SOON_VISUAL_BY_CATEGORY[product.category]) visual += ' ' + SOON_VISUAL_BY_CATEGORY[product.category];
      return [
        indent + '<div class="lookbook-card">',
        indent + '  <div class="' + visual + '">',
        indent + '    <span class="lookbook-card-soon">Bientôt</span>',
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
      indent + '<div class="lookbook-card" data-piece-name="' + name + '"' + details + '>',
      indent + '  <img src="' + escapeHtml(normalizeImagePath(image.src)) + '" alt="' + escapeHtml(image.alt) + '" loading="lazy">'
    ];
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
    buildWhatsAppLink: buildWhatsAppLink,
    buildCustomizationLink: buildCustomizationLink,
    formatPrice: formatPrice,
    formatDimensions: formatDimensions,
    escapeHtml: escapeHtml,
    normalizeImagePath: normalizeImagePath,
    isComingSoon: isComingSoon,
    renderLookbookCard: renderLookbookCard,
    renderLookbookCards: renderLookbookCards,
    renderLookbookCount: renderLookbookCount
  };
}));
