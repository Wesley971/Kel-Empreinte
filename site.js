/* Comportements communs à toutes les pages du site : navigation (pilule et menu mobile),
   verrou de défilement des calques plein écran, zoom d'une photo (lightbox).

   Chargé par index.html, /boutique/ et les pages pièce, avant le script propre à chaque page.
   Expose `KelSite` : { lockScroll, unlockScroll, openLightbox, closeLightbox }. Chaque bloc ne
   fait rien si la page n'a pas l'élément concerné : le même fichier sert partout. */

(function() {
  'use strict';

  /* ── Verrou de scroll de la page — partagé par les calques plein écran ── */
  var lockedScrollY = 0;

  function lockScroll() {
    // déjà verrouillé : scrollY vaut 0 (document réduit), le relire écraserait la position mémorisée
    if (document.body.classList.contains('is-scroll-locked')) return;
    lockedScrollY = window.scrollY;
    document.body.style.top = -lockedScrollY + 'px';
    document.body.classList.add('is-scroll-locked');
  }

  function unlockScroll() {
    document.body.classList.remove('is-scroll-locked');
    document.body.style.top = '';
    // html est en scroll-behavior: smooth — la restauration ne doit pas être animée
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, lockedScrollY);
    document.documentElement.style.scrollBehavior = '';
  }

  /* ── Menu mobile ── */
  var hamburger = document.querySelector('.hamburger');
  var mobileNav = document.querySelector('.mobile-nav');

  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', function() {
      var opening = !mobileNav.classList.contains('open');
      hamburger.classList.toggle('open', opening);
      mobileNav.classList.toggle('open', opening);
      if (opening) lockScroll(); else unlockScroll();
    });

    mobileNav.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', function() {
        hamburger.classList.remove('open');
        mobileNav.classList.remove('open');
        unlockScroll();
      });
    });
  }

  /* ── Navigation pilule : défilement doux vers une section de la page courante ── */
  document.querySelectorAll('.pill-nav a').forEach(function(link) {
    link.addEventListener('click', function(e) {
      var href = this.getAttribute('href');
      if (href && href.length > 1 && href.charAt(0) === '#') {
        e.preventDefault();
        var target = document.querySelector(href);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  /* ── Lightbox : une photo en grand, légende facultative ── */
  var lightbox = document.getElementById('lightbox');
  var openLightbox = function() {};
  var closeLightbox = function() {};

  if (lightbox) {
    var lightboxImg = lightbox.querySelector('.lightbox-img');
    var lightboxClose = lightbox.querySelector('.lightbox-close');
    var lightboxCaption = lightbox.querySelector('.lightbox-caption');
    var captionName = lightbox.querySelector('.lightbox-caption-name');
    var captionDimensions = lightbox.querySelector('.lightbox-caption-dimensions');
    var captionDesc = lightbox.querySelector('.lightbox-caption-desc');
    var formatDimensions = window.KelCatalog ? window.KelCatalog.formatDimensions : function(d) { return d || ''; };

    // details : { name, desc, dimensions } ; la légende n'apparaît que si la pièce a une
    // description ou des dimensions (textContent : jamais de HTML)
    openLightbox = function(src, alt, details) {
      details = details || {};
      var hasCaption = !!(details.desc || details.dimensions);
      lightboxImg.src = src;
      lightboxImg.alt = alt;
      captionName.textContent = hasCaption ? (details.name || '') : '';
      captionDimensions.textContent = hasCaption ? formatDimensions(details.dimensions) : '';
      captionDesc.textContent = hasCaption ? (details.desc || '') : '';
      lightboxCaption.hidden = !hasCaption;
      lightbox.classList.toggle('has-caption', hasCaption);
      lightbox.classList.add('is-open');
      lightbox.setAttribute('aria-hidden', 'false');
      lockScroll();
    };

    closeLightbox = function() {
      // le bouton × reste focusable au clavier lightbox fermée (opacity: 0, pas display: none)
      if (!lightbox.classList.contains('is-open')) return;
      lightbox.classList.remove('is-open');
      lightbox.setAttribute('aria-hidden', 'true');
      unlockScroll();
    };

    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', function(e) {
      if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeLightbox();
    });
  }

  window.KelSite = {
    lockScroll: lockScroll,
    unlockScroll: unlockScroll,
    openLightbox: openLightbox,
    closeLightbox: closeLightbox
  };
})();
