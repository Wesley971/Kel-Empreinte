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
| `check-site.js` | sonde : compare le site en ligne au dépôt (voir *Surveillance*) |
| `check-catalog-drop.js` | garde-fou : repère une chute anormale du nombre de pièces dans un push |
| `.github/workflows/` | planification des deux contrôles ci-dessus (GitHub Actions) |
| `data/products.json` | **source de vérité du catalogue**, éditée via `/admin` |
| `admin/` | Sveltia CMS. `config.yml` = schéma des fiches + titre/logo de l'interface (`app_title`, `logo`) ; `index.html` = en-tête Kel'Empreinte au-dessus du CMS monté dans `#nc-root` (les couleurs de Sveltia elles-mêmes ne sont pas personnalisables) ; `guide.html` = guide « Gérer mes bijoux » pour Prescilia (`noindex`) ; `logo.png` = logo de connexion/favicon ; `manifest.webmanifest` + `icon-*.png` = nom « Mes bijoux » et icône du raccourci « écran d'accueil », à garder devant le script Sveltia qui injecte son propre manifest |
| `images/` | photos (les uploads du CMS arrivent ici) |
| `functions/` | Cloudflare Pages Functions : les routes `/api/*` (voir *Fonctions serverless*). `_lib/` = modules partagés (réponses JSON, accès GitHub, vérification du jeton Cloudflare Access) ; `api/` = les routes, une par fichier |
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

## Fonctions serverless — `/api`

Le dossier `functions/` est compilé par Cloudflare Pages à chaque déploiement en un Worker qui
répond sur `/api/*` (pas de `package.json`, pas de wrangler : Cloudflare détecte le dossier et
génère le routage). Il n'est **pas** servi en statique, bien que l'output directory soit la racine
(`functions` figure dans la liste d'exclusion de l'upload Pages). Le reste du site ne passe pas par
ce Worker. Ce socle est partagé par le futur espace de gestion (`/api/admin/*`) et le paiement en
ligne SumUp.

| Route | Rôle |
|---|---|
| `GET /api/health` | preuve de vie : lit `data/products.json` sur GitHub avec le token et répond `{ ok, github, products, checkedAt }` (200) ou `{ ok: false, … }` (503). Publique, mise en cache 5 min (1 min en échec) pour ne pas consommer le quota GitHub ; `checkedAt` date la lecture GitHub réelle — deux réponses avec le même `checkedAt` viennent du cache. Ne révèle que le nombre de pièces, un état et cette date — le détail des erreurs est dans les logs Cloudflare (*Functions › Real-time logs*) |
| `/api/admin/*` | routes d'écriture de l'espace de gestion (à venir). Protégées par `functions/api/admin/_middleware.js` : **503** tant que Cloudflare Access n'est pas configuré, **401** sans jeton Access valide. Fermé par défaut, sans exception |
| tout autre `/api/*` | 404 JSON — au lieu de la page d'accueil en 200 que Pages sert pour un chemin inconnu |

Toutes les réponses sont en JSON, `Cache-Control: no-store` sauf mention contraire, messages
d'erreur en français prêts à être affichés dans l'espace de gestion.

### Variables Runtime

Dashboard Cloudflare › projet `kel-empreinte` › **Settings › Variables and Secrets** — et surtout
pas le bloc *Build › Build variables* : une variable de build n'existe pas à l'exécution (erreur déjà
faite sur le Worker `sveltia-cms-auth`). **Production et Preview se configurent séparément** : une
variable posée sur un seul des deux laisse l'autre environnement en 503. Un secret doit exister
**avant** le déploiement qui l'utilise ; s'il est ajouté après, relancer le dernier déploiement
(*Retry deployment*).

| Variable | Type | Environnements | Rôle |
|---|---|---|---|
| `GITHUB_TOKEN` | Secret | Production + Preview | token GitHub fine-grained, **Contents : Read and write** sur le seul dépôt `Wesley971/Kel-Empreinte`, aucune autre permission. Nom du token : `kel-empreinte-pages-functions`. **Il expire** : la date est suivie dans le ticket KD-94 (sonde à ajouter) — passé cette date, toute écriture de l'espace de gestion échoue et `/api/health` passe en 503 |
| `GITHUB_REPO`, `GITHUB_BRANCH` | texte | facultatives | dépôt et branche visés ; par défaut `Wesley971/Kel-Empreinte` et `master`, codés dans `functions/_lib/github.js` |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | texte | Production + Preview | configuration Cloudflare Access de `/admin` et `/api/admin/*` : le team domain (`<équipe>.cloudflareaccess.com`, sans `https://`) et l'*Application Audience (AUD) Tag* de l'application Access. **À poser lors de la mise en place d'Access (KD-91)** ; tant qu'elles manquent, `/api/admin/*` répond 503 |

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

## Surveillance

Trois niveaux, trois responsabilités qui ne se recouvrent pas. Toutes les alertes vont au
mainteneur, jamais à la personne qui édite le catalogue : elle ne pourrait rien en faire, son
retour d'information passe par les libellés du CMS.

| Niveau | Détecte | Mécanisme | Alerte |
|---|---|---|---|
| Validité des données | JSON cassé, champ manquant, image introuvable | `build.js` au déploiement | e-mail Cloudflare « Deployment failed » |
| Site vs dépôt | site injoignable, déploiement échoué ou jamais parti, catalogue amputé en ligne, `/admin` inaccessible | `check-site.js`, toutes les 6 h | e-mail GitHub (workflow en échec) |
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

Seuils : la sonde exige que le nombre de cartes servies et le compteur du lookbook soient égaux au
nombre de pièces du JSON, en tolérant un écart pendant les 15 minutes qui suivent un commit (un
déploiement peut être en cours ou en file d'attente). Le garde-fou alerte si le catalogue perd plus
d'un quart de ses pièces en un seul push, ou s'il passe sous 5 pièces.

**Limites à connaître.**

- GitHub **désactive un workflow planifié après 60 jours sans activité sur le dépôt**, sans prévenir :
  la surveillance peut donc s'arrêter en silence. La date du dernier passage vert reste visible dans
  l'onglet *Actions*.
- Les notifications d'un workflow planifié partent à la personne qui a **modifié le `cron` en dernier**,
  et supposent les notifications « Actions » activées sur le compte GitHub. Pour vérifier que l'alerte
  arrive : *Actions › Surveillance du site › Run workflow*, avec `url` = `https://kel-empreinte.invalid/`
  — un hôte qui n'existe pas, donc un échec net et indiscutable.
- **Cloudflare Pages sert la page d'accueil, en 200, pour tout chemin qu'il ne connaît pas** (mesuré :
  `/nope`, `/zzz/qqq` renvoient l'index complet). Un code HTTP ne prouve donc rien sur cet hébergement :
  c'est pourquoi la sonde exige des marqueurs de contenu, y compris sur `/admin/`, où un 200 seul
  laisserait passer un CMS disparu du déploiement.
- Le garde-fou **détecte, il ne bloque pas** : Cloudflare builde en parallèle de GitHub Actions, un
  catalogue amputé est donc publié, puis signalé dans la minute. L'empêcher supposerait une branche
  protégée et un flux de pull requests, incompatible avec l'écriture directe du CMS.
- La sonde s'appuie sur les marqueurs `<!-- build:lookbook-cards:… -->` et sur `class="lookbook-count"` :
  une refonte du lookbook qui les déplacerait la ferait échouer en boucle. Son message d'erreur le dit
  et nomme le fichier à corriger.
- La sonde **n'interroge pas encore `/api/health`** : un token GitHub expiré ou révoqué (voir *Fonctions
  serverless*) n'est signalé par aucun des trois niveaux aujourd'hui. C'est l'objet du ticket KD-94.
