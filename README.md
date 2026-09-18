# Kel'Empreinte — site et boutique

Site statique (HTML / CSS / JS sans framework) de la marque de bijoux artisanaux Kel'Empreinte,
hébergé sur Cloudflare Pages. Trois pages : l'**accueil** (`/`, la vitrine : histoire, pièces mises
en avant, collections, FAQ, contact), la **boutique** (`/boutique/`, toutes les pièces, filtrables)
et une **page par pièce** (`/boutique/<id>/`). Le catalogue vit dans `data/products.json` sur GitHub ;
la marque le modifie depuis l'espace de gestion (`/admin/`, voir plus bas) et les pages sont
régénérées à chaque déploiement (KD-97, cadrage KD-84). Le panier et le paiement (KD-64) ne sont pas
encore là : les pages renvoient vers WhatsApp.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | l'accueil ; la navigation, les coordonnées de la section « Contact », les sections « Pièces mises en avant » et « Collections » y sont **générées** entre les marqueurs `<!-- build:… -->` |
| `templates/boutique.html`, `templates/piece.html` | gabarits sources de la boutique et des pages pièce (mêmes marqueurs) ; `build.js` les remplit et écrit `boutique/`. Déployés avec le site mais **jamais servis** : `functions/templates/[[path]].js` répond 404 (le `_redirects` de Pages ne sait pas produire un 404), et la sonde le vérifie |
| `templates/partials/nav.html`, `templates/partials/footer.html` | la navigation et le pied de page, **écrits une seule fois** et injectés par `build.js` dans les quatre pages (voir *Navigation et pied de page*). Le commentaire de tête de chaque partiel explique le fichier et n'est pas injecté |
| `boutique/`, `sitemap.xml` | **générés au build, jamais committés** (`.gitignore`) : `boutique/index.html` + une page par pièce visible, plan du site. Vidés et réécrits à chaque `node build.js` |
| `404.html` | servie par Pages avec un vrai code 404 pour tout chemin inconnu — dont l'adresse d'une pièce passée en brouillon ou retirée. Porte la même navigation et le même pied de page que le reste du site, réécrits en place comme ceux d'`index.html` |
| `tokens.css` | les variables CSS du site (palette, courbes, texture) — seule définition, chargée par toutes les pages **avant** leur feuille et par `/admin/`. Contient aussi la **palette sombre** (voir *Mode sombre*) |
| `tooplate-ivory-style.css`, `tooplate-ivory-script.js` | styles de base et comportement de l'accueil (template Tooplate 2166 adapté) |
| `shop.css` | composants du site marchand : carte d'une pièce, puces de filtre, grille, page pièce, bandes de collections, pied de page, 404 |
| `site.js` | navigation, menu mobile, verrou de scroll, lightbox — partagé par toutes les pages |
| `shop.js` | boutique (filtres, état dans l'URL) et page pièce (galerie) |
| `catalog.js` | tout ce qui touche à une pièce, écrit une fois et partagé par le navigateur, le build, l'espace de gestion et les Functions : vocabulaire (états, types, publics, canaux, options de personnalisation), règle « peut passer en vente », ordres d'affichage, prix et promotion, référence, liens WhatsApp, rendu des cartes |
| `build.js` | script de build : valide le catalogue (modèle v2, voir *Modèle*), génère l'accueil, la boutique, les pages pièce et le plan du site ; échoue si les données sont incohérentes |
| `check-site.js` | sonde : compare le site en ligne au dépôt (voir *Surveillance*) |
| `check-catalog-drop.js` | garde-fou : repère une chute anormale du nombre de pièces dans un push |
| `.github/workflows/` | planification des deux contrôles ci-dessus (GitHub Actions) |
| `data/products.json` | **source de vérité du catalogue**, modifiée par l'espace de gestion (`/admin/`) via les Functions, un commit par modification (voir *Modèle*) |
| `data/collections.json` | les collections nommées (`id`, `name`, `order`, `tagline`, `cover`) : une bande par collection sur l'accueil, dans cet ordre. « Nouveautés » n'y est pas : elle est automatique (les 8 dernières pièces en vente) |
| `data/site.json` | les coordonnées (`contact` : `email`, `phone` au format international, `phoneLabel`, `whatsapp`) et les boutiques (`shops` : `name`, `url`). **Seule source** de ces liens : pied de page des quatre pages, section « Contact » de l'accueil, intro de la boutique, réponse « personnaliser » de la FAQ, messages de catalogue vide et liens WhatsApp des cartes et pages pièce (`catalog.js` reçoit le lien par `configure()`, il n'écrit jamais le numéro). Ne contient pas la navigation — c'est le fichier que l'écran de réglages de KD-79 écrira |
| `data/shipping.json` | les modes d'envoi (`methods` : `id`, `label`, `price`, un seul `standard: true`, `freeFrom` = montant à partir duquel le mode standard est offert). **Seule source des tarifs** : la réponse « paiement et livraison » de la FAQ est générée d'ici, et le panier (KD-64) y lira les frais. La Poste change ses prix chaque année : on modifie ce fichier, jamais une page |
| `admin/` | l'espace de gestion, derrière Cloudflare Access (voir *Espace de gestion*). `index.html` + `gestion.css` + `gestion.js` = l'écran « Mes bijoux » (les fichiers nomment l'espace, pas le chemin) ; `manifest.webmanifest` + `icon-*.png` = nom « Mes bijoux » et icône opaque (fond crème) du raccourci « écran d'accueil » de Prescilia (KD-66), `start_url` et `scope` `/admin/` ; `guide.html` = **ancien** guide « Gérer mes bijoux », écrit pour Sveltia, remplacé par KD-104 |
| `images/` | photos des pièces (KD-93 y écrira depuis l'espace de gestion). `images/logo/` : le logo en 200 px, en deux versions — `logo-kel-empreinte.png` (« Empreinte » en encre, appareil clair) et `logo-kel-empreinte-dark-mode.png` (« Empreinte » en crème, appareil sombre) — et l'image de partage `og-image-kel-empreinte.png`. Les sources haute résolution ne sont pas dans le dépôt |
| `favicon.svg` | favicon qui embarque les deux logos et affiche celui du réglage de l'appareil (Chrome, Firefox) ; Safari ignore les favicons SVG et garde le PNG déclaré avant lui |
| `functions/` | Cloudflare Pages Functions : les routes `/api/*` (voir *Fonctions serverless*). `_lib/` = modules partagés (réponses JSON, accès GitHub, catalogue — lecture / réécriture fidèle de `products.json`, vérification du jeton Cloudflare Access, `build-info.js` = branche du déploiement, réécrit par `build.js` sur Pages) ; `api/` = les routes, une par fichier |
| `.node-version` | version de Node utilisée par le build Cloudflare |

## Déploiement — Cloudflare Pages

Réglages du projet dans le dashboard Cloudflare (ils ne sont **pas** versionnés — ce tableau est
la référence si le projet doit être recréé ; état vérifié le 15/09/2026, page *Settings* du
projet, bloc **Build**) :

| Réglage | Valeur |
|---|---|
| Projet | `kel-empreinte` — https://kel-empreinte.pages.dev |
| Dépôt Git | `Wesley971/Kel-Empreinte`, production branch `master`, automatic deployments : enabled |
| Build command | `node build.js` |
| Build output directory | vide (= racine du dépôt : rien n'est copié, `index.html` est réécrit en place) |
| Root directory | vide |
| Build system version | 3 ; Node lu dans `.node-version` (22.16.0 détecté au build) |
| Build cache / watch paths | disabled / `*` (valeurs par défaut) |
| Previews | chaque push d'une branche hors `master` déploie une preview `<branche>.kel-empreinte.pages.dev` avec la même build command (réglage non affiché dans l'interface actuelle, comportement vérifié) |
| Notification | compte › *Notifications* › **Pages › Project updates**, nommée « Kel'Empreinte - échec de déploiement » : projet `kel-empreinte`, environnements Production + Preview, événement **Deployment failed** seul, e-mail au mainteneur |
| Access policy | **enabled** — protège toutes les previews `*.kel-empreinte.pages.dev` par Cloudflare Access ; l'application correspondante et celle de la production sont décrites dans *Espace de gestion* |

Chaque push sur `master` — y compris chaque enregistrement depuis l'espace de gestion — déclenche
un build puis un déploiement (~1 à 2 min). Un build en échec **laisse le dernier déploiement en
ligne** et envoie l'e-mail de notification : rien ne casse en ligne, mais la modification n'est pas
publiée tant que la donnée fautive n'est pas corrigée. Un seul build à la fois (plan gratuit) : des
enregistrements rapprochés se mettent en file — l'écran de gestion l'annonce (« mise en ligne dans
1 à 2 minutes ») sans le vérifier.

**Rollback** : vider la build command dans le dashboard fait retomber le site sur le HTML committé
(périmé mais fonctionnel) ; ou redéployer une version précédente depuis la liste des déploiements
(chaque déploiement garde une URL permanente `<hash>.kel-empreinte.pages.dev`).

## Mode sombre

Le site suit le réglage clair / sombre de l'appareil (`prefers-color-scheme`), avec sa propre palette :
toutes les pages déclarent `color-scheme: light dark` et `tokens.css` redéfinit les variables sous
`@media (prefers-color-scheme: dark)`. Le logo change avec : chaque `<img>` du logo est dans un
`<picture>` dont la `<source media="(prefers-color-scheme: dark)">` pointe sur la version à
« Empreinte » crème (KD-101).

Pourquoi une palette à nous plutôt que l'assombrissement automatique de Chrome Android : ce réglage
veut dire « la visiteuse préfère le sombre », pas « la page est rendue sombre ». Safari (iPhone) et
Firefox n'assombrissent jamais une page ; sans palette sombre déclarée, elles auraient reçu le logo crème
sur fond crème. Déclarer `light dark` fait aussi que Chrome cesse d'assombrir la page de force et rend
la nôtre (vérifié : une page `light` seule est assombrie, une page `light dark` ne l'est plus).

La palette sombre est **calibrée sur ce que Chrome produisait** (inversion de luminosité en CIELAB,
`L' = 110 − L`), rendu qui avait été approuvé, avec quelques écarts de conception notés dans
`tokens.css` (puce active claire, texte atténué plus discret, terracotta inchangé). Règles :

- toute couleur qui doit basculer passe par un token, y compris les surfaces translucides (`--glass*`,
  `--hairline`, `--ghost-text`) ; les seuls littéraux restants sont des ombres et les nuances de la
  lightbox et du bouton vidéo, constantes par design ;
- les surfaces **sombres par design** dans les deux modes (section « Comment naît chaque pièce »,
  fragment vidéo, lightbox) utilisent les constantes `--night` / `--cream` / `--cream-muted`, qui ne
  basculent pas — pas `--ink` / `--oat`, qui basculent ;
- `/admin/` définit ses couleurs propres (`--kel-error`, `--kel-error-ghost`, `--kel-surface`, `--kel-backdrop`)
  dans les deux modes, dans `admin/gestion.css`.

Pour vérifier un rendu sans changer le réglage de son appareil : DevTools › Rendering › *Emulate CSS
media feature prefers-color-scheme*. L'icône d'écran d'accueil (manifest) ne peut pas suivre le
réglage : elle relève de KD-95.

## Build local

```
node build.js
```

Lit `data/products.json`, `data/collections.json`, `data/site.json` et `data/shipping.json`, vérifie les données, puis
génère : les régions de l'accueil et de `404.html` (réécrits en place entre les marqueurs),
`boutique/index.html`, une page
`boutique/<id>/index.html` par pièce visible (disponible, réservée, vendue) et `sitemap.xml`. Toute la
validation précède la première écriture ; `boutique/` est vidé avant d'être réécrit, pour qu'aucune
page d'une pièce devenue brouillon ou retirée ne survive. Le script refuse de générer (sortie 1,
message qui nomme la pièce et le champ) si : JSON invalide ou vide, champ inconnu ou de l'ancien
format, identifiant en double ou qui n'est pas un slug, état / type / public inconnu, référence en
double une fois normalisée, pièce en vente ou réservée sans prix ou sans photo, pièce vendue sans
photo, réservée sans date, vente datée dans le futur (heure de Paris), promotion supérieure au prix,
collection inconnue, photo sans description ou fichier introuvable, marqueur absent ou en double, mode d'envoi sans prix numérique ou sans mode standard unique. Un
catalogue sans pièce visible **n'est pas une erreur** : les pages le disent. Le catalogue est validé
tel qu'écrit puis rendu tel que **réglé** à l'instant du build : une réservation échue est rendue
disponible (voir *Réservation*), et le journal le dit.

### Navigation et pied de page

Écrits **une seule fois** (KD-100), en trois morceaux qui ne se recouvrent pas :

| Quoi | Où ça se modifie |
|---|---|
| le balisage (coque de la pilule, hamburger, menu mobile, structure du pied de page) | `templates/partials/nav.html` et `templates/partials/footer.html` |
| les entrées du menu — ajouter, renommer, déplacer, retirer | la liste `NAV_ITEMS` de `build.js`, et nulle part ailleurs |
| les liens de contact et de boutiques | `data/site.json` |

`build.js` remplit les partiels puis les injecte dans la région `<!-- build:nav:… -->` des quatre
pages et dans `<!-- build:footer:… -->` des trois qui ont un pied de page. L'accueil n'en a pas :
ses coordonnées vivent dans la section « Contact », avec son propre balisage, alimentée par les
régions `signature-contact` et `signature-links` — mêmes données, autre habillage.

Même mécanique pour trois paragraphes qui portent des données : l'intro de la boutique (région
`shop-intro`, lien WhatsApp) et, dans la FAQ de l'accueil, la réponse « personnaliser » (`faq-customization`,
lien WhatsApp) et la réponse « paiement et livraison » (`faq-shipping`, montants de `data/shipping.json`).
Les trois autres réponses de la FAQ restent écrites dans `index.html`. Le numéro WhatsApp n'existe
qu'à un endroit, `data/site.json` : les vingt pages générées le suivent au build suivant.

Trois variantes de navigation, choisies par page : `home` (toutes les entrées, ancres locales,
« Accueil » active), `shop` (boutique et pages pièce ; les entrées `homeOnly` disparaissent, les
ancres deviennent `/#…`, « Boutique » active) et `plain` (404, aucune entrée active). L'entrée active
est désignée par son adresse, jamais par son libellé : renommer une entrée n'éteint pas sa mise en
évidence.

Un partiel est lu en LF quelles que soient ses fins de ligne sur le disque, et une région vide fait
**échouer** le build — une navigation absente est une erreur de génération, pas un état légitime.

Le HTML committé d'`index.html` est un **instantané** : après une modification depuis l'espace de
gestion, le dépôt est périmé jusqu'au prochain `node build.js` local (Cloudflare, lui, régénère à
chaque déploiement). Lancer le build avant de committer une modification d'`index.html` ou de
`404.html` — les deux seuls fichiers versionnés réécrits en place —, et ne jamais éditer à la main ce
qui se trouve entre les marqueurs : c'est écrasé au déploiement. En local,
`boutique/` n'existe qu'après un build ; servir la racine avec n'importe quel serveur statique.

Sur Cloudflare (`CF_PAGES=1`), le build réécrit aussi `functions/_lib/build-info.js` avec la branche
et le commit du déploiement (`CF_PAGES_BRANCH`, `CF_PAGES_COMMIT_SHA`) : c'est ainsi que les Functions
savent sur quelle branche écrire (voir *Fonctions serverless*). En local, le fichier commité (branche
inconnue) n'est jamais touché — ne pas y committer une autre valeur.

### Modèle — `data/products.json` (v2, KD-97)

Une liste de pièces **uniques** : pas de stock ni de quantité. Les champs et leurs règles :

| Champ | Valeurs | Règle |
|---|---|---|
| `id` | slug `minuscules-tirets` | clé technique, invisible, jamais modifiée ; devient l'adresse `/boutique/<id>/` |
| `reference` | texte libre ou `null` | la référence de Prescilia (« BO-023 », « BO.R1.4o »), affichée sur les cartes, les pages et dans les messages WhatsApp ; **unique** une fois normalisée (casse, espaces, tirets et points ignorés : `BO023` = `bo-023`). Une pièce retirée garde la sienne : une référence n'est jamais réutilisée |
| `name`, `category`, `audience` | texte · `boucles-oreilles`, `collier`, `noeud-papillon`, `bague`, `bracelet`, `cravate`, `broche` · `femme`, `homme`, `mixte` | obligatoires sauf en brouillon ; les libellés sont dans `catalog.js`. `mixte` sort sous les deux filtres Femme et Homme. Un type sans pièce n'a pas de puce en boutique |
| `collections` | liste d'`id` de `collections.json` | facultative, plusieurs possibles |
| `availability` | `disponible` · `reservee` · `vendue` · `brouillon` · `retiree` | **disponible** : accueil (si mise en avant) et boutique, prix et achat. **reservee** : masquée de l'accueil ; en boutique « Réservée jusqu'au … », sans bouton — **jusqu'à l'échéance seulement** : passé `reservedUntil`, la pièce redevient disponible toute seule (voir *Réservation*). **vendue** : masquée de l'accueil ; en boutique après les autres, photo estompée, « Vendue » et un lien WhatsApp « Une pièce semblable ? » ; sa page reste en ligne (un lien partagé survit à la vente). **brouillon** : jamais publiée, en cours de saisie, seul état supprimable (KD-93) — aucune action ne ramène une pièce publiée en brouillon. **retiree** : publiée puis sortie du site sans être vendue (cassée, offerte, gardée), remise en vente possible. Brouillons et retirées : nulle part sur le site, pas même une page (→ 404) |
| `reservedUntil` | date `AAAA-MM-JJ` | obligatoire si `reservee`, interdit sinon. **Le dernier jour réservé, inclus** ; jamais saisi : l'API le calcule (jour de la réservation + 13, heure de Paris) |
| `price`, `promoPrice` | nombres ≥ 0 · `null` | prix obligatoire pour une pièce en vente ou réservée ; `promoPrice` doit être inférieur au prix, il s'affiche alors devant le prix barré |
| `customization` | `{ "options": [`fleurs` · `couleur` · `taille` · `forme`] }` | liste vide = non personnalisable. Jamais de prix : la page propose « Demander un devis » (WhatsApp, réponse sous 72 h) |
| `desc`, `materials`, `dimensions` | texte · liste de textes · texte | description **sans limite**, retours à la ligne et emojis conservés (`white-space: pre-line`) |
| `images` | liste `{ src, alt }` | la première est la vignette partout, toutes sont sur la page pièce. Photo **obligatoire** pour une pièce en vente, réservée ou vendue : l'espace de gestion refuse de mettre en vente une pièce sans photo ou sans prix (règle unique dans `catalog.js`, appliquée par l'écran, l'API et le build) |
| `featured`, `featuredOrder` | booléen · nombre | mise en avant sur l'accueil, en vente seulement — une pièce réservée ou vendue en sort d'elle-même ; si aucune n'est cochée, l'accueil montre les 4 dernières ajoutées |
| `createdAt` | date `AAAA-MM-JJ` | obligatoire ; ordonne la boutique (plus récentes d'abord dans chaque état), nourrit « Nouveautés » et le repli de l'accueil |
| `sale` | `{ amount, channel, date }` ou absent | renseigné quand la pièce passe vendue : `amount` = montant **net encaissé** (nombre ≥ 0, ou `null` tant que Prescilia ne l'a pas complété — l'écran le réclame), `channel` parmi `site`, `sumup`, `whatsapp`, `etsy`, `vinted`, `physique`, `date` = jour de la vente, **jamais dans le futur** (à l'heure de Paris). Interdit sur une pièce non vendue ; une vendue remise en vente le perd |

Tout champ inconnu, et tout champ de l'ancien modèle (`heading`, `plainName`, `badge`, `specs`,
`priceType`, `priceConfirmed`, `customizable`, état `bientot`), fait échouer le build avec un message
explicite. Un **brouillon** n'est vérifié que sur les types : c'est une saisie en cours.

Les espaces insécables du fichier sont écrits `\u00a0` : les Functions les réécrivent tels quels
(round-trip identique octet pour octet, couvert par un test), pour que le diff d'un commit de
l'espace de gestion ne contienne que la modification voulue.

### Réservation — 14 jours fixes, heure de Paris (KD-98)

La règle de Prescilia : une pièce réservée le 1er reste réservée **jusqu'au 14 inclus** et redevient
disponible **le 15 à 00 h 00, heure de Paris**. Rien ne se saisit ni ne se prolonge : l'API calcule
`reservedUntil` (jour + 13), et « Remettre en vente » annule la réservation avant terme si la cliente
renonce. La règle vit **une seule fois**, dans `catalog.js` (`TIME_ZONE = 'Europe/Paris'`,
`RESERVATION_DAYS = 14`, `todayInParis`, `reservationEnd`, `isReservationActive`,
`effectiveAvailability`, `settleReservation`), et trois consommateurs l'appliquent à l'identique :

- **`build.js`** rend le catalogue *réglé* à l'instant du build : une réservation échue est une pièce
  disponible pour toutes les pages (le fichier garde `reservee` + sa date jusqu'à la prochaine action
  de Prescilia). Une carte ou une page pièce encore réservée porte `data-reserved-until` et **ses deux
  visages** : ce qui se montre tant que la réservation tient (`data-while-reserved`) et ce qui la
  remplace à l'échéance (`data-after-reservation`, caché).
- **le navigateur** (`shop.js`, boutique et page pièce) compare l'échéance au jour à Paris au
  chargement et bascule d'un visage à l'autre : la pièce redevient achetable **dès 00 h 00 à Paris, sans
  attendre un déploiement**. Les textes montrés à Prescilia disent « au matin du 15 octobre », jamais
  « à minuit ». Sans script, la page reste telle que construite — réservée, le sens sûr. Le
  carrousel de l'accueil, lui, ne se met à jour qu'au déploiement suivant (une pièce mise en avant
  dont la réservation expire y réapparaît alors) — connu, accepté, à revoir avant la mise en service.
- **la Function de checkout** (KD-64) jugera la disponibilité avec `effectiveAvailability` : une
  réservation échue compte comme disponible.

Le fuseau est écrit dans le code, jamais pris sur l'appareil ; les jours `AAAA-MM-JJ` se comparent
comme des chaînes et l'arithmétique passe par `Date.UTC` : le téléphone d'une visiteuse à l'étranger,
le poste de build et le Worker en UTC rendent le même verdict à la même seconde, changements d'heure
compris.

## Historique — Sveltia CMS (retiré le 18/09/2026, KD-95)

Jusqu'au pivot boutique, `/admin` servait Sveltia CMS (connexion GitHub via un Worker OAuth
`sveltia-cms-auth`, écriture directe dans `data/products.json` et `images/`). Hors service depuis le
renommage du projet et volontairement non réparé (KD-84) : sa configuration décrivait le modèle v1,
que `build.js` refuse depuis KD-97. Le dossier, le Worker et son application OAuth GitHub ont été
retirés ; l'espace de gestion ci-dessous a repris le chemin `/admin/`, celui que Prescilia connaît.

## Espace de gestion — `/admin` et Cloudflare Access

L'espace de gestion (KD-84) vit à **`/admin/`** (le chemin provisoire `/gestion/` de KD-91 à KD-95 n'existe
plus : personne ne l'avait en favori, le site n'étant pas encore en service) et écrit par les routes
**`/api/admin/*`**. Les deux sont protégés par
**Cloudflare Access** (Zero Trust) : connexion par **code à usage unique envoyé par mail**, sans
compte GitHub ni mot de passe. Deux verrous en série : Access à la bordure (redirection vers la page
de connexion tant qu'il n'y a pas de session), puis le middleware `functions/api/admin/_middleware.js`
qui revérifie le jeton (voir *Fonctions serverless*). Ce qui est public reste public : `/`,
`/api/health`, `images/`, `tokens.css`, `catalog.js`.

### L'écran « Mes bijoux »

`admin/index.html` + `gestion.css` + `gestion.js`, sans dépendance : la palette vient de `tokens.css`,
les règles de `catalog.js`. Il liste les pièces lues par `GET /api/admin/products` (la vérité du
dépôt, pas le JSON servi avec le site qui a 1 à 2 min de retard), **groupées par état effectif** —
En vente, Réservées, Brouillons, Vendues, Retirées (une réservation échue est « en vente », avec la
mention « Remise en vente le … ») ; les groupes vides n'apparaissent pas. Chaque ligne : photo, nom,
référence, type, prix (barré + promo), une **pastille d'état** qui ouvre la feuille d'actions, et
**« Marquer vendue »** à un tap là où ça a un sens (en vente, réservée).

- **Recherche** (KD-102) : un champ en tête de liste (il défile avec elle ; la zone collante reste à
  l'en-tête et au statut) filtre à chaque frappe sur le **nom** et la **référence**. La saisie est
  découpée en mots : une pièce correspond si **chacun** est contenu dans son nom ou sa référence, dans
  n'importe quel ordre, sans casse ni accents (« velours herbier » trouve « Herbier Jaune Velours » ;
  « bo023 » et « BO-023 » se comparent via `catalog.normalizeReference`). Les groupes gardent leur ordre,
  leurs compteurs suivent, le résumé dit « N sur T » ; aucune correspondance → « Aucune pièce ne
  correspond à « … ». » avec un bouton d'effacement. Rien n'est écrit ni mémorisé : champ vide à chaque
  ouverture. Tout se passe dans la page — la liste est déjà chargée, un rendu complet par frappe coûte
  ~1 ms (une dizaine pour rendre 100 lignes).
- La **feuille d'actions** ne propose que ce que `catalog.allowedTransitions` autorise — la même table
  que l'API (422 pour le reste) : en vente → *Réserver 14 jours* (date calculée affichée, confirmation)
  · *Marquer vendue* · *Retirer du site* (confirmation) ; réservée → *Marquer vendue* · *Remettre en
  vente* (annule la réservation, confirmation) ; vendue → *Compléter la vente* (si le montant manque) ·
  *Remettre en vente* (efface la vente, confirmation) ; brouillon → *Mettre en vente* (désactivé avec la
  raison tant qu'il manque photo ou prix) ; retirée → *Remettre en vente*. Aucune action ne mène vers
  brouillon ; aucune date de réservation ne se saisit.
- **« Marquer vendue »** : modale courte — montant encaissé (facultatif, `inputmode="decimal"`, « 12,50 »
  accepté), canal (six pastilles), date préremplie au jour à Paris, modifiable pour une vente passée,
  jamais dans le futur. Vérifications dans l'écran **et** par l'API.
- Écriture **optimiste, en trois temps** : la ligne prend l'état espéré et se verrouille (statut global
  « Mise à jour du site en cours » tant qu'une écriture est en vol) → la réponse confirme et la pièce
  rejoint son groupe, ou la ligne **revient en arrière** avec la raison écrite dessous → « Enregistré,
  mise en ligne dans 1 à 2 minutes. » L'écran ne vérifie pas la mise en ligne (KD-82).
- Les feuilles sont des `<dialog>` collés en bas de l'écran (pouce), boutons collants quand le clavier
  réduit la hauteur ; toucher le fond ferme.
- Session Access expirée en cours d'usage : l'API répond par une redirection, l'écran la détecte
  (`fetch` en `redirect: 'manual'`) et recharge la page, qui repasse par la connexion. Un garde-fou
  évite une boucle de rechargements.
- Une connexion perdue **après** l'écriture affiche un retour en arrière alors que le dépôt a changé :
  le message invite à recharger, et le rechargement relit GitHub.

Réglages Zero Trust (dashboard, non versionnés — état au 16/09/2026) :

| Réglage | Valeur |
|---|---|
| Équipe | `kelempreinte` → team domain **`kelempreinte.cloudflareaccess.com`** (l'URL de la page de connexion ; le bandeau de cette page peut afficher l'ancien nom auto-généré `hidden-pond-e843`, sans conséquence — l'émetteur du jeton est bien `kelempreinte`, vérifié). Offre Free (50 utilisateurs) : **exige un moyen de paiement enregistré**, sans facturation ; au-delà de 50 sièges les connexions sont bloquées, pas facturées |
| Méthode de connexion | **One-time PIN** seule (*Settings › Authentication › Login methods*) |
| Application « production » | *Access controls › Applications* › « Kel'Empreinte — espace de gestion (production) » : hostnames **`kel-empreinte.pages.dev/admin*`** et **`kel-empreinte.pages.dev/api/admin*`** (le `*` en fin de chemin couvre le chemin nu et ses sous-chemins ; `admin/*` seul **exclurait** `/admin`). Une seule application, jamais recréée : son AUD est celui de `CF_ACCESS_AUD`. Le chemin est passé de `gestion*` à `admin*` le 18/09/2026 (KD-95), en ajoutant le nouveau **avant** le déploiement et en retirant l'ancien **après** — jamais de fenêtre sans couverture |
| Application « previews » | « Kel'Empreinte — espace de gestion (previews) » : hostname **`*.kel-empreinte.pages.dev`**, tout le site des previews. Créée par le bouton *Access policy* du projet Pages |
| Policy (les deux applications) | une seule, **Allow**, *Include → Emails* : les adresses de Prescilia et de Wesley, rien d'autre |
| Session | **1 semaine** (les deux applications) |
| AUD | chaque application a son *Application Audience (AUD) Tag* (onglet *Overview*) → `CF_ACCESS_AUD` de l'environnement Pages correspondant : production ↔ Production, previews ↔ Preview |

Les deux applications viennent de la procédure « Known issues » de Cloudflare Pages, la seule qui
accepte un hostname `pages.dev` sans domaine personnalisé : activer *Access policy* sur le projet
(crée l'application `*.kel-empreinte.pages.dev`), retirer le `*` du sous-domaine dans Zero Trust et
poser les chemins (→ application de production), puis réactiver *Access policy* (→ nouvelle
application pour les previews).

**Ajouter ou retirer une personne** : Zero Trust › Applications › chaque application › *Policies* ›
la liste *Emails*. Aucun déploiement nécessaire. **Révoquer une session en cours** : *Zero Trust ›
My Team › Users* › la personne › *Revoke sessions*.

**Vérifier** (sans session, la bordure doit rediriger ; ce qui est public ne doit pas l'être) :

```
curl -sI https://kel-empreinte.pages.dev/admin/ | grep -i location       # https://kelempreinte.cloudflareaccess.com/…
curl -sI https://kel-empreinte.pages.dev/api/admin/ | grep -i location   # idem
curl -sI https://kel-empreinte.pages.dev/ | head -1                      # 200, pas de redirection
```

Après connexion dans un navigateur, `/api/admin/quoi` répond `404 {"error":"Cette adresse n'existe pas."}`
avec `Cache-Control: no-store` : la preuve que le middleware a accepté le jeton. Un `401` à la place
signifie que `CF_ACCESS_AUD` ou `CF_ACCESS_TEAM_DOMAIN` ne correspond pas à l'application (le log
`access : …` du déploiement nomme la cause) ; un `503`, que les variables manquent.

**Limite** : les previews étant entièrement derrière Access, `node check-site.js --url <preview>` ne
fonctionne plus (la page de connexion est servie à la place de la boutique). La sonde vise la production.

## Fonctions serverless — `/api`

Le dossier `functions/` est compilé par Cloudflare Pages à chaque déploiement en un Worker qui
répond sur `/api/*` (pas de `package.json`, pas de wrangler : Cloudflare détecte le dossier et
génère le routage). Il n'est **pas** servi en statique, bien que l'output directory soit la racine
(`functions` figure dans la liste d'exclusion de l'upload Pages). Le reste du site ne passe pas par
ce Worker. Ce socle porte l'espace de gestion (`/api/admin/*`) et, plus tard, le paiement en
ligne SumUp.

| Route | Rôle |
|---|---|
| `GET /api/health` | preuve de vie : lit `data/products.json` sur GitHub avec le token et répond `{ ok, github, products, checkedAt }` (200) ou `{ ok: false, … }` (503). Publique, mise en cache 5 min (1 min en échec) pour ne pas consommer le quota GitHub ; `checkedAt` date la lecture GitHub réelle — deux réponses avec le même `checkedAt` viennent du cache. Ne révèle que le nombre de pièces, un état et cette date — le détail des erreurs est dans les logs Cloudflare (*Functions › Real-time logs*) |
| `/api/admin/*` | les routes de l'espace de gestion. Derrière Cloudflare Access à la bordure (voir *Espace de gestion*), puis `functions/api/admin/_middleware.js` revérifie le jeton : **503** si les variables Access manquent, **401** sans jeton valide. Fermé par défaut, sans exception |
| `GET /api/admin/products` | la liste des pièces lue sur GitHub, dans l'ordre d'affichage, et `branch` : la branche sur laquelle ce déploiement écrirait (`master` en production, la branche de la preview sinon, `null` = écriture impossible). À vérifier avant la première bascule sur un nouvel environnement |
| `PATCH /api/admin/products/:id` | corps `{ "availability": <état>, "sale"?: { amount, channel, date } }`, rien d'autre — un `reservedUntil` dans le corps est refusé (400) : la date de réservation se calcule. Les transitions sont celles de `catalog.allowedTransitions` (une publiée ne redevient pas brouillon, une réservée active ne se réserve pas à nouveau, `vendue → vendue` avec `sale` complète la vente). `reservee` écrit `reservedUntil` = jour à Paris + 13 ; quitter un état retire `reservedUntil` ou `sale`, pour que le fichier reste valide. Réécrit le fichier en **un commit** sur la branche du déploiement (auteur : l'adresse `noreply` GitHub du propriétaire du token, jamais une adresse personnelle — le dépôt est public ; message `content(catalog): mark "<nom>" as <état>` ou `record the sale of "<nom>"` + « via l'espace de gestion »). **200** `{ product, commit }` ou `{ product, unchanged: true }` · **400** corps invalide, champ inattendu, date de réservation envoyée · **404** pièce inconnue · **422** état inconnu, transition refusée, vente mal renseignée (canal, date au futur, montant négatif), pièce qui ne peut pas passer en vente ou réservée (règle de `catalog.js`) · **409** deux écritures se sont croisées deux fois de suite (une relecture + un nouvel essai, transition rejugée, sont faits avant) · **502** GitHub en erreur (401/403 = jeton expiré ?, 404 = branche disparue) · **503** environnement sans token ou sans branche connue |
| tout autre `/api/*` | 404 JSON — au lieu de la page d'accueil en 200 que Pages sert pour un chemin inconnu ; **405** avec `Allow` pour une route existante appelée avec la mauvaise méthode |

Toutes les réponses sont en JSON, `Cache-Control: no-store` sauf mention contraire, messages
d'erreur en français prêts à être affichés dans l'espace de gestion.

### Variables Runtime

Dashboard Cloudflare › projet `kel-empreinte` › **Settings › Variables and Secrets** — et surtout
pas le bloc *Build › Build variables* : une variable de build n'existe pas à l'exécution (erreur déjà
faite une fois, sur l'ancien Worker OAuth de Sveltia). **Production et Preview se configurent séparément** : une
variable posée sur un seul des deux laisse l'autre environnement en 503. Un secret doit exister
**avant** le déploiement qui l'utilise ; s'il est ajouté après, relancer le dernier déploiement
(*Retry deployment*) — celui de l'environnement concerné, la liste mêle Production et Preview.
Après toute modification dans ce panneau, **recharger la page et relire la liste** avant de
relancer un déploiement : lors de la mise en place (16/09/2026), une suppression puis un ajout ont
paru enregistrés sans l'être, et le symptôme — `/api/health` en 503 — est le même qu'une panne
réelle. Seule la ligne `health : …` des logs du déploiement (*Functions › Begin log stream*) dit
laquelle des causes est en jeu.

| Variable | Type | Environnements | Rôle |
|---|---|---|---|
| `GITHUB_TOKEN` | Secret | Production + Preview | token GitHub fine-grained, **Contents : Read and write** sur le seul dépôt `Wesley971/Kel-Empreinte`, aucune autre permission. Nom du token : `kel-empreinte-pages-functions`. **Il expire** : la date est suivie dans le ticket KD-94 (sonde à ajouter) — passé cette date, toute écriture de l'espace de gestion échoue et `/api/health` passe en 503 |
| `GITHUB_REPO` | texte | facultative | dépôt visé ; par défaut `Wesley971/Kel-Empreinte`, codé dans `functions/_lib/github.js` |

**Pas de variable pour la branche** : les Functions écrivent sur la branche du déploiement qui les
exécute, lue dans `functions/_lib/build-info.js` que `build.js` réécrit pendant le build Cloudflare
(`CF_PAGES_BRANCH`, disponible au build seulement). Production → `master`, preview → sa branche ;
rien à poser, rien à retirer, et une preview dont la branche a été supprimée échoue (GitHub 404) au
lieu d'écrire ailleurs. Branche inconnue (le fichier commité) : lecture sur `master`, écriture
refusée en 503. `GET /api/admin/products` renvoie la branche retenue.
| `CF_ACCESS_TEAM_DOMAIN` | texte | Production + Preview | `kelempreinte.cloudflareaccess.com` — **sans `https://`** (le middleware compare l'émetteur du jeton à `https://` + cette valeur) |
| `CF_ACCESS_AUD` | texte | Production + Preview, **valeurs différentes** | l'*Application Audience (AUD) Tag* de l'application Access de l'environnement : « production » sur Production, « previews » sur Preview (voir *Espace de gestion*). Une AUD croisée donne un 401 permanent, jamais un 503 |

Le middleware revérifie le jeton Access (`Cf-Access-Jwt-Assertion`, RS256, clés publiques du team
domain, `aud` / `iss` / `exp`) même si Access a déjà filtré la requête à la bordure : si la policy
Access est un jour mal réglée ou retirée, les routes d'écriture restent fermées.

### Vérifier après un déploiement

```
curl -i https://kel-empreinte.pages.dev/api/health            # 200, "products" = nombre de pièces du JSON
curl -i https://kel-empreinte.pages.dev/api/admin/quoi         # 503 (Access non configuré) ou 401
curl -i https://kel-empreinte.pages.dev/api/nimporte           # 404 JSON
curl -i https://kel-empreinte.pages.dev/functions/_lib/github.js   # du HTML (page d'accueil), jamais du JS
```

Sur une preview, remplacer l'hôte par `<branche>.kel-empreinte.pages.dev`.

Après connexion dans un navigateur, ouvrir `/api/admin/products` : `branch` doit valoir `master` en
production et le nom de la branche sur une preview — **à vérifier avant la première bascule** sur un
environnement nouveau. Les logs du déploiement (*Functions*) portent la ligne `build.js : build-info —
branche …`. Puis une bascule aller-retour dans `/admin/` : deux commits sur la branche, deux
déploiements, et la carte de la boutique qui suit (« Vendue », puis de nouveau en vente).

## Surveillance

Trois niveaux, trois responsabilités qui ne se recouvrent pas. Toutes les alertes vont au
mainteneur, jamais à la personne qui édite le catalogue : elle ne pourrait rien en faire, son
retour d'information passe par les libellés de l'espace de gestion.

| Niveau | Détecte | Mécanisme | Alerte |
|---|---|---|---|
| Validité des données | JSON cassé, champ manquant, image introuvable | `build.js` au déploiement | e-mail Cloudflare « Deployment failed » |
| Site vs dépôt | boutique injoignable, déploiement échoué ou jamais parti, catalogue amputé en ligne, **espace de gestion (`/admin/`, `/api/admin/`) servi sans redirection Access**, gabarit `/templates/…` servi au lieu d'un 404 | `check-site.js`, toutes les 6 h | e-mail GitHub (workflow en échec) |
| Dépôt vs son état d'avant | catalogue qui perd anormalement des pièces alors que le build réussit | `check-catalog-drop.js`, à chaque push touchant `data/products.json` | e-mail GitHub (workflow en échec) |

La sonde compare le site au dépôt ; le garde-fou compare le dépôt à lui-même. Aucun des deux ne
revalide les données : une saisie invalide est signalée par le build, tout de suite. La sonde prend
le relais si personne n'a réagi — au prochain passage, le site ne reflétant plus le dépôt, elle
alertera à son tour. Premier e-mail immédiat, second dans les 6 h : c'est voulu, c'est le cas « le
premier message est passé inaperçu ».

```
node check-site.js                                  # sonde la production
node check-site.js --url http://localhost:3000/     # sonde une copie locale ou une preview
node check-catalog-drop.js <avant.json>             # compare data/products.json à un état précédent
```

Seuils : la sonde exige que le nombre de cartes servies par `/boutique/` et son compteur soient égaux
au nombre de pièces **visibles** du JSON (disponibles, réservées, vendues — la règle de `catalog.js`),
en tolérant un écart pendant les 15 minutes qui suivent un commit (un déploiement peut être en cours
ou en file d'attente). Le garde-fou alerte si le catalogue perd plus
d'un quart de ses pièces en un seul push, ou s'il passe sous 5 pièces — y compris quand la perte est
voulue (la migration v2 de KD-97, 24 → 17, l'a déclenché une fois, en connaissance de cause).

**Limites à connaître.**

- GitHub **désactive un workflow planifié après 60 jours sans activité sur le dépôt**, sans prévenir :
  la surveillance peut donc s'arrêter en silence. La date du dernier passage vert reste visible dans
  l'onglet *Actions*.
- Les notifications d'un workflow planifié partent à la personne qui a **modifié le `cron` en dernier**,
  et supposent les notifications « Actions » activées sur le compte GitHub. Pour vérifier que l'alerte
  arrive : *Actions › Surveillance du site › Run workflow*, avec `url` = `https://kel-empreinte.invalid/`
  — un hôte qui n'existe pas, donc un échec net et indiscutable.
- Depuis KD-97, `404.html` fait servir un **vrai 404** pour tout chemin inconnu (sans ce fichier, Pages
  servait la page d'accueil en 200 : mesuré sur `/nope`, `/zzz/qqq`). La sonde continue d'exiger des
  marqueurs de contenu sur la boutique : un 200 seul ne prouve pas que la bonne page est servie.
- Le garde-fou **détecte, il ne bloque pas** : Cloudflare builde en parallèle de GitHub Actions, un
  catalogue amputé est donc publié, puis signalé dans la minute. L'empêcher supposerait une branche
  protégée et un flux de pull requests, incompatible avec l'écriture directe de l'espace de gestion.
- La sonde s'appuie sur les marqueurs `<!-- build:shop-cards:… -->` et sur `class="shop-count"` de
  `/boutique/` : une refonte de la boutique qui les déplacerait la ferait échouer en boucle. Son message
  d'erreur le dit et nomme le fichier à corriger.
- La sonde **n'interroge pas encore `/api/health`** : un token GitHub expiré ou révoqué (voir *Fonctions
  serverless*) n'est signalé par aucun des trois niveaux aujourd'hui. C'est l'objet du ticket KD-94.
