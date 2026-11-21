import { createContext, useContext, useState } from 'react';
import Card from './Card.jsx';
import CardPreview, { hoverRect } from './CardPreview.jsx';
import { ZONES } from '../game/zones.js';
import { resourceOf, tokenById } from '../game/tokens.js';

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
//   token:        the player's Hero/Villain token id
//   clashCard:    card shown in the Strike! area (the attack or counter just played)
//   highlight:    Map zoneId -> 'place' | 'target' | 'reveal' | 'use' | 'selected'
export default function PlayerMat({
  side, owner, playerName, board = {}, latentCards = {}, token = null, deckCount = 0, discard = [], exhausted = [],
  clashCard, turnNo, highlight, onZoneClick, viewablePiles = [], onPileClick,
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
        // Deck / discard piles that can be opened to look through (when not lit for something else)
        const viewable = !lit && onPileClick && viewablePiles.includes(z.id);
        const click = lit ? () => onZoneClick(z.id) : viewable ? () => onPileClick(z.id) : null;
        const label = <span className="zone-label">{z.label}</span>;
        let content = label;
        let filled = false;

        if (z.id === 'token') {
          const t = tokenById(token);
          if (t) {
            filled = true;
            content = (
              <div className={`token ${t.kind}`} title={`${t.kind === 'villain' ? 'Villain' : 'Hero'} token — earns ${resourceOf(t.id).label}`}>
                <span className="token-value">{t.name}</span>
                <span className="token-emotion">{t.emotion}</span>
                <span className="token-kind">{t.kind === 'villain' ? 'Villain' : 'Hero'}</span>
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
            // Each Incantation powers up one tier at the end of each of its owner's turns (3 tiers)
            const TIERS = 3;
            const tier = Math.min(TIERS, Math.max(0, ...list.map((c) => c.tier || 0)));
            content = (
              <>
                <div className="incantation-row">{list.map((c) => <CardSlot key={c.iid} card={c} className={c.tier ? '' : 'dormant'} />)}</div>
                <span className={`zone-count ${tier === TIERS ? 'awake' : ''}`} title={`${tier} of ${TIERS} turn effects active`}>
                  <span className="incant-tiers">
                    {tier === TIERS ? 'Fully active' : tier ? `Turn ${tier} active` : 'Charging'}
                    {Array.from({ length: TIERS }, (_, i) => <span key={i} className={`incant-pip ${i < tier ? 'on' : ''}`} />)}
                  </span>
                </span>
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
            className={`zone zone-${z.id} ${filled ? 'filled' : ''} ${lit ? `lit ${lit}` : ''} ${viewable ? 'viewable' : ''}`}
            data-zone={z.id}
            style={{ gridColumn: z.span ? `${z.col} / span ${z.span}` : z.col, gridRow: z.row }}
            onClick={click || undefined}
            role={click ? 'button' : undefined}
            tabIndex={click ? 0 : undefined}
            onKeyDown={click ? (e) => (e.key === 'Enter' || e.key === ' ') && click() : undefined}
            aria-label={viewable ? `View ${z.label.toLowerCase()}` : lit ? `${z.label}${item?.title ? `: ${item.title}` : ''}` : undefined}
            title={viewable ? `Click to view ${z.label.toLowerCase()}` : undefined}
          >
            {content}
          </div>
        );
      })}
    </section>
    </HoverContext.Provider>
  );
}
