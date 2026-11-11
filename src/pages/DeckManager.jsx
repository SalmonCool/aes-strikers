import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import {
  CARD_TYPES, createDeck, deleteCard, deleteDeck, renameDeck, setActiveDeck, setDeckCardCount,
} from '../firebase/db.js';
import useDecks, { MY_CARDS_SET_ID } from '../hooks/useDecks.js';
import { CARD_SETS, SOUL_CARD, starterDeckCards } from '../data/cardSets.js';
import {
  COPY_LIMITS, BODY_ARMOR_PER_DECK, DECK_SIZE_LIMIT, TYPE_TOTAL_LIMITS, copyLimitFor, limitLabel, maxCopiesInDeck,
} from '../game/deckRules.js';
import Card from '../components/Card.jsx';
import CardEditorModal from '../components/deck/CardEditorModal.jsx';
import ImportCardsModal from '../components/deck/ImportCardsModal.jsx';
import FormatGuideModal from '../components/deck/FormatGuideModal.jsx';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const TYPE_ORDER = ['Soul', ...CARD_TYPES.filter((t) => t !== 'Soul')];

// ======================= Decks tab: list =======================
function DeckList({ uid, decks, activeDeckId, onEdit, onError }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(null); // { id, name }

  const create = async (deckName, cards) => {
    setBusy(true);
    try {
      const id = await createDeck(uid, deckName, cards);
      if (!activeDeckId) await setActiveDeck(uid, id);
      onEdit(id);
    } catch (err) {
      console.error(err);
      onError('Could not create the deck.');
    } finally {
      setBusy(false);
    }
  };

  const examples = decks.filter((d) => d.builtIn);
  const mine = decks.filter((d) => !d.builtIn);

  const submit = (e) => {
    e.preventDefault();
    if (name.trim()) create(name, {}).then(() => setName(''));
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
    if (!confirm(`Delete the deck "${deck.name}"? Your cards and card sets are not affected.`)) return;
    try {
      await deleteDeck(uid, deck.id);
    } catch (err) {
      console.error(err);
      onError('Could not delete the deck.');
    }
  };

  return (
    <>
      <section className="panel">
        <h2>Build a Deck</h2>
        <form className="deck-create" onSubmit={submit}>
          <input className="ui-input" placeholder="New deck name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
          <button className="ui-btn primary" disabled={busy || !name.trim()}>Create Empty Deck</button>
        </form>
        <div className="starter-row">
          <span className="starter-label">Or start from a set:</span>
          {CARD_SETS.map((s) => (
            <button key={s.id} className="ui-btn small" disabled={busy} onClick={() => create(`${s.name} Starter`, starterDeckCards(s))}>
              {s.name} Starter
            </button>
          ))}
        </div>
        <p className="field-help">Starter decks contain one copy of every card in the set plus 10 SOUL. Adjust copies in the builder.</p>
      </section>

      <section className="panel">
        <h2>My Decks</h2>
        {mine.length === 0 ? (
          <p className="empty">No decks of your own yet. Create one above, or copy an example deck below.</p>
        ) : (
          <div className="deck-grid">
            {mine.map((deck) => {
              const active = deck.id === activeDeckId;
              const isRenaming = renaming?.id === deck.id;
              return (
                <article key={deck.id} className={`deck-tile ${active ? 'active' : ''}`}>
                  <div className="deck-tile-head">
                    {isRenaming ? (
                      <form className="deck-rename" onSubmit={saveRename}>
                        <input className="ui-input" value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} maxLength={40} autoFocus aria-label="Deck name" />
                        <button className="ui-btn primary small">Save</button>
                        <button type="button" className="ui-btn small" onClick={() => setRenaming(null)}>Cancel</button>
                      </form>
                    ) : (
                      <h3>{deck.name}</h3>
                    )}
                    <div className="deck-badges">
                      {active && <span className="badge active">Active for play</span>}
                      {deck.check.valid ? <span className="badge ok">Legal</span> : <span className="badge bad">Needs fixes</span>}
                    </div>
                  </div>
                  <DeckStats deck={deck} />
                  <div className="deck-tile-actions">
                    <button className="ui-btn primary small" onClick={() => onEdit(deck.id)}>Edit Deck</button>
                    {!active && <button className="ui-btn small" onClick={() => setActiveDeck(uid, deck.id).catch(() => onError('Could not select the deck.'))}>Use for Play</button>}
                    {!isRenaming && <button className="ui-btn small" onClick={() => setRenaming({ id: deck.id, name: deck.name })}>Rename</button>}
                    <button className="ui-btn danger small" onClick={() => remove(deck)}>Delete</button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Example Decks</h2>
        <p className="field-help" style={{ marginBottom: 12 }}>Ready to play for testing. Read-only. Copy one to customize it.</p>
        <div className="deck-grid">
          {examples.map((deck) => {
            const active = deck.id === activeDeckId;
            return (
              <article key={deck.id} className={`deck-tile ${active ? 'active' : ''}`}>
                <div className="deck-tile-head">
                  <h3>{deck.name}</h3>
                  <div className="deck-badges">
                    <span className="badge lock">Example · Read-only</span>
                    {active && <span className="badge active">Active for play</span>}
                  </div>
                </div>
                <DeckStats deck={deck} />
                <div className="deck-tile-actions">
                  <button className="ui-btn primary small" onClick={() => onEdit(deck.id)}>View Deck</button>
                  {!active && <button className="ui-btn small" onClick={() => setActiveDeck(uid, deck.id).catch(() => onError('Could not select the deck.'))}>Use for Play</button>}
                  <button className="ui-btn small" disabled={busy} onClick={() => create(deck.name.replace(' (Example)', ''), deck.entries)}>Copy to My Decks</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}

function DeckStats({ deck }) {
  const { size, byType } = deck.check;
  return (
    <p className="deck-count">
      {size}/{DECK_SIZE_LIMIT} cards + {byType.Soul || 0} SOUL · Weapons {byType.Weapon || 0}/{TYPE_TOTAL_LIMITS.Weapon} · Shields {byType.Shield || 0}/{TYPE_TOTAL_LIMITS.Shield} · Body Armor {byType['Body Armor'] || 0}/{BODY_ARMOR_PER_DECK}
    </p>
  );
}

// ======================= Decks tab: builder =======================
function CountControl({ count, max, onChange, label, readOnly }) {
  const capped = max !== Infinity;
  if (readOnly) return <div className="count-control"><span className={`count-value ${count > 0 ? 'on' : ''}`}>×{count}</span></div>;
  return (
    <div className="count-control" role="group" aria-label={`${label} copies`}>
      <button className="fx-btn" onClick={() => onChange(count - 1)} disabled={count <= 0} aria-label={`Remove one ${label}`}>−</button>
      <span className={`count-value ${count > 0 ? 'on' : ''}`}>{count}{capped ? `/${max}` : ''}</span>
      <button className="fx-btn" onClick={() => onChange(count + 1)} disabled={count >= max} aria-label={`Add one ${label}`}>+</button>
    </div>
  );
}

function DeckBuilder({ uid, deck, sets, catalog, activeDeckId, onBack, onError }) {
  const [setFilter, setSetFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('All');
  const [search, setSearch] = useState('');
  const entries = deck.entries;
  const readOnly = Boolean(deck.builtIn);

  const setCount = (card, n) => {
    const max = maxCopiesInDeck(card, entries, catalog);
    const next = Math.max(0, Math.min(n, max));
    setDeckCardCount(uid, deck.id, card.id, next).catch((e) => {
      console.error(e);
      onError('Could not update the deck.');
    });
  };

  const pool = useMemo(() => {
    const fromSets = setFilter === 'all' ? sets.flatMap((s) => s.cards) : setFilter === 'soul' ? [] : sets.find((s) => s.id === setFilter)?.cards || [];
    const list = setFilter === 'all' || setFilter === 'soul' ? [SOUL_CARD, ...fromSets] : fromSets;
    const q = search.trim().toLowerCase();
    return list.filter((c) => (typeFilter === 'All' || c.cardType === typeFilter) && (!q || c.title.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q)));
  }, [sets, setFilter, typeFilter, search]);

  const inDeck = Object.entries(entries)
    .filter(([id, n]) => n > 0 && catalog[id])
    .map(([id, n]) => ({ card: catalog[id], n }))
    .sort((a, b) => TYPE_ORDER.indexOf(a.card.cardType) - TYPE_ORDER.indexOf(b.card.cardType) || a.card.title.localeCompare(b.card.title));
  const missing = Object.keys(entries).filter((id) => entries[id] > 0 && !catalog[id]).length;
  const byType = {};
  inDeck.forEach((e) => { (byType[e.card.cardType] ||= []).push(e); });

  return (
    <div className="builder">
      <section className="panel builder-head">
        <button className="ui-btn small" onClick={onBack}>← All Decks</button>
        <div className="builder-title">
          <h2>{deck.name}</h2>
          <DeckStats deck={deck} />
        </div>
        <div className="deck-badges">
          {deck.check.valid ? <span className="badge ok">Legal</span> : <span className="badge bad">Needs fixes</span>}
          {deck.id === activeDeckId
            ? <span className="badge active">Active for play</span>
            : <button className="ui-btn small" onClick={() => setActiveDeck(uid, deck.id)}>Use for Play</button>}
        </div>
      </section>

      {readOnly && (
        <p className="ui-msg info">This is a read-only example deck. Use “Copy to My Decks” on the deck list to make an editable version.</p>
      )}
      {deck.check.errors.length > 0 && (
        <p className="ui-msg error">{deck.check.errors.join(' ')}</p>
      )}

      <div className="builder-body">
        <section className="panel builder-pool">
          <div className="builder-filters">
            <div className="chip-row" role="tablist" aria-label="Card set">
              {[['all', 'All Sets'], ...sets.map((s) => [s.id, s.name]), ['soul', 'SOUL']].map(([id, label]) => (
                <button key={id} role="tab" aria-selected={setFilter === id} className={`chip ${setFilter === id ? 'active' : ''}`} onClick={() => setSetFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="builder-filter-row">
              <input className="ui-input" placeholder="Search cards…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search cards" />
              <select className="ui-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by card type">
                <option>All</option>
                {TYPE_ORDER.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {pool.length === 0 && (
            <p className="empty">{setFilter === MY_CARDS_SET_ID ? 'You have no custom cards yet. Create them on the Card Sets tab.' : 'No cards match.'}</p>
          )}
          <div className="pool-grid">
            {pool.map((c) => {
              const count = entries[c.id] || 0;
              const max = maxCopiesInDeck(c, entries, catalog);
              return (
                <div key={c.id} className={`pool-card ${count > 0 ? 'in-deck' : ''}`}>
                  <Card card={c} />
                  <CountControl count={count} max={Math.max(max, count)} label={c.title} onChange={(n) => setCount(c, n)} readOnly={readOnly} />
                  <span className="pool-limit">{limitLabel(c)}</span>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="panel builder-list">
          <h2>Deck List</h2>
          {inDeck.length === 0 && <p className="empty">Add cards from the left.</p>}
          {TYPE_ORDER.filter((t) => byType[t]).map((t) => {
            const total = byType[t].reduce((s, e) => s + e.n, 0);
            return (
              <div key={t} className="list-group">
                <h3>
                  {t} <span>{total}{TYPE_TOTAL_LIMITS[t] ? `/${TYPE_TOTAL_LIMITS[t]}` : ''}</span>
                </h3>
                <ul>
                  {byType[t].map(({ card, n }) => (
                    <li key={card.id} className={!TYPE_TOTAL_LIMITS[card.cardType] && n > copyLimitFor(card) ? 'over' : ''}>
                      <span className="list-name">{card.title}</span>
                      <CountControl count={n} max={Math.max(maxCopiesInDeck(card, entries, catalog), n)} label={card.title} onChange={(v) => setCount(card, v)} readOnly={readOnly} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {missing > 0 && <p className="field-help">{plural(missing, 'card')} in this deck no longer exist and are ignored.</p>}
          <p className="field-help limits-note">
            Max {DECK_SIZE_LIMIT} cards (SOUL not counted, unlimited). Copies per card: Attack {COPY_LIMITS.Attack} · Defend {COPY_LIMITS.Defend} · Ability {COPY_LIMITS.Ability} · Incantation {COPY_LIMITS.Incantation} · Spatial {COPY_LIMITS.Spatial}. Per deck: {TYPE_TOTAL_LIMITS.Weapon} Weapons · {TYPE_TOTAL_LIMITS.Shield} Shields · {BODY_ARMOR_PER_DECK} Body Armor.
          </p>
        </aside>
      </div>
    </div>
  );
}

// ======================= Card Sets tab =======================
function CardSetsTab({ uid, sets }) {
  const [setId, setSetId] = useState(sets[0].id);
  const [filter, setFilter] = useState('All');
  const [editing, setEditing] = useState(null); // null | 'new' | card
  const [importing, setImporting] = useState(false);
  const [guide, setGuide] = useState(false);
  const set = sets.find((s) => s.id === setId) || sets[0];
  const editable = !set.builtIn;
  const shown = set.cards.filter((c) => filter === 'All' || c.cardType === filter);

  return (
    <section className="panel">
      <div className="cards-head">
        <div className="chip-row" role="tablist" aria-label="Card set">
          {sets.map((s) => (
            <button key={s.id} role="tab" aria-selected={s.id === set.id} className={`chip ${s.id === set.id ? 'active' : ''}`} onClick={() => setSetId(s.id)}>
              {s.name} <span className="chip-count">{s.cards.length}</span>
            </button>
          ))}
        </div>
        <div className="deck-badges">
          {set.builtIn ? <span className="badge lock">Built-in · Read-only</span> : <span className="badge">Your custom cards</span>}
          {set.aetherType && <span className="badge">{set.aetherType}/{set.idolType}</span>}
        </div>
      </div>

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
        <p className="empty">{set.cards.length === 0 ? 'No custom cards yet. Add or import some, then put them in a deck.' : 'No cards of this type.'}</p>
      )}

      <div className="card-grid">
        {shown.map((c) => (
          <Card key={c.id} card={c}>
            {editable && (
              <div className="card-actions">
                <button className="ui-btn primary small" onClick={() => setEditing(c)}>Edit</button>
                <button className="ui-btn danger small" onClick={() => confirm(`Delete "${c.title}"? It will also be removed from any deck using it.`) && deleteCard(uid, c)}>
                  Delete
                </button>
              </div>
            )}
          </Card>
        ))}
      </div>

      {editing && editable && (
        <CardEditorModal key={editing === 'new' ? 'new' : editing.id} uid={uid} existing={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {importing && editable && !guide && <ImportCardsModal uid={uid} onClose={() => setImporting(false)} onOpenGuide={() => setGuide(true)} />}
      {guide && <FormatGuideModal onClose={() => setGuide(false)} />}
    </section>
  );
}

// ======================= Page =======================
export default function DeckManager() {
  const { user } = useAuth();
  const { sets, catalog, decks, activeDeckId, loading } = useDecks(user.uid);
  const [tab, setTab] = useState('decks');
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  const editingDeck = decks?.find((d) => d.id === editingId) || null;
  const active = decks?.find((d) => d.id === activeDeckId);

  return (
    <main className="page">
      <div className="page-inner wide">
        <header className="page-header">
          <div>
            <h1 className="page-title">Deck <span className="accent">Manager</span></h1>
            <p className="page-sub">{loading ? 'Loading…' : active ? `Playing with: ${active.name}` : 'No deck selected for play yet'}</p>
          </div>
          <Link to="/" className="ui-btn small">Back to Lobby</Link>
        </header>

        <div className="tabs" role="tablist" aria-label="Deck manager">
          <button role="tab" aria-selected={tab === 'decks'} className={`tab ${tab === 'decks' ? 'active' : ''}`} onClick={() => setTab('decks')}>Decks</button>
          <button role="tab" aria-selected={tab === 'sets'} className={`tab ${tab === 'sets' ? 'active' : ''}`} onClick={() => setTab('sets')}>Card Sets</button>
        </div>

        {error && <p className="ui-msg error" style={{ marginBottom: 16 }} onClick={() => setError('')}>{error}</p>}

        {loading ? (
          <p className="empty">Loading…</p>
        ) : tab === 'sets' ? (
          <CardSetsTab uid={user.uid} sets={sets} />
        ) : editingDeck ? (
          <DeckBuilder uid={user.uid} deck={editingDeck} sets={sets} catalog={catalog} activeDeckId={activeDeckId} onBack={() => setEditingId(null)} onError={setError} />
        ) : (
          <DeckList uid={user.uid} decks={decks} activeDeckId={activeDeckId} onEdit={setEditingId} onError={setError} />
        )}
      </div>
    </main>
  );
}
