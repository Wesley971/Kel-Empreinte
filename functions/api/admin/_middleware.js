/* Garde de /api/admin/* — rien ne passe sans un jeton Cloudflare Access valide.

   S'exécute avant toute route du dossier (Pages Functions applique _middleware.js à tout
   le sous-arbre). Trois refus possibles, tous fermés par défaut :

   - 503 si les réglages Access ne sont pas posés (CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD,
     variables Runtime configurées en KD-91). C'est l'état normal tant que KD-91 n'est pas
     fait : l'API existe mais n'est pas utilisable — c'est l'ordre des dépendances voulu,
     pas une panne. Volontairement pas de secret provisoire à la place : un chemin d'auth
     parallèle qu'on oublierait de retirer.
   - 401 sans header Cf-Access-Jwt-Assertion : l'appel n'a pas traversé Access.
   - 401 si le jeton ne se vérifie pas (signature, expiration, émetteur, audience).

   Quand tout est bon, l'identité du jeton est déposée dans context.data.user pour que
   les routes métier (KD-92, KD-93) sachent qui écrit — utile pour signer les commits. */

import { error } from '../../_lib/http.js';
import { accessConfig, verifyAccessJwt } from '../../_lib/access.js';

export async function onRequest(context) {
  const config = accessConfig(context.env);
  if (!config) {
    return error(503, "L'accès à l'espace de gestion n'est pas encore configuré.");
  }

  const token = context.request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) {
    return error(401, 'Connexion requise pour accéder à cette page.');
  }

  try {
    context.data.user = await verifyAccessJwt(token, config);
  } catch (err) {
    console.warn('access : ' + (err && err.message ? err.message : err));
    return error(401, 'Votre session a expiré ou n\'est pas valable. Reconnectez-vous.');
  }

  return context.next();
}
