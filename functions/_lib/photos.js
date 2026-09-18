/* Les photos reçues du formulaire de pièce (KD-93) — lecture de la requête, contrôle du contenu,
   nom des fichiers.

   Le formulaire envoie du JSON : { piece: <la fiche>, photos: { "photo-1": "<base64>", … } }.
   Les photos arrivent DÉJÀ en base64, encodées par le navigateur (FileReader.readAsDataURL,
   natif) : la Function ne les décode ni ne les réencode, elle passe la chaîne telle quelle à
   GitHub (git/blobs, encoding base64). C'est une question de temps CPU, compté par requête
   (10 ms sur l'offre gratuite) : encoder des octets en base64 en JavaScript coûte ~10 ms par
   Mo, alors que JSON.parse d'un corps de 1,3 Mo et JSON.stringify des corps de blobs sont
   natifs et tiennent en 2 à 3 ms — mesuré le 18/09/2026. Le multipart binaire aurait obligé
   à encoder ici.

   Le navigateur réduit et convertit les photos avant l'envoi (WebP, JPEG en repli) ; ici on
   vérifie ce qui arrive vraiment — la signature des premiers octets, jamais un type annoncé —
   et on borne : 10 photos, 1 Mo chacune, 3 Mo par enregistrement. Une photo trop lourde n'est
   pas une faute de Prescilia, c'est le signe que la réduction n'a pas eu lieu ; le message le
   dit. Une chaîne qui ne serait pas du base64 valide est refusée par GitHub (502) : le
   formulaire est le seul émetteur, on ne paie pas une vérification de plus ici. */

export const MAX_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 1024 * 1024;
export const MAX_REQUEST_PHOTO_BYTES = 3 * 1024 * 1024;
const PHOTO_FIELD = /^photo-\d+$/;
const EXTENSIONS = { webp: 'webp', jpeg: 'jpg' };

// Lit la requête du formulaire. Renvoie { piece, uploads } — `piece` tel que reçu (non vérifié),
// `uploads` : { 'photo-1': { base64, kind } } — ou { error: { status, message } }.
export async function readPieceRequest(request) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return { error: { status: 400, message: 'Requête illisible : le corps doit être du JSON.' } };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: { status: 400, message: 'Requête illisible : un objet { piece, photos } est attendu.' } };
  }
  const unknown = Object.keys(body).find((key) => key !== 'piece' && key !== 'photos');
  if (unknown) return { error: { status: 400, message: 'Champ inattendu dans la requête : « ' + unknown + ' ».' } };
  if (body.piece === undefined) return { error: { status: 400, message: 'Requête illisible : la fiche (piece) manque.' } };

  const photos = body.photos === undefined ? {} : body.photos;
  if (!photos || typeof photos !== 'object' || Array.isArray(photos)) {
    return { error: { status: 400, message: 'Requête illisible : « photos » doit être un objet { "photo-1": "<base64>" }.' } };
  }
  const uploads = {};
  let total = 0;
  const fields = Object.keys(photos);
  if (fields.length > MAX_PHOTOS) return { error: { status: 422, message: 'Au plus ' + MAX_PHOTOS + ' photos par pièce.' } };
  for (const field of fields) {
    if (!PHOTO_FIELD.test(field)) return { error: { status: 400, message: 'Champ inattendu dans les photos : « ' + field + ' ».' } };
    const base64 = photos[field];
    if (typeof base64 !== 'string' || !base64) return { error: { status: 400, message: 'La photo « ' + field + ' » doit être une chaîne base64.' } };
    const bytes = decodedLength(base64);
    if (bytes > MAX_PHOTO_BYTES) {
      return { error: { status: 413, message: 'Une photo est trop lourde (plus de 1 Mo). Le formulaire les réduit avant l\'envoi : réessayez, ou choisissez une autre photo.' } };
    }
    total += bytes;
    if (total > MAX_REQUEST_PHOTO_BYTES) {
      return { error: { status: 413, message: 'Trop de photos lourdes d\'un coup (plus de 3 Mo). Enregistrez avec moins de photos, puis ajoutez les autres.' } };
    }
    const kind = imageKind(base64);
    if (!kind) return { error: { status: 415, message: 'Format de photo non pris en charge : JPEG ou WebP attendu.' } };
    uploads[field] = { base64, kind };
  }
  return { piece: body.piece, uploads };
}

// La taille décodée d'une chaîne base64, sans la décoder
function decodedLength(base64) {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor(base64.length * 3 / 4) - padding;
}

// 'webp' | 'jpeg' | null, d'après les premiers octets — RIFF….WEBP, ou FF D8 FF. Seuls les
// 16 premiers caractères (12 octets) sont décodés.
export function imageKind(base64) {
  let head;
  try {
    head = atob(base64.slice(0, 16));
  } catch (_) {
    return null;
  }
  const b = (i) => head.charCodeAt(i);
  if (head.length >= 12 && b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 &&
      b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return 'webp';
  if (head.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'jpeg';
  return null;
}

// Les fichiers qu'une pièce possède par leur nom : images/<id>-<n>.<ext>. Ce sont les seuls que
// l'API supprime (photo retirée, brouillon supprimé) — un fichier au nom d'avant KD-93
// (images/boucles-herbier-jaune-velours.jpg) reste en place quoi qu'il arrive : rien ne dit
// qu'une page ne s'en sert pas.
export function ownedPhotoPattern(id) {
  return new RegExp('^images/' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)\\.[a-z0-9]+$');
}

// Le chemin de la prochaine photo d'une pièce : le premier numéro libre après ceux qu'elle a
// déjà (jamais renommé : l'ordre des photos vit dans la liste `images`, pas dans les noms).
export function nextPhotoPath(id, takenSrcs, kind) {
  const owned = ownedPhotoPattern(id);
  let max = 0;
  takenSrcs.forEach((src) => {
    const match = owned.exec(src);
    if (match) max = Math.max(max, Number(match[1]));
  });
  return 'images/' + id + '-' + (max + 1) + '.' + EXTENSIONS[kind];
}
