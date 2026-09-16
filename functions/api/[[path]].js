/* Tout /api/* qui ne correspond à aucune route — un vrai 404.

   Sans ce fichier, Cloudflare Pages servirait la page d'accueil, en 200, pour n'importe
   quel chemin inconnu sous /api (comportement mesuré et documenté dans le README). Un
   client qui se tromperait de route recevrait du HTML avec un statut de succès : le pire
   des signaux. Ici, il reçoit une erreur qu'il peut afficher. */

import { error } from '../_lib/http.js';

export function onRequest() {
  return error(404, 'Cette adresse n\'existe pas.');
}
