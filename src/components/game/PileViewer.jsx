import { useEffect, useState } from 'react';
import Card from '../Card.jsx';
import CardPreview, { hoverRect } from '../CardPreview.jsx';

// Fixed order for showing a deck: never the real draw order, so viewing it reveals nothing about what's next.
const TYPE_ORDER = ['Attack', 'Defend', 'Ability', 'Weapon', 'Shield', 'Body Armor', 'Spatial', 'Incantation'];
const typeRank = (t) => {
  const i = TYPE_ORDER.indexOf(t);
  return i < 0 ? TYPE_ORDER.length : i;
};
const sortedDeck = (cards) =>
  [...cards].sort((a, b) =>
    typeRank(a.cardType) - typeRank(b.cardType)
    || (a.title || '').localeCompare(b.title || '')
    || String(a.id || '').localeCompare(String(b.id || '')));

// Groups cards by type, keeping the order they're given in.
const groupByType = (cards) => {
  const groups = new Map();
  cards.forEach((c) => {
    const k = c.cardType || 'Other';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  });
  return [...groups.entries()];
};

// Read-only list of a pile's cards.
//   kind 'deck': sorted into a fixed arrangement, grouped by type
//   kind 'discard': most recently discarded first
// onPick(card): pick mode (deck search) - clicking a card chooses it; pickNote explains the search.
export default function PileViewer({ kind, owner, cards = [], onClose, onPick, pickNote, onSkip }) {
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isDeck = kind === 'deck';
  const shown = isDeck ? sortedDeck(cards) : [...cards].reverse();
  const title = `${owner} ${isDeck ? 'Deck' : 'Discard Pile'}`;
  const note = onPick ? pickNote : isDeck
    ? 'Sorted by type and name. This is not the order you will draw in.'
    : 'Most recently discarded first.';

  const cardTile = (c, i) => (
    <div
      key={c.iid || `${c.id}-${i}`}
      className={`pile-card ${onPick ? 'pickable' : ''}`}
      role={onPick ? 'button' : undefined}
      tabIndex={onPick ? 0 : undefined}
      aria-label={onPick ? `Take ${c.title}` : undefined}
      onClick={onPick ? () => onPick(c) : undefined}
      onKeyDown={onPick ? (e) => (e.key === 'Enter' || e.key === ' ') && onPick(c) : undefined}
      onMouseEnter={(e) => setHover({ card: c, rect: hoverRect(e) })}
      onMouseLeave={() => setHover(null)}
    >
      <Card card={c} />
    </div>
  );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {hover && <CardPreview card={hover.card} rect={hover.rect} />}
      <div className="panel modal modal-wide pile-viewer" role="dialog" aria-modal="true" aria-labelledby="pile-title">
        <div className="pile-head">
          <h2 id="pile-title">{title} <span className="pile-count">{cards.length}</span></h2>
          <span className="pile-head-actions">
            {onSkip && <button className="ui-btn small" onClick={onSkip}>Skip search</button>}
            <button className="ui-btn small" onClick={onClose}>Close</button>
          </span>
        </div>
        <p className="pile-note">{note}</p>
        {cards.length === 0 ? (
          <p className="pile-empty">{isDeck ? 'Your deck is empty.' : 'No cards have been discarded yet.'}</p>
        ) : isDeck ? (
          groupByType(shown).map(([type, list]) => (
            <section key={type} className="pile-group">
              <h3>{type} <span className="pile-count">{list.length}</span></h3>
              <div className="pile-grid">{list.map(cardTile)}</div>
            </section>
          ))
        ) : (
          <div className="pile-grid">{shown.map(cardTile)}</div>
        )}
      </div>
    </div>
  );
}
