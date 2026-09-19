/* Accès au dépôt GitHub depuis les Pages Functions — lecture et écriture de fichiers.

   Le dépôt est la seule base de données du site (data/products.json, images/). Les
   Functions y écrivent via l'API Contents avec un token fine-grained limité à ce seul
   dépôt (Contents : Read and write), lu dans env.GITHUB_TOKEN — une variable Runtime
   Cloudflare (Settings › Variables and Secrets, type Secret), jamais une variable de
   Build, jamais envoyée au navigateur.

   Un enregistrement du formulaire de pièce (KD-93) écrit plusieurs fichiers — photos et JSON —
   en UN commit, via l'API Git Data (commitFiles, en bas de ce fichier) ; l'API Contents reste
   pour l'écriture d'un seul fichier texte (writeRepoFile).

   Le repo a une valeur par défaut : une seule variable à configurer pour que la brique
   fonctionne. GITHUB_REPO permet de viser un autre dépôt (fork, test) sans toucher au code.

   La branche n'est pas configurable : c'est celle du déploiement qui exécute la Function
   (functions/_lib/build-info.js, écrit par build.js pendant le build Cloudflare). La
   production écrit sur master, une preview sur sa propre branche — et une preview dont la
   branche a été supprimée échoue proprement au lieu d'écrire ailleurs. Branche inconnue
   (exécution hors Pages) : lecture sur master, écriture refusée. On ne devine jamais où
   publier.

   Le piège de ce fichier est l'encodage : l'API échange les contenus en base64, et
   atob/btoa ne connaissent que le Latin-1. Un « é » passé à btoa lève une exception,
   un « ç » lu via atob seul devient deux caractères parasites. Tout texte passe donc par
   des octets UTF-8 (TextEncoder/TextDecoder), et le round-trip est couvert par un test.
   Une photo, elle, n'est jamais encodée ici : le navigateur l'envoie déjà en base64
   (FileReader, natif), et la chaîne passe telle quelle à GitHub — encoder 1 Mo d'octets en
   JavaScript coûte ~10 ms de CPU, la limite d'une Function sur l'offre gratuite. */

import { buildInfo } from './build-info.js';

const API_URL = 'https://api.github.com';
const API_VERSION = '2022-11-28';
// L'API GitHub refuse les requêtes sans User-Agent.
const USER_AGENT = 'kel-empreinte-pages-functions';

const DEFAULT_REPO = 'Wesley971/Kel-Empreinte';
// Branche de lecture quand celle du déploiement est inconnue (jamais utilisée pour écrire).
const READ_FALLBACK_BRANCH = 'master';

// Signature des commits écrits par l'espace de gestion. Le dépôt est public : jamais
// d'adresse personnelle. L'adresse « noreply » GitHub du propriétaire du token relie le
// commit à son compte sans rien exposer — c'est déjà celle des commits de l'ancien CMS.
const COMMIT_IDENTITY = { name: 'Wesley Abdoul', email: '142779515+Wesley971@users.noreply.github.com' };

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

// Une configuration absente est une erreur de déploiement, pas une erreur d'API :
// on la nomme pour qu'elle se lise dans les logs sans chercher.
export function repoConfig(env) {
  if (!env.GITHUB_TOKEN) {
    throw new GitHubError(0, 'GITHUB_TOKEN absent : variable Runtime non configurée sur cet environnement Cloudflare');
  }
  return {
    token: env.GITHUB_TOKEN,
    repo: env.GITHUB_REPO || DEFAULT_REPO,
    // null hors Pages : voir build-info.js
    branch: buildInfo.branch || null,
  };
}

// La branche sur laquelle ce déploiement écrirait — exposée par l'API de gestion pour
// vérifier, avant la première écriture, qu'une preview vise bien sa branche et la
// production master.
export function deploymentBranch() {
  return buildInfo.branch || null;
}

// Le commit que ce déploiement sert (CF_PAGES_COMMIT_SHA, écrit par build.js) : c'est en le
// comparant à la tête de la branche que l'écran de gestion sait si une modification est en
// ligne (KD-82). null hors Pages.
export function deploymentCommit() {
  return buildInfo.commit || null;
}

// Ce que la branche a de plus que `base` : GitHub compare base...head et renvoie le statut
// (identical, ahead, behind, diverged) et les commits de head absents de base — jusqu'à 250,
// bien au-delà de ce qu'un déploiement en retard peut accumuler. `base` est un sha, `head` la
// branche du déploiement (KD-82). Renvoie { status, commits: [{ sha, message, date }] } ; la
// date est celle du committer, posée par GitHub pour les commits de l'API.
export async function compareCommits(env, base, head) {
  const config = repoConfig(env);
  // Ni sha ni branche ne sont encodés : GitHub lit « base...head » tel quel, barre oblique d'une
  // branche de preview (feat/KD-…) comprise — encodée en %2F, elle ne serait pas résolue
  const result = await githubFetch(config, '/repos/' + config.repo + '/compare/' + base + '...' + head);
  if (typeof result.status !== 'string' || !Array.isArray(result.commits)) {
    throw new GitHubError(0, 'compare ' + base.slice(0, 7) + '...' + head + ' : réponse GitHub sans statut ni commits');
  }
  return {
    status: result.status,
    commits: result.commits.map((entry) => ({
      sha: entry.sha,
      message: entry.commit && typeof entry.commit.message === 'string' ? entry.commit.message : '',
      date: entry.commit && entry.commit.committer && entry.commit.committer.date ? entry.commit.committer.date : null,
    })),
  };
}

async function githubFetch(config, path, init = {}) {
  const response = await fetch(API_URL + path, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + config.token,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json()).message || ''; } catch (_) { /* corps non JSON */ }
    throw new GitHubError(response.status, 'GitHub ' + response.status + ' sur ' + path + (detail ? ' : ' + detail : ''));
  }
  return response.json();
}

// Chaque segment du chemin est encodé séparément : les « / » doivent rester des séparateurs.
function contentsPath(config, filePath) {
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  return '/repos/' + config.repo + '/contents/' + encoded;
}

// Lit un fichier texte du dépôt. Renvoie son contenu décodé et son sha : le sha est exigé
// par GitHub pour toute mise à jour (protection contre l'écrasement d'une modification
// concurrente — deux onglets de l'espace de gestion, ou une édition directe sur GitHub).
// `ref` : un commit précis (celui que commitFiles prendra pour parent) ; sinon la branche.
export async function readRepoFile(env, filePath, { ref } = {}) {
  const config = repoConfig(env);
  const at = ref || config.branch || READ_FALLBACK_BRANCH;
  const file = await githubFetch(config, contentsPath(config, filePath) + '?ref=' + encodeURIComponent(at));
  if (file.type !== 'file' || typeof file.content !== 'string') {
    throw new GitHubError(0, filePath + ' : la réponse GitHub ne contient pas un fichier (' + (file.type || 'type inconnu') + ')');
  }
  return { content: decodeBase64Utf8(file.content), sha: file.sha };
}

// Écrit (crée ou met à jour) un fichier TEXTE du dépôt en un commit sur la branche. Texte
// uniquement : le contenu passe par TextEncoder. Pour une photo, ou plusieurs fichiers d'un
// coup, voir commitFiles.
// `sha` : celui renvoyé par readRepoFile pour une mise à jour ; omis pour une création.
// Sans le bon sha, GitHub répond 409 : c'est voulu, on ne veut jamais écraser à l'aveugle.
// Une branche supprimée (preview survivant à son merge) donne un 404 GitHub : rien n'est écrit.
export async function writeRepoFile(env, filePath, { content, sha, message }) {
  const config = repoConfig(env);
  if (!config.branch) {
    throw new GitHubError(0, 'branche du déploiement inconnue (build-info.js non généré) : écriture refusée');
  }
  const result = await githubFetch(config, contentsPath(config, filePath), {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: encodeBase64Utf8(content),
      branch: config.branch,
      committer: COMMIT_IDENTITY,
      author: COMMIT_IDENTITY,
      ...(sha ? { sha } : {}),
    }),
  });
  return { sha: result.content.sha, commit: result.commit.sha };
}

// GitHub renvoie le base64 avec un retour à la ligne tous les 60 caractères.
export function decodeBase64Utf8(base64) {
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Par tranches : String.fromCharCode(...bytes) sur un fichier entier dépasse la limite
// d'arguments dès quelques dizaines de milliers d'octets.
export function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/* ── Plusieurs fichiers en un commit (KD-93) ──

   Une pièce enregistrée depuis le formulaire, c'est ses photos plus data/products.json — et rien
   ne doit exister à moitié : un build qui verrait le JSON sans la photo échouerait (fichier
   introuvable), un build qui verrait la photo sans le JSON ne casserait rien mais laisserait un
   fichier orphelin. L'API Contents ne sait écrire qu'un fichier par commit ; l'API Git Data
   assemble un commit entier : un blob par fichier, un arbre posé sur celui de la branche, un
   commit, puis la référence.

   La référence est mise à jour SANS force : si la branche a avancé entre la lecture de `parent`
   et l'écriture (une bascule d'état depuis un autre onglet, une autre pièce enregistrée),
   GitHub refuse (422 « not a fast forward ») et rien n'est écrit — l'appelant relit et rejoue,
   comme pour le 409 de l'API Contents. C'est pour cela que `parent` est exigé : l'appelant lit
   ses données À ce commit (readRepoFile avec `ref`), et l'écriture ne passe que si la branche
   est toujours là. Les blobs créés d'un commit qui n'aboutit pas sont orphelins : GitHub les
   nettoie, personne ne les voit. */

// La tête de la branche du déploiement : le commit sur lequel lire, puis écrire.
export async function branchHead(env) {
  const config = repoConfig(env);
  if (!config.branch) {
    throw new GitHubError(0, 'branche du déploiement inconnue (build-info.js non généré) : écriture refusée');
  }
  const ref = await githubFetch(config, '/repos/' + config.repo + '/git/ref/heads/' + config.branch);
  if (!ref.object || typeof ref.object.sha !== 'string') {
    throw new GitHubError(0, 'la référence de la branche ' + config.branch + ' ne porte pas de commit');
  }
  return ref.object.sha;
}

// files : { path, text } pour un fichier texte, { path, base64 } pour une photo déjà encodée par
// le navigateur (passée telle quelle, jamais décodée ni réencodée ici), { path, remove: true }
// pour retirer un fichier. Renvoie { commit } — le sha du commit écrit.
export async function commitFiles(env, { message, files, parent }) {
  const config = repoConfig(env);
  if (!config.branch) {
    throw new GitHubError(0, 'branche du déploiement inconnue (build-info.js non généré) : écriture refusée');
  }
  if (typeof parent !== 'string' || !parent) throw new GitHubError(0, 'commitFiles : le commit parent est requis');
  if (!Array.isArray(files) || !files.length) throw new GitHubError(0, 'commitFiles : aucun fichier à écrire');
  const git = '/repos/' + config.repo + '/git';

  const head = await githubFetch(config, git + '/commits/' + parent);

  // Les blobs en parallèle : une photo n'attend pas la précédente
  const entries = await Promise.all(files.map(async (file) => {
    if (typeof file.path !== 'string' || !file.path || file.path.indexOf('..') !== -1 || file.path.charAt(0) === '/') {
      throw new GitHubError(0, 'commitFiles : chemin refusé — ' + String(file.path));
    }
    if (file.remove) return { path: file.path, mode: '100644', type: 'blob', sha: null };
    const content = typeof file.base64 === 'string' ? file.base64 : encodeBase64Utf8(String(file.text));
    const blob = await githubFetch(config, git + '/blobs', {
      method: 'POST',
      body: JSON.stringify({ content, encoding: 'base64' }),
    });
    return { path: file.path, mode: '100644', type: 'blob', sha: blob.sha };
  }));

  const tree = await githubFetch(config, git + '/trees', {
    method: 'POST',
    body: JSON.stringify({ base_tree: head.tree.sha, tree: entries }),
  });
  const commit = await githubFetch(config, git + '/commits', {
    method: 'POST',
    body: JSON.stringify({ message, tree: tree.sha, parents: [parent], author: COMMIT_IDENTITY, committer: COMMIT_IDENTITY }),
  });

  try {
    await githubFetch(config, git + '/refs/heads/' + config.branch, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
  } catch (err) {
    // La branche a bougé : même situation que le 409 de l'API Contents, même traitement
    if (err instanceof GitHubError && err.status === 422) {
      throw new GitHubError(409, 'la branche ' + config.branch + ' a avancé pendant l\'écriture (' + err.message + ')');
    }
    throw err;
  }
  return { commit: commit.sha };
}
