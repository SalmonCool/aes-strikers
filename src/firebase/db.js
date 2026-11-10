// Firestore data layer.
//
// Collections:
//   users/{uid}                 { displayName, email, emailLower, photoURL, updatedAt }
//   users/{uid}/cards/{cardId}  see "Card shape" below
//   users/{uid}/decks/{deckId}  see "Decks" below
//   friendships/{uidA_uidB}     { members: [uidA, uidB], names: {uid: name}, requestedBy, status: 'pending'|'accepted', createdAt }
//   sessions/{sessionId}        { hostUid, hostName, guestUid, guestName, status: 'waiting'|'active', createdAt }
import {
  addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, query,
  runTransaction, serverTimestamp, setDoc, updateDoc, where, limit, writeBatch,
} from 'firebase/firestore';
import { db } from './config.js';
import { DEFAULT_CROP, addArtDeletesToBatch, addArtToBatch, forgetArt, normalizeCrop } from './cardArt.js';
import { newGame, newPlayer } from '../game/engine.js';

export const displayNameOf = (user) => user.displayName || user.email?.split('@')[0] || 'Player';

// ---------- Users ----------
export function saveUserProfile(user) {
  return setDoc(
    doc(db, 'users', user.uid),
    {
      displayName: displayNameOf(user),
      email: user.email || '',
      emailLower: (user.email || '').toLowerCase(),
      photoURL: user.photoURL || '',
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function findUserByEmail(email) {
  const q = query(collection(db, 'users'), where('emailLower', '==', email.trim().toLowerCase()), limit(1));
  const snap = await getDocs(q);
  return snap.empty ? null : { uid: snap.docs[0].id, ...snap.docs[0].data() };
}

// ---------- Cards ----------
// Card shape:
//   deckId: string                (the user deck this card belongs to)
//   title, cardType, typeAction ('' = none), description, aetherType, idolType: string
//   soulCost, health, damage: number
//   block: number   (Defend cards: damage blocked when used as a COUNTER!; Body Armor: direct damage reduced)
//   healthPlus, damagePlus: boolean   (show the stat as "40+", i.e. variable / can increase)
//   art: { ownerUid, cardId, chunks, v } | null   (image chunks live in Firestore, see cardArt.js)
//   artCrop: { x, y, zoom }   x/y = focal point 0–1, zoom = 1–4 (applied when rendering, original image kept)
//   createdAt, updatedAt: timestamp
export const CARD_TYPES = ['Ability', 'Attack', 'Defend', 'Spatial', 'Soul', 'Weapon', 'Shield', 'Body Armor', 'Incantation'];
export const TYPE_ACTIONS = ['Equip', 'Cast', 'Latent'];
export const AETHER_TYPES = ['Air', 'Wind', 'Earth', 'Fire', 'Water', 'Shadow', 'Aether', 'Demon', 'Soul'];
export const IDOL_TYPES = ['Anger', 'Fear', 'Sadness', 'Disgust', 'Happiness', 'Surprise'];

export const EMPTY_CARD = {
  title: '',
  cardType: CARD_TYPES[0],
  typeAction: TYPE_ACTIONS[0],
  description: '',
  soulCost: 0,
  health: 0,
  damage: 0,
  block: 0,
  healthPlus: false,
  damagePlus: false,
  aetherType: AETHER_TYPES[0],
  idolType: IDOL_TYPES[0],
  art: null,
  artCrop: DEFAULT_CROP,
};

const cardFields = (card) => ({
  title: card.title.trim(),
  cardType: card.cardType,
  typeAction: card.typeAction || '',
  description: (card.description || '').trim(),
  soulCost: Number(card.soulCost) || 0,
  health: Number(card.health) || 0,
  damage: Number(card.damage) || 0,
  block: Number(card.block) || 0,
  healthPlus: Boolean(card.healthPlus),
  damagePlus: Boolean(card.damagePlus),
  aetherType: card.aetherType,
  idolType: card.idolType,
  artCrop: normalizeCrop(card.artCrop),
});

const cardsCol = (uid) => collection(db, 'users', uid, 'cards');
const millis = (t) => t?.toMillis?.() ?? Number.MAX_SAFE_INTEGER; // pending server timestamps sort last

// All of a user's cards across every deck (filtered by deck client-side; avoids needing a composite index).
export function watchAllCards(uid, cb) {
  return onSnapshot(cardsCol(uid), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => millis(a.createdAt) - millis(b.createdAt))),
  );
}

// Saves a card into a deck, plus (optionally) its compressed art data URL, in one atomic batch.
export async function addCard(uid, deckId, card, artDataUrl) {
  const ref = doc(cardsCol(uid));
  const batch = writeBatch(db);
  const art = artDataUrl ? addArtToBatch(batch, uid, ref.id, artDataUrl) : null;
  batch.set(ref, { ...cardFields(card), deckId, art, createdAt: serverTimestamp() });
  await batch.commit();
  return ref.id;
}

// Updates an existing card.
//   artChange: undefined = keep current art, null = remove art, string = replace with this data URL
export async function updateCard(uid, existing, card, artChange) {
  const ref = doc(db, 'users', uid, 'cards', existing.id);
  const batch = writeBatch(db);
  let art = existing.art || null;

  if (artChange !== undefined) {
    art = artChange ? addArtToBatch(batch, uid, existing.id, artChange) : null;
    // New chunks overwrite indexes 0..n-1; delete any leftover old chunks beyond that
    if (existing.art) addArtDeletesToBatch(batch, existing.art, art ? art.chunks : 0);
  }

  batch.update(ref, { ...cardFields(card), art, updatedAt: serverTimestamp() });
  await batch.commit();
  if (artChange !== undefined && existing.art) forgetArt(existing.art);
}

export async function deleteCard(uid, card) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', uid, 'cards', card.id));
  if (card.art) addArtDeletesToBatch(batch, card.art);
  await batch.commit();
  if (card.art) forgetArt(card.art);
}

// ---------- Decks ----------
//   users/{uid}/decks/{deckId}  { name, createdAt }
//   users/{uid}.activeDeckId    the deck used when entering an arena (may be a built-in default deck id)
const decksCol = (uid) => collection(db, 'users', uid, 'decks');
const MAX_BATCH_OPS = 450;

export function watchDecks(uid, cb) {
  return onSnapshot(decksCol(uid), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => millis(a.createdAt) - millis(b.createdAt))),
  );
}

export function watchProfile(uid, cb) {
  return onSnapshot(doc(db, 'users', uid), (s) => cb(s.exists() ? s.data() : {}));
}

export const setActiveDeck = (uid, deckId) => setDoc(doc(db, 'users', uid), { activeDeckId: deckId }, { merge: true });

export async function createDeck(uid, name) {
  const ref = await addDoc(decksCol(uid), { name: name.trim(), createdAt: serverTimestamp() });
  return ref.id;
}

export const renameDeck = (uid, deckId, name) => updateDoc(doc(db, 'users', uid, 'decks', deckId), { name: name.trim() });

// Deletes a deck and every card (and card art) in it.
export async function deleteDeck(uid, deckId, cards) {
  const ops = [];
  for (const c of cards) {
    ops.push((b) => b.delete(doc(db, 'users', uid, 'cards', c.id)));
    if (c.art) for (let i = 0; i < c.art.chunks; i++) ops.push((b) => addArtDeletesToBatch(b, { ...c.art, chunks: i + 1 }, i));
  }
  ops.push((b) => b.delete(doc(db, 'users', uid, 'decks', deckId)));
  for (let i = 0; i < ops.length; i += MAX_BATCH_OPS) {
    const batch = writeBatch(db);
    ops.slice(i, i + MAX_BATCH_OPS).forEach((op) => op(batch));
    await batch.commit();
  }
  cards.forEach((c) => c.art && forgetArt(c.art));
}

// Creates an editable copy of a deck (used for the built-in example decks, which have no art).
export async function copyDeck(uid, name, cards) {
  const deckRef = doc(decksCol(uid));
  const batch = writeBatch(db);
  batch.set(deckRef, { name: name.trim(), createdAt: serverTimestamp() });
  cards.forEach((c) => batch.set(doc(cardsCol(uid)), { ...cardFields(c), deckId: deckRef.id, art: null, createdAt: serverTimestamp() }));
  await batch.commit();
  return deckRef.id;
}

// One-time migration: cards created before decks existed get moved into a "My Cards" deck.
export async function adoptLooseCards(uid, looseCards) {
  if (looseCards.length === 0) return null;
  const deckRef = doc(decksCol(uid));
  for (let i = 0; i < looseCards.length; i += MAX_BATCH_OPS) {
    const batch = writeBatch(db);
    if (i === 0) batch.set(deckRef, { name: 'My Cards', createdAt: serverTimestamp() });
    looseCards.slice(i, i + MAX_BATCH_OPS).forEach((c) => batch.update(doc(db, 'users', uid, 'cards', c.id), { deckId: deckRef.id }));
    await batch.commit();
  }
  return deckRef.id;
}

// ---------- Friends ----------
const pairId = (a, b) => [a, b].sort().join('_');

export function watchFriendships(uid, cb) {
  const q = query(collection(db, 'friendships'), where('members', 'array-contains', uid));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function sendFriendRequest(me, email) {
  const target = await findUserByEmail(email);
  if (!target) throw new Error('No player found with that email.');
  if (target.uid === me.uid) throw new Error("You can't add yourself.");
  try {
    await setDoc(doc(db, 'friendships', pairId(me.uid, target.uid)), {
      members: [me.uid, target.uid],
      names: { [me.uid]: displayNameOf(me), [target.uid]: target.displayName },
      requestedBy: me.uid,
      status: 'pending',
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    // Rules reject overwriting an existing friendship doc
    if (e.code === 'permission-denied') throw new Error('You already have a request or friendship with this player.');
    throw e;
  }
  return target;
}

export const acceptFriendRequest = (id) => updateDoc(doc(db, 'friendships', id), { status: 'accepted' });
export const removeFriendship = (id) => deleteDoc(doc(db, 'friendships', id));

// ---------- Sessions ----------
export async function createSession(user) {
  const ref = await addDoc(collection(db, 'sessions'), {
    hostUid: user.uid,
    hostName: displayNameOf(user),
    guestUid: null,
    guestName: null,
    status: 'waiting',
    game: newGame(user.uid, displayNameOf(user)),
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export function watchSession(id, cb, onError) {
  return onSnapshot(
    doc(db, 'sessions', id),
    (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    onError,
  );
}

// Claims the guest seat if it's free. Returns 'host' | 'guest' | 'full' | 'missing'.
export function joinSession(id, user) {
  return runTransaction(db, async (tx) => {
    const ref = doc(db, 'sessions', id);
    const snap = await tx.get(ref);
    if (!snap.exists()) return 'missing';
    const s = snap.data();
    if (s.hostUid === user.uid) return 'host';
    if (s.guestUid === user.uid) return 'guest';
    if (s.guestUid) return 'full';
    const name = displayNameOf(user);
    tx.update(ref, {
      guestUid: user.uid,
      guestName: name,
      status: 'active',
      [`game.players.${user.uid}`]: newPlayer(name),
      [`game.board.${user.uid}`]: {},
      [`game.discard.${user.uid}`]: [],
    });
    tx.set(doc(collection(db, 'sessions', id, 'log')), {
      text: `${name} joined the arena.`, kind: 'info', uid: user.uid, at: Date.now(),
    });
    return 'guest';
  });
}

