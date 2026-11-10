// Card art stored directly in Firestore (no Firebase Storage needed).
//
// Upload: image is resized in the browser (max 720px) and re-encoded as WebP/JPEG,
// then the resulting data URL is split into chunks under 1 MB doc limit:
//   users/{uid}/cardArt/{cardId}/chunks/{index}  { index, data }
// The card doc records { art: { ownerUid, cardId, chunks } } so anyone can locate it.
import { collection, doc, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from './config.js';

export const MAX_ART_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB cap on the file the player selects
const MAX_DIMENSION = 720;
const CHUNK_CHARS = 900_000; // stays safely under Firestore's 1 MiB document limit

// Resize + compress an image File into a data URL string.
export async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let url = canvas.toDataURL('image/webp', 0.82);
  // Browsers without WebP encoding silently return PNG; JPEG is far smaller in that case
  if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.85);
  return url;
}

const chunksCol = (ownerUid, cardId) => collection(db, 'users', ownerUid, 'cardArt', cardId, 'chunks');

// Adds chunk writes to an existing batch; returns the art reference to store on the card.
export function addArtToBatch(batch, ownerUid, cardId, dataUrl) {
  const chunks = Math.ceil(dataUrl.length / CHUNK_CHARS);
  for (let i = 0; i < chunks; i++) {
    batch.set(doc(chunksCol(ownerUid, cardId), String(i)), {
      index: i,
      data: dataUrl.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS),
    });
  }
  return { ownerUid, cardId, chunks };
}

export function addArtDeletesToBatch(batch, art) {
  for (let i = 0; i < art.chunks; i++) batch.delete(doc(chunksCol(art.ownerUid, art.cardId), String(i)));
}

// In-memory cache so each image is only fetched once per page load.
const cache = new Map();

export function loadArt(art) {
  const key = `${art.ownerUid}/${art.cardId}`;
  if (!cache.has(key)) {
    const p = getDocs(query(chunksCol(art.ownerUid, art.cardId), orderBy('index')))
      .then((snap) => snap.docs.map((d) => d.data().data).join(''))
      .catch((e) => {
        cache.delete(key); // allow retry later
        throw e;
      });
    cache.set(key, p);
  }
  return cache.get(key);
}

export const forgetArt = (art) => cache.delete(`${art.ownerUid}/${art.cardId}`);
