import { useEffect, useRef, useState } from 'react';

const TUMBLE_MS = 900;
const SHOW_MS = 2600;

// Pip positions (3x3 grid cells, 1-9) for each die face
const PIPS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

function DieFace({ value }) {
  return (
    <div className="die-face">
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={`pip ${PIPS[value]?.includes(i + 1) ? 'on' : ''}`} />
      ))}
    </div>
  );
}

// Shows each automatic die roll (game.rolls) on both players' screens: the die tumbles, then lands
// on the result with what the roll did. Rolls that happened before this screen loaded aren't replayed.
export default function DiceRoll({ rolls = [], names }) {
  const seen = useRef(null);
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const [face, setFace] = useState(1);
  const [landed, setLanded] = useState(false);

  // Queue newly-arrived rolls
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(rolls.map((r) => r.id));
      return;
    }
    const fresh = rolls.filter((r) => !seen.current.has(r.id));
    if (!fresh.length) return;
    fresh.forEach((r) => seen.current.add(r.id));
    setQueue((q) => [...q, ...fresh]);
  }, [rolls]);

  // Play the queue one roll at a time (state adjusted during render when the slot frees up)
  if (!current && queue.length > 0) {
    setCurrent(queue[0]);
    setQueue(queue.slice(1));
    setLanded(false);
  }

  useEffect(() => {
    if (!current) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const spin = reduced ? null : setInterval(() => setFace(1 + Math.floor(Math.random() * 6)), 80);
    const land = setTimeout(() => {
      clearInterval(spin);
      setFace(current.value);
      setLanded(true);
    }, reduced ? 0 : TUMBLE_MS);
    const done = setTimeout(() => setCurrent(null), SHOW_MS);
    return () => {
      clearInterval(spin);
      clearTimeout(land);
      clearTimeout(done);
    };
  }, [current]);

  if (!current) return null;
  const even = current.value % 2 === 0;
  return (
    <div className="dice-roll" role="status" aria-live="polite">
      <div className="dice-card">
        <span className="dice-reason">{names[current.by] || 'Player'} rolls for {current.reason}</span>
        <div className={`die ${landed ? 'landed' : 'tumbling'}`} aria-hidden="true">
          <DieFace value={face} />
        </div>
        {landed && (
          <>
            <span className={`dice-result ${even ? 'even' : 'odd'}`}>{current.value} — {even ? 'Even' : 'Odd'}</span>
            {current.outcome && <span className="dice-outcome">{current.outcome}</span>}
          </>
        )}
      </div>
    </div>
  );
}
