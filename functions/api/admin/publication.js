/* GET /api/admin/publication — ce que Prescilia a enregistré est-il en ligne ? (KD-82)

   L'écran « Mes bijoux » promettait « mise en ligne dans 1 à 2 minutes » sans rien observer : un
   build en échec ne se voyait que chez Wesley (e-mail Cloudflare). Ici, sans aucun jeton
   Cloudflare : le déploiement qui exécute cette Function connaît son propre commit
   (build-info.js, écrit par build.js depuis CF_PAGES_COMMIT_SHA), et GitHub sait ce que la branche
   a de plus que lui. La différence, c'est ce qui attend d'être mis en ligne.

   Réponse 200 : { deployed, latest, pending: [{ sha, date }], state }
     deployed  le commit servi par ce déploiement
     latest    le dernier commit comparé — la tête de la branche quand elle est en avance ;
               `deployed` quand rien ne l'est (l'écran ne s'en sert pas)
     pending   les commits après `deployed` qui déploient — un commit porteur d'un marqueur
               « ne pas déployer » de Cloudflare Pages (aujourd'hui : la suppression d'un
               brouillon, functions/_lib/piece.js) n'attend rien et n'est pas compté
     state     online   rien n'attend
               pending  le plus ancien commit en attente a moins de PENDING_MINUTES (un build
                        Pages prend 1 à 2 min, plus une file : un seul build à la fois, KD-72)
               late     il attend depuis plus longtemps, ou `deployed` n'est plus dans
                        l'historique de la branche (rollback manuel, historique réécrit) : le
                        site n'est pas à jour et ne le sera pas tout seul

   Jamais un 200 sans verdict : l'écran se tait sur toute autre réponse (il ne sait pas, donc il
   n'affiche rien — un bandeau d'échec à tort serait pire que pas de bandeau). 503 hors Pages
   (build-info sans commit), 502/503/409 GitHub via catalogFailure, 405 autre méthode.

   Le verdict (judge) est une fonction pure de la comparaison et de l'instant : c'est elle qui
   est testée. Derrière Cloudflare Access et le middleware du dossier ; jamais mise en cache. */

import { json, error, methodNotAllowed } from '../../_lib/http.js';
import { deploymentBranch, deploymentCommit, compareCommits } from '../../_lib/github.js';
import { catalogFailure } from '../../_lib/products.js';

// Au-delà, un déploiement n'est plus « en cours » : il a échoué ou n'est jamais parti
export const PENDING_MINUTES = 6;

// Les cinq formes que Cloudflare Pages reconnaît n'importe où dans le message, sans tenir compte
// de la casse (la seule écrite par l'API est celle de functions/_lib/piece.js). Une regex dans
// le code, jamais dans un message de commit : githooks/commit-msg refuse ces marqueurs.
const SKIP_MARKER = /\[(ci[ -]skip|skip[ -]ci|cf-pages-skip)\]/i;

export async function onRequest(context) {
  if (context.request.method !== 'GET') return methodNotAllowed(['GET']);

  const deployed = deploymentCommit();
  const branch = deploymentBranch();
  if (!deployed || !branch) return error(503, 'Ce déploiement ne sait pas quel commit il sert : la mise en ligne ne peut pas être observée.');

  try {
    const compare = await compareCommits(context.env, deployed, branch);
    return json(judge({ deployed, compare, now: new Date() }));
  } catch (err) {
    console.error('publication : comparaison impossible — ' + (err && err.message ? err.message : err));
    return catalogFailure(err);
  }
}

// Le verdict. `compare` : { status, commits: [{ sha, message, date }] } tel que compareCommits le
// rend, les commits du plus ancien au plus récent (ordre GitHub).
export function judge({ deployed, compare, now }) {
  const pending = compare.commits
    .filter((commit) => !SKIP_MARKER.test(commit.message))
    .map((commit) => ({ sha: commit.sha, date: commit.date }));
  const latest = compare.commits.length ? compare.commits[compare.commits.length - 1].sha : deployed;

  let state;
  if (compare.status === 'diverged' || compare.status === 'behind') {
    // Le commit servi n'est plus dans l'historique : rien de ce qui attend ne le rattrapera
    state = 'late';
  } else if (!pending.length) {
    state = 'online';
  } else {
    const oldest = Date.parse(pending[0].date);
    // Date illisible : on ne peut pas dire « en cours », on dit « en retard » — le silence
    // serait un faux « en ligne »
    state = isNaN(oldest) || now.getTime() - oldest >= PENDING_MINUTES * 60 * 1000 ? 'late' : 'pending';
  }
  return { deployed, latest, pending, state };
}
