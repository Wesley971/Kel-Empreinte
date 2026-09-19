/* Fiche d'une pièce — /admin/piece (KD-93) : ajouter, modifier, dupliquer, supprimer un brouillon.

   Trois entrées, lues dans l'adresse :
     /admin/piece            une nouvelle pièce, à partir de zéro
     /admin/piece?id=<id>    modifier cette pièce
     /admin/piece?from=<id>  une nouvelle pièce copiée sur celle-là (tout sauf photos, nom,
                             référence et mise en avant ; état brouillon)

   La liste des pièces et les collections viennent de GET /api/admin/products (la vérité du
   dépôt) : la pièce à modifier y est prise, et la liste sert au contrôle d'unicité de la
   référence, en direct, avec le même message que l'API.

   Les listes de choix (types, publics) et les règles (« peut passer en vente ») viennent de
   catalog.js — les mêmes qu'appliquent l'API et le build. L'appel à l'API, le toast, les feuilles
   et la confirmation viennent de common.js, partagés avec « Mes bijoux ».

   Les photos sont préparées dans le navigateur avant l'envoi : décodées avec leur orientation,
   réduites à 1 600 px de grand côté, réencodées en WebP (JPEG si le navigateur ne sait pas
   encoder le WebP), puis envoyées en base64 dans le JSON — l'API les passe telles quelles à
   GitHub, sans les décoder (voir functions/_lib/photos.js pour le pourquoi : le temps CPU).

   Enregistrer : POST (nouvelle pièce) ou PUT (modification), un seul commit côté dépôt, puis
   retour à « Mes bijoux » sur la pièce. Si ça échoue, la fiche reste telle quelle, avec la raison
   en tête : elle réessaie sans rien ressaisir. Si la session Access expire pendant la saisie, le
   texte est mis de côté avant le rechargement et restauré après — les photos non envoyées, non
   (dit à l'écran). */

(function () {
  'use strict';

  var API = '/api/admin/products';
  var MAX_SIDE = 1600;       // grand côté d'une photo envoyée, en pixels
  var WEBP_QUALITY = 0.82;
  var JPEG_QUALITY = 0.85;
  var MAX_PHOTOS = 10;
  var PHOTO_PENDING = 'Photo en cours de mise en ligne'; // servie au prochain déploiement, 1 à 2 min
  var catalog = window.KelCatalog;
  var admin = window.KelAdmin;

  var els = {
    title: document.getElementById('title'),
    save: document.getElementById('save'),
    status: document.getElementById('status'),
    statusText: document.getElementById('status-text'),
    loading: document.getElementById('loading'),
    error: document.getElementById('error'),
    errorText: document.getElementById('error-text'),
    retry: document.getElementById('retry'),
    form: document.getElementById('piece-form'),
    note: document.getElementById('note'),
    failure: document.getElementById('failure'),
    failureText: document.getElementById('failure-text'),
    photos: document.getElementById('photos'),
    photoCamera: document.getElementById('photo-camera'),
    photoGallery: document.getElementById('photo-gallery'),
    photosError: document.getElementById('photos-error'),
    photoTemplate: document.getElementById('photo-template'),
    name: document.getElementById('name'),
    nameError: document.getElementById('name-error'),
    reference: document.getElementById('reference'),
    referenceError: document.getElementById('reference-error'),
    collections: document.getElementById('collections'),
    audience: document.getElementById('audience'),
    categories: document.getElementById('categories'),
    desc: document.getElementById('desc'),
    price: document.getElementById('price'),
    priceError: document.getElementById('price-error'),
    featured: document.getElementById('featured'),
    publish: document.getElementById('publish'),
    publishHelp: document.getElementById('publish-help'),
    publishFixed: document.getElementById('publish-fixed'),
    danger: document.getElementById('danger'),
    deleteButton: document.getElementById('delete'),
    toast: document.getElementById('toast'),
    confirm: document.getElementById('confirm'),
    confirmTitle: document.getElementById('confirm-title'),
    confirmText: document.getElementById('confirm-text'),
    confirmOk: document.getElementById('confirm-ok')
  };

  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }

  if (!catalog || !admin) {
    hide(els.loading);
    els.errorText.textContent = 'Un script n\'a pas pu être chargé. Rechargez la page.';
    show(els.error);
    return;
  }

  var showToast = admin.createToast(els.toast);
  var dialogs = admin.createDialogs([els.confirm], showToast);
  var openConfirm = admin.createConfirm({ dialog: els.confirm, title: els.confirmTitle, text: els.confirmText, ok: els.confirmOk }, dialogs);

  // Ce que l'adresse demande
  var params = new URLSearchParams(window.location.search);
  var mode = params.get('id') ? 'edit' : params.get('from') ? 'copy' : 'new';
  var sourceId = params.get('id') || params.get('from') || null;
  var DRAFT_KEY = 'kel-piece-draft:' + mode + ':' + (sourceId || '');

  var products = [];      // la liste de l'API : unicité de la référence
  var collections = [];   // les collections, pour les cases et le type suggéré
  var existing = null;    // la pièce source (edit : celle qu'on modifie ; copy : le modèle)
  var photos = [];        // dans l'ordre affiché : { src, alt } (existante) ou { blob, kind, preview, name, busy } (ajoutée)
  var userChoseState = false; // tant qu'elle n'a pas touché « Publication », l'état suit photo + prix
  var suggestedTypes = [];    // [{ collectionId, category }] : les types cochés par une collection et pas touchés depuis ; les autres sont les siens
  var dirty = false;      // quelque chose a changé depuis le chargement
  var saving = false;

  /* ── Chargement ── */

  function load() {
    show(els.loading);
    hide(els.error);
    hide(els.form);
    admin.api(API)
      .then(function (data) {
        products = data.products;
        collections = data.collections || [];
        if (sourceId) {
          existing = products.filter(function (p) { return p.id === sourceId; })[0] || null;
          if (!existing) {
            hide(els.loading);
            els.errorText.textContent = 'Cette pièce n\'existe pas, ou n\'existe plus.';
            hide(els.retry);
            show(els.error);
            return;
          }
        }
        hide(els.loading);
        buildChoices();
        fill();
        restoreDraft();
        show(els.form);
      })
      .catch(function (err) {
        hide(els.loading);
        if (err instanceof admin.SessionExpired) return reconnect();
        els.errorText.textContent = err instanceof admin.ApiError ? err.message : 'Connexion impossible. Vérifiez votre réseau, puis réessayez.';
        show(els.error);
      });
  }

  function reconnect() {
    admin.reconnect({
      toast: showToast,
      beforeReload: stashDraft,
      onBlocked: function (message) {
        hide(els.loading);
        els.errorText.textContent = message;
        show(els.error);
      }
    });
  }

  /* ── Les choix : types, publics, collections — depuis catalog.js et l'API ── */

  // Les types en cases à cocher : une parure ou un combo en a plusieurs (KD-120). Leurs libellés
  // restent ceux du formulaire depuis KD-93 (le pluriel des puces de la boutique) ; la liste
  // « Boucles d'oreilles et bracelet » est la grammaire d'affichage du site, pas de la saisie.
  function buildChoices() {
    fillChoices(els.audience, 'audience', 'radio', catalog.AUDIENCES.map(function (a) { return { id: a.id, label: a.label }; }));
    fillChoices(els.categories, 'categories', 'checkbox', catalog.CATEGORIES.map(function (c) { return { id: c.id, label: c.plural }; }));
    fillChoices(els.collections, 'collections', 'checkbox', collections.map(function (c) { return { id: c.id, label: c.name }; }));
  }

  function fillChoices(container, name, type, options) {
    container.textContent = '';
    options.forEach(function (option) {
      var label = document.createElement('label');
      label.className = 'kel-choice';
      var input = document.createElement('input');
      input.type = type;
      input.name = name;
      input.value = option.id;
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + option.label));
      container.appendChild(label);
    });
  }

  function checked(container, name) {
    return Array.prototype.map.call(container.querySelectorAll('input[name="' + name + '"]:checked'), function (input) { return input.value; });
  }

  function check(container, name, values) {
    Array.prototype.forEach.call(container.querySelectorAll('input[name="' + name + '"]'), function (input) {
      input.checked = values.indexOf(input.value) !== -1;
    });
  }

  /* ── Remplissage ── */

  function fill() {
    var source = existing;
    if (mode === 'new') {
      els.title.textContent = 'Nouvelle pièce';
      document.title = 'Nouvelle pièce — Kel\'Empreinte';
    } else if (mode === 'copy') {
      els.title.textContent = 'Nouvelle pièce';
      document.title = 'Nouvelle pièce — Kel\'Empreinte';
      els.note.textContent = 'Copiée sur « ' + source.name + ' » : il reste les photos, le nom et la référence à donner.';
      show(els.note);
    } else {
      els.title.textContent = source.name;
      document.title = source.name + ' — Kel\'Empreinte';
    }

    if (source) {
      // Une copie reprend tout sauf les photos, le nom, la référence et la mise en avant
      var copy = mode === 'copy';
      els.name.value = copy ? '' : (source.name || '');
      els.reference.value = copy ? suggestReference(source.reference) : (source.reference || '');
      check(els.collections, 'collections', source.collections || []);
      check(els.audience, 'audience', source.audience ? [source.audience] : []);
      check(els.categories, 'categories', source.categories || []); // les siens : aucune suggestion en cours
      els.desc.value = source.desc || '';
      els.price.value = typeof source.price === 'number' ? String(source.price).replace('.', ',') : '';
      els.featured.checked = copy ? false : source.featured === true;
      photos = copy ? [] : (source.images || []).map(function (image) { return { src: image.src, alt: image.alt }; });
    }
    renderPhotos();
    updatePublish();
    if (mode === 'edit' && source.availability === 'brouillon') show(els.danger);
    autosize(els.desc);
  }

  // « BO-023 » → « BO-024 » à la duplication, seulement quand la référence finit par un nombre
  function suggestReference(reference) {
    if (typeof reference !== 'string') return '';
    var match = /^(.*?)(\d+)$/.exec(reference.trim());
    if (!match) return '';
    var next = String(Number(match[2]) + 1);
    while (next.length < match[2].length) next = '0' + next;
    return match[1] + next;
  }

  /* ── Photos ── */

  function renderPhotos() {
    els.photos.textContent = '';
    photos.forEach(function (photo, index) {
      var item = els.photoTemplate.content.firstElementChild.cloneNode(true);
      var img = item.querySelector('.kel-photo-img');
      var state = item.querySelector('.kel-photo-state');
      img.alt = photo.alt || photo.name || '';
      if (photo.busy) {
        // Pas de src tant que la photo se prépare : une image sans adresse n'affiche rien — ni
        // glyphe cassé, ni requête vers /undefined (recette du 19/09)
        item.setAttribute('aria-busy', 'true');
        img.hidden = true;
        state.textContent = 'Préparation…';
        state.hidden = false;
      } else {
        img.src = photo.preview || ('/' + catalog.normalizeImagePath(photo.src));
        // Enregistrée mais pas encore servie (le build suit chaque enregistrement) : un état, pas
        // une image cassée. KD-82 rendra cette attente visible depuis la liste.
        img.addEventListener('error', function () {
          img.hidden = true;
          state.textContent = PHOTO_PENDING;
          state.hidden = false;
        });
      }
      item.querySelector('.kel-photo-badge').hidden = index !== 0;
      item.querySelector('.kel-photo-first').addEventListener('click', function () {
        photos.splice(0, 0, photos.splice(index, 1)[0]);
        touched();
        renderPhotos();
        updatePublish();
      });
      item.querySelector('.kel-photo-remove').addEventListener('click', function () {
        if (photo.preview) URL.revokeObjectURL(photo.preview);
        photos.splice(index, 1);
        touched();
        renderPhotos();
        updatePublish();
      });
      els.photos.appendChild(item);
    });
  }

  // Chaque fichier choisi entre dans la liste tout de suite (vignette grisée), puis est préparé :
  // décodé avec son orientation, réduit, réencodé. Une photo illisible sort de la liste avec un mot.
  function addFiles(files) {
    hide(els.photosError);
    var room = MAX_PHOTOS - photos.length;
    var list = Array.prototype.slice.call(files);
    if (list.length > room) {
      els.photosError.textContent = 'Au plus ' + MAX_PHOTOS + ' photos par pièce : ' + (list.length - Math.max(0, room)) + ' n\'ont pas été prises.';
      show(els.photosError);
      list = list.slice(0, Math.max(0, room));
    }
    list.forEach(function (file) {
      var photo = { name: file.name, busy: true, preview: null };
      photos.push(photo);
      touched();
      renderPhotos();
      preparePhoto(file)
        .then(function (prepared) {
          photo.blob = prepared.blob;
          photo.kind = prepared.kind;
          photo.preview = URL.createObjectURL(prepared.blob);
          photo.busy = false;
          renderPhotos();
          updatePublish();
        })
        .catch(function () {
          var at = photos.indexOf(photo);
          if (at !== -1) photos.splice(at, 1);
          els.photosError.textContent = 'Cette photo n\'a pas pu être lue (format non pris en charge) : ' + file.name;
          show(els.photosError);
          renderPhotos();
          updatePublish();
        });
    });
    updatePublish();
  }

  [els.photoCamera, els.photoGallery].forEach(function (input) {
    input.addEventListener('change', function () {
      addFiles(input.files);
      input.value = ''; // la même photo peut être reprise
    });
  });

  // Décode (orientation EXIF comprise), réduit à MAX_SIDE, réencode en WebP — ou en JPEG si le
  // navigateur rend autre chose que du WebP (Safari). Renvoie { blob, kind }.
  function preparePhoto(file) {
    return decodeImage(file).then(function (image) {
      var scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
      var width = Math.max(1, Math.round(image.width * scale));
      var height = Math.max(1, Math.round(image.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(image, 0, 0, width, height);
      if (typeof image.close === 'function') image.close();
      return toBlob(canvas, 'image/webp', WEBP_QUALITY).then(function (blob) {
        if (blob && blob.type === 'image/webp') return { blob: blob, kind: 'webp' };
        return toBlob(canvas, 'image/jpeg', JPEG_QUALITY).then(function (jpeg) {
          if (!jpeg) throw new Error('encodage impossible');
          return { blob: jpeg, kind: 'jpeg' };
        });
      });
    });
  }

  function decodeImage(file) {
    if (typeof window.createImageBitmap === 'function') {
      return window.createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return decodeWithImg(file); });
    }
    return decodeWithImg(file);
  }

  function decodeWithImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image illisible')); };
      img.src = url;
    });
  }

  function toBlob(canvas, type, quality) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, type, quality); });
  }

  function toBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(',')[1]); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  /* ── Ce que la pièce serait, telle que l'API la jugerait ── */

  function parsePrice(text) {
    var cleaned = String(text || '').trim().replace(/\s/g, '').replace(',', '.').replace(/€$/, '');
    if (!cleaned) return null;
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return NaN;
    return Number(cleaned);
  }

  function candidate() {
    var price = parsePrice(els.price.value);
    return {
      name: els.name.value.trim(),
      reference: els.reference.value.trim() || null,
      categories: checked(els.categories, 'categories'), // dans l'ordre des cases = celui du vocabulaire
      audience: checked(els.audience, 'audience')[0] || null,
      collections: checked(els.collections, 'collections'),
      desc: els.desc.value,
      price: typeof price === 'number' && !isNaN(price) ? price : null,
      featured: els.featured.checked,
      images: photos.filter(function (photo) { return !photo.busy; }).map(function (photo) { return photo.src ? { src: photo.src } : { upload: 'photo' }; })
    };
  }

  /* ── Publication : en vente dès qu'il y a une photo et un prix, sinon brouillon ── */

  function updatePublish() {
    var piece = candidate();
    var blockers = catalog.saleBlockers(piece);
    var published = mode === 'edit' && existing.availability !== 'brouillon';

    if (published) {
      hide(els.publish);
      els.publishFixed.textContent = catalog.STATE_LABELS[existing.availability] + ' — l\'état se change depuis « Mes bijoux », pas d\'ici.';
      show(els.publishFixed);
      return;
    }
    show(els.publish);
    hide(els.publishFixed);
    var onSale = els.publish.querySelector('input[value="disponible"]');
    var draft = els.publish.querySelector('input[value="brouillon"]');
    onSale.disabled = blockers.length > 0;
    if (blockers.length) {
      draft.checked = true;
      els.publishHelp.textContent = catalog.describeSaleBlockers(blockers).replace(/ avant de mettre cette pièce en vente\.$/, ' pour la mettre en vente.').replace(/ pour mettre cette pièce en vente\.$/, ' pour la mettre en vente.');
    } else {
      if (!userChoseState) onSale.checked = true;
      els.publishHelp.textContent = onSale.checked ? 'Visible en boutique dès la mise en ligne, 1 à 2 minutes après l\'enregistrement.' : 'Gardée pour vous, invisible sur le site. Vous la mettrez en vente plus tard.';
    }
  }

  function targetState() {
    if (mode === 'edit' && existing.availability !== 'brouillon') return null; // l'état ne s'envoie pas
    return checked(els.publish, 'availability')[0] || 'brouillon';
  }

  els.publish.addEventListener('change', function () {
    userChoseState = true;
    touched();
    updatePublish();
  });

  /* ── Contrôles en direct : le nom, la référence, le prix ── */

  function setFieldError(input, errorEl, message) {
    var field = input.closest('.kel-field');
    if (message) {
      errorEl.textContent = message;
      show(errorEl);
      if (field) field.classList.add('kel-field--invalid');
    } else {
      hide(errorEl);
      if (field) field.classList.remove('kel-field--invalid');
    }
  }

  function checkName() {
    var name = els.name.value.trim();
    var message = !name ? 'Donnez un nom à la pièce, même en brouillon.' :
      !catalog.slugify(name) ? 'Le nom doit contenir au moins une lettre ou un chiffre.' : '';
    setFieldError(els.name, els.nameError, message);
    return !message;
  }

  function checkReference() {
    var reference = els.reference.value.trim();
    var message = '';
    if (reference) {
      if (!catalog.normalizeReference(reference)) {
        message = 'La référence doit contenir au moins une lettre ou un chiffre.';
      } else {
        var owner = catalog.referenceOwner(products, reference, mode === 'edit' ? existing.id : null);
        if (owner) message = 'La référence ' + reference + ' est déjà portée par « ' + owner.name + ' ». Si ce n\'est pas la même pièce, choisissez une autre référence.';
      }
    }
    setFieldError(els.reference, els.referenceError, message);
    return !message;
  }

  function checkPrice() {
    var price = parsePrice(els.price.value);
    var message = typeof price === 'number' && isNaN(price) ? 'Le prix s\'écrit en chiffres, par exemple 25 ou 12,50.' : '';
    setFieldError(els.price, els.priceError, message);
    return !message;
  }

  function touched() { dirty = true; }

  els.form.addEventListener('input', touched);
  els.form.addEventListener('change', touched);
  els.name.addEventListener('input', function () { if (!els.nameError.hidden) checkName(); updatePublish(); });
  els.name.addEventListener('blur', checkName);
  els.reference.addEventListener('input', checkReference);
  els.price.addEventListener('input', function () { checkPrice(); updatePublish(); });
  els.audience.addEventListener('change', updatePublish);

  // Les types suggérés par les collections (collections.json, `category`) : une suggestion qui
  // s'annule proprement, jamais un effacement d'un choix de Prescilia. Ce qui distingue « suggéré »
  // de « saisi », c'est la source du geste : le code coche sans cliquer, elle ne peut pas choisir
  // sans cliquer. La garde est PAR TYPE (KD-120), plus globale comme avec le type unique de KD-93 :
  //   - cocher une collection coche ses types encore vides, et s'en souvient (`suggestedTypes`) ;
  //     une case déjà cochée — par elle ou par une autre collection — n'est pas touchée ;
  //   - décocher une collection décoche seulement les types qui viennent d'elle et n'ont pas bougé ;
  //   - dès qu'elle clique une case de type, ce type est le sien (coché ou décoché) : plus aucune
  //     collection ne le bouge ;
  //   - une deuxième collection ajoute ses types aux cases vides — y compris le vide laissé par une
  //     première collection décochée — sans rien remplacer ;
  //   - une fiche existante ou dupliquée démarre sans suggestion : ses types sont les siens.
  // Deux collections qui suggéreraient le même type (aucune aujourd'hui) : il appartient à la
  // première cochée, la seconde trouve la case pleine et n'ajoute rien.
  function typeInput(category) {
    return els.categories.querySelector('input[name="categories"][value="' + category + '"]');
  }

  // Ce qu'une collection suggère : rien ou un type aujourd'hui (`category`) ; en liste, pour que
  // la règle ne change pas le jour où collections.json en porte plusieurs
  function collectionTypes(collectionId) {
    var collection = collections.filter(function (c) { return c.id === collectionId; })[0];
    return collection && collection.category ? [collection.category] : [];
  }

  function forgetSuggestion(category) {
    suggestedTypes = suggestedTypes.filter(function (entry) { return entry.category !== category; });
  }

  els.collections.addEventListener('change', function (event) {
    var collectionId = event.target.value;
    if (event.target.checked) {
      collectionTypes(collectionId).forEach(function (category) {
        var input = typeInput(category);
        if (!input || input.checked) return;
        input.checked = true;
        suggestedTypes.push({ collectionId: collectionId, category: category });
      });
    } else {
      suggestedTypes.filter(function (entry) { return entry.collectionId === collectionId; }).forEach(function (entry) {
        var input = typeInput(entry.category);
        if (input && input.checked) input.checked = false;
        forgetSuggestion(entry.category);
      });
    }
    updatePublish();
  });

  // Un clic sur une case de type ne vient que d'elle (le code coche sans cliquer) : ce type est
  // désormais le sien — même si elle le décoche puis le recoche, ce qu'un `change` seul ne dirait pas
  els.categories.addEventListener('click', function (event) {
    if (event.target.matches('input')) forgetSuggestion(event.target.value);
  });
  els.categories.addEventListener('change', updatePublish);

  // La description grandit avec le texte : pas d'ascenseur dans un ascenseur au téléphone
  function autosize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.max(120, textarea.scrollHeight + 2) + 'px';
  }
  els.desc.addEventListener('input', function () { autosize(els.desc); });

  // Quitter avec des changements non enregistrés : le navigateur demande confirmation
  window.addEventListener('beforeunload', function (event) {
    if (!dirty || saving) return;
    event.preventDefault();
    event.returnValue = '';
  });

  /* ── Enregistrer ── */

  els.form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (saving) return;
    hide(els.failure);
    var ok = [checkName(), checkReference(), checkPrice()].every(Boolean);
    if (!ok) {
      var firstError = els.form.querySelector('.kel-field--invalid input');
      if (firstError) firstError.focus();
      return;
    }
    if (photos.some(function (photo) { return photo.busy; })) {
      showToast('Les photos sont encore en préparation, un instant…');
      return;
    }
    save();
  });

  function setSaving(on, message) {
    saving = on;
    els.form.setAttribute('aria-busy', on ? 'true' : 'false');
    els.save.disabled = on;
    els.deleteButton.disabled = on;
    els.photoCamera.disabled = on;
    els.photoGallery.disabled = on;
    els.statusText.textContent = message || 'Enregistrement en cours…';
    els.status.hidden = !on;
  }

  function save() {
    var piece = candidate();
    var state = targetState();
    if (state) piece.availability = state;
    var uploads = photos.filter(function (photo) { return photo.blob; });
    var uploaded = 0;
    piece.images = photos.map(function (photo) {
      return photo.src ? { src: photo.src } : { upload: 'photo-' + (++uploaded) };
    });
    setSaving(true, uploads.length ? 'Envoi de ' + uploads.length + ' photo' + (uploads.length > 1 ? 's' : '') + ' et enregistrement…' : 'Enregistrement en cours…');

    Promise.all(uploads.map(function (photo) { return toBase64(photo.blob); }))
      .then(function (encoded) {
        var body = { piece: piece, photos: {} };
        encoded.forEach(function (base64, i) { body.photos['photo-' + (i + 1)] = base64; });
        var path = mode === 'edit' ? API + '/' + encodeURIComponent(existing.id) : API;
        return admin.api(path, {
          method: mode === 'edit' ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      })
      .then(function (data) {
        dirty = false;
        clearDraft();
        // Retour à la liste, sur la pièce : c'est elle qui dit « Enregistré, mise en ligne… »
        window.location.assign('/admin/?saved=' + encodeURIComponent(data.product.id) + '&state=' + encodeURIComponent(data.product.availability));
      })
      .catch(function (err) {
        setSaving(false);
        if (err instanceof admin.SessionExpired) return reconnect();
        var message = err instanceof admin.ApiError ? err.message : 'Connexion impossible. Vérifiez votre réseau, puis réessayez : rien n\'a été perdu.';
        // Une référence refusée par l'API (une autre pièce l'a prise entre-temps) se montre sur son champ
        if (err instanceof admin.ApiError && /^La référence /.test(message)) setFieldError(els.reference, els.referenceError, message);
        els.failureText.textContent = message;
        show(els.failure);
        els.failure.scrollIntoView({ block: 'nearest' });
      });
  }

  /* ── Supprimer un brouillon ── */

  els.deleteButton.addEventListener('click', function () {
    if (saving) return;
    openConfirm({ title: 'Supprimer ce brouillon ?', text: 'La pièce et ses photos disparaissent de l\'espace de gestion. Elle n\'a jamais été publiée.', ok: 'Supprimer' }, function () {
      setSaving(true, 'Suppression en cours…');
      admin.api(API + '/' + encodeURIComponent(existing.id), { method: 'DELETE' })
        .then(function () {
          dirty = false;
          clearDraft();
          window.location.assign('/admin/?deleted=' + encodeURIComponent(existing.name));
        })
        .catch(function (err) {
          setSaving(false);
          if (err instanceof admin.SessionExpired) return reconnect();
          els.failureText.textContent = err instanceof admin.ApiError ? err.message : 'Connexion impossible. Vérifiez votre réseau, puis réessayez.';
          show(els.failure);
          els.failure.scrollIntoView({ block: 'nearest' });
        });
    });
  });

  /* ── La fiche mise de côté quand la session expire ── */

  function stashDraft() {
    if (!dirty) return;
    var piece = candidate();
    delete piece.images;
    piece.availability = targetState();
    piece.photosLost = photos.some(function (photo) { return !photo.src; });
    piece.suggestedTypes = suggestedTypes; // une suggestion en cours reste annulable après le rechargement
    try { window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(piece)); } catch (_) { /* stockage indisponible : tant pis */ }
  }

  function restoreDraft() {
    var raw = null;
    try { raw = window.sessionStorage.getItem(DRAFT_KEY); } catch (_) { return; }
    if (!raw) return;
    clearDraft();
    var piece;
    try { piece = JSON.parse(raw); } catch (_) { return; }
    els.name.value = piece.name || '';
    els.reference.value = piece.reference || '';
    check(els.collections, 'collections', piece.collections || []);
    check(els.audience, 'audience', piece.audience ? [piece.audience] : []);
    var restoredTypes = Array.isArray(piece.categories) ? piece.categories : [];
    check(els.categories, 'categories', restoredTypes);
    // Une suggestion ne survit que si son type est encore coché et sa collection aussi
    suggestedTypes = (Array.isArray(piece.suggestedTypes) ? piece.suggestedTypes : []).filter(function (entry) {
      return entry && restoredTypes.indexOf(entry.category) !== -1 && (piece.collections || []).indexOf(entry.collectionId) !== -1;
    });
    els.desc.value = piece.desc || '';
    els.price.value = typeof piece.price === 'number' ? String(piece.price).replace('.', ',') : '';
    els.featured.checked = piece.featured === true;
    if (piece.availability) { check(els.publish, 'availability', [piece.availability]); userChoseState = true; }
    dirty = true;
    autosize(els.desc);
    updatePublish();
    showToast(piece.photosLost ? 'Votre saisie a été retrouvée après la reconnexion — sauf les photos ajoutées, à reprendre.' : 'Votre saisie a été retrouvée après la reconnexion.');
  }

  function clearDraft() {
    try { window.sessionStorage.removeItem(DRAFT_KEY); } catch (_) { /* idem */ }
  }

  /* ── Démarrage ── */

  els.retry.addEventListener('click', load);
  load();
}());
