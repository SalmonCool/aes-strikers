import { useEffect, useMemo, useRef, useState } from 'react';
import { setDeckCards, watchAllCards, watchDecks, watchProfile } from '../firebase/db.js';
import { CARD_SETS, STARTER_DECKS } from '../data/cardSets.js';
import { expandDeck, validateDeck } from '../game/deckRules.js';

export const MY_CARDS_SET_ID = 'set-mine';

// Read-only, ready-to-play example decks: two per built-in set, each with its own play style.
export const EXAMPLE_DECKS = STARTER_DECKS.map((d) => ({
  id: d.id,
  name: `${d.name} (Example)`,
  blurb: d.blurb,
  builtIn: true,
  cards: d.cards,
}));

// Everything the deck builder and arena setup need:
//   sets:     built-in card sets + the player's own "My Cards" set
//   catalog:  { cardId: card } for every card that can go in a deck
//   decks:    example decks + the player's decks, each with { entries, cards (expanded), check (validation), builtIn }
//   activeDeckId: deck used for play (falls back to the first deck)
export default function useDecks(uid) {
  const [userDecks, setUserDecks] = useState(null);
  const [myCards, setMyCards] = useState(null);
  const [profile, setProfile] = useState(null);
  const migrated = useRef(new Set());

  useEffect(() => {
    const unsubs = [watchDecks(uid, setUserDecks), watchAllCards(uid, setMyCards), watchProfile(uid, setProfile)];
    return () => unsubs.forEach((u) => u());
  }, [uid]);

  // Decks saved before decks became "card + count" lists held their own cards (cards had a deckId).
  // Convert each such deck once into the new format, one copy of each of its cards.
  useEffect(() => {
    if (!userDecks || !myCards) return;
    userDecks.forEach((d) => {
      if (d.cards || migrated.current.has(d.id)) return;
      migrated.current.add(d.id);
      const entries = Object.fromEntries(myCards.filter((c) => c.deckId === d.id).map((c) => [c.id, 1]));
      setDeckCards(uid, d.id, entries).catch((e) => console.error('Deck migration failed', e));
    });
  }, [userDecks, myCards, uid]);

  const sets = useMemo(() => [
    ...CARD_SETS,
    { id: MY_CARDS_SET_ID, name: 'My Cards', builtIn: false, cards: myCards || [] },
  ], [myCards]);

  const catalog = useMemo(() => {
    const all = {};
    sets.forEach((s) => s.cards.forEach((c) => { all[c.id] = c; }));
    return all;
  }, [sets]);

  const decks = useMemo(() => {
    if (!userDecks) return null;
    return [...EXAMPLE_DECKS, ...userDecks].map((d) => {
      const entries = d.cards || {};
      return { ...d, entries, cards: expandDeck(entries, catalog), check: validateDeck(entries, catalog) };
    });
  }, [userDecks, catalog]);

  const loading = !decks || !profile || !myCards;
  const activeDeckId = decks && profile
    ? (decks.some((d) => d.id === profile.activeDeckId) ? profile.activeDeckId : decks[0]?.id ?? null)
    : null;

  return { sets, catalog, decks, activeDeckId, loading };
}
