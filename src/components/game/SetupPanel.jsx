import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AETHER_TYPES, IDOL_TYPES, setActiveDeck } from '../../firebase/db.js';
import useDecks from '../../hooks/useDecks.js';

// Most common value of a field among non-SOUL cards (used to pre-select the deck's tokens).
function mostCommon(cards, key) {
  const counts = {};
  cards.filter((c) => c.cardType !== 'Soul').forEach((c) => { counts[c[key]] = (counts[c[key]] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

// Setup phase: choose a deck and your Aether + Idol tokens. Only cards matching both tokens can be played.
export default function SetupPanel({ uid, onReady }) {
  const { decks, activeDeckId, loading } = useDecks(uid);
  const [picks, setPicks] = useState({}); // deckId -> { aether, idol }
  const [busy, setBusy] = useState(false);

  const deck = decks?.find((d) => d.id === activeDeckId);
  const cards = useMemo(() => deck?.cards || [], [deck]);
  const defaults = useMemo(() => ({ aether: mostCommon(cards, 'aetherType'), idol: mostCommon(cards, 'idolType') }), [cards]);
  const aether = picks[deck?.id]?.aether ?? defaults.aether ?? AETHER_TYPES[0];
  const idol = picks[deck?.id]?.idol ?? defaults.idol ?? IDOL_TYPES[0];
  const setPick = (k, v) => setPicks((p) => ({ ...p, [deck.id]: { aether, idol, [k]: v } }));

  const playable = cards.filter((c) => c.cardType === 'Soul' || (c.aetherType === aether && c.idolType === idol));
  const unplayable = cards.filter((c) => !playable.includes(c));

  const ready = async () => {
    setBusy(true);
    try {
      await onReady(cards, aether, idol);
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
        ) : (
          <>
            <div className="field setup-deck">
              <label htmlFor="setup-deck">Deck</label>
              <select id="setup-deck" className="ui-select" value={activeDeckId} onChange={(e) => setActiveDeck(uid, e.target.value)}>
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>{d.name} ({d.cards.length} cards){d.isDefault ? ' — example' : ''}</option>
                ))}
              </select>
            </div>

            {cards.length === 0 ? (
              <>
                <p className="setup-hint">This deck has no cards yet.</p>
                <Link to="/deck" className="ui-btn primary">Go to Deck Manager</Link>
              </>
            ) : (
              <>
                <p className="setup-hint">
                  Place your <strong>Aether</strong> and <strong>Idol</strong> tokens. They show your opponent what kind of deck you
                  play, and you can only play cards that match both.
                </p>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="setup-aether">Aether Token</label>
                    <select id="setup-aether" className="ui-select" value={aether} onChange={(e) => setPick('aether', e.target.value)}>
                      {AETHER_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="setup-idol">Idol Token</label>
                    <select id="setup-idol" className="ui-select" value={idol} onChange={(e) => setPick('idol', e.target.value)}>
                      {IDOL_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <p className={`ui-msg ${unplayable.length ? 'error' : 'info'} setup-summary`}>
                  {playable.length} of {cards.length} cards are playable with {aether}/{idol}.
                  {unplayable.length > 0 && ` Not playable: ${unplayable.map((c) => `${c.title} (${c.aetherType}/${c.idolType})`).join(', ')}.`}
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
