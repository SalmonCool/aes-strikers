import { useState } from 'react';
import Card from '../Card.jsx';

const PREVIEW_GAP = 16; // px between the hand card and the enlarged preview
const EDGE = 12; // px kept clear of the viewport edges

// Enlarged copy of a hand card, floating above it. Fixed-positioned so the hand's scroll area can't clip it.
function CardPreview({ card, rect }) {
  const maxH = Math.max(200, rect.top - PREVIEW_GAP - EDGE); // fit in the space above the hand
  const width = Math.min(320, maxH * (467 / 657), window.innerWidth - EDGE * 2);
  const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, EDGE), window.innerWidth - width - EDGE);
  const bottom = Math.max(EDGE, window.innerHeight - rect.top + PREVIEW_GAP);

  return (
    <div className="hand-preview" style={{ width, left, bottom }} aria-hidden="true">
      <Card card={card} />
    </div>
  );
}

export default function Hand({ cards, selected, onSelect, isPlayable }) {
  const [hover, setHover] = useState(null); // { iid, rect }
  const show = (iid) => (e) => setHover({ iid, rect: e.currentTarget.getBoundingClientRect() });
  const hide = () => setHover(null);
  const hovered = hover && cards.find((c) => c.iid === hover.iid);

  return (
    <>
      <div className="hand" aria-label="Your hand" onScroll={hide}>
        {cards.length === 0 && <p className="hand-empty">Your hand is empty</p>}
        {cards.map((c) => (
          <button
            key={c.iid}
            className={`hand-card ${selected === c.iid ? 'selected' : ''} ${isPlayable(c) ? 'playable' : ''}`}
            onClick={() => onSelect(selected === c.iid ? null : c.iid)}
            onMouseEnter={show(c.iid)}
            onMouseLeave={hide}
            onFocus={show(c.iid)}
            onBlur={hide}
            aria-pressed={selected === c.iid}
            aria-label={c.title}
          >
            <Card card={c} />
          </button>
        ))}
      </div>
      {hovered && <CardPreview card={hovered} rect={hover.rect} />}
    </>
  );
}
