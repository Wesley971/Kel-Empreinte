/* JavaScript Document

Tooplate 2166 Ivory Flow

https://www.tooplate.com/view/2166-ivory-flow

Comportements propres à l'accueil : apparition de la frise du savoir-faire, lien actif de la
navigation pilule, couleur du décorateur vertical sur la section sombre, FAQ. La navigation
elle-même, le menu mobile et le verrou de scroll sont dans site.js, partagé avec la boutique.
Les pièces mises en avant et les collections sont générées au déploiement (build.js) : aucune
donnée n'est chargée ici.

*/

(function() {
  'use strict';

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

  /* ── FAQ: accordéon sur mobile, réponse dans une scène dédiée au-delà de 768px ──
     Les réponses sont écrites dans leur question (accordéon, et rendu sans script). Au-dessus
     du point de bascule, elles sont déplacées dans .faq-stage et affichées une à la fois :
     cliquer une question ne modifie plus que le contenu de la scène, la liste ne bouge pas. */
  var faqSection = document.querySelector('.faq');
  var faqItems = document.querySelectorAll('.faq-item');
  var faqStage = document.querySelector('.faq-stage');
  var faqSplit = window.matchMedia('(min-width: 769px)');

  function faqPanelOf(item) {
    var trigger = item.querySelector('.faq-trigger');
    return trigger ? document.getElementById(trigger.getAttribute('aria-controls')) : null;
  }

  function showFaq(item, open) {
    var trigger = item.querySelector('.faq-trigger');
    var panel = faqPanelOf(item);
    if (!trigger || !panel) return;
    item.classList.toggle('is-open', open);
    panel.classList.toggle('is-shown', open);
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  function applyFaqLayout() {
    if (!faqStage) return;
    var split = faqSplit.matches;
    var selected = null;
    // La scène n'est annoncée qu'une fois son contenu en place (plus bas) : une région live
    // armée pendant qu'on y déplace les réponses ferait lire la première réponse au chargement,
    // et la réponse sélectionnée à chaque franchissement de largeur.
    faqStage.removeAttribute('aria-live');
    faqItems.forEach(function(item) {
      var panel = faqPanelOf(item);
      if (!panel) return;
      if (!selected && item.classList.contains('is-open')) selected = item;
      // Le déplacement ne perd aucun écouteur : ils sont posés sur les éléments, pas sur leur position.
      if (split) faqStage.appendChild(panel);
      else item.appendChild(panel);
    });
    if (faqSection) faqSection.classList.toggle('is-split', split);
    // Une réponse est toujours affichée en format à panneau : la question déjà ouverte, sinon
    // la première. En accordéon, l'état en cours est conservé tel quel.
    if (split) {
      var current = selected || faqItems[0];
      faqItems.forEach(function(item) { showFaq(item, item === current); });
      // Armée au tour suivant, donc après les déplacements et l'affichage initial : seuls les
      // changements de réponse provoqués par un clic sont lus. En mode panneau, la réponse est
      // loin de sa question dans l'ordre de lecture (elle suit toute la liste), d'où l'annonce.
      setTimeout(function() { if (faqSplit.matches) faqStage.setAttribute('aria-live', 'polite'); }, 0);
    }
  }

  faqItems.forEach(function(item) {
    var trigger = item.querySelector('.faq-trigger');
    var panel = faqPanelOf(item);
    if (!trigger || !panel) return;
    trigger.addEventListener('click', function() {
      if (faqSplit.matches) {
        faqItems.forEach(function(other) { showFaq(other, other === item); }); // une seule réponse à la fois
      } else {
        showFaq(item, !item.classList.contains('is-open'));
      }
    });
  });

  applyFaqLayout();
  faqSplit.addEventListener('change', applyFaqLayout); // au franchissement seulement, pas à chaque resize

})();
