import { useState } from 'react';
import Card from '../Card.jsx';
import CardPreview, { hoverRect } from '../CardPreview.jsx';

export default function Hand({ cards, selected, onSelect, isPlayable }) {
  const [hover, setHover] = useState(null); // { iid, rect }
  const show = (iid) => (e) => setHover({ iid, rect: hoverRect(e) });
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
      {hovered && <CardPreview card={hovered} rect={hover.rect} placement="above" />}
    </>
  );
}
