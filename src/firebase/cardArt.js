// Card art stored directly in Firestore (no Firebase Storage needed).
//
// Upload: image is resized in the browser (max 1024px, leaving headroom for zoomed crops) and
// re-encoded as WebP/JPEG, then the resulting data URL is split into chunks under the 1 MB doc limit:
//   users/{uid}/cardArt/{cardId}/chunks/{index}  { index, data }
// The card doc records { art: { ownerUid, cardId, chunks, v } } so anyone can locate it.
// `v` changes whenever the art is replaced, so cached copies are refreshed.
// The full image is kept; the card's `artCrop` decides which part shows in the art window.
import { collection, doc, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from './config.js';

export const MAX_ART_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB cap on the file the player selects
const MAX_DIMENSION = 1024;
const CHUNK_CHARS = 900_000; // stays safely under Firestore's 1 MiB document limit

// ---------- Crop ----------
// x, y: focal point of the image (0 = left/top edge, 1 = right/bottom edge). zoom: 1 = fill the window.
export const DEFAULT_CROP = { x: 0.5, y: 0.5, zoom: 1 };
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const CARD_ZOOM = { min: MIN_ZOOM, max: MAX_ZOOM };
// Player icons can zoom out below 1 (whole photo inside the circle) and further in, to focus on a detail.
export const AVATAR_ZOOM = { min: 0.5, max: 6 };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// `limits`: allowed zoom range (CARD_ZOOM for card art, AVATAR_ZOOM for player icons).
export const normalizeCrop = (c, limits = CARD_ZOOM) => ({
  x: clamp(Number(c?.x ?? 0.5) || 0, 0, 1),
  y: clamp(Number(c?.y ?? 0.5) || 0, 0, 1),
  zoom: clamp(Number(c?.zoom ?? 1) || 1, limits.min, limits.max),
});

// Inline style that applies a crop to an <img> filling its frame.
export function cropStyle(crop, limits = CARD_ZOOM) {
  const { x, y, zoom } = normalizeCrop(crop, limits);
  const pos = `${x * 100}% ${y * 100}%`;
  return { objectFit: 'cover', objectPosition: pos, transformOrigin: pos, transform: `scale(${zoom})` };
}

// ---------- Compression ----------
// Resize + compress an image File/Blob into a data URL string.
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

// Player icons: the whole image is kept (resized small so the data URL fits comfortably on the user doc);
// the profile's `avatarCrop` decides which part shows in the round frame, just like card art.
const AVATAR_MAX = 512;
export async function compressAvatar(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, AVATAR_MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let url = canvas.toDataURL('image/webp', 0.85);
  if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.85);
  return url;
}

// ---------- Chunk storage ----------
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
  return { ownerUid, cardId, chunks, v: Date.now() };
}

// Deletes chunk docs from index `from` up to the art's chunk count.
export function addArtDeletesToBatch(batch, art, from = 0) {
  for (let i = from; i < art.chunks; i++) batch.delete(doc(chunksCol(art.ownerUid, art.cardId), String(i)));
}

// In-memory cache so each image is only fetched once per page load.
const cache = new Map();
export const artKey = (art) => `${art.ownerUid}/${art.cardId}/${art.v || 0}`;

export function loadArt(art) {
  const key = artKey(art);
  if (!cache.has(key)) {
    const p = getDocs(query(chunksCol(art.ownerUid, art.cardId), orderBy('index')))
      .then((snap) => snap.docs.slice(0, art.chunks).map((d) => d.data().data).join(''))
      .catch((e) => {
        cache.delete(key); // allow retry later
        throw e;
      });
    cache.set(key, p);
  }
  return cache.get(key);
}

export const forgetArt = (art) => cache.delete(artKey(art));
