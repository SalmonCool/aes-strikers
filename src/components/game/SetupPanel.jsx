import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { createDeck, setActiveDeck } from '../../firebase/db.js';
import { TOKENS, cardTokenId, resourceOf, tokenLabel } from '../../game/tokens.js';
import { STARTER_DECKS } from '../../data/cardSets.js';
import useDecks from '../../hooks/useDecks.js';

// The token most of the deck's cards belong to (used to pre-select it).
function mostCommonToken(cards) {
  const counts = {};
  cards.filter((c) => c.cardType !== 'Soul').forEach((c) => {
    const t = cardTokenId(c);
    if (t) counts[t] = (counts[t] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

// Setup phase: choose a deck and your Hero/Villain token. Only cards belonging to that token can be played.
export default function SetupPanel({ uid, onReady }) {
  const { decks, activeDeckId, loading } = useDecks(uid);
  const [picks, setPicks] = useState({}); // deckId -> token id
  const [busy, setBusy] = useState(false);

  const deck = decks?.find((d) => d.id === activeDeckId);
  const cards = useMemo(() => deck?.cards || [], [deck]);
  const defaultToken = useMemo(() => mostCommonToken(cards), [cards]);
  const token = picks[deck?.id] ?? defaultToken ?? TOKENS[0].id;
  const setPick = (v) => setPicks((p) => ({ ...p, [deck.id]: v }));

  const playable = cards.filter((c) => c.cardType !== 'Soul' && cardTokenId(c) === token);
  const unplayableTitles = [...new Set(cards.filter((c) => !playable.includes(c)).map((c) => `${c.title} (${tokenLabel(cardTokenId(c))})`))];
  const heroes = TOKENS.filter((t) => t.kind === 'hero');
  const villains = TOKENS.filter((t) => t.kind === 'villain');

  const ready = async () => {
    setBusy(true);
    try {
      await onReady(cards, token);
    } finally {
      setBusy(false);
    }
  };

  const makeStarter = async (starter) => {
    setBusy(true);
    try {
      const id = await createDeck(uid, starter.name, starter.cards);
      await setActiveDeck(uid, id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="panel modal setup-panel" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <h2 id="setup-title">Setup Phase</h2>
        {loading ? (
          <p className="setup-hint">Loading your decks…</p>
        ) : decks.length === 0 ? (
          <>
            <p className="setup-hint">You don’t have a deck yet. Grab a starter deck to play now, or build one in the Deck Manager.</p>
            <div className="starter-row">
              {STARTER_DECKS.map((d) => (
                <button key={d.id} className="ui-btn primary" disabled={busy} title={d.blurb} onClick={() => makeStarter(d)}>{d.name}</button>
              ))}
              <Link to="/deck" className="ui-btn">Deck Manager</Link>
            </div>
          </>
        ) : (
          <>
            <div className="field setup-deck">
              <label htmlFor="setup-deck">Deck</label>
              <select id="setup-deck" className="ui-select" value={activeDeckId} onChange={(e) => setActiveDeck(uid, e.target.value)}>
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>{d.name} ({d.check.total} cards){d.check.valid ? '' : ' — needs fixes'}</option>
                ))}
              </select>
            </div>

            {!deck.check.valid ? (
              <>
                <p className="ui-msg error setup-summary">This deck can’t be played yet: {deck.check.errors.join(' ')}</p>
                <Link to="/deck" className="ui-btn primary">Fix in Deck Manager</Link>
              </>
            ) : (
              <>
                <p className="setup-hint">
                  Place your <strong>Hero</strong> or <strong>Villain</strong> token. It shows your opponent who you play, decides which
                  cards you can play, and sets your resource: Heroes earn SOUL, Villains earn SHADOW or DRIVE.
                </p>
                <div className="field">
                  <label htmlFor="setup-token">Token</label>
                  <select id="setup-token" className="ui-select" value={token} onChange={(e) => setPick(e.target.value)}>
                    <optgroup label="Heroes">
                      {heroes.map((t) => <option key={t.id} value={t.id}>{tokenLabel(t.id)} — earns {resourceOf(t.id).label}</option>)}
                    </optgroup>
                    {villains.length > 0 && (
                      <optgroup label="Villains">
                        {villains.map((t) => <option key={t.id} value={t.id}>{tokenLabel(t.id)} — earns {resourceOf(t.id).label}</option>)}
                      </optgroup>
                    )}
                  </select>
                </div>
                <p className={`ui-msg ${unplayableTitles.length ? 'error' : 'info'} setup-summary`}>
                  {playable.length} of {cards.length} cards are playable with {tokenLabel(token)}.
                  {unplayableTitles.length > 0 && ` Not playable: ${unplayableTitles.join(', ')}.`}
                </p>
                <div className="modal-actions">
                  <button className="ui-btn primary" disabled={busy} onClick={ready}>{busy ? 'Shuffling…' : 'Ready'}</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
