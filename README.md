# Kel'Empreinte — site vitrine

Site statique (HTML / CSS / JS sans framework) de la marque de bijoux artisanaux Kel'Empreinte,
hébergé sur Cloudflare Pages. Le catalogue est édité par la marque dans un CMS git (`/admin`) et le
HTML du lookbook est régénéré à chaque déploiement depuis `data/products.json`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | page unique du site ; le lookbook y est **généré** entre les marqueurs `<!-- build:… -->` |
| `tooplate-ivory-style.css`, `tooplate-ivory-script.js` | styles et comportement (template Tooplate 2166 adapté) |
| `catalog.js` | règles de présentation partagées navigateur / build : prix, lien WhatsApp, rendu des cartes |
| `build.js` | script de build : régénère le lookbook depuis le JSON, échoue si les données sont incohérentes |
| `data/products.json` | **source de vérité du catalogue**, éditée via `/admin` |
| `admin/` | Sveltia CMS (`config.yml` = schéma des fiches ; `manifest.webmanifest` + `icon-*.png` = nom « Mes bijoux » et icône du raccourci « écran d'accueil » sur téléphone, à garder devant le script Sveltia qui injecte son propre manifest) |
| `images/` | photos (les uploads du CMS arrivent ici) |
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

Chaque push sur `master` — y compris chaque enregistrement dans `/admin` — déclenche un build puis
un déploiement (~1 à 2 min). Un build en échec **laisse le dernier déploiement en ligne** et envoie
l'e-mail de notification : rien ne casse en ligne, mais la modification n'est pas publiée tant que
la donnée fautive n'est pas corrigée. Un seul build à la fois (plan gratuit) : des enregistrements
rapprochés dans le CMS se mettent en file.

**Rollback** : vider la build command dans le dashboard fait retomber le site sur le HTML committé
(périmé mais fonctionnel) ; ou redéployer une version précédente depuis la liste des déploiements
(chaque déploiement garde une URL permanente `<hash>.kel-empreinte.pages.dev`).

## Build local

```
node build.js
```

Lit `data/products.json`, vérifie les données et réécrit le lookbook dans `index.html` entre les
marqueurs. Le script refuse de générer (sortie 1, message explicite) si : JSON invalide ou vide,
identifiant en double, nom / catégorie / prix manquant, photo sans description ou fichier
introuvable, marqueur absent ou en double.

Le HTML committé est un **instantané** : après une édition dans `/admin`, `index.html` du dépôt est
périmé jusqu'au prochain `node build.js` local (Cloudflare, lui, régénère à chaque déploiement).
Lancer le build avant de committer une modification d'`index.html`, et ne jamais éditer à la main
ce qui se trouve entre les marqueurs — c'est écrasé au déploiement.

## CMS

`/admin` (Sveltia CMS, connexion GitHub via le worker OAuth `sveltia-cms-auth`) écrit directement
dans `data/products.json` et `images/` sur `master`. Les champs et leurs règles sont décrits dans
`admin/config.yml`.
