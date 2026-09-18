/* Ce que les écrans de l'espace de gestion partagent — « Mes bijoux » (gestion.js) et la fiche
   d'une pièce (piece.js, KD-93) : l'appel à l'API derrière Cloudflare Access, la reconnexion
   quand la session a expiré, le toast, les feuilles <dialog> et la confirmation d'une phrase.
   Écrit une fois pour que les deux écrans se comportent pareil face aux mêmes situations.

   Chargé avant gestion.js / piece.js ; expose window.KelAdmin. */

(function () {
  'use strict';

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
  // du middleware (jeton refusé) sont traités de la même façon : la session est à refaire —
  // sauf une erreur 5xx sans JSON (page d'erreur Cloudflare : Function en panne, temps CPU
  // dépassé) : là, la session n'y est pour rien, on le dit et on ne recharge pas, pour ne pas
  // perdre ce qui est saisi.
  function api(path, init) {
    init = init || {};
    var headers = Object.assign({ Accept: 'application/json' }, init.headers || {});
    return fetch(path, Object.assign({}, init, { headers: headers, redirect: 'manual', credentials: 'same-origin' }))
      .then(function (response) {
        if (response.type === 'opaqueredirect' || response.status === 0 || response.status === 401) throw new SessionExpired();
        var type = response.headers.get('Content-Type') || '';
        if (type.indexOf('application/json') === -1) {
          if (response.status >= 500) throw new ApiError(response.status, 'Le site n\'a pas pu répondre. Réessayez dans un instant.');
          throw new SessionExpired();
        }
        return response.json().then(function (body) {
          if (!response.ok) throw new ApiError(response.status, body && body.error ? body.error : 'Une erreur est survenue.');
          return body;
        });
      });
  }

  // Recharge la page pour repasser par Access. Garde-fou : si la page vient déjà d'être
  // rechargée pour ça, on n'insiste pas — une boucle de rechargements serait pire qu'un message.
  // `onBlocked(message)` affiche ce message à la place ; `beforeReload()` laisse l'écran mettre
  // de côté ce qu'il ne veut pas perdre (la fiche en cours de saisie).
  function reconnect(options) {
    var key = 'kel-gestion-reconnect-at';
    var last = 0;
    try { last = Number(window.sessionStorage.getItem(key)) || 0; } catch (_) { /* stockage indisponible */ }
    if (Date.now() - last < 30000) {
      options.onBlocked('Impossible de vérifier votre connexion. Fermez cette page et rouvrez-la.');
      return;
    }
    try { window.sessionStorage.setItem(key, String(Date.now())); } catch (_) { /* idem */ }
    if (options.beforeReload) options.beforeReload();
    options.toast('Votre session a expiré. Reconnexion…');
    window.setTimeout(function () { window.location.reload(); }, 1500);
  }

  /* ── Toast ── */

  function createToast(el) {
    var timer = null;
    return function (message) {
      el.textContent = message;
      el.hidden = false;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () { el.hidden = true; }, 5000);
    };
  }

  /* ── Dialogues (feuilles en bas d'écran) ── */

  // Toucher le fond ferme la feuille ; à la fermeture, le focus revient à ce qui l'a ouverte.
  function createDialogs(dialogs, toast) {
    var returnFocusTo = null;
    dialogs.forEach(function (dialog) {
      dialog.addEventListener('click', function (event) { if (event.target === dialog) dialog.close(); });
      dialog.addEventListener('close', function () {
        if (returnFocusTo && document.body.contains(returnFocusTo) && typeof returnFocusTo.focus === 'function') returnFocusTo.focus();
        returnFocusTo = null;
      });
    });
    return {
      open: function (dialog, opener) {
        returnFocusTo = opener || document.activeElement;
        if (typeof dialog.showModal !== 'function') {
          toast('Votre navigateur est trop ancien pour cet écran. Mettez-le à jour.');
          return;
        }
        dialog.showModal();
      },
      close: function (dialog) {
        if (dialog.open) dialog.close();
      }
    };
  }

  /* ── Confirmation d'une phrase, pour ce qui ne se défait pas d'un geste ── */

  // els : { dialog, title, text, ok } — renvoie openConfirm({ title, text, ok }, onOk)
  function createConfirm(els, dialogs) {
    var callback = null;
    els.dialog.addEventListener('close', function () {
      var pending = callback;
      callback = null;
      if (els.dialog.returnValue === 'ok' && pending) pending();
      els.dialog.returnValue = '';
    });
    return function (options, onOk) {
      els.title.textContent = options.title;
      els.text.textContent = options.text;
      els.ok.textContent = options.ok;
      callback = onOk;
      dialogs.open(els.dialog);
    };
  }

  window.KelAdmin = {
    ApiError: ApiError,
    SessionExpired: SessionExpired,
    api: api,
    reconnect: reconnect,
    createToast: createToast,
    createDialogs: createDialogs,
    createConfirm: createConfirm
  };
}());
