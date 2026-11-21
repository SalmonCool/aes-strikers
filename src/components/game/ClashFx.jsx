import { useEffect, useRef, useState } from 'react';
import Card from '../Card.jsx';

// Purely visual: plays when an attack resolves (game.clash changes). Nothing here affects the rules.
//   - countered: a spark burst between the two Strike! areas and a "COUNTER!" pop
//   - fully blocked: the attack card shatters into shards in the attacker's Strike! area, "BLOCKED!"
//   - hit: a red impact flash on whatever was hit (the player's nameplate or the targeted card)

const DURATION_MS = 1400;
const CX = 48; // shatter origin (% of the card), slightly off-centre so shards look natural
const CY = 44;
// Points around the card edge; each shard is a triangle from the origin to two neighbouring points
const RIM = [[0, 0], [35, 0], [70, 0], [100, 0], [100, 35], [100, 70], [100, 100], [65, 100], [30, 100], [0, 100], [0, 65], [0, 30]];
const SHARDS = RIM.map((p, i) => {
  const q = RIM[(i + 1) % RIM.length];
  const mx = (CX + p[0] + q[0]) / 3; // shard centroid
  const my = (CY + p[1] + q[1]) / 3;
  const len = Math.hypot(mx - CX, my - CY) || 1;
  return {
    clip: `polygon(${CX}% ${CY}%, ${p[0]}% ${p[1]}%, ${q[0]}% ${q[1]}%)`,
    dx: ((mx - CX) / len) * (60 + (i % 3) * 30),
    dy: ((my - CY) / len) * (60 + (i % 3) * 30) + 40, // shards fall a little
    rot: (i % 2 ? 1 : -1) * (25 + (i % 4) * 20),
  };
});

const rectOf = (selector) => document.querySelector(selector)?.getBoundingClientRect() || null;
const mid = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

export default function ClashFx({ clash }) {
  const [fx, setFx] = useState(null);
  const seen = useRef(null);

  useEffect(() => {
    // Ignore the clash already on the board when the page loads
    if (seen.current === null) {
      seen.current = clash?.id || '';
      return;
    }
    if (!clash?.id || clash.id === seen.current) return;
    seen.current = clash.id;

    const raf = requestAnimationFrame(() => {
      const atkZone = rectOf(`[data-owner="${clash.by}"] [data-zone="strike"]`);
      const defZone = rectOf(`[data-owner="${clash.defender}"] [data-zone="strike"]`);
      const target = clash.target?.kind === 'card'
        ? rectOf(`[data-owner="${clash.defender}"] [data-zone="${clash.target.zone}"]`)
        : rectOf(`[data-player-plate="${clash.defender}"]`);
      setFx({
        key: clash.id,
        countered: Boolean(clash.counterCard),
        blocked: clash.outcome === 'blocked',
        card: clash.attackCard,
        // The opponent's half of the board is shown rotated, so their cards appear upside down
        flipped: Boolean(document.querySelector(`.player-mat.opponent[data-owner="${clash.by}"]`)),
        atkZone,
        defZone,
        target,
        reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [clash]);

  useEffect(() => {
    if (!fx) return;
    const t = setTimeout(() => setFx((f) => (f?.key === fx.key ? null : f)), DURATION_MS);
    return () => clearTimeout(t);
  }, [fx]);

  if (!fx) return null;
  const spark = fx.countered && fx.atkZone && fx.defZone
    ? { x: (mid(fx.atkZone).x + mid(fx.defZone).x) / 2, y: (mid(fx.atkZone).y + mid(fx.defZone).y) / 2 }
    : null;
  const cardW = fx.atkZone ? Math.min(fx.atkZone.height * (467 / 657), fx.atkZone.width) * 0.96 : 0;

  return (
    <div className={`clash-fx ${fx.reduced ? 'reduced' : ''}`} aria-hidden="true">
      {spark && (
        <div className="cfx-spark" style={{ left: spark.x, top: spark.y }}>
          <span className="cfx-spark-ring" />
          <span className="cfx-spark-flash" />
          {Array.from({ length: 10 }, (_, i) => <span key={i} className="cfx-ray" style={{ '--a': `${i * 36}deg` }} />)}
          <span className="cfx-word counter">COUNTER!</span>
        </div>
      )}

      {fx.blocked && fx.atkZone && fx.card && (
        <div className="cfx-shatter" style={{ left: mid(fx.atkZone).x, top: mid(fx.atkZone).y, width: cardW }}>
          <div className="cfx-shards" style={fx.flipped ? { transform: 'rotate(180deg)' } : undefined}>
          {SHARDS.map((s, i) => (
            <div
              key={i}
              className="cfx-shard"
              style={{ clipPath: s.clip, '--dx': `${s.dx}px`, '--dy': `${s.dy}px`, '--rot': `${s.rot}deg`, '--delay': `${spark ? 220 : 0}ms` }}
            >
              <Card card={fx.card} />
            </div>
          ))}
          </div>
          <span className="cfx-word blocked">BLOCKED!</span>
        </div>
      )}

      {!fx.blocked && fx.target && (
        <div
          className="cfx-impact"
          style={{ left: fx.target.left, top: fx.target.top, width: fx.target.width, height: fx.target.height, '--delay': `${spark ? 200 : 0}ms` }}
        />
      )}
    </div>
  );
}
