import { createContext, useContext, useState } from 'react';
import Card from './Card.jsx';
import CardPreview, { hoverRect } from './CardPreview.jsx';
import { MAX_INCANTATIONS, ZONES } from '../game/zones.js';

// Lets every card slot on the mat report hover without threading props through each zone.
const HoverContext = createContext(null);

const CardSlot = ({ card, className = '' }) => {
  const setHover = useContext(HoverContext);
  return (
    <div
      className={`zone-card ${className}`}
      onMouseEnter={(e) => setHover({ card, rect: hoverRect(e) })}
      onMouseLeave={() => setHover(null)}
    >
      <Card card={card} />
    </div>
  );
};

// One player's half of the board.
//   board:        { zoneId: card | { faceDown } , incantation: card[] }
//   latentCards:  (own side only) the real cards behind face-down Latent slots
//   tokens:       { aether, idol }
//   clashCard:    card shown in the Strike! area (the attack or counter just played)
//   highlight:    Map zoneId -> 'place' | 'target' | 'reveal' | 'use' | 'selected'
export default function PlayerMat({
  side, owner, playerName, board = {}, latentCards = {}, tokens = {}, deckCount = 0, discard = [], exhausted = [],
  stunZone, clashCard, turnNo, highlight, onZoneClick,
}) {
  const [hover, setHover] = useState(null); // { card, rect }

  return (
    <HoverContext.Provider value={setHover}>
    {hover && <CardPreview card={hover.card} rect={hover.rect} />}
    <section className={`player-mat ${side}`} data-owner={owner} aria-label={`${playerName}'s side`} onMouseLeave={() => setHover(null)}>
      <div className="mat-watermark" aria-hidden="true">Strike!</div>
      <div className="mat-player">{playerName}</div>
      {ZONES.map((z) => {
        const item = board[z.id];
        const lit = highlight?.get(z.id);
        const label = <span className="zone-label">{z.label}</span>;
        let content = label;
        let filled = false;

        if (z.id === 'aether' || z.id === 'idol') {
          const value = z.id === 'aether' ? tokens.aether : tokens.idol;
          if (value) {
            filled = true;
            content = (
              <div className={`token ${z.id}`}>
                <span className="token-value">{value}</span>
                <span className="token-kind">{z.label}</span>
              </div>
            );
          }
        } else if (z.id === 'deck') {
          if (deckCount > 0) content = <div className="card-back"><span>{deckCount}</span></div>;
        } else if (z.id === 'discard') {
          const top = discard[discard.length - 1];
          if (top) content = <><CardSlot card={top} /><span className="zone-count">{discard.length}</span></>;
        } else if (z.id === 'strike') {
          if (clashCard) {
            filled = true;
            content = <CardSlot card={clashCard} className="clash" />;
          }
        } else if (z.id === 'incantation') {
          const list = board.incantation || [];
          if (list.length) {
            filled = true;
            const awake = list.length === MAX_INCANTATIONS;
            content = (
              <>
                <div className="incantation-row">{list.map((c) => <CardSlot key={c.iid} card={c} className={awake ? '' : 'dormant'} />)}</div>
                <span className={`zone-count ${awake ? 'awake' : ''}`}>{awake ? 'Awakened' : `Dormant ${list.length}/${MAX_INCANTATIONS}`}</span>
              </>
            );
          }
        } else if (item?.faceDown) {
          filled = true;
          const hidden = latentCards[z.id];
          content = hidden
            ? <><CardSlot card={hidden} className="face-down-own" /><span className="zone-count">Face-down</span></>
            : <div className="card-back" />;
        } else if (z.id === 'body-armor' && !item && exhausted.some((c) => c.cardType === 'Body Armor')) {
          // Body Armor that left play stays visible here, exhausted, so both players know it's gone for good
          const spent = exhausted.filter((c) => c.cardType === 'Body Armor').at(-1);
          content = <><CardSlot card={spent} className="exhausted" /><span className="zone-count">Exhausted</span></>;
        } else if (item) {
          filled = true;
          content = (
            <>
              <CardSlot card={item} />
              {item.revealed && <span className="zone-count">{item.usedTurn === turnNo ? 'Used this turn' : 'Revealed'}</span>}
            </>
          );
        }

        return (
          <div
            key={z.id}
            className={`zone zone-${z.id} ${filled ? 'filled' : ''} ${lit ? `lit ${lit}` : ''}`}
            data-zone={z.id}
            style={{ gridColumn: z.span ? `${z.col} / span ${z.span}` : z.col, gridRow: z.row }}
            onClick={lit ? () => onZoneClick(z.id) : undefined}
            role={lit ? 'button' : undefined}
            tabIndex={lit ? 0 : undefined}
            onKeyDown={lit ? (e) => (e.key === 'Enter' || e.key === ' ') && onZoneClick(z.id) : undefined}
            aria-label={lit ? `${z.label}${item?.title ? `: ${item.title}` : ''}` : undefined}
          >
            {content}
            {stunZone === z.id && <span className="zone-stunned">Stunned</span>}
          </div>
        );
      })}
    </section>
    </HoverContext.Provider>
  );
}
