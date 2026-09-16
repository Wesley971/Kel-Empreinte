/* Écran « Mes bijoux » — /gestion/ (KD-92).

   La liste vient de GET /api/admin/products : la vérité du dépôt, pas le data/products.json
   servi avec le site, qui a jusqu'à deux minutes de retard (le temps d'un déploiement).

   L'interrupteur « En vente » est optimiste, en trois temps :
   1. au toucher, l'écran bascule tout de suite, l'interrupteur se verrouille et le statut
      global « Mise à jour du site en cours » s'allume ;
   2. la réponse de PATCH /api/admin/products/:id confirme l'état — ou l'écran revient en
      arrière, obligatoirement, avec la raison écrite sous la pièce ;
   3. une fois enregistré : « Enregistré, mise en ligne dans 1 à 2 minutes. » On ne relit pas le
      site pour vérifier la mise en ligne (ce sera KD-82).

   Les règles d'état (quand une pièce peut passer en vente) sont celles de catalog.js, les
   mêmes que l'API : l'écran ne propose jamais une action que l'API refuserait — l'interrupteur
   d'une pièce sans photo ou sans prix est désactivé, la raison est affichée. L'API reste le
   filet. Deux libellés distincts pour une pièce éteinte : « Bientôt (pas encore de photo) »
   et « Vendue » — deux situations différentes, Prescilia doit voir laquelle. */

(function () {
  'use strict';

  var API = '/api/admin/products';
  var catalog = window.KelCatalog;

  // Mots de l'ancien CMS (admin/config.yml), déjà validés avec Prescilia
  var STATE_LABELS = { disponible: 'En vente', bientot: 'Bientôt (pas encore de photo)', vendue: 'Vendue' };
  var CATEGORY_LABELS = { 'boucles-oreilles': "Boucles d'oreilles", noeud: 'Nœud', pendentif: 'Pendentif', bracelet: 'Bracelet', bague: 'Bague' };
  var BLOCKER_WORDS = { photo: 'photo', prix: 'prix' };
  var NETWORK_MESSAGE = 'Connexion impossible. Vérifiez votre réseau, puis rechargez la page : elle affichera l\'état réellement enregistré.';

  var els = {
    list: document.getElementById('list'),
    loading: document.getElementById('loading'),
    error: document.getElementById('error'),
    errorText: document.getElementById('error-text'),
    retry: document.getElementById('retry'),
    summary: document.getElementById('summary'),
    status: document.getElementById('status'),
    toast: document.getElementById('toast'),
    template: document.getElementById('row-template')
  };

  var pending = 0;      // écritures en vol : le statut global reste allumé tant qu'il y en a
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

  /* ── Chargement de la liste ── */

  function load() {
    show(els.loading);
    hide(els.error);
    els.list.textContent = '';
    els.summary.textContent = '';
    api(API)
      .then(function (data) {
        hide(els.loading);
        var fragment = document.createDocumentFragment();
        data.products.forEach(function (product) { fragment.appendChild(renderRow(product)); });
        els.list.appendChild(fragment);
        updateSummary();
      })
      .catch(function (err) {
        hide(els.loading);
        if (err instanceof SessionExpired) return reconnect();
        els.errorText.textContent = err instanceof ApiError ? err.message : NETWORK_MESSAGE;
        show(els.error);
      });
  }

  function renderRow(product) {
    var row = els.template.content.firstElementChild.cloneNode(true);
    row.dataset.id = product.id;
    row.querySelector('.kel-row-name').textContent = product.name;
    row.querySelector('.kel-row-meta').textContent = [CATEGORY_LABELS[product.category] || product.category, catalog.formatPrice(product)]
      .filter(Boolean).join(' · ');

    if (catalog.hasPhoto(product)) {
      var img = document.createElement('img');
      img.src = '/' + catalog.normalizeImagePath(product.images[0].src);
      img.alt = '';
      img.loading = 'lazy';
      img.width = 56;
      img.height = 56;
      row.querySelector('.kel-row-photo').appendChild(img);
    }

    var toggle = row.querySelector('.kel-switch');
    toggle.setAttribute('aria-label', 'En vente : ' + product.name);
    toggle.addEventListener('click', function () { onToggle(row, product); });

    applyState(row, product);
    return row;
  }

  // Un seul endroit traduit une pièce en état d'écran : après un toucher (état espéré), après
  // la réponse (état confirmé) ou après un échec (état d'avant).
  function applyState(row, product) {
    row.dataset.availability = product.availability;
    var onSale = product.availability === 'disponible';

    // La ligne d'état explique pourquoi une pièce est éteinte ; allumée, l'interrupteur suffit
    var state = row.querySelector('.kel-row-state');
    state.textContent = STATE_LABELS[product.availability] || product.availability;
    state.hidden = onSale;

    var toggle = row.querySelector('.kel-switch');
    toggle.setAttribute('aria-checked', onSale ? 'true' : 'false');

    // Éteinte et impossible à allumer : interrupteur désactivé, raison écrite sous le nom
    var blockers = onSale ? [] : catalog.saleBlockers(product);
    var hint = row.querySelector('.kel-row-hint');
    toggle.disabled = blockers.length > 0;
    if (blockers.length) {
      hint.textContent = 'À compléter : ' + blockers.map(function (b) { return BLOCKER_WORDS[b]; }).join(' et ') + '.';
      show(hint);
    } else {
      hide(hint);
    }
  }

  /* ── Bascule ── */

  function onToggle(row, product) {
    var toggle = row.querySelector('.kel-switch');
    if (toggle.disabled || toggle.getAttribute('aria-busy') === 'true') return;

    var target = product.availability === 'disponible' ? 'vendue' : 'disponible';
    var errorEl = row.querySelector('.kel-row-error');

    // 1. Tout de suite
    hide(errorEl);
    applyState(row, Object.assign({}, product, { availability: target }));
    toggle.setAttribute('aria-busy', 'true');
    beginPending();

    api(API + '/' + encodeURIComponent(product.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ availability: target })
    })
      .then(function (data) {
        // 2. Confirmé : l'écran suit la réponse, pas ce qu'il espérait
        Object.assign(product, data.product);
        applyState(row, product);
        // 3. Et ensuite
        showToast(data.unchanged ? 'Cette pièce était déjà dans cet état.' : 'Enregistré, mise en ligne dans 1 à 2 minutes.');
      })
      .catch(function (err) {
        // 2 bis. Refusé ou injoignable : retour en arrière, obligatoire, et la raison
        applyState(row, product);
        if (err instanceof SessionExpired) return reconnect();
        errorEl.textContent = err instanceof ApiError ? err.message : NETWORK_MESSAGE;
        show(errorEl);
      })
      .then(function () {
        toggle.removeAttribute('aria-busy');
        endPending();
        updateSummary();
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

  function updateSummary() {
    var rows = Array.prototype.slice.call(els.list.children);
    function count(state) { return rows.filter(function (r) { return r.dataset.availability === state; }).length; }
    var sold = count('vendue');
    els.summary.textContent = count('disponible') + ' en vente · ' + count('bientot') + ' bientôt · ' + sold + (sold > 1 ? ' vendues' : ' vendue');
  }

  /* ── Démarrage ── */

  if (!catalog) {
    hide(els.loading);
    els.errorText.textContent = 'Le script du catalogue n\'a pas pu être chargé. Rechargez la page.';
    show(els.error);
    return;
  }
  els.retry.addEventListener('click', load);
  load();
}());
