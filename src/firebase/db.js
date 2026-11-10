// Firestore data layer.
//
// Collections:
//   users/{uid}                 { displayName, email, emailLower, photoURL, updatedAt }
//   users/{uid}/cards/{cardId}  see "Card shape" below
//   friendships/{uidA_uidB}     { members: [uidA, uidB], names: {uid: name}, requestedBy, status: 'pending'|'accepted', createdAt }
//   sessions/{sessionId}        { hostUid, hostName, guestUid, guestName, status: 'waiting'|'active', createdAt }
import {
  addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query,
  runTransaction, serverTimestamp, setDoc, updateDoc, where, limit, writeBatch,
} from 'firebase/firestore';
import { db } from './config.js';
import { addArtDeletesToBatch, addArtToBatch, forgetArt } from './cardArt.js';
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
//   title, cardType, typeAction, description, aetherType, idolType: string
//   soulCost, health, damage: number
//   art: { ownerUid, cardId, chunks } | null   (image chunks live in Firestore, see cardArt.js)
//   createdAt: timestamp
export const CARD_TYPES = ['Ability', 'Attack', 'Defend', 'Spatial', 'Soul', 'Body Armor', 'Incantation'];
export const TYPE_ACTIONS = ['Equip', 'Cast', 'Latent'];
export const AETHER_TYPES = ['Air', 'Earth', 'Fire', 'Water', 'Shadow', 'Aether', 'Demon', 'Soul'];
export const IDOL_TYPES = ['Anger', 'Fear', 'Sadness', 'Disgust', 'Happiness', 'Surprise'];

export const EMPTY_CARD = {
  title: '',
  cardType: CARD_TYPES[0],
  typeAction: TYPE_ACTIONS[0],
  description: '',
  soulCost: 0,
  health: 0,
  damage: 0,
  aetherType: AETHER_TYPES[0],
  idolType: IDOL_TYPES[0],
  art: null,
};

export function watchCards(uid, cb) {
  const q = query(collection(db, 'users', uid, 'cards'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// Saves a card and (optionally) its compressed art data URL in one atomic batch.
export async function addCard(uid, card, artDataUrl) {
  const ref = doc(collection(db, 'users', uid, 'cards'));
  const batch = writeBatch(db);
  const art = artDataUrl ? addArtToBatch(batch, uid, ref.id, artDataUrl) : null;
  batch.set(ref, {
    title: card.title.trim(),
    cardType: card.cardType,
    typeAction: card.typeAction,
    description: card.description.trim(),
    soulCost: Number(card.soulCost) || 0,
    health: Number(card.health) || 0,
    damage: Number(card.damage) || 0,
    aetherType: card.aetherType,
    idolType: card.idolType,
    art,
    createdAt: serverTimestamp(),
  });
  await batch.commit();
  return ref.id;
}

export async function deleteCard(uid, card) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', uid, 'cards', card.id));
  if (card.art) addArtDeletesToBatch(batch, card.art);
  await batch.commit();
  if (card.art) forgetArt(card.art);
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

