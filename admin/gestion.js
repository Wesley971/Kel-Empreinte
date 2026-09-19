/* Écran « Mes bijoux » — /admin/ (KD-92, cinq états avec KD-98, à /admin/ depuis KD-95).

   La liste vient de GET /api/admin/products : la vérité du dépôt, pas le data/products.json
   servi avec le site, qui a jusqu'à deux minutes de retard (le temps d'un déploiement).

   Chaque pièce a un état effectif (catalog.js : une réservation échue compte comme « en vente »)
   qui décide de son groupe — En vente, Réservées, Brouillons, Vendues, Retirées —, de sa
   pastille et des actions proposées. La pastille ouvre une feuille d'actions ; l'action la plus
   fréquente, « Marquer vendue », a son bouton sur la ligne. Les actions possibles sont celles de
   catalog.allowedTransitions, les mêmes que l'API accepte : l'écran ne propose jamais un geste
   que l'API refuserait, et l'API reste le filet.

   Réserver ne demande rien : 14 jours, calculés par l'API à l'heure de Paris. Marquer vendue
   ouvre une modale courte : montant encaissé (facultatif, réclamé ensuite), canal, date.

   Chaque écriture est optimiste, en trois temps (KD-92) :
   1. au toucher, la ligne prend l'état espéré, se verrouille, et le statut global « Mise à jour
      du site en cours » s'allume ;
   2. la réponse de PATCH /api/admin/products/:id confirme — la pièce est alors rangée dans son
      nouveau groupe — ou la ligne revient en arrière, obligatoirement, avec la raison écrite ;
   3. une fois enregistré : « Enregistré, mise en ligne dans 1 à 2 minutes. » On ne relit pas le
      site pour vérifier la mise en ligne (ce sera KD-82).

   Recherche (KD-102) : un champ en tête de liste filtre à chaque frappe sur le nom et la référence,
   mot par mot dans n'importe quel ordre, sans casse ni accents. Les groupes gardent leur ordre, les
   compteurs suivent, le résumé dit « N sur T ». Tout se passe dans la page (la liste est déjà là),
   rien n'est écrit ni mémorisé : champ vide à chaque ouverture. */

(function () {
  'use strict';

  // L'appel à l'API, la reconnexion, le toast, les feuilles et la confirmation viennent de
  // common.js (KD-93) : la fiche d'une pièce (piece.js) les partage.
  var API = '/api/admin/products';
  var catalog = window.KelCatalog;

  // Ordre des groupes de l'écran ; le libellé pluriel sert au titre et au résumé
  var GROUPS = [
    { state: 'disponible', title: 'En vente', one: 'en vente', many: 'en vente' },
    { state: 'reservee', title: 'Réservées', one: 'réservée', many: 'réservées' },
    { state: 'brouillon', title: 'Brouillons', one: 'brouillon', many: 'brouillons' },
    { state: 'vendue', title: 'Vendues', one: 'vendue', many: 'vendues' },
    { state: 'retiree', title: 'Retirées', one: 'retirée', many: 'retirées' }
  ];
  var BLOCKER_WORDS = { photo: 'photo', prix: 'prix', nom: 'nom', type: 'type', public: 'public' };
  var NETWORK_MESSAGE = 'Connexion impossible. Vérifiez votre réseau, puis rechargez la page : elle affichera l\'état réellement enregistré.';

  var els = {
    groups: document.getElementById('groups'),
    loading: document.getElementById('loading'),
    error: document.getElementById('error'),
    errorText: document.getElementById('error-text'),
    retry: document.getElementById('retry'),
    summary: document.getElementById('summary'),
    status: document.getElementById('status'),
    toast: document.getElementById('toast'),
    rowTemplate: document.getElementById('row-template'),
    groupTemplate: document.getElementById('group-template'),
    sheet: document.getElementById('sheet'),
    sheetTitle: document.getElementById('sheet-title'),
    sheetState: document.getElementById('sheet-state'),
    sheetActions: document.getElementById('sheet-actions'),
    confirm: document.getElementById('confirm'),
    confirmTitle: document.getElementById('confirm-title'),
    confirmText: document.getElementById('confirm-text'),
    confirmOk: document.getElementById('confirm-ok'),
    sale: document.getElementById('sale'),
    saleForm: document.getElementById('sale-form'),
    saleTitle: document.getElementById('sale-title'),
    salePiece: document.getElementById('sale-piece'),
    saleAmount: document.getElementById('sale-amount'),
    saleChannels: document.getElementById('sale-channels'),
    saleDate: document.getElementById('sale-date'),
    saleError: document.getElementById('sale-error'),
    saleCancel: document.getElementById('sale-cancel'),
    searchForm: document.getElementById('search-form'),
    search: document.getElementById('search'),
    searchClear: document.getElementById('search-clear'),
    empty: document.getElementById('empty'),
    emptyText: document.getElementById('empty-text'),
    emptyClear: document.getElementById('empty-clear'),
    add: document.getElementById('add'),
    addSheet: document.getElementById('add-sheet'),
    addCopy: document.getElementById('add-copy'),
    addNew: document.getElementById('add-new'),
    pick: document.getElementById('pick'),
    pickCancel: document.getElementById('pick-cancel')
  };

  var products = [];   // la liste telle que l'API l'a donnée, mise à jour par ses réponses
  var rows = {};       // id → <li> affiché
  var inflight = {};   // id → état espéré d'une écriture en vol : un rendu complet le garde, verrou compris
  var rowErrors = {};  // id → raison du dernier refus : un rendu complet (une frappe) ne l'efface pas
  var query = '';      // la recherche en cours, telle que tapée
  var pending = 0;     // écritures en vol : le statut global reste allumé tant qu'il y en a
  var picking = false; // « Copier une pièce existante » : le prochain nom touché est la pièce à copier

  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }

  var admin = window.KelAdmin;
  if (!admin) {
    hide(els.loading);
    els.errorText.textContent = 'Le script de l\'espace de gestion n\'a pas pu être chargé. Rechargez la page.';
    show(els.error);
    return;
  }
  var ApiError = admin.ApiError;
  var SessionExpired = admin.SessionExpired;
  var api = admin.api;
  var showToast = admin.createToast(els.toast);
  var dialogs = admin.createDialogs([els.sheet, els.confirm, els.sale, els.addSheet], showToast);
  var openConfirm = admin.createConfirm({ dialog: els.confirm, title: els.confirmTitle, text: els.confirmText, ok: els.confirmOk }, dialogs);
  var openDialog = dialogs.open;
  var closeDialog = dialogs.close;

  // Session Access expirée : common.js recharge la page ; si ça vient d'être fait, on l'écrit ici
  function reconnect() {
    admin.reconnect({
      toast: showToast,
      onBlocked: function (message) {
        hide(els.loading);
        els.errorText.textContent = message;
        show(els.error);
      }
    });
  }

  /* ── Chargement ── */

  function load() {
    show(els.loading);
    hide(els.error);
    hide(els.searchForm);
    hide(els.empty);
    rowErrors = {}; // la liste revient du serveur : les refus d'avant ne la décrivent plus
    els.groups.textContent = '';
    els.summary.textContent = '';
    api(API)
      .then(function (data) {
        hide(els.loading);
        products = data.products;
        els.searchForm.hidden = !products.length;
        els.add.hidden = false;
        render();
        afterForm();
      })
      .catch(function (err) {
        hide(els.loading);
        if (err instanceof SessionExpired) return reconnect();
        els.errorText.textContent = err instanceof ApiError ? err.message : NETWORK_MESSAGE;
        show(els.error);
      });
  }

  /* ── Rendu ── */

  function stateOf(product) { return catalog.effectiveAvailability(product); }

  // Toute la liste, groupée par état effectif, réduite aux pièces qui répondent à la recherche :
  // une pièce qui change d'état change de groupe, un groupe sans pièce n'apparaît pas. Rendu complet
  // à chaque fois (chargement, réponse d'une écriture, frappe) : une centaine de lignes, quelques
  // millisecondes.
  function render() {
    var words = queryWords(query);
    var filtering = words.length > 0;
    var fragment = document.createDocumentFragment();
    var counts = {};
    var matched = 0;
    rows = {};
    // Une passe : l'état effectif (Intl, à chaque appel) et la correspondance sont jugés une fois par
    // pièce, pas une fois par groupe — c'est ce qui coûte, pas les lignes
    var byState = {};
    products.forEach(function (p) {
      if (filtering && !matches(p, words)) return;
      var state = stateOf(p);
      (byState[state] = byState[state] || []).push(p);
    });
    GROUPS.forEach(function (group) {
      var members = byState[group.state] || [];
      counts[group.state] = members.length;
      matched += members.length;
      if (!members.length) return;
      var section = els.groupTemplate.content.firstElementChild.cloneNode(true);
      section.dataset.state = group.state;
      section.querySelector('.kel-group-name').textContent = group.title;
      section.querySelector('.kel-group-count').textContent = String(members.length);
      var list = section.querySelector('.kel-list');
      list.setAttribute('aria-label', group.title);
      members.forEach(function (product) {
        var row = renderRow(product);
        rows[product.id] = row;
        list.appendChild(row);
      });
      fragment.appendChild(section);
    });
    els.groups.textContent = '';
    els.groups.appendChild(fragment);
    updateSummary(counts, matched, filtering);
    updateEmpty(filtering && !matched);
  }

  function renderRow(product) {
    var row = els.rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.id = product.id;
    var name = row.querySelector('.kel-row-name');
    name.textContent = product.name;
    name.href = pieceUrl(product.id, picking ? 'from' : 'id');
    // En mode « copier », toute la ligne choisit la pièce
    row.addEventListener('click', function () { if (picking) window.location.assign(pieceUrl(product.id, 'from')); });

    if (catalog.hasPhoto(product)) {
      var img = document.createElement('img');
      img.src = '/' + catalog.normalizeImagePath(product.images[0].src);
      img.alt = '';
      img.loading = 'lazy';
      img.width = 52;
      img.height = 52;
      // Pas encore servie (le build suit chaque enregistrement, brouillon compris) : la case garde
      // son fond et la ligne le dit, plutôt qu'une image cassée (recette du 19/09)
      img.addEventListener('error', function () {
        img.remove();
        var pending = row.querySelector('.kel-row-pending');
        pending.textContent = 'Photo en cours de mise en ligne.';
        show(pending);
      });
      row.querySelector('.kel-row-photo').appendChild(img);
    }

    row.querySelector('.kel-state').addEventListener('click', function () { openSheet(product); });
    row.querySelector('.kel-quick').addEventListener('click', function () { openSale(product, null); });

    // Une écriture en cours sur cette pièce (le rendu vient du succès d'une autre) garde son état
    // espéré et son verrou jusqu'à sa propre réponse
    applyState(row, inflight[product.id] || product);
    if (inflight[product.id]) setBusy(row, true);
    if (rowErrors[product.id]) {
      var errorEl = row.querySelector('.kel-row-error');
      errorEl.textContent = rowErrors[product.id];
      show(errorEl);
    }
    return row;
  }

  // Référence · type · prix (barré + promo) — construit en DOM : rien de ce que Prescilia écrit
  // ne passe par du HTML
  function fillMeta(el, product) {
    el.textContent = '';
    var parts = [];
    if (product.reference) parts.push(document.createTextNode(product.reference));
    var type = catalog.categoryLabel(product.category);
    if (type) parts.push(document.createTextNode(type));
    if (catalog.hasPrice(product)) {
      var price = document.createElement('span');
      if (catalog.hasPromo(product)) {
        var old = document.createElement('s');
        old.textContent = catalog.formatOriginalPrice(product);
        price.appendChild(old);
        price.appendChild(document.createTextNode(' '));
      }
      price.appendChild(document.createTextNode(catalog.formatPrice(product)));
      parts.push(price);
    }
    parts.forEach(function (part, i) {
      if (i) el.appendChild(document.createTextNode('\u00a0· '));
      el.appendChild(part);
    });
  }

  // La pastille dit l'état, en un mot ; le détail a sa ligne sous le nom
  function stateText(state) {
    return catalog.STATE_LABELS[state] || state;
  }

  // Ce qu'il faut savoir de plus, d'un coup d'œil : jusqu'à quand, vendue quand et comment,
  // revenue en vente toute seule quand. Vide quand l'état se suffit.
  function detailText(product, state) {
    if (state === 'reservee') {
      var until = catalog.parseIsoDate(product.reservedUntil);
      return until ? 'Réservée jusqu\'au ' + catalog.formatDay(until, true) + ' inclus' : '';
    }
    if (state === 'vendue') return catalog.formatSale(product, true);
    if (catalog.isReservationExpired(product)) return catalog.formatReturnedToSale(product);
    return '';
  }

  // Un seul endroit traduit une pièce en ligne d'écran : au rendu, après un toucher (état
  // espéré), après la réponse (état confirmé) ou après un échec (état d'avant).
  function applyState(row, product) {
    var state = stateOf(product);
    row.dataset.availability = state;
    fillMeta(row.querySelector('.kel-row-meta'), product);

    var detail = detailText(product, state);
    var stateButton = row.querySelector('.kel-state');
    stateButton.querySelector('.kel-state-text').textContent = stateText(state);
    stateButton.setAttribute('aria-label', product.name + ' : ' + (detail || stateText(state)) + '. Ouvrir les actions.');

    // La ligne de détail : date de réservation, vente, ou remise en vente automatique
    var note = row.querySelector('.kel-row-note');
    note.textContent = detail;
    note.hidden = !detail;

    // Brouillon incomplet : ce qui manque, écrit sous le nom
    var hint = row.querySelector('.kel-row-hint');
    var blockers = state === 'brouillon' ? catalog.saleBlockers(product) : [];
    if (blockers.length) {
      hint.textContent = 'À compléter : ' + blockers.map(function (b) { return BLOCKER_WORDS[b] || b; }).join(', ').replace(/, ([^,]*)$/, ' et $1') + '.';
      show(hint);
    } else {
      hide(hint);
    }

    // « Marquer vendue » à un tap, seulement là où ça a un sens
    var quick = row.querySelector('.kel-quick');
    quick.hidden = !(state === 'disponible' || state === 'reservee');
    quick.setAttribute('aria-label', 'Marquer vendue : ' + product.name);
  }

  function setBusy(row, busy) {
    row.setAttribute('aria-busy', busy ? 'true' : 'false');
    Array.prototype.forEach.call(row.querySelectorAll('button'), function (button) { button.disabled = busy; });
  }

  function isBusy(row) { return row.getAttribute('aria-busy') === 'true'; }

  /* ── Feuille d'actions ── */

  // Les actions par état effectif, dans l'ordre d'affichage. `target` est l'état demandé à l'API ;
  // `confirm` ouvre une confirmation d'une phrase ; `sale` ouvre la modale de vente.
  function actionsFor(product) {
    var state = stateOf(product);
    var today = catalog.todayInParis();
    var until = catalog.reservationEnd(today);
    var actions = [];
    if (state === 'disponible') {
      actions.push({
        label: 'Réserver 14 jours', target: 'reservee',
        detail: 'Jusqu\'au ' + catalog.formatDay(catalog.parseIsoDate(until)) + ' inclus, retour en vente au matin du ' + catalog.formatDay(catalog.parseIsoDate(catalog.addDays(until, 1))) + '.',
        confirm: { title: 'Réserver 14 jours ?', text: 'La pièce sera réservée jusqu\'au ' + catalog.formatDay(catalog.parseIsoDate(until)) + ' inclus et reviendra en vente au matin du ' + catalog.formatDay(catalog.parseIsoDate(catalog.addDays(until, 1))) + ' si elle n\'est pas payée.', ok: 'Réserver' }
      });
      actions.push({ label: 'Marquer vendue', sale: true, detail: 'Montant encaissé, canal et date.' });
      actions.push({
        label: 'Retirer du site', target: 'retiree', detail: 'Cassée, offerte, gardée : elle disparaît du site, vous pourrez la remettre en vente.',
        confirm: { title: 'Retirer du site ?', text: 'La pièce ne sera plus visible sur le site. Elle reste dans vos bijoux, avec sa référence, et vous pourrez la remettre en vente.', ok: 'Retirer' }
      });
    } else if (state === 'reservee') {
      actions.push({ label: 'Marquer vendue', sale: true, detail: 'La cliente a payé.' });
      actions.push({
        label: 'Remettre en vente', target: 'disponible', detail: 'La cliente renonce : la réservation est annulée tout de suite.',
        confirm: { title: 'Annuler la réservation ?', text: 'La pièce sera de nouveau en vente sur le site dès la prochaine mise en ligne, sans attendre la fin des 14 jours.', ok: 'Remettre en vente' }
      });
    } else if (state === 'vendue') {
      if (!catalog.isSaleComplete(product)) actions.push({ label: 'Compléter la vente', sale: true, detail: 'Le montant encaissé manque.' });
      actions.push({
        label: 'Remettre en vente', target: 'disponible', detail: 'Erreur de manipulation : la vente enregistrée sera effacée.',
        confirm: { title: 'Remettre en vente ?', text: 'Cette pièce a été marquée vendue. La remettre en vente effacera la vente enregistrée (montant, canal, date).', ok: 'Remettre en vente' }
      });
    } else if (state === 'brouillon') {
      var blockers = catalog.saleBlockers(product);
      actions.push({ label: 'Mettre en vente', target: 'disponible', detail: blockers.length ? catalog.describeSaleBlockers(blockers) : 'Elle apparaîtra en boutique à la prochaine mise en ligne.', disabled: blockers.length > 0 });
    } else if (state === 'retiree') {
      actions.push({ label: 'Remettre en vente', target: 'disponible', detail: 'Elle réapparaîtra en boutique à la prochaine mise en ligne.' });
    }
    // Le filet : jamais une action que l'API refuserait
    return actions.filter(function (action) { return action.sale || catalog.canTransition(product, action.target); });
  }

  function openSheet(product) {
    var row = rows[product.id];
    if (row && isBusy(row)) return;
    els.sheetTitle.textContent = product.name;
    // Le détail commence déjà par l'état (« Réservée jusqu'au… », « Vendue le… »), sauf la remise en vente
    var state = stateOf(product);
    var detail = detailText(product, state);
    els.sheetState.textContent = !detail ? stateText(state) : (state === 'disponible' ? stateText(state) + ' · ' + detail : detail);
    els.sheetActions.textContent = '';
    var open = [
      { label: 'Modifier la fiche', href: pieceUrl(product.id, 'id'), detail: 'Photos, nom, référence, description, prix…' },
      { label: 'Dupliquer', href: pieceUrl(product.id, 'from'), detail: 'Une nouvelle pièce à partir de celle-ci, sans ses photos ni son nom.' }
    ];
    open.concat(actionsFor(product)).forEach(function (action) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'kel-action' + (action.target === 'retiree' ? ' kel-action--quiet' : '');
      button.disabled = !!action.disabled;
      var label = document.createElement('span');
      label.className = 'kel-action-label';
      label.textContent = action.label;
      button.appendChild(label);
      if (action.detail) {
        var detailEl = document.createElement('span');
        detailEl.className = 'kel-action-detail';
        detailEl.textContent = action.detail;
        button.appendChild(detailEl);
      }
      button.addEventListener('click', function () {
        closeDialog(els.sheet);
        if (action.href) return window.location.assign(action.href);
        if (action.sale) return openSale(product, product.sale || null);
        if (action.confirm) return openConfirm(action.confirm, function () { submit(product, action.target, null); });
        submit(product, action.target, null);
      });
      els.sheetActions.appendChild(button);
    });
    openDialog(els.sheet, row && row.querySelector('.kel-state'));
  }

  /* ── Marquer vendue ── */

  var saleProduct = null;

  // Les canaux viennent de catalog.js : le même vocabulaire que le fichier et le build
  function buildChannels() {
    els.saleChannels.textContent = '';
    catalog.CHANNELS.forEach(function (channel) {
      var label = document.createElement('label');
      label.className = 'kel-choice';
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'channel';
      input.value = channel.id;
      var text = document.createElement('span');
      text.textContent = channel.label;
      label.appendChild(input);
      label.appendChild(text);
      els.saleChannels.appendChild(label);
    });
  }

  function openSale(product, existing) {
    var row = rows[product.id];
    if (row && isBusy(row)) return;
    saleProduct = product;
    var today = catalog.todayInParis();
    els.saleTitle.textContent = existing ? 'Compléter la vente' : 'Marquer vendue';
    els.salePiece.textContent = product.name + (catalog.hasPrice(product) ? ' · prix affiché ' + catalog.formatPrice(product) : '');
    els.saleAmount.value = existing && typeof existing.amount === 'number' ? String(existing.amount).replace('.', ',') : '';
    Array.prototype.forEach.call(els.saleChannels.querySelectorAll('input'), function (input) {
      input.checked = !!existing && existing.channel === input.value;
    });
    els.saleDate.max = today;
    els.saleDate.value = existing && existing.date ? existing.date : today;
    hide(els.saleError);
    openDialog(els.sale, row && row.querySelector('.kel-quick'));
    els.saleAmount.focus();
  }

  // « 45 », « 12,50 », « 12.5 €  » → nombre ; vide → null ; autre chose → NaN
  function parseAmount(text) {
    var cleaned = String(text || '').replace(/\s|€/g, '').replace(',', '.');
    if (!cleaned) return null;
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return NaN;
    return Math.round(Number(cleaned) * 100) / 100;
  }

  els.saleForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var product = saleProduct;
    if (!product) return;
    var amount = parseAmount(els.saleAmount.value);
    var channel = (els.saleChannels.querySelector('input:checked') || {}).value;
    var date = els.saleDate.value;
    var problem = '';
    if (Number.isNaN(amount)) problem = 'Montant : un nombre, comme 45 ou 12,50 — ou laissez vide pour le compléter plus tard.';
    else if (!channel) problem = 'Choisissez où la pièce a été vendue.';
    else if (!catalog.parseIsoDate(date)) problem = 'Indiquez la date de la vente.';
    else if (catalog.isFutureDay(date)) problem = 'La date de la vente ne peut pas être dans le futur.';
    if (problem) {
      els.saleError.textContent = problem;
      show(els.saleError);
      return;
    }
    closeDialog(els.sale);
    submit(product, 'vendue', { amount: amount, channel: channel, date: date });
  });

  els.saleCancel.addEventListener('click', function () { closeDialog(els.sale); });

  /* ── Écriture ── */

  // L'état espéré, pour l'affichage immédiat : ce que l'API écrira si elle accepte
  function expected(product, target, sale) {
    var next = Object.assign({}, product, { availability: target });
    delete next.reservedUntil;
    delete next.sale;
    if (target === 'reservee') next.reservedUntil = catalog.reservationEnd(catalog.todayInParis());
    if (target === 'vendue' && (sale || product.sale)) next.sale = sale || product.sale;
    return next;
  }

  // La réponse fait foi : la pièce prend exactement ce que l'API a écrit (clés retirées comprises)
  function replaceWith(product, fresh) {
    Object.keys(product).forEach(function (key) { if (!(key in fresh)) delete product[key]; });
    Object.assign(product, fresh);
  }

  function submit(product, target, sale) {
    var row = rows[product.id];
    if (!row || isBusy(row)) return;
    var errorEl = row.querySelector('.kel-row-error');

    // 1. Tout de suite
    hide(errorEl);
    delete rowErrors[product.id];
    inflight[product.id] = expected(product, target, sale);
    applyState(row, inflight[product.id]);
    setBusy(row, true);
    beginPending();

    var body = { availability: target };
    if (sale) body.sale = sale;
    api(API + '/' + encodeURIComponent(product.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (data) {
        // 2. Confirmé : la pièce suit la réponse, pas ce qu'elle espérait, et rejoint son groupe
        delete inflight[product.id];
        replaceWith(product, data.product);
        endPending();
        render();
        // 3. Et ensuite
        showToast(data.unchanged ? 'Cette pièce était déjà dans cet état.' : 'Enregistré, mise en ligne dans 1 à 2 minutes.');
      })
      .catch(function (err) {
        // 2 bis. Refusé ou injoignable : retour en arrière, obligatoire, et la raison — sur la ligne
        // affichée maintenant (un rendu complet a pu remplacer celle du toucher)
        delete inflight[product.id];
        var current = rows[product.id] || row;
        applyState(current, product);
        setBusy(current, false);
        endPending();
        if (err instanceof SessionExpired) return reconnect();
        rowErrors[product.id] = err instanceof ApiError ? err.message : NETWORK_MESSAGE;
        var currentError = current.querySelector('.kel-row-error');
        currentError.textContent = rowErrors[product.id];
        show(currentError);
      });
  }

  function beginPending() {
    pending++;
    show(els.status);
  }

  function endPending() {
    pending = Math.max(0, pending - 1);
    if (!pending) hide(els.status);
  }

  /* ── Affichage ── */

  // « 12 en vente · 1 réservée · 3 vendues » : les groupes vides ne sont pas cités. Sous filtre :
  // « 2 sur 17 » — le filtre actif et le total restent visibles (des pièces ne « disparaissent »
  // pas), la répartition par état est portée par les compteurs de groupe.
  function updateSummary(counts, matched, filtering) {
    if (filtering) {
      els.summary.textContent = matched + ' sur ' + products.length;
      return;
    }
    var parts = [];
    GROUPS.forEach(function (group) {
      var n = counts[group.state] || 0;
      if (n || group.state === 'disponible') parts.push(n + ' ' + (n > 1 ? group.many : group.one));
    });
    els.summary.textContent = parts.join(' · ');
  }

  function updateEmpty(visible) {
    els.emptyText.textContent = visible ? 'Aucune pièce ne correspond à «\u00a0' + query.trim() + '\u00a0».' : '';
    els.empty.hidden = !visible;
  }

  /* ── Recherche ── */

  // Un texte prêt à être comparé : sans accents (décomposition NFD, marques diacritiques retirées)
  // et en minuscules. Sans « normalize » (navigateur ancien), la casse seule est neutralisée — la
  // recherche marche, aux accents près.
  function fold(text) {
    var value = String(text == null ? '' : text);
    if (typeof value.normalize === 'function') value = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return value.toLowerCase();
  }

  // Les mots de la saisie, pliés : « Velours  Herbier » → ['velours', 'herbier']
  function queryWords(text) {
    return fold(text).split(/\s+/).filter(Boolean);
  }

  // Une pièce correspond si chacun des mots est dans son nom ou dans sa référence, dans n'importe
  // quel ordre (« velours herbier » trouve « Herbier Jaune Velours »). La référence se compare comme
  // build.js la dédoublonne (catalog.normalizeReference : « bo-023 » = « BO023 ») ; un mot qui n'y
  // laisse rien (« é ») ne la consulte pas, sinon il correspondrait à toutes.
  function matches(product, words) {
    var name = fold(product.name);
    var reference = catalog.normalizeReference(product.reference);
    return words.every(function (word) {
      if (name.indexOf(word) !== -1) return true;
      var ref = catalog.normalizeReference(word);
      return ref !== '' && reference.indexOf(ref) !== -1;
    });
  }

  function setQuery(text) {
    query = text;
    els.searchClear.hidden = !query;
    render();
  }

  // La croix vide et redonne le champ (clavier ouvert, prête à retaper) ; le bouton de l'état vide
  // rend la liste sans rouvrir le clavier
  function clearSearch(refocus) {
    els.search.value = '';
    setQuery('');
    if (refocus) els.search.focus();
  }

  els.search.addEventListener('input', function () { setQuery(els.search.value); });
  // « Rechercher » sur le clavier : rien à envoyer, on replie le clavier pour voir les résultats
  els.searchForm.addEventListener('submit', function (event) { event.preventDefault(); els.search.blur(); });
  els.searchClear.addEventListener('click', function () { clearSearch(true); });
  els.emptyClear.addEventListener('click', function () { clearSearch(false); });

  /* ── Ajouter une pièce, copier une pièce (KD-93) ── */

  function pieceUrl(id, param) {
    return '/admin/piece?' + param + '=' + encodeURIComponent(id);
  }

  // En mode « copier », le nom de chaque ligne mène à la copie (rendu avec picking = true), le
  // bandeau dit quoi faire, les boutons d'état s'effacent
  function setPicking(on) {
    picking = on;
    els.pick.hidden = !on;
    document.body.classList.toggle('kel-picking', on);
    render();
    if (on) window.scrollTo({ top: 0, behavior: 'instant' });
  }

  els.add.addEventListener('click', function () { openDialog(els.addSheet, els.add); });
  els.addNew.addEventListener('click', function () { closeDialog(els.addSheet); window.location.assign('/admin/piece'); });
  els.addCopy.addEventListener('click', function () {
    closeDialog(els.addSheet);
    if (!products.length) return showToast('Aucune pièce à copier pour l\'instant.');
    setPicking(true);
  });
  els.pickCancel.addEventListener('click', function () { setPicking(false); });

  // Retour de la fiche : ?saved=<id>&state=<état> ou ?deleted=<nom> — le toast, la pièce mise en
  // évidence, et l'adresse nettoyée pour qu'un rechargement ne répète pas le message
  function afterForm() {
    var params = new URLSearchParams(window.location.search);
    var saved = params.get('saved');
    var deleted = params.get('deleted');
    if (!saved && !deleted) return;
    window.history.replaceState(null, '', window.location.pathname);
    if (deleted) return showToast('Brouillon « ' + deleted + ' » supprimé.');
    showToast(params.get('state') === 'brouillon' ? 'Brouillon enregistré. Il n\'est pas sur le site.' : 'Enregistré, mise en ligne dans 1 à 2 minutes.');
    var row = rows[saved];
    if (!row) return;
    row.classList.add('kel-row--saved');
    row.scrollIntoView({ block: 'center' });
    window.setTimeout(function () { row.classList.remove('kel-row--saved'); }, 4000);
  }

  /* ── Démarrage ── */

  if (!catalog) {
    hide(els.loading);
    els.errorText.textContent = 'Le script du catalogue n\'a pas pu être chargé. Rechargez la page.';
    show(els.error);
    return;
  }
  buildChannels();
  els.retry.addEventListener('click', load);
  load();
}());
