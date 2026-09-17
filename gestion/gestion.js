/* Écran « Mes bijoux » — /gestion/ (KD-92, cinq états avec KD-98).

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
      site pour vérifier la mise en ligne (ce sera KD-82). */

(function () {
  'use strict';

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
    saleCancel: document.getElementById('sale-cancel')
  };

  var products = [];   // la liste telle que l'API l'a donnée, mise à jour par ses réponses
  var rows = {};       // id → <li> affiché
  var inflight = {};   // id → état espéré d'une écriture en vol : un rendu complet le garde, verrou compris
  var pending = 0;     // écritures en vol : le statut global reste allumé tant qu'il y en a
  var toastTimer = null;

  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }

  function ApiError(status, message) {
    this.name = 'ApiError';
    this.status = status;
    this.message = message;
  }
  ApiError.prototype = Object.create(Error.prototype);

  function SessionExpired() {
    this.name = 'SessionExpired';
    this.message = 'session expirée';
  }
  SessionExpired.prototype = Object.create(Error.prototype);

  /* ── Appels à l'API ── */

  // redirect: 'manual' : une session Access expirée répond par une redirection vers la page de
  // connexion. Suivie, elle finirait en erreur CORS, indiscernable d'une panne réseau. Non
  // suivie, elle se voit (type opaqueredirect) et on recharge la page : Access redemande le
  // code et ramène ici. Une réponse qui n'est pas du JSON (page Access, page d'erreur) et un 401
  // du middleware (jeton refusé) sont traités de la même façon : la session est à refaire.
  function api(path, init) {
    init = init || {};
    var headers = Object.assign({ Accept: 'application/json' }, init.headers || {});
    return fetch(path, Object.assign({}, init, { headers: headers, redirect: 'manual', credentials: 'same-origin' }))
      .then(function (response) {
        if (response.type === 'opaqueredirect' || response.status === 0 || response.status === 401) throw new SessionExpired();
        var type = response.headers.get('Content-Type') || '';
        if (type.indexOf('application/json') === -1) throw new SessionExpired();
        return response.json().then(function (body) {
          if (!response.ok) throw new ApiError(response.status, body && body.error ? body.error : 'Une erreur est survenue.');
          return body;
        });
      });
  }

  // Recharge la page pour repasser par Access. Garde-fou : si la page vient déjà d'être
  // rechargée pour ça, on n'insiste pas — une boucle de rechargements serait pire qu'un message.
  function reconnect() {
    var key = 'kel-gestion-reconnect-at';
    var last = 0;
    try { last = Number(window.sessionStorage.getItem(key)) || 0; } catch (_) { /* stockage indisponible */ }
    if (Date.now() - last < 30000) {
      hide(els.loading);
      els.errorText.textContent = 'Impossible de vérifier votre connexion. Fermez cette page et rouvrez-la.';
      show(els.error);
      return;
    }
    try { window.sessionStorage.setItem(key, String(Date.now())); } catch (_) { /* idem */ }
    showToast('Votre session a expiré. Reconnexion…');
    window.setTimeout(function () { window.location.reload(); }, 1500);
  }

  /* ── Chargement ── */

  function load() {
    show(els.loading);
    hide(els.error);
    els.groups.textContent = '';
    els.summary.textContent = '';
    api(API)
      .then(function (data) {
        hide(els.loading);
        products = data.products;
        render();
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

  // Toute la liste, groupée par état effectif : une pièce qui change d'état change de groupe.
  // Les groupes vides n'apparaissent pas. Rendu complet à chaque fois : la liste est courte.
  function render() {
    var fragment = document.createDocumentFragment();
    var counts = {};
    rows = {};
    GROUPS.forEach(function (group) {
      var members = products.filter(function (p) { return stateOf(p) === group.state; });
      counts[group.state] = members.length;
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
    updateSummary(counts);
  }

  function renderRow(product) {
    var row = els.rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.id = product.id;
    row.querySelector('.kel-row-name').textContent = product.name;

    if (catalog.hasPhoto(product)) {
      var img = document.createElement('img');
      img.src = '/' + catalog.normalizeImagePath(product.images[0].src);
      img.alt = '';
      img.loading = 'lazy';
      img.width = 52;
      img.height = 52;
      row.querySelector('.kel-row-photo').appendChild(img);
    }

    row.querySelector('.kel-state').addEventListener('click', function () { openSheet(product); });
    row.querySelector('.kel-quick').addEventListener('click', function () { openSale(product, null); });

    // Une écriture en cours sur cette pièce (le rendu vient du succès d'une autre) garde son état
    // espéré et son verrou jusqu'à sa propre réponse
    applyState(row, inflight[product.id] || product);
    if (inflight[product.id]) setBusy(row, true);
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
    actionsFor(product).forEach(function (action) {
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
        if (action.sale) return openSale(product, product.sale || null);
        if (action.confirm) return openConfirm(action.confirm, function () { submit(product, action.target, null); });
        submit(product, action.target, null);
      });
      els.sheetActions.appendChild(button);
    });
    openDialog(els.sheet, row && row.querySelector('.kel-state'));
  }

  /* ── Confirmation ── */

  var confirmCallback = null;

  function openConfirm(options, onOk) {
    els.confirmTitle.textContent = options.title;
    els.confirmText.textContent = options.text;
    els.confirmOk.textContent = options.ok;
    confirmCallback = onOk;
    openDialog(els.confirm);
  }

  els.confirm.addEventListener('close', function () {
    var callback = confirmCallback;
    confirmCallback = null;
    if (els.confirm.returnValue === 'ok' && callback) callback();
    els.confirm.returnValue = '';
  });

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

  /* ── Dialogues (feuilles en bas d'écran) ── */

  var returnFocusTo = null;

  function openDialog(dialog, opener) {
    returnFocusTo = opener || document.activeElement;
    if (typeof dialog.showModal !== 'function') {
      showToast('Votre navigateur est trop ancien pour cet écran. Mettez-le à jour.');
      return;
    }
    dialog.showModal();
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
  }

  [els.sheet, els.confirm, els.sale].forEach(function (dialog) {
    // Toucher le fond ferme la feuille
    dialog.addEventListener('click', function (event) { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', function () {
      if (returnFocusTo && document.body.contains(returnFocusTo) && typeof returnFocusTo.focus === 'function') returnFocusTo.focus();
      returnFocusTo = null;
    });
  });

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
        var currentError = current.querySelector('.kel-row-error');
        currentError.textContent = err instanceof ApiError ? err.message : NETWORK_MESSAGE;
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

  function showToast(message) {
    els.toast.textContent = message;
    show(els.toast);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { hide(els.toast); }, 5000);
  }

  // « 12 en vente · 1 réservée · 3 vendues » : les groupes vides ne sont pas cités
  function updateSummary(counts) {
    var parts = [];
    GROUPS.forEach(function (group) {
      var n = counts[group.state] || 0;
      if (n || group.state === 'disponible') parts.push(n + ' ' + (n > 1 ? group.many : group.one));
    });
    els.summary.textContent = parts.join(' · ');
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
