/* Tout /api/admin/* qui ne correspond à aucune route métier — 404, derrière la garde.

   Les routes métier arrivent avec leurs tickets (KD-92 : PATCH /api/admin/products/:slug,
   KD-93 : ajout et modification d'un bijou) et, plus spécifiques, passeront devant ce
   catch-all. Il garantit dès maintenant que le middleware a quelque chose à protéger :
   c'est ce qui permet de vérifier, sans attendre KD-91, que /api/admin/* refuse bien. */

import { error } from '../../_lib/http.js';

export function onRequest() {
  return error(404, 'Cette adresse n\'existe pas.');
}
