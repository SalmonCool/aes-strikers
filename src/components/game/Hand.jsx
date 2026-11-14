import { useState } from 'react';
import Card from '../Card.jsx';
import CardPreview, { hoverRect } from '../CardPreview.jsx';
import { isSoulCard } from '../../game/engine.js';

export default function Hand({ cards, selected, onSelect, isPlayable }) {
  const [hover, setHover] = useState(null); // { card, rect, placement }
  const hide = () => setHover(null);
  const playable = cards.filter((c) => !isSoulCard(c));
  // Keep the preview pointing at the live card object (e.g. if the hand updates while hovering)
  const hoveredCard = hover && (cards.find((c) => c.iid === hover.card.iid) || null);

  return (
    <>
      <div className="hand" aria-label="Your hand" onScroll={hide}>
        {playable.length === 0 &&<p className="hand-empty">Your hand is empty</p>}
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
