/* /templates/* — les gabarits sources de build.js ne se servent pas.

   Cloudflare Pages déploie tout ce qui se trouve à la racine du dépôt, templates/ compris : sans
   ce fichier, /templates/boutique.html répondrait le gabarit brut, marqueurs et commentaires de
   construction inclus. Inerte, mais ça expose la structure du site pour rien. Le fichier
   `_redirects` de Pages ne sait pas répondre un 404 (il n'accepte que des redirections et des
   réécritures en 200), d'où cette Function, qui prend le pas sur l'asset statique et sert la
   page 404 du site avec le vrai code. */

export async function onRequest(context) {
  const notFound = await context.env.ASSETS.fetch(new URL('/404.html', context.request.url));
  return new Response(notFound.body, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
