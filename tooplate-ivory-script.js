/* JavaScript Document

Tooplate 2166 Ivory Flow
    
https://www.tooplate.com/view/2166-ivory-flow

*/

(function() {
  'use strict';

  /* ── Product data: single source of truth for the signature carousel ──
     Loaded from data/products.json (fetch below); starts empty so any code
     that runs before the fetch resolves sees an empty array rather than
     undefined. The static HTML already showing slide 0 is the fallback
     while this loads (and if the fetch fails). ── */
  var productSlides = [];
  var currentSlide = 0;

  var openLightbox;

  /* Helpers de présentation partagés avec le build (catalog.js, chargé avant ce script) */
  var buildWhatsAppLink = window.KelCatalog.buildWhatsAppLink;
  var formatPrice = window.KelCatalog.formatPrice;
  var formatDimensions = window.KelCatalog.formatDimensions;

  /* ── Verrou de scroll de la page — partagé par les overlays plein écran ── */
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

  fetch('data/products.json')
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function(allProducts) {
      productSlides = allProducts
        .filter(function(p) { return p.featured && p.heading && p.plainName; })
        .sort(function(a, b) { return (a.featuredOrder || Infinity) - (b.featuredOrder || Infinity); });
      initProductCarousel();
    })
    .catch(function(err) {
      console.error('Carrousel produit : échec du chargement de data/products.json', err);
    });

  /* ── Timeline items — fade in at center viewport ── */
  var timelineItems = document.querySelectorAll('[data-timeline]');

  if ('IntersectionObserver' in window) {
    var timelineObs = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
        } else {
          entry.target.classList.remove('in-view');
        }
      });
    }, { rootMargin: '-30% 0px -30% 0px' });

    timelineItems.forEach(function(el) { timelineObs.observe(el); });

    setTimeout(function() {
      timelineItems.forEach(function(el) { el.classList.add('in-view'); });
    }, 3000);
  } else {
    timelineItems.forEach(function(el) { el.classList.add('in-view'); });
  }

  /* ── Active pill nav link ── */
  var pillLinks = document.querySelectorAll('.pill-nav a');
  var sections = document.querySelectorAll('.canvas-section');

  if ('IntersectionObserver' in window) {
    var navObs = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          var id = entry.target.id;
          pillLinks.forEach(function(link) {
            link.classList.toggle('active', link.getAttribute('href') === '#' + id);
          });
        }
      });
    }, { threshold: 0.4 });

    sections.forEach(function(sec) {
      if (sec.id) navObs.observe(sec);
    });
  }

  /* ── Est. label: swap to muted color over the dark process section ── */
  var estLabel = document.querySelector('.est-label');
  var processSection = document.getElementById('process');

  if (estLabel && processSection && 'IntersectionObserver' in window) {
    var estLabelObs = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        estLabel.classList.toggle('est-label--on-dark', entry.isIntersecting);
      });
    }, { threshold: 0.2 });

    estLabelObs.observe(processSection);
  }

  /* ── Mouse-following Buy Circle (LERP) ── */
  var buyCircle = document.getElementById('buyCircle');
  var productZone = document.getElementById('productImageZone');
  var mouseX = 0, mouseY = 0, circleX = 0, circleY = 0;
  var isOverProduct = false;
  var rafId = null;
  var hasHoverPointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (productZone) {
    productZone.addEventListener('click', function() {
      if (!productSlides[currentSlide]) return;
      window.open(buildWhatsAppLink(productSlides[currentSlide].plainName), '_blank', 'noopener');
    });
  }

  if (productZone && buyCircle && hasHoverPointer) {
    productZone.addEventListener('mouseenter', function() {
      isOverProduct = true;
      buyCircle.classList.add('visible');
      if (!rafId) lerpLoop();
    });

    productZone.addEventListener('mouseleave', function() {
      isOverProduct = false;
      buyCircle.classList.remove('visible');
    });

    productZone.addEventListener('mousemove', function(e) {
      mouseX = e.clientX;
      mouseY = e.clientY;
      var overThumbs = !!e.target.closest('.product-thumbs');
      buyCircle.classList.toggle('visible', !overThumbs);
    });

    function lerpLoop() {
      circleX += (mouseX - circleX) * 0.12;
      circleY += (mouseY - circleY) * 0.12;
      buyCircle.style.left = circleX - 60 + 'px';
      buyCircle.style.top = circleY - 60 + 'px';

      if (isOverProduct || Math.abs(mouseX - circleX) > 0.5) {
        rafId = requestAnimationFrame(lerpLoop);
      } else {
        rafId = null;
      }
    }
  }

  /* ── Product: 3-piece carousel ── */
  var productSection = document.querySelector('.product');
  var productPrevBtn = document.getElementById('productPrev');
  var productNextBtn = document.getElementById('productNext');
  var productDotsContainer = document.querySelector('.product-dots');

  function initProductCarousel() {
    if (!productSection || !productPrevBtn || !productNextBtn || !productDotsContainer) return;
    if (!productSlides.length) {
      console.error('Carrousel produit : aucune pièce signature valide (featured + heading + plainName).');
      return;
    }
    var isTransitioning = false;
    var infoContent = productSection.querySelector('.product-info-content');
    var slideImg = productSection.querySelector('.product-main-img');
    var thumbsEl = document.getElementById('productThumbs');
    var badgeEl = productSection.querySelector('.product-badge');
    var nameEl = productSection.querySelector('.product-name');
    var priceEl = productSection.querySelector('.product-price');
    var descEl = productSection.querySelector('.product-desc');
    var dimensionsEl = productSection.querySelector('.product-dimensions');
    var specsEl = productSection.querySelector('.product-specs');
    var productCta = productSection.querySelector('#productCta');
    var productDots;

    function renderThumbs(data) {
      thumbsEl.innerHTML = '';
      if (data.images.length <= 1) {
        thumbsEl.classList.remove('is-visible');
        return;
      }
      thumbsEl.classList.add('is-visible');
      data.images.forEach(function(img, i) {
        var thumb = document.createElement('button');
        thumb.className = 'product-thumb' + (i === 0 ? ' is-active' : '');
        thumb.style.backgroundImage = 'url(' + img.src + ')';
        thumb.setAttribute('aria-label', 'Voir cette photo');
        thumb.addEventListener('click', function(e) {
          e.stopPropagation();
          slideImg.src = img.src;
          slideImg.alt = img.alt;
          thumbsEl.querySelectorAll('.product-thumb').forEach(function(t) { t.classList.remove('is-active'); });
          thumb.classList.add('is-active');
        });
        thumbsEl.appendChild(thumb);
      });
    }

    function renderSlide(index) {
      var data = productSlides[index];
      slideImg.src = data.images[0].src;
      slideImg.alt = data.images[0].alt;
      renderThumbs(data);
      badgeEl.textContent = data.badge;
      nameEl.innerHTML = data.heading;
      priceEl.textContent = formatPrice(data);
      descEl.textContent = data.desc;
      dimensionsEl.textContent = formatDimensions(data.dimensions);
      dimensionsEl.hidden = !data.dimensions;
      specsEl.innerHTML = data.specs;
      productCta.href = buildWhatsAppLink(data.plainName);
      productDots.forEach(function(dot, i) {
        var active = i === index;
        dot.classList.toggle('is-active', active);
        if (active) { dot.setAttribute('aria-current', 'true'); }
        else { dot.removeAttribute('aria-current'); }
      });
    }

    function renderDots() {
      productDotsContainer.innerHTML = '';
      productSlides.forEach(function(slide, i) {
        var dot = document.createElement('button');
        dot.className = 'product-dot' + (i === 0 ? ' is-active' : '');
        dot.setAttribute('data-slide', i);
        dot.setAttribute('aria-label', 'Voir la pièce ' + (i + 1));
        if (i === 0) dot.setAttribute('aria-current', 'true');
        dot.addEventListener('click', function() {
          goToSlide(i);
        });
        productDotsContainer.appendChild(dot);
      });
      productDots = productDotsContainer.querySelectorAll('.product-dot');
    }

    function goToSlide(index) {
      if (isTransitioning || index === currentSlide) return;
      isTransitioning = true;
      currentSlide = index;

      var done = false;
      function finish() {
        if (done) return;
        done = true;
        renderSlide(currentSlide);
        productSection.classList.remove('is-fading');
        isTransitioning = false;
      }

      infoContent.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, 500);
      productSection.classList.add('is-fading');
    }

    productPrevBtn.addEventListener('click', function() {
      goToSlide((currentSlide + productSlides.length - 1) % productSlides.length);
    });

    productNextBtn.addEventListener('click', function() {
      goToSlide((currentSlide + 1) % productSlides.length);
    });

    renderDots();
    renderSlide(currentSlide);
  }

  /* ── Lookbook: Momentum drag + Arrow buttons ── */
  var track = document.querySelector('.lookbook-track');
  if (track) {
    var isDragging = false;
    var startX = 0;
    var scrollStart = 0;
    var velX = 0;
    var lastX = 0;
    var lastTime = 0;
    var momentumId = null;
    var dragDistance = 0;

    track.addEventListener('mousedown', function(e) {
      cancelMomentum();
      isDragging = true;
      startX = e.clientX;
      lastX = e.clientX;
      scrollStart = track.scrollLeft;
      lastTime = Date.now();
      velX = 0;
      dragDistance = 0;
      track.classList.add('is-dragging');
    });

    document.addEventListener('mousemove', function(e) {
      if (!isDragging) return;
      e.preventDefault();
      var now = Date.now();
      var dt = now - lastTime;
      var dx = e.clientX - lastX;
      if (dt > 0) velX = dx / dt;
      lastX = e.clientX;
      lastTime = now;
      dragDistance = Math.abs(e.clientX - startX);
      track.scrollLeft = scrollStart - (e.clientX - startX);
    });

    document.addEventListener('mouseup', function() {
      if (!isDragging) return;
      isDragging = false;
      track.classList.remove('is-dragging');
      startMomentum();
    });

    function startMomentum() {
      if (Math.abs(velX) < 0.1) return;
      var speed = -velX * 18;
      function step() {
        speed *= 0.94;
        if (Math.abs(speed) < 0.5) return;
        track.scrollLeft += speed;
        momentumId = requestAnimationFrame(step);
      }
      momentumId = requestAnimationFrame(step);
    }

    function cancelMomentum() {
      if (momentumId) {
        cancelAnimationFrame(momentumId);
        momentumId = null;
      }
    }

    /* Arrow buttons */
    var prevBtn = document.getElementById('lbPrev');
    var nextBtn = document.getElementById('lbNext');
    var cards = track.querySelectorAll('.lookbook-card');

    function getScrollStep() {
      return cards.length ? cards[0].offsetWidth + 28 : 400;
    }

    function smoothScroll(target) {
      cancelMomentum();
      var start = track.scrollLeft;
      var dist = target - start;
      var duration = 600;
      var startTime = null;

      function ease(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      }

      function animate(now) {
        if (!startTime) startTime = now;
        var elapsed = now - startTime;
        var progress = Math.min(elapsed / duration, 1);
        track.scrollLeft = start + dist * ease(progress);
        if (progress < 1) requestAnimationFrame(animate);
      }

      requestAnimationFrame(animate);
    }

    if (prevBtn) prevBtn.addEventListener('click', function() {
      smoothScroll(track.scrollLeft - getScrollStep());
    });

    if (nextBtn) nextBtn.addEventListener('click', function() {
      smoothScroll(track.scrollLeft + getScrollStep());
    });

    /* Click/tap to zoom (skipped when the click ends a drag) */
    cards.forEach(function(card) {
      var img = card.querySelector('img');
      if (img) {
        card.addEventListener('click', function(e) {
          if (e.target !== card && e.target !== img) return;
          if (dragDistance > 5 || !openLightbox) return;
          openLightbox(img.src, img.alt, {
            name: card.getAttribute('data-piece-name'),
            desc: card.getAttribute('data-desc'),
            dimensions: card.getAttribute('data-dimensions')
          });
        });
      }

      var cta = card.querySelector('.lookbook-card-cta');
      if (cta) {
        cta.href = buildWhatsAppLink(card.getAttribute('data-piece-name'));
        cta.addEventListener('click', function(e) {
          if (dragDistance > 5) e.preventDefault();
        });
      }

      // Badge « Personnalisable » : href déjà posé au build, seule la garde anti-drag est partagée
      var badge = card.querySelector('.lookbook-card-badge');
      if (badge) {
        badge.addEventListener('click', function(e) {
          if (dragDistance > 5) e.preventDefault();
        });
      }
    });
  }

  /* ── Lookbook: Lightbox zoom ── */
  var lightbox = document.getElementById('lightbox');
  if (lightbox) {
    var lightboxImg = lightbox.querySelector('.lightbox-img');
    var lightboxClose = lightbox.querySelector('.lightbox-close');
    var lightboxCaption = lightbox.querySelector('.lightbox-caption');
    var captionName = lightbox.querySelector('.lightbox-caption-name');
    var captionDimensions = lightbox.querySelector('.lightbox-caption-dimensions');
    var captionDesc = lightbox.querySelector('.lightbox-caption-desc');

    // details : { name, desc, dimensions } lus sur la carte ; la légende n'apparaît
    // que si la pièce a une description ou des dimensions (textContent : jamais de HTML)
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

    function closeLightbox() {
      // le bouton × reste focusable au clavier lightbox fermée (opacity: 0, pas display: none)
      if (!lightbox.classList.contains('is-open')) return;
      lightbox.classList.remove('is-open');
      lightbox.setAttribute('aria-hidden', 'true');
      unlockScroll();
    }

    lightboxClose.addEventListener('click', closeLightbox);

    lightbox.addEventListener('click', function(e) {
      if (e.target === lightbox) closeLightbox();
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeLightbox();
    });
  }

  /* ── Hamburger ── */
  var hamburger = document.querySelector('.hamburger');
  var mobileNav = document.querySelector('.mobile-nav');
  var mobileLinks = document.querySelectorAll('.mobile-nav a');

  function closeMobileNav() {
    hamburger.classList.remove('open');
    mobileNav.classList.remove('open');
    unlockScroll();
  }

  hamburger.addEventListener('click', function() {
    var opening = !mobileNav.classList.contains('open');
    hamburger.classList.toggle('open', opening);
    mobileNav.classList.toggle('open', opening);
    if (opening) lockScroll(); else unlockScroll();
  });

  mobileLinks.forEach(function(link) {
    link.addEventListener('click', closeMobileNav);
  });

  /* ── FAQ: centrage figé au repos ──
     La section fait un écran ; centrer le bloc en flex le ferait remonter de la moitié
     de chaque réponse ouverte (voir .faq dans le CSS). On mesure la marge libre bloc
     fermé et on pose la moitié en --faq-offset : l'ouverture ne pousse plus que vers le bas. */
  var faqSection = document.querySelector('.faq');
  var faqInner = document.querySelector('.faq-inner');
  var faqItems = document.querySelectorAll('.faq-item');

  function centerFaq() {
    if (!faqSection || !faqInner) return;
    if (faqSection.querySelector('.faq-item.is-open')) return; // la mesure doit être celle du bloc fermé
    faqSection.style.setProperty('--faq-offset', '0px');      // sinon l'offset précédent fausse la mesure
    var cs = getComputedStyle(faqSection);
    var free = faqSection.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - faqInner.offsetHeight;
    faqSection.style.setProperty('--faq-offset', Math.max(0, free / 2) + 'px');
  }

  centerFaq();
  window.addEventListener('load', centerFaq);
  window.addEventListener('resize', centerFaq);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(centerFaq); // le swap Fraunces change la hauteur du bloc

  /* ── FAQ: accordion ── */
  faqItems.forEach(function(item) {
    var trigger = item.querySelector('.faq-trigger');
    var panel = item.querySelector('.faq-panel');
    if (!trigger || !panel) return;
    trigger.addEventListener('click', function() {
      var open = item.classList.toggle('is-open');
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    });
    // Rattrape un redimensionnement survenu panneau ouvert : recalcul une fois le panneau
    // refermé (fin de transition, pas au clic, sinon la mesure inclurait le panneau en cours de fermeture)
    panel.addEventListener('transitionend', function(e) {
      if (e.propertyName === 'grid-template-rows' && !item.classList.contains('is-open')) centerFaq();
    });
  });

  /* ── Smooth scroll for pill nav ── */
  pillLinks.forEach(function(link) {
    link.addEventListener('click', function(e) {
      var href = this.getAttribute('href');
      if (href && href.length > 1 && href.startsWith('#')) {
        e.preventDefault();
        var target = document.querySelector(href);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

})();