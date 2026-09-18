/* Fiche d'une pièce — /admin/piece (KD-93) : ajouter, modifier, dupliquer.

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

   MAQUETTE (étape 4 de KD-93) : l'écran se remplit et se manipule, mais n'enregistre pas encore —
   « Enregistrer » le dit. Le câblage (photos réduites en WebP, envoi, retour à la liste) arrive
   avec l'étape 6, une fois la maquette vue par Prescilia. */

(function () {
  'use strict';

  var API = '/api/admin/products';
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
    category: document.getElementById('category'),
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

  var products = [];      // la liste de l'API : unicité de la référence
  var collections = [];   // les collections, pour les cases
  var existing = null;    // la pièce modifiée (mode edit), telle que l'API l'a donnée
  var photos = [];        // dans l'ordre affiché : { src, alt } (existante) ou { file, preview } (ajoutée)
  var userChoseState = false; // tant qu'elle n'a pas touché « Publication », l'état suit photo + prix

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
      onBlocked: function (message) {
        hide(els.loading);
        els.errorText.textContent = message;
        show(els.error);
      }
    });
  }

  /* ── Les choix : types, publics, collections — depuis catalog.js et l'API ── */

  function buildChoices() {
    fillChoices(els.audience, 'audience', 'radio', catalog.AUDIENCES.map(function (a) { return { id: a.id, label: a.label }; }));
    fillChoices(els.category, 'category', 'radio', catalog.CATEGORIES.map(function (c) { return { id: c.id, label: c.plural }; }));
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
      check(els.category, 'category', source.category ? [source.category] : []);
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
      img.src = photo.preview || ('/' + catalog.normalizeImagePath(photo.src));
      img.alt = photo.alt || '';
      item.querySelector('.kel-photo-badge').hidden = index !== 0;
      item.querySelector('.kel-photo-first').addEventListener('click', function () {
        photos.splice(0, 0, photos.splice(index, 1)[0]);
        renderPhotos();
        updatePublish();
      });
      item.querySelector('.kel-photo-remove').addEventListener('click', function () {
        if (photo.preview) URL.revokeObjectURL(photo.preview);
        photos.splice(index, 1);
        renderPhotos();
        updatePublish();
      });
      els.photos.appendChild(item);
    });
  }

  function addFiles(files) {
    hide(els.photosError);
    Array.prototype.forEach.call(files, function (file) {
      if (!/^image\//.test(file.type)) {
        els.photosError.textContent = 'Ce fichier n\'est pas une photo : ' + file.name;
        show(els.photosError);
        return;
      }
      photos.push({ file: file, preview: URL.createObjectURL(file) });
    });
    renderPhotos();
    updatePublish();
  }

  [els.photoCamera, els.photoGallery].forEach(function (input) {
    input.addEventListener('change', function () {
      addFiles(input.files);
      input.value = ''; // la même photo peut être reprise
    });
  });

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
      category: checked(els.category, 'category')[0] || null,
      audience: checked(els.audience, 'audience')[0] || null,
      collections: checked(els.collections, 'collections'),
      desc: els.desc.value,
      price: typeof price === 'number' && !isNaN(price) ? price : null,
      featured: els.featured.checked,
      images: photos.map(function (photo) { return photo.src ? { src: photo.src } : { upload: 'photo' }; })
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

  els.publish.addEventListener('change', function () {
    userChoseState = true;
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
        var owner = catalog.referenceOwner(products, reference, existing && mode === 'edit' ? existing.id : null);
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

  els.name.addEventListener('input', function () { if (!els.nameError.hidden) checkName(); });
  els.name.addEventListener('blur', checkName);
  els.reference.addEventListener('input', checkReference);
  els.price.addEventListener('input', function () { checkPrice(); updatePublish(); });
  [els.audience, els.category].forEach(function (group) { group.addEventListener('change', updatePublish); });

  // La description grandit avec le texte : pas d'ascenseur dans un ascenseur au téléphone
  function autosize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.max(120, textarea.scrollHeight + 2) + 'px';
  }
  els.desc.addEventListener('input', function () { autosize(els.desc); });

  /* ── Enregistrer — maquette : pas encore ── */

  els.form.addEventListener('submit', function (event) {
    event.preventDefault();
    var ok = checkName() & checkReference() & checkPrice();
    if (!ok) {
      var firstError = els.form.querySelector('.kel-field--invalid input');
      if (firstError) firstError.focus();
      return;
    }
    showToast('Maquette : l\'enregistrement arrive à l\'étape suivante. Dites ce qui vous gêne ou vous manque.');
  });

  els.deleteButton.addEventListener('click', function () {
    openConfirm({ title: 'Supprimer ce brouillon ?', text: 'La pièce et ses photos disparaissent de l\'espace de gestion. Elle n\'a jamais été publiée.', ok: 'Supprimer' }, function () {
      showToast('Maquette : la suppression arrive à l\'étape suivante.');
    });
  });

  /* ── Démarrage ── */

  els.retry.addEventListener('click', load);
  load();
}());
