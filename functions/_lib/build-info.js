/* Branche et commit du déploiement qui exécute les Functions.

   Cloudflare Pages ne donne la branche qu'au moment du build (CF_PAGES_BRANCH) ; build.js
   réécrit ce fichier avec les vraies valeurs pendant le déploiement, avant que Pages ne
   compile functions/. La production écrit donc sur master et une preview sur sa propre
   branche, sans aucune variable à poser dans le tableau de bord.

   La version commitée dit « inconnu » : c'est ce que voient une exécution locale ou un
   déploiement où la branche manquerait. github.js refuse alors d'écrire — on ne devine
   jamais où publier — et se rabat sur master pour lire. Ne jamais committer une autre
   valeur que null ici. */

export const buildInfo = {
  "branch": null,
  "commit": null
};
