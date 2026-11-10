import Card from './Card.jsx';
import { ZONES } from '../game/zones.js';

// One player's half of the board.
// cards: { zoneId: card }  highlight: Set of zoneIds that are clickable right now
export default function PlayerMat({ side, playerName, cards = {}, deckCount = 0, discard = [], highlight, highlightKind, onZoneClick }) {
  return (
    <section className={`player-mat ${side}`} aria-label={`${playerName}'s side`}>
      <div className="mat-watermark" aria-hidden="true">Strike!</div>
      <div className="mat-player">{playerName}</div>
      {ZONES.map((z) => {
        const card = cards[z.id];
        const lit = highlight?.has(z.id);
        let content;
        if (z.id === 'deck') {
          content = deckCount > 0
            ? <div className="card-back"><span>{deckCount}</span></div>
            : <span className="zone-label">{z.label}</span>;
        } else if (z.id === 'discard') {
          const top = discard[discard.length - 1];
          content = top
            ? <><div className="zone-card"><Card card={top} /></div><span className="zone-count">{discard.length}</span></>
            : <span className="zone-label">{z.label}</span>;
        } else {
          content = card
            ? <div className="zone-card"><Card card={card} /></div>
            : <span className="zone-label">{z.label}</span>;
        }
        return (
          <div
            key={z.id}
            className={`zone ${card ? 'filled' : ''} ${lit ? `lit ${highlightKind || ''}` : ''}`}
            data-zone={z.id}
            style={{ gridColumn: z.span ? `${z.col} / span ${z.span}` : z.col, gridRow: z.row }}
            onClick={lit ? () => onZoneClick(z.id) : undefined}
            role={lit ? 'button' : undefined}
            tabIndex={lit ? 0 : undefined}
            onKeyDown={lit ? (e) => (e.key === 'Enter' || e.key === ' ') && onZoneClick(z.id) : undefined}
            aria-label={lit ? `${z.label}${card ? `: ${card.title}` : ''}` : undefined}
          >
            {content}
          </div>
        );
      })}
    </section>
  );
}
