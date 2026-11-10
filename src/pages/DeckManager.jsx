import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { CARD_TYPES, copyDeck, createDeck, deleteCard, deleteDeck, renameDeck, setActiveDeck } from '../firebase/db.js';
import useDecks from '../hooks/useDecks.js';
import Card from '../components/Card.jsx';
import CardEditorModal from '../components/deck/CardEditorModal.jsx';
import ImportCardsModal from '../components/deck/ImportCardsModal.jsx';
import FormatGuideModal from '../components/deck/FormatGuideModal.jsx';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------- Decks tab ----------
function DecksTab({ uid, decks, activeDeckId, onOpen, onError }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(null); // { id, name }

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const id = await createDeck(uid, name);
      setName('');
      onOpen(id);
    } catch (err) {
      console.error(err);
      onError('Could not create the deck.');
    } finally {
      setBusy(false);
    }
  };

  const saveRename = async (e) => {
    e.preventDefault();
    if (!renaming.name.trim()) return;
    try {
      await renameDeck(uid, renaming.id, renaming.name);
      setRenaming(null);
    } catch (err) {
      console.error(err);
      onError('Could not rename the deck.');
    }
  };

  const remove = async (deck) => {
    if (!confirm(`Delete "${deck.name}" and its ${plural(deck.cards.length, 'card')}? This cannot be undone.`)) return;
    try {
      await deleteDeck(uid, deck.id, deck.cards);
    } catch (err) {
      console.error(err);
      onError('Could not delete the deck.');
    }
  };

  const copy = async (deck) => {
    try {
      const id = await copyDeck(uid, `${deck.name} (Copy)`, deck.cards);
      onOpen(id);
    } catch (err) {
      console.error(err);
      onError('Could not copy the deck.');
    }
  };

  const examples = decks.filter((d) => d.isDefault);
  const mine = decks.filter((d) => !d.isDefault);

  const tile = (deck) => {
    const active = deck.id === activeDeckId;
    const isRenaming = renaming?.id === deck.id;
    return (
      <article key={deck.id} className={`deck-tile ${active ? 'active' : ''}`}>
        <div className="deck-tile-head">
          {isRenaming ? (
            <form className="deck-rename" onSubmit={saveRename}>
              <input
                className="ui-input"
                value={renaming.name}
                onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                maxLength={40}
                autoFocus
                aria-label="Deck name"
              />
              <button className="ui-btn primary small">Save</button>
              <button type="button" className="ui-btn small" onClick={() => setRenaming(null)}>Cancel</button>
            </form>
          ) : (
            <h3>{deck.name}</h3>
          )}
          <div className="deck-badges">
            {deck.isDefault && <span className="badge lock">Example · Read-only</span>}
            {active && <span className="badge active">Active for play</span>}
          </div>
        </div>
        <p className="deck-count">{plural(deck.cards.length, 'card')}</p>
        <div className="deck-tile-actions">
          <button className="ui-btn primary small" onClick={() => onOpen(deck.id)}>{deck.isDefault ? 'View Cards' : 'Manage Cards'}</button>
          {!active && <button className="ui-btn small" onClick={() => setActiveDeck(uid, deck.id).catch(() => onError('Could not select the deck.'))}>Use for Play</button>}
          {deck.isDefault ? (
            <button className="ui-btn small" onClick={() => copy(deck)}>Copy to My Decks</button>
          ) : (
            !isRenaming && (
              <>
                <button className="ui-btn small" onClick={() => setRenaming({ id: deck.id, name: deck.name })}>Rename</button>
                <button className="ui-btn danger small" onClick={() => remove(deck)}>Delete</button>
              </>
            )
          )}
        </div>
      </article>
    );
  };

  return (
    <>
      <section className="panel">
        <h2>Create a Deck</h2>
        <form className="deck-create" onSubmit={create}>
          <input className="ui-input" placeholder="Deck name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
          <button className="ui-btn primary" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create Deck'}</button>
        </form>
      </section>

      <section className="panel">
        <h2>My Decks</h2>
        {mine.length === 0 ? <p className="empty">No decks yet. Create one above, or copy an example deck.</p> : <div className="deck-grid">{mine.map(tile)}</div>}
      </section>

      <section className="panel">
        <h2>Example Decks</h2>
        <div className="deck-grid">{examples.map(tile)}</div>
      </section>
    </>
  );
}

// ---------- Cards tab ----------
function CardsTab({ uid, deck, decks, activeDeckId, onSelectDeck }) {
  const [filter, setFilter] = useState('All');
  const [editing, setEditing] = useState(null); // null | 'new' | card
  const [importing, setImporting] = useState(false);
  const [guide, setGuide] = useState(false);
  const editable = !deck.isDefault;
  const shown = deck.cards.filter((c) => filter === 'All' || c.cardType === filter);

  return (
    <section className="panel">
      <div className="cards-head">
        <div className="field cards-deck-pick">
          <label htmlFor="deck-pick">Deck</label>
          <select id="deck-pick" className="ui-select" value={deck.id} onChange={(e) => onSelectDeck(e.target.value)}>
            {decks.map((d) => <option key={d.id} value={d.id}>{d.name}{d.isDefault ? ' (example)' : ''}</option>)}
          </select>
        </div>
        <div className="deck-badges">
          <span className="badge">{plural(deck.cards.length, 'card')}</span>
          {deck.isDefault && <span className="badge lock">Read-only</span>}
          {deck.id === activeDeckId
            ? <span className="badge active">Active for play</span>
            : <button className="ui-btn small" onClick={() => setActiveDeck(uid, deck.id)}>Use for Play</button>}
        </div>
      </div>

      {deck.isDefault && (
        <p className="ui-msg info readonly-note">
          This is a built-in example deck and can’t be edited. Use “Copy to My Decks” on the Decks tab to make an editable version.
        </p>
      )}

      <div className="deck-toolbar">
        {editable && (
          <>
            <button className="ui-btn primary" onClick={() => setEditing('new')}>+ Add Card</button>
            <button className="ui-btn" onClick={() => setImporting(true)}>Import JSON</button>
          </>
        )}
        <button className="ui-btn" onClick={() => setGuide(true)}>Format Guide</button>
        <select className="ui-select" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by card type">
          <option>All</option>
          {CARD_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </div>

      {shown.length === 0 && (
        <p className="empty">{deck.cards.length === 0 ? 'This deck has no cards yet. Add or import some to begin.' : 'No cards of this type.'}</p>
      )}

      <div className="card-grid">
        {shown.map((c) => (
          <Card key={c.id} card={c}>
            {editable && (
              <div className="card-actions">
                <button className="ui-btn primary small" onClick={() => setEditing(c)}>Edit</button>
                <button
                  className="ui-btn danger small"
                  onClick={() => confirm(`Remove "${c.title}" from this deck?`) && deleteCard(uid, c)}
                >
                  Remove
                </button>
              </div>
            )}
          </Card>
        ))}
      </div>

      {editing && editable && (
        <CardEditorModal
          key={editing === 'new' ? 'new' : editing.id}
          uid={uid}
          deckId={deck.id}
          existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && editable && !guide && (
        <ImportCardsModal uid={uid} deckId={deck.id} deckName={deck.name} onClose={() => setImporting(false)} onOpenGuide={() => setGuide(true)} />
      )}
      {guide && <FormatGuideModal onClose={() => setGuide(false)} />}
    </section>
  );
}

// ---------- Page ----------
export default function DeckManager() {
  const { user } = useAuth();
  const { decks, activeDeckId, loading } = useDecks(user.uid);
  const [tab, setTab] = useState('decks');
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState('');

  const selected = decks?.find((d) => d.id === selectedId) || decks?.find((d) => d.id === activeDeckId) || null;
  const active = decks?.find((d) => d.id === activeDeckId);

  const openDeck = (id) => {
    setSelectedId(id);
    setTab('cards');
  };

  return (
    <main className="page">
      <div className="page-inner">
        <header className="page-header">
          <div>
            <h1 className="page-title">Deck <span className="accent">Manager</span></h1>
            <p className="page-sub">{loading ? 'Loading…' : `Playing with: ${active?.name}`}</p>
          </div>
          <Link to="/" className="ui-btn small">Back to Lobby</Link>
        </header>

        <div className="tabs" role="tablist" aria-label="Deck manager">
          <button role="tab" aria-selected={tab === 'decks'} className={`tab ${tab === 'decks' ? 'active' : ''}`} onClick={() => setTab('decks')}>
            Decks
          </button>
          <button role="tab" aria-selected={tab === 'cards'} className={`tab ${tab === 'cards' ? 'active' : ''}`} onClick={() => setTab('cards')} disabled={!selected}>
            Cards{selected ? ` · ${selected.name}` : ''}
          </button>
        </div>

        {error && <p className="ui-msg error" style={{ marginBottom: 16 }} onClick={() => setError('')}>{error}</p>}

        {loading ? (
          <p className="empty">Loading decks…</p>
        ) : tab === 'decks' ? (
          <DecksTab uid={user.uid} decks={decks} activeDeckId={activeDeckId} onOpen={openDeck} onError={setError} />
        ) : (
          selected && <CardsTab key={selected.id} uid={user.uid} deck={selected} decks={decks} activeDeckId={activeDeckId} onSelectDeck={setSelectedId} />
        )}
      </div>
    </main>
  );
}
