import { useState } from 'react';
import Card from '../Card.jsx';
import CardPreview, { hoverRect } from '../CardPreview.jsx';
import { isSoulCard } from '../../game/engine.js';

const PILE_LAYERS = 3; // how many offset cards to draw in the SOUL pile

// SOUL cards are spent automatically, so they sit in one compact pile at the left of the hand.
function SoulPile({ cards, onHover, onLeave }) {
  if (cards.length === 0) return null;
  const layers = cards.slice(0, PILE_LAYERS);
  return (
    <div
      className="soul-pile"
      onMouseEnter={(e) => onHover(cards[0], hoverRect(e))}
      onMouseLeave={onLeave}
      role="img"
      aria-label={`${cards.length} SOUL card${cards.length === 1 ? '' : 's'} in hand`}
      title="SOUL cards are spent automatically to pay for other cards"
    >
      {layers.map((c, i) => (
        <div key={c.iid} className="soul-pile-card" style={{ '--i': layers.length - 1 - i }}>
          <Card card={c} />
        </div>
      ))}
      <span className="soul-pile-count">×{cards.length}</span>
    </div>
  );
}

export default function Hand({ cards, selected, onSelect, isPlayable }) {
  const [hover, setHover] = useState(null); // { card, rect, placement }
  const hide = () => setHover(null);
  const soul = cards.filter(isSoulCard);
  const playable = cards.filter((c) => !isSoulCard(c));
  // Keep the preview pointing at the live card object (e.g. if the hand updates while hovering)
  const hoveredCard = hover && (cards.find((c) => c.iid === hover.card.iid) || null);

  return (
    <>
      <div className="hand" aria-label="Your hand" onScroll={hide}>
        <SoulPile
          cards={soul}
          onHover={(card, rect) => setHover({ card, rect, placement: 'above' })}
          onLeave={hide}
        />
        {cards.length === 0 && <p className="hand-empty">Your hand is empty</p>}
        {playable.map((c) => {
          const show = (e) => setHover({ card: c, rect: hoverRect(e), placement: 'above' });
          return (
            <button
              key={c.iid}
              className={`hand-card ${selected === c.iid ? 'selected' : ''} ${isPlayable(c) ? 'playable' : ''}`}
              onClick={() => onSelect(selected === c.iid ? null : c.iid)}
              onMouseEnter={show}
              onMouseLeave={hide}
              onFocus={show}
              onBlur={hide}
              aria-pressed={selected === c.iid}
              aria-label={c.title}
            >
              <Card card={c} />
            </button>
          );
        })}
      </div>
      {hoveredCard && <CardPreview card={hoveredCard} rect={hover.rect} placement={hover.placement} />}
    </>
  );
}
