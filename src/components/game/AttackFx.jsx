import { useEffect, useRef, useState } from 'react';
import Card from '../Card.jsx';

const FLIGHT_MS = 650;
const FIREBALL_MS = 700;
const BURST_MS = 900;
const EMBERS = 14;

const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const rectOf = (selector) => document.querySelector(selector)?.getBoundingClientRect() || null;

// Plays on both screens whenever an attack is declared:
//  - attacking a card: a copy of the attack card flies from the attacker's Strike! area into the target, then bursts in blue flame
//  - attacking the player directly: a blue fireball launches from the Strike! area at the defender's nameplate
export default function AttackFx({ attack }) {
  const [fx, setFx] = useState(null); // { key, kind, card, from, to, stage: 'fly' | 'burst' }
  const seen = useRef(null);
  const flyRef = useRef(null);

  // Detect a newly declared attack (ignore one already in progress when the page loads)
  useEffect(() => {
    if (seen.current === null) {
      seen.current = attack?.id || '';
      return;
    }
    if (!attack || attack.id === seen.current) return;
    seen.current = attack.id;

    // Wait a frame so the board has rendered the attack card in the Strike! area, then measure
    const raf = requestAnimationFrame(() => {
      const from = rectOf(`[data-owner="${attack.by}"] [data-zone="strike"]`);
      const to = attack.target.kind === 'player'
        ? rectOf(`[data-player-plate="${attack.defender}"]`)
        : rectOf(`[data-owner="${attack.defender}"] [data-zone="${attack.target.zone}"]`);
      if (!from || !to) return;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      setFx({
        key: attack.id,
        kind: attack.target.kind === 'player' ? 'fireball' : 'card',
        card: attack.card,
        from,
        to,
        stage: reduced ? 'burst' : 'fly',
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [attack]);

  // Run the flight, then switch to the burst
  useEffect(() => {
    if (fx?.stage !== 'fly' || !flyRef.current) return;
    const a = center(fx.from);
    const b = center(fx.to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let anim;
    if (fx.kind === 'card') {
      const cardW = Math.min(fx.from.height * (467 / 657), fx.from.width);
      const scale = Math.max(0.4, Math.min(fx.to.height / fx.from.height, 1.4));
      anim = flyRef.current.animate([
        { transform: 'translate(-50%, -50%) scale(1) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - 40}px)) scale(${(1 + scale) / 2 + 0.15}) rotate(-8deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${scale}) rotate(6deg)`, opacity: 0.9 },
      ], { duration: FLIGHT_MS, easing: 'cubic-bezier(0.5, 0, 0.75, 0.4)', fill: 'forwards' });
      flyRef.current.style.width = `${cardW}px`;
    } else {
      // Arc upward relative to travel direction for a lobbed fireball
      const lift = Math.min(160, Math.hypot(dx, dy) * 0.25);
      anim = flyRef.current.animate([
        { transform: 'translate(-50%, -50%) scale(0.6)' },
        { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - lift}px)) scale(1.1)`, offset: 0.5 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.3)` },
      ], { duration: FIREBALL_MS, easing: 'cubic-bezier(0.45, 0, 0.55, 1)', fill: 'forwards' });
    }
    anim.onfinish = () => setFx((f) => (f && f.key === fx.key ? { ...f, stage: 'burst' } : f));
    return () => anim.cancel();
  }, [fx]);

  // Clear after the burst
  useEffect(() => {
    if (fx?.stage !== 'burst') return;
    const t = setTimeout(() => setFx((f) => (f?.key === fx.key ? null : f)), BURST_MS);
    return () => clearTimeout(t);
  }, [fx]);

  if (!fx) return null;
  const a = center(fx.from);
  const b = center(fx.to);
  const burstSize = fx.kind === 'card' ? Math.max(fx.to.width, fx.to.height) * 1.4 : Math.max(140, fx.to.height * 1.6);

  return (
    <div className="attack-fx" aria-hidden="true">
      {fx.stage === 'fly' && (
        fx.kind === 'card' ? (
          <div ref={flyRef} className="fx-flying-card" style={{ left: a.x, top: a.y }}>
            <Card card={fx.card} />
          </div>
        ) : (
          <div ref={flyRef} className="fx-fireball" style={{ left: a.x, top: a.y }}>
            <span className="fx-fireball-core" />
          </div>
        )
      )}
      {fx.stage === 'burst' && (
        <div className={`fx-burst ${fx.kind}`} style={{ left: b.x, top: b.y, width: burstSize, height: burstSize }}>
          <span className="fx-burst-ring" />
          <span className="fx-burst-core" />
          {Array.from({ length: EMBERS }, (_, i) => (
            <span key={i} className="fx-ember" style={{ '--a': `${(360 / EMBERS) * i + (i % 2) * 12}deg`, '--d': `${0.35 + (i % 3) * 0.12}` }} />
          ))}
        </div>
      )}
    </div>
  );
}
