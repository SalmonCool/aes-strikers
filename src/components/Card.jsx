import { useEffect, useState } from 'react';
import { artKey, cropStyle, loadArt } from '../firebase/cardArt.js';
import './Card.css';

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

// Renders a card using the standard layout. Scales to whatever width its container gives it.
// `artUrl` (e.g. a local preview) takes priority over the saved `art` reference.
export default function Card({ card, children }) {
  const { title, cardType, typeAction, description, soulCost, health, damage, aetherType, idolType } = card;
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
    <article className="game-card" aria-label={title || 'Card'}>
      <div className="gc-frame">
        <span className="gc-orb gc-soul-top" title="SOUL cost">{soulCost}</span>

        <h3 className="gc-title"><span>{title || 'Untitled'}</span></h3>

        <span className="gc-orb gc-affinity" title="Aether / Idol type">
          <span className="gc-aether">{aetherType}</span>
          <span className="gc-idol">{idolType}</span>
        </span>

        <div className="gc-art">
          <div className="gc-art-window">
            {artUrl && <img src={artUrl} alt="" draggable="false" style={cropStyle(card.artCrop)} />}
          </div>
          <span className="gc-orb gc-health" title="Health">{health}{card.healthPlus && <sup>+</sup>}</span>
          <span className="gc-orb gc-damage" title="Damage">{damage}{card.damagePlus && <sup>+</sup>}</span>
        </div>

        <div className="gc-type">
          {cardType}{typeAction ? `: ${typeAction}` : ''}
        </div>

        <div className="gc-desc">
          <p>{description}</p>
          <span className="gc-orb gc-soul-bottom" title="SOUL cost">{soulCost}</span>
        </div>
      </div>
      {children}
    </article>
  );
}
