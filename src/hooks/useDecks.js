import { useEffect, useMemo, useRef, useState } from 'react';
import { adoptLooseCards, watchAllCards, watchDecks, watchProfile } from '../firebase/db.js';
import { DEFAULT_DECKS } from '../data/defaultDecks.js';

// All decks available to a player: the built-in example decks followed by their own decks (with cards attached),
// plus which deck is active for play. Falls back to the first deck when none (or a deleted one) is selected.
export default function useDecks(uid) {
  const [userDecks, setUserDecks] = useState(null);
  const [cards, setCards] = useState(null);
  const [profile, setProfile] = useState(null);
  const migrating = useRef(false);

  useEffect(() => {
    const unsubs = [watchDecks(uid, setUserDecks), watchAllCards(uid, setCards), watchProfile(uid, setProfile)];
    return () => unsubs.forEach((u) => u());
  }, [uid]);

  // Cards from before decks existed have no deckId: move them into a "My Cards" deck once.
  useEffect(() => {
    if (!cards || migrating.current) return;
    const loose = cards.filter((c) => !c.deckId);
    if (loose.length === 0) return;
    migrating.current = true;
    adoptLooseCards(uid, loose)
      .catch((e) => console.error('Card migration failed', e))
      .finally(() => { migrating.current = false; });
  }, [cards, uid]);

  const decks = useMemo(() => {
    if (!userDecks || !cards) return null;
    const byDeck = {};
    cards.forEach((c) => { if (c.deckId) (byDeck[c.deckId] ||= []).push(c); });
    return [
      ...DEFAULT_DECKS,
      ...userDecks.map((d) => ({ ...d, isDefault: false, cards: byDeck[d.id] || [] })),
    ];
  }, [userDecks, cards]);

  const loading = !decks || !profile;
  const activeDeckId = decks && profile
    ? (decks.some((d) => d.id === profile.activeDeckId) ? profile.activeDeckId : decks[0].id)
    : null;

  return { decks, activeDeckId, loading };
}
