/* Vérification du jeton Cloudflare Access — qui appelle /api/admin/* ?

   Cloudflare Access (Zero Trust, configuré en KD-91) protège /admin et /api/admin/* à
   la bordure : un visiteur non connecté ne voit que la page de connexion. Une fois
   connecté, chaque requête qui traverse Access porte un JWT signé par Cloudflare dans
   le header Cf-Access-Jwt-Assertion.

   Ce module revérifie ce JWT côté Function. C'est une ceinture en plus des bretelles :
   si la policy Access est mal configurée, absente sur une route ou retirée par erreur,
   la Function refuse quand même tout ce qui n'est pas signé par Cloudflare pour NOTRE
   application. Sans lui, /api/admin/* ne tiendrait que par un réglage de dashboard que
   personne ne relit.

   Pas de bibliothèque : RS256 se vérifie avec WebCrypto, disponible dans les Workers
   comme dans Node. Les clés publiques viennent du team domain (JWKS) et changent
   rarement ; on laisse le cache Cloudflare les garder une heure.

   Tout ce qui ne colle pas lève une AccessError : l'appelant répond 401, jamais autre
   chose. En cas de doute, on ferme. */

const JWKS_CACHE_SECONDS = 3600;
// Tolérance sur les horloges pour nbf/iat : les serveurs Cloudflare et le nôtre sont
// tous à l'heure, mais une seconde d'écart ne doit pas coûter une reconnexion.
const CLOCK_SKEW_SECONDS = 60;

export class AccessError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AccessError';
  }
}

// Les deux réglages viennent du dashboard Zero Trust (KD-91) et sont posés en variables
// Runtime : CF_ACCESS_TEAM_DOMAIN = « <équipe>.cloudflareaccess.com » (sans https://),
// CF_ACCESS_AUD = l'Application Audience (AUD) Tag de l'application Access.
export function accessConfig(env) {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const audience = env.CF_ACCESS_AUD;
  if (!teamDomain || !audience) return null;
  return { teamDomain, audience };
}

function base64UrlToBytes(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  let binary;
  try {
    binary = atob(padded);
  } catch (_) {
    throw new AccessError('segment du jeton illisible (base64url)');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonSegment(text, what) {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(text)));
  } catch (err) {
    if (err instanceof AccessError) throw err;
    throw new AccessError(what + ' du jeton illisible (JSON)');
  }
}

async function fetchSigningKeys(teamDomain) {
  const response = await fetch('https://' + teamDomain + '/cdn-cgi/access/certs', {
    cf: { cacheTtl: JWKS_CACHE_SECONDS, cacheEverything: true },
  });
  if (!response.ok) {
    throw new AccessError('clés publiques Access injoignables (HTTP ' + response.status + ')');
  }
  const body = await response.json();
  if (!body || !Array.isArray(body.keys)) {
    throw new AccessError('clés publiques Access dans un format inattendu');
  }
  return body.keys;
}

// Vérifie le JWT et renvoie l'identité qu'il porte ({ email, sub }).
// Lève une AccessError pour toute anomalie — l'appelant ne distingue pas les causes,
// il refuse. Le détail est pour les logs.
export async function verifyAccessJwt(token, config) {
  if (typeof token !== 'string') throw new AccessError('jeton absent');
  const parts = token.split('.');
  if (parts.length !== 3) throw new AccessError('jeton mal formé (' + parts.length + ' segments)');

  const header = decodeJsonSegment(parts[0], 'en-tête');
  // L'algorithme est imposé, jamais lu dans le jeton : accepter « none » ou un HMAC
  // dont la clé serait la clé publique est l'attaque classique contre les JWT.
  if (header.alg !== 'RS256') throw new AccessError('algorithme refusé : ' + header.alg);
  if (typeof header.kid !== 'string' || !header.kid) throw new AccessError('identifiant de clé (kid) absent');

  const keys = await fetchSigningKeys(config.teamDomain);
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new AccessError('clé de signature inconnue : ' + header.kid);
  if (jwk.kty !== 'RSA') throw new AccessError('type de clé inattendu : ' + jwk.kty);

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1]),
  );
  if (!valid) throw new AccessError('signature invalide');

  const payload = decodeJsonSegment(parts[1], 'contenu');
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new AccessError('jeton expiré');
  if (typeof payload.nbf === 'number' && payload.nbf > now + CLOCK_SKEW_SECONDS) throw new AccessError('jeton pas encore valable');
  if (payload.iss !== 'https://' + config.teamDomain) throw new AccessError('émetteur inattendu : ' + payload.iss);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(config.audience)) throw new AccessError('audience inattendue');

  return { email: payload.email, sub: payload.sub };
}
