/* Accès au dépôt GitHub depuis les Pages Functions — lecture et écriture de fichiers.

   Le dépôt est la seule base de données du site (data/products.json, images/). Les
   Functions y écrivent via l'API Contents avec un token fine-grained limité à ce seul
   dépôt (Contents : Read and write), lu dans env.GITHUB_TOKEN — une variable Runtime
   Cloudflare (Settings › Variables and Secrets, type Secret), jamais une variable de
   Build, jamais envoyée au navigateur.

   Le repo et la branche ont une valeur par défaut : une seule variable à configurer
   pour que la brique fonctionne. GITHUB_REPO / GITHUB_BRANCH permettent de viser un
   autre dépôt (fork, test) sans toucher au code.

   Le piège de ce fichier est l'encodage : l'API échange les contenus en base64, et
   atob/btoa ne connaissent que le Latin-1. Un « é » passé à btoa lève une exception,
   un « ç » lu via atob seul devient deux caractères parasites. Tout passe donc par des
   octets UTF-8 (TextEncoder/TextDecoder), et le round-trip est couvert par un test. */

const API_URL = 'https://api.github.com';
const API_VERSION = '2022-11-28';
// L'API GitHub refuse les requêtes sans User-Agent.
const USER_AGENT = 'kel-empreinte-pages-functions';

const DEFAULT_REPO = 'Wesley971/Kel-Empreinte';
const DEFAULT_BRANCH = 'master';

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
    branch: env.GITHUB_BRANCH || DEFAULT_BRANCH,
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
// concurrente — la même pièce éditée depuis Sveltia et depuis le nouvel espace).
export async function readRepoFile(env, filePath) {
  const config = repoConfig(env);
  const file = await githubFetch(config, contentsPath(config, filePath) + '?ref=' + encodeURIComponent(config.branch));
  if (file.type !== 'file' || typeof file.content !== 'string') {
    throw new GitHubError(0, filePath + ' : la réponse GitHub ne contient pas un fichier (' + (file.type || 'type inconnu') + ')');
  }
  return { content: decodeBase64Utf8(file.content), sha: file.sha };
}

// Écrit (crée ou met à jour) un fichier TEXTE du dépôt en un commit sur la branche. Texte
// uniquement : le contenu passe par TextEncoder. Les images (KD-93) demanderont une variante
// qui encode des octets, pas une chaîne.
// `sha` : celui renvoyé par readRepoFile pour une mise à jour ; omis pour une création.
// Sans le bon sha, GitHub répond 409 : c'est voulu, on ne veut jamais écraser à l'aveugle.
export async function writeRepoFile(env, filePath, { content, sha, message }) {
  const config = repoConfig(env);
  const result = await githubFetch(config, contentsPath(config, filePath), {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: encodeBase64Utf8(content),
      branch: config.branch,
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
