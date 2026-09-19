/* Boutique et pages pièce — comportements côté navigateur.

   /boutique/ : les cartes sont générées au déploiement (build.js), avec leurs critères en data-*
   (data-audience : une valeur ; data-category et data-collections : des listes séparées d'espaces,
   une parure a plusieurs types — KD-120). Ce script ne fait que montrer ou masquer : deux barres
   de puces cumulables (Public, Type), compteur par puce recalculé selon les autres filtres actifs
   (jamais de zéro-résultat surprise), filtres actifs rappelés au-dessus de la grille avec une
   croix, mention « Collection : … » à l'arrivée depuis l'accueil. L'état vit dans l'URL
   (?public=femme&type=collier&collection=parures) : un filtrage se partage et survit au
   rechargement. Sans script, toutes les cartes sont visibles — rien n'est perdu.

   Page pièce : vignettes qui changent la grande photo, grande photo qui s'ouvre en plein écran
   (lightbox de site.js).

   Réservations (KD-98) : les pages sont générées au déploiement, mais une réservation expire à
   minuit, heure de Paris, sans attendre le déploiement suivant. build.js rend donc une pièce
   réservée avec ses deux visages (voir catalog.js) et ce script montre le bon au chargement, avec
   la règle partagée. Sans script ou sans catalog.js, la page reste telle que construite —
   réservée, le sens sûr. */

(function() {
  'use strict';

  // Noms lisibles des filtres dans l'URL
  var PARAMS = { audience: 'public', category: 'type' };

  settleReservations();

  var grid = document.getElementById('shopGrid');
  if (grid) initShop(grid);

  var gallery = document.querySelector('.piece-gallery');
  if (gallery) initGallery(gallery);

  /* ── Réservations échues ── */

  // Cartes et article portent data-reserved-until ; passé ce jour (heure de Paris, jugée par
  // catalog.js), ce qui parlait de réservation se cache et ce qui attendait se montre. Le
  // data-availability suit, pour le CSS et les filtres.
  function settleReservations() {
    var catalog = window.KelCatalog;
    if (!catalog) return;
    toArray(document.querySelectorAll('[data-reserved-until]')).forEach(function(root) {
      var product = { availability: 'reservee', reservedUntil: root.getAttribute('data-reserved-until') };
      var settled;
      try {
        settled = catalog.isReservationExpired(product);
      } catch (err) {
        return; // Intl sans fuseau : on ne tranche pas, la page reste réservée
      }
      if (!settled) return;
      toArray(root.querySelectorAll('[data-while-reserved]')).forEach(function(el) { el.hidden = true; });
      toArray(root.querySelectorAll('[data-after-reservation]')).forEach(function(el) { el.hidden = false; });
      root.setAttribute('data-availability', 'disponible');
    });
  }

  /* ── Boutique : filtres ── */

  function initShop(grid) {
    var cards = toArray(grid.querySelectorAll('.shop-card'));
    var groups = toArray(document.querySelectorAll('.shop-chips[data-filter]'));
    var countEl = document.querySelector('.shop-count');
    var activeEl = document.getElementById('shopActive');
    var emptyEl = document.getElementById('shopEmpty');
    var resetBtn = document.getElementById('shopReset');
    var collectionEl = document.getElementById('shopCollection');
    var collectionNameEl = document.getElementById('shopCollectionName');
    var collectionClear = document.getElementById('shopCollectionClear');
    var collections = readCollections();

    var selected = { audience: [], category: [] };
    var collection = null;

    // Les valeurs connues sont celles des puces générées : une valeur inventée dans l'URL est ignorée
    var known = {};
    groups.forEach(function(group) {
      var filter = group.getAttribute('data-filter');
      known[filter] = toArray(group.querySelectorAll('.shop-chip')).map(function(chip) { return chip.getAttribute('data-value'); });
      group.addEventListener('click', function(e) {
        var chip = e.target.closest('.shop-chip');
        if (!chip) return;
        toggle(filter, chip.getAttribute('data-value'));
      });
    });

    function toggle(filter, value) {
      var at = selected[filter].indexOf(value);
      if (at === -1) selected[filter].push(value); else selected[filter].splice(at, 1);
      render();
    }

    // « a b c » contient-il ce jeton ? (les listes des attributs data-category et data-collections)
    function hasToken(list, wanted) {
      return (' ' + list + ' ').indexOf(' ' + wanted + ' ') !== -1;
    }

    // Une pièce « mixte » répond aux deux publics ; une pièce à plusieurs types répond à chacun
    function matchesValue(filter, cardValue, wanted) {
      if (filter === 'audience') return cardValue === wanted || cardValue === 'mixte';
      return hasToken(cardValue, wanted);
    }

    // data-audience porte une valeur ; data-category porte une LISTE de types séparés par des
    // espaces malgré son nom au singulier (KD-120) : l'attribut est dérivé du nom du filtre, lui-même
    // lié au paramètre d'URL `?type=` (PARAMS), le renommer casserait les liens partagés pour rien.
    function matchesGroup(card, filter, values) {
      if (!values.length) return true;
      var cardValue = card.getAttribute('data-' + filter) || '';
      return values.some(function(wanted) { return matchesValue(filter, cardValue, wanted); });
    }

    function matchesCollection(card) {
      if (!collection) return true;
      return hasToken(card.getAttribute('data-collections') || '', collection);
    }

    // override : { filter, values } — « combien de pièces si ce groupe valait ceci ? », pour les compteurs
    function matches(card, override) {
      var ok = Object.keys(selected).every(function(filter) {
        var values = override && override.filter === filter ? override.values : selected[filter];
        return matchesGroup(card, filter, values);
      });
      return ok && matchesCollection(card);
    }

    function chipLabel(filter, value) {
      var group = groups.filter(function(g) { return g.getAttribute('data-filter') === filter; })[0];
      var chip = group && group.querySelector('.shop-chip[data-value="' + value + '"]');
      var label = chip && chip.querySelector('.shop-chip-label');
      return label ? label.textContent : value;
    }

    function collectionName(id) {
      for (var i = 0; i < collections.length; i++) if (collections[i].id === id) return collections[i].name;
      return null;
    }

    function readUrl() {
      var params = new URLSearchParams(window.location.search);
      Object.keys(PARAMS).forEach(function(filter) {
        var raw = params.get(PARAMS[filter]) || '';
        selected[filter] = raw.split(',').filter(function(v) { return v && known[filter].indexOf(v) !== -1; });
      });
      var wanted = params.get('collection');
      collection = wanted && collectionName(wanted) ? wanted : null;
    }

    function writeUrl() {
      var params = new URLSearchParams();
      Object.keys(PARAMS).forEach(function(filter) {
        if (selected[filter].length) params.set(PARAMS[filter], selected[filter].join(','));
      });
      if (collection) params.set('collection', collection);
      var query = params.toString();
      var url = window.location.pathname + (query ? '?' + query : '') + window.location.hash;
      if (url !== window.location.pathname + window.location.search + window.location.hash) {
        window.history.replaceState(null, '', url);
      }
    }

    function activeItem(text, onRemove) {
      var li = document.createElement('li');
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'shop-active-chip';
      button.setAttribute('aria-label', 'Retirer le filtre ' + text);
      button.innerHTML = '<span></span> <span class="shop-active-x" aria-hidden="true">&times;</span>';
      button.firstChild.textContent = text;
      button.addEventListener('click', onRemove);
      li.appendChild(button);
      return li;
    }

    function render() {
      var shown = 0;
      cards.forEach(function(card) {
        var ok = matches(card);
        card.hidden = !ok;
        if (ok) shown++;
      });

      if (countEl) countEl.textContent = shown === 0 ? 'Aucune pièce' : shown + (shown > 1 ? ' pièces' : ' pièce');
      // Le message « aucune pièce ne correspond à ces filtres » suppose des cartes à filtrer : quand
      // la grille est vide dès le build (rien en vente), build.js a déjà posé son message et
      // « Tout afficher » n'aurait rien à montrer (KD-118).
      if (emptyEl) emptyEl.hidden = shown > 0 || !cards.length;

      groups.forEach(function(group) {
        var filter = group.getAttribute('data-filter');
        toArray(group.querySelectorAll('.shop-chip')).forEach(function(chip) {
          var value = chip.getAttribute('data-value');
          var pressed = selected[filter].indexOf(value) !== -1;
          chip.setAttribute('aria-pressed', pressed ? 'true' : 'false');
          var n = cards.filter(function(card) { return matches(card, { filter: filter, values: [value] }); }).length;
          var countNode = chip.querySelector('.shop-chip-count');
          if (countNode) countNode.textContent = String(n);
          chip.classList.toggle('is-empty', n === 0 && !pressed);
        });
      });

      if (activeEl) {
        activeEl.textContent = '';
        Object.keys(selected).forEach(function(filter) {
          selected[filter].forEach(function(value) {
            activeEl.appendChild(activeItem(chipLabel(filter, value), function() { toggle(filter, value); }));
          });
        });
        activeEl.hidden = !activeEl.children.length;
      }

      if (collectionEl) {
        collectionEl.hidden = !collection;
        if (collection && collectionNameEl) collectionNameEl.textContent = collectionName(collection);
      }

      writeUrl();
    }

    if (collectionClear) {
      collectionClear.addEventListener('click', function() {
        collection = null;
        render();
      });
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', function() {
        selected = { audience: [], category: [] };
        collection = null;
        render();
      });
    }

    readUrl();
    render();
  }

  // Les noms des collections sont posés par build.js dans un <script type="application/json">,
  // entre ses marqueurs de région (des commentaires HTML) : on les retire avant de lire le JSON.
  function readCollections() {
    var node = document.getElementById('shopCollections');
    if (!node) return [];
    try {
      var list = JSON.parse(node.textContent.replace(/<!--[\s\S]*?-->/g, '').trim() || '[]');
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  /* ── Page pièce : galerie ── */

  function initGallery(gallery) {
    var mainButton = gallery.querySelector('.piece-main');
    var mainImg = mainButton && mainButton.querySelector('img');
    var thumbs = toArray(gallery.querySelectorAll('.piece-thumb'));
    if (!mainImg) return;

    thumbs.forEach(function(thumb) {
      thumb.addEventListener('click', function() {
        mainImg.src = thumb.getAttribute('data-src');
        mainImg.alt = thumb.getAttribute('data-alt') || '';
        thumbs.forEach(function(t) { t.classList.toggle('is-active', t === thumb); });
      });
    });

    mainButton.addEventListener('click', function() {
      if (window.KelSite) window.KelSite.openLightbox(mainImg.src, mainImg.alt);
    });
  }

  function toArray(list) {
    return Array.prototype.slice.call(list);
  }
})();
