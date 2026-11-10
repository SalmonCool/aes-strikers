import Card from '../Card.jsx';

export default function Hand({ cards, selected, onSelect, isPlayable }) {
  return (
    <div className="hand" aria-label="Your hand">
      {cards.length === 0 && <p className="hand-empty">Your hand is empty</p>}
      {cards.map((c) => (
        <button
          key={c.iid}
          className={`hand-card ${selected === c.iid ? 'selected' : ''} ${isPlayable(c) ? 'playable' : ''}`}
          onClick={() => onSelect(selected === c.iid ? null : c.iid)}
          aria-pressed={selected === c.iid}
          aria-label={c.title}
        >
          <Card card={c} />
        </button>
      ))}
    </div>
  );
}
