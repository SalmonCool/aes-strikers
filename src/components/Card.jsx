import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { artKey, cropStyle, loadArt } from '../firebase/cardArt.js';
import './Card.css';
import { cardTokenId, resourceOf, tokenById } from '../game/tokens.js';

const SOUL_CARD_ART = '/cards/soul.jpg';

// Loads a card's art from Firestore chunks (cached). Returns '' until loaded / if none.
function useCardArt(art) {
  const [loaded, setLoaded] = useState({ key: null, url: '' });
  const key = art ? artKey(art) : null;

  useEffect(() => {
    if (!art) return;
    let cancelled = false;
    loadArt(art)
      .then((url) => !cancelled && setLoaded({ key, url }))
      .catch((e) => console.warn('Card art failed to load', e));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return loaded.key === key ? loaded.url : '';
}

// Description text that wraps around the bottom-right SOUL orb and shrinks until it fits the box.
// Sizes are in cqw (relative to card width), so a size that fits at one card size fits at every size.
const DESC_MAX = 3.6;
const DESC_MIN = 2.2;
const DESC_STEP = 0.1;

function FittedText({ text }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      if (!el.clientHeight) return; // not laid out (hidden) yet
      let size = DESC_MAX;
      el.style.fontSize = `${size}cqw`;
      while (el.scrollHeight > el.clientHeight + 1 && size > DESC_MIN) {
        size = Math.round((size - DESC_STEP) * 10) / 10;
        el.style.fontSize = `${size}cqw`;
      }
    };
    fit();
    // Re-fit when the card first becomes visible or changes size (e.g. fonts finish loading)
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, [text]);

  return (
    <div className="gc-desc-text" ref={ref}>
      {/* Two floats reserve the bottom-right corner for the SOUL orb so text flows around it */}
      <span className="gc-desc-push" aria-hidden="true" />
      <span className="gc-desc-orb-space" aria-hidden="true" />
      {text}
    </div>
  );
}

// Renders a card using the standard layout. Scales to whatever width its container gives it.
// `artUrl` (e.g. a local preview) takes priority over the saved `art` reference.
export default function Card({ card, children }) {
  const { title, cardType, typeAction, description, soulCost, health, damage } = card;
  const token = tokenById(cardTokenId(card));
  const res = resourceOf(token?.id);

  // Damage feedback: when health drops while this card is on screen, show a floating "−X" and shake the orb.
  // (State is adjusted during render — React's recommended pattern for reacting to a prop change.)
  const [prevHealth, setPrevHealth] = useState(health);
  const [hit, setHit] = useState(null); // { amount, n }
  if (health !== prevHealth) {
    if (health < prevHealth) setHit((h) => ({ amount: prevHealth - health, n: (h?.n || 0) + 1 }));
    setPrevHealth(health);
  }
  const maxHealth = card.baseHealth ?? health;
  const damaged = health < maxHealth;
  const savedArt = useCardArt(card.artUrl ? null : card.art);
  const artUrl = card.artUrl || savedArt;

  // SOUL resource cards have their own full-art design
  if (cardType === 'Soul') {
    return (
      <article className="game-card soul-card" aria-label={`${title || 'SOUL'} — SOUL resource card`}>
        <img className="soul-card-art" src={SOUL_CARD_ART} alt="" draggable="false" />
        {children}
      </article>
    );
  }

  return (
    <article className={`game-card res-${res.id}`} aria-label={title || 'Card'}>
      <div className="gc-frame">
        <span className="gc-orb gc-soul-top" title={`${res.label} cost`}>{soulCost}</span>

        <h3 className="gc-title"><span>{title || 'Untitled'}</span></h3>

        <span className={`gc-orb gc-affinity ${token?.kind || ''}`} title={token ? `${token.kind === 'villain' ? 'Villain' : 'Hero'}: ${token.name} · ${token.emotion}` : 'No token'}>
          <span className="gc-aether">{token?.name || '—'}</span>
          <span className="gc-idol">{token?.emotion || ''}</span>
        </span>

        <div className="gc-art">
          <div className="gc-art-window">
            {artUrl && <img src={artUrl} alt="" draggable="false" style={cropStyle(card.artCrop)} />}
          </div>
          <span
            key={hit ? `hit-${hit.n}` : 'health'}
            className={`gc-orb gc-health ${damaged ? 'damaged' : ''} ${hit ? 'hit' : ''}`}
            title={damaged ? `Health ${health} of ${maxHealth}` : 'Health'}
          >
            <span>{health}{card.healthPlus && <sup>+</sup>}</span>
            {damaged && <span className="gc-health-max">/{maxHealth}</span>}
          </span>
          {hit && <span key={`dmg-${hit.n}`} className="gc-damage-pop" aria-hidden="true">−{hit.amount}</span>}
          <span className="gc-orb gc-damage" title="Damage"><span>{damage}{card.damagePlus && <sup>+</sup>}</span></span>
        </div>

        <div className="gc-type">
          {cardType}{typeAction ? `: ${typeAction}` : ''}
        </div>

        <div className="gc-desc">
          <FittedText text={description} />
          <span className="gc-orb gc-soul-bottom" title={`${res.label} cost`}>{soulCost}</span>
        </div>
      </div>
      {children}
    </article>
  );
}
