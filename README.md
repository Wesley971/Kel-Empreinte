# Kel'Empreinte — site vitrine

Site statique (HTML / CSS / JS sans framework) de la marque de bijoux artisanaux Kel'Empreinte,
hébergé sur Cloudflare Pages. Le catalogue vit dans `data/products.json` sur GitHub ; la marque le
modifie depuis l'espace de gestion (`/gestion`, voir plus bas) et le HTML du lookbook est régénéré à
chaque déploiement.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | page unique du site ; le lookbook y est **généré** entre les marqueurs `<!-- build:… -->` |
| `tokens.css` | les variables CSS du site (palette, courbes, texture) — seule définition, chargée par `index.html` **avant** la feuille du site et par `/gestion/` |
| `tooplate-ivory-style.css`, `tooplate-ivory-script.js` | styles et comportement (template Tooplate 2166 adapté) |
| `catalog.js` | tout ce qui touche à une pièce, écrit une fois et partagé par le navigateur, le build, l'espace de gestion et les Functions : états (`disponible`, `bientot`, `vendue`), règle « peut passer en vente », ordre d'affichage, prix, liens WhatsApp, rendu des cartes |
| `build.js` | script de build : régénère le lookbook depuis le JSON, échoue si les données sont incohérentes |
| `check-site.js` | sonde : compare le site en ligne au dépôt (voir *Surveillance*) |
| `check-catalog-drop.js` | garde-fou : repère une chute anormale du nombre de pièces dans un push |
| `.github/workflows/` | planification des deux contrôles ci-dessus (GitHub Actions) |
| `data/products.json` | **source de vérité du catalogue**, modifiée par l'espace de gestion (`/gestion`) via les Functions, un commit par modification (voir *Modèle*) |
| `admin/` | Sveltia CMS. `config.yml` = schéma des fiches + titre/logo de l'interface (`app_title`, `logo`) ; `index.html` = en-tête Kel'Empreinte au-dessus du CMS monté dans `#nc-root` (les couleurs de Sveltia elles-mêmes ne sont pas personnalisables) ; `guide.html` = guide « Gérer mes bijoux » pour Prescilia (`noindex`) ; `logo.png` = logo de connexion/favicon ; `manifest.webmanifest` + `icon-*.png` = nom « Mes bijoux » et icône du raccourci « écran d'accueil », à garder devant le script Sveltia qui injecte son propre manifest |
| `images/` | photos (les uploads du CMS arrivent ici) |
| `functions/` | Cloudflare Pages Functions : les routes `/api/*` (voir *Fonctions serverless*). `_lib/` = modules partagés (réponses JSON, accès GitHub, catalogue — lecture / réécriture fidèle de `products.json`, vérification du jeton Cloudflare Access, `build-info.js` = branche du déploiement, réécrit par `build.js` sur Pages) ; `api/` = les routes, une par fichier |
| `gestion/` | l'espace de gestion, derrière Cloudflare Access (voir *Espace de gestion*). Chemin provisoire tant que `admin/` est occupé par Sveltia. `index.html` + `gestion.css` + `gestion.js` = l'écran « Mes bijoux » : la liste des pièces et l'interrupteur « En vente » |
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

## Build local

```
node build.js
```

Lit `data/products.json`, vérifie les données et réécrit le lookbook dans `index.html` entre les
marqueurs. Le script refuse de générer (sortie 1, message explicite) si : JSON invalide ou vide,
identifiant en double, nom / catégorie manquant, état ou type de prix inconnu, pièce disponible à
prix fixe sans prix, photo sans description ou fichier introuvable, marqueur absent ou en double.

Le HTML committé est un **instantané** : après une modification depuis l'espace de gestion,
`index.html` du dépôt est périmé jusqu'au prochain `node build.js` local (Cloudflare, lui, régénère
à chaque déploiement). Lancer le build avant de committer une modification d'`index.html`, et ne
jamais éditer à la main ce qui se trouve entre les marqueurs — c'est écrasé au déploiement.

Sur Cloudflare (`CF_PAGES=1`), le build réécrit aussi `functions/_lib/build-info.js` avec la branche
et le commit du déploiement (`CF_PAGES_BRANCH`, `CF_PAGES_COMMIT_SHA`) : c'est ainsi que les Functions
savent sur quelle branche écrire (voir *Fonctions serverless*). En local, le fichier commité (branche
inconnue) n'est jamais touché — ne pas y committer une autre valeur.

### Modèle — `data/products.json`

Une liste de pièces. Les champs qui portent une règle :

| Champ | Valeurs | Règle |
|---|---|---|
| `availability` | `disponible` · `bientot` · `vendue` | `disponible` = en vente ; `bientot` = annoncée, pas encore de photo (visuel d'attente « Bientôt ») ; `vendue` = partie : la carte reste dans le lookbook, **après** toutes les autres, photo légèrement désaturée, mention « Vendue » à la place du prix, pas de bouton Commander mais un lien WhatsApp « Une pièce semblable ? ». Une pièce mise en avant puis vendue quitte le carrousel d'accueil |
| `priceType`, `price` | `fixe` + nombre · `devis` | `disponible` + `fixe` exige un prix (le build échoue sinon) |
| `images` | liste `{ src, alt }` | sans photo, une pièce `disponible` s'affiche comme « Bientôt » : l'espace de gestion refuse donc de mettre en vente une pièce sans photo, ou à prix fixe sans prix (règle unique dans `catalog.js`, appliquée par l'écran et par l'API) |

Les espaces insécables du fichier sont écrits `\u00a0` : les Functions les réécrivent tels quels
(round-trip identique octet pour octet, couvert par un test), pour que le diff d'un commit de
l'espace de gestion ne contienne que la modification voulue.

## CMS

`/admin` (Sveltia CMS, connexion GitHub via le worker OAuth `sveltia-cms-auth`) écrit directement
dans `data/products.json` et `images/` sur `master`. Les champs et leurs règles sont décrits dans
`admin/config.yml`.

**Hors service depuis le renommage du projet** (les variables du worker OAuth n'ont pas suivi) et
**volontairement non réparé** (décision du 16/09/2026, KD-84) : le site n'est pas encore en service,
et Sveltia est remplacé par l'espace de gestion sur mesure ci-dessous. Le dossier `admin/`, le worker
et le contrôle `/admin/` de la sonde disparaissent en phase 3 du chantier, qui tranchera aussi si le
nouvel espace reprend `/admin` ou reste à `/gestion`.

## Espace de gestion — `/gestion` et Cloudflare Access

L'espace de gestion (KD-84) vit à **`/gestion/`** — chemin provisoire, `/admin` étant occupé par
les fichiers de Sveltia — et écrit par les routes **`/api/admin/*`**. Les deux sont protégés par
**Cloudflare Access** (Zero Trust) : connexion par **code à usage unique envoyé par mail**, sans
compte GitHub ni mot de passe. Deux verrous en série : Access à la bordure (redirection vers la page
de connexion tant qu'il n'y a pas de session), puis le middleware `functions/api/admin/_middleware.js`
qui revérifie le jeton (voir *Fonctions serverless*). Ce qui est public reste public : `/`, `/admin/`,
`/api/health`, `images/`, `tokens.css`, `catalog.js`.

### L'écran « Mes bijoux »

`gestion/index.html` + `gestion.css` + `gestion.js`, sans dépendance : la palette vient de `tokens.css`,
les règles de `catalog.js`. Il liste les pièces lues par `GET /api/admin/products` (la vérité du
dépôt, pas le JSON servi avec le site qui a 1 à 2 min de retard), dans l'ordre du lookbook — les
vendues à la fin, l'ordre est celui du chargement et ne bouge pas pendant la session. Chaque ligne :
photo, nom, catégorie, prix, et un interrupteur **« En vente »** (`PATCH /api/admin/products/:id`).

- **Allumé** = `disponible`. **Éteint** = `vendue`, ou `bientot` : deux libellés distincts sous le
  nom (« Vendue » / « Bientôt (pas encore de photo) »), pour qu'on sache pourquoi une pièce est éteinte.
- Une pièce qui ne peut pas passer en vente (sans photo, ou à prix fixe sans prix) a son interrupteur
  **désactivé** et la raison écrite (« À compléter : photo et prix. ») — l'écran ne propose jamais une
  action que l'API refuserait. Les six pièces « bientôt » du catalogue sont dans ce cas jusqu'à ce
  qu'un écran de modification (KD-93) permette d'ajouter photo et prix.
- Interrupteur **optimiste, en trois temps** : bascule immédiate et verrouillage (statut global
  « Mise à jour du site en cours » tant qu'une écriture est en vol) → la réponse confirme, ou l'écran
  **revient en arrière** avec la raison sous la pièce → « Enregistré, mise en ligne dans 1 à 2 minutes. »
  L'écran ne vérifie pas la mise en ligne (KD-82).
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
| Application « production » | *Access controls › Applications* › « Kel'Empreinte — espace de gestion (production) » : hostnames **`kel-empreinte.pages.dev/gestion*`** et **`kel-empreinte.pages.dev/api/admin*`** (le `*` en fin de chemin couvre le chemin nu et ses sous-chemins ; `gestion/*` seul **exclurait** `/gestion`) |
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
curl -sI https://kel-empreinte.pages.dev/gestion/ | grep -i location     # https://kelempreinte.cloudflareaccess.com/…
curl -sI https://kel-empreinte.pages.dev/api/admin/ | grep -i location   # idem
curl -sI https://kel-empreinte.pages.dev/ | head -1                      # 200, pas de redirection
```

Après connexion dans un navigateur, `/api/admin/quoi` répond `404 {"error":"Cette adresse n'existe pas."}`
avec `Cache-Control: no-store` : la preuve que le middleware a accepté le jeton. Un `401` à la place
signifie que `CF_ACCESS_AUD` ou `CF_ACCESS_TEAM_DOMAIN` ne correspond pas à l'application (le log
`access : …` du déploiement nomme la cause) ; un `503`, que les variables manquent.

**Limite** : les previews étant entièrement derrière Access, `node check-site.js --url <preview>` ne
fonctionne plus (la page de connexion est servie à la place du lookbook). La sonde vise la production.

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
| `PATCH /api/admin/products/:id` | corps `{ "availability": "disponible" \| "bientot" \| "vendue" }`, rien d'autre. Lit `products.json`, modifie l'état, réécrit le fichier en **un commit** sur la branche du déploiement (auteur : l'adresse `noreply` GitHub du propriétaire du token, jamais une adresse personnelle — le dépôt est public ; message `content(catalog): mark "<nom>" as <état>` + « via l'espace de gestion »). **200** `{ product, commit }` ou `{ product, unchanged: true }` · **400** corps invalide · **404** pièce inconnue · **422** état inconnu ou pièce qui ne peut pas passer en vente (règle de `catalog.js`) · **409** deux écritures se sont croisées deux fois de suite (une relecture + un nouvel essai sont faits avant) · **502** GitHub en erreur (401/403 = jeton expiré ?, 404 = branche disparue) · **503** environnement sans token ou sans branche connue |
| tout autre `/api/*` | 404 JSON — au lieu de la page d'accueil en 200 que Pages sert pour un chemin inconnu ; **405** avec `Allow` pour une route existante appelée avec la mauvaise méthode |

Toutes les réponses sont en JSON, `Cache-Control: no-store` sauf mention contraire, messages
d'erreur en français prêts à être affichés dans l'espace de gestion.

### Variables Runtime

Dashboard Cloudflare › projet `kel-empreinte` › **Settings › Variables and Secrets** — et surtout
pas le bloc *Build › Build variables* : une variable de build n'existe pas à l'exécution (erreur déjà
faite sur le Worker `sveltia-cms-auth`). **Production et Preview se configurent séparément** : une
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
branche …`. Puis une bascule aller-retour dans `/gestion/` : deux commits sur la branche, deux
déploiements, et la carte du lookbook qui suit.

## Surveillance

Trois niveaux, trois responsabilités qui ne se recouvrent pas. Toutes les alertes vont au
mainteneur, jamais à la personne qui édite le catalogue : elle ne pourrait rien en faire, son
retour d'information passe par les libellés du CMS.

| Niveau | Détecte | Mécanisme | Alerte |
|---|---|---|---|
| Validité des données | JSON cassé, champ manquant, image introuvable | `build.js` au déploiement | e-mail Cloudflare « Deployment failed » |
| Site vs dépôt | site injoignable, déploiement échoué ou jamais parti, catalogue amputé en ligne, `/admin` inaccessible, **espace de gestion (`/gestion/`, `/api/admin/`) servi sans redirection Access** | `check-site.js`, toutes les 6 h | e-mail GitHub (workflow en échec) |
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
