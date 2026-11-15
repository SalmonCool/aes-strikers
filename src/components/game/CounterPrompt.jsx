import { useEffect, useRef, useState } from 'react';
import { COUNTER_WINDOW_MS } from '../../game/engine.js';

// Extra time the attacker's client waits before resolving, in case the defender's client is offline.
const ATTACKER_GRACE_MS = 1000;

// Shown while an attack's COUNTER! window is open. Parent keys it by attack.id so each attack gets a fresh timer.
export default function CounterPrompt({ attack, me, names, onCounter, onPass, onTimeout }) {
  const isDefender = attack.defender === me;
  const limit = COUNTER_WINDOW_MS + (isDefender ? 0 : ATTACKER_GRACE_MS);
  const [startedAt] = useState(() => Date.now());
  const [left, setLeft] = useState(COUNTER_WINDOW_MS);
  const firedRef = useRef(false);
  const timeoutRef = useRef(onTimeout);
  useEffect(() => { timeoutRef.current = onTimeout; }, [onTimeout]);

  useEffect(() => {
    const iv = setInterval(() => {
      const remaining = limit - (Date.now() - startedAt);
      setLeft(Math.max(0, remaining));
      if (remaining <= 0 && !firedRef.current) {
        firedRef.current = true;
        timeoutRef.current();
      }
    }, 50);
    return () => clearInterval(iv);
  }, [limit, startedAt]);

  const shown = Math.min(left, COUNTER_WINDOW_MS);
  const pct = (shown / COUNTER_WINDOW_MS) * 100;
  const target = attack.target.kind === 'player' ? names[attack.defender] : `"${attack.targetTitle || 'a card'}"`;

  return (
    <div className={`counter-prompt ${isDefender ? 'defender' : 'attacker'}`} role="alertdialog" aria-label="Counter window">
      <div className="cp-attack">
        <strong>{names[attack.by]}</strong> strikes {target} with <strong>“{attack.card.title}”</strong>
        <span className="cp-damage">{attack.damage} DMG</span>
      </div>
      {attack.breakdown?.parts?.length > 0 && (
        <div className="cp-breakdown" aria-label="How the damage adds up">
          <span className="cp-part">{attack.breakdown.base} base</span>
          {attack.breakdown.parts.map((p, i) => (
            <span key={i} className="cp-part bonus">+{p.amount} <small>{p.label}</small></span>
          ))}
          <span className="cp-part total">= {attack.damage}</span>
        </div>
      )}
      <div className="cp-timer"><div className="cp-timer-fill" style={{ width: `${pct}%` }} /></div>
      {isDefender ? (
        <div className="cp-actions">
          <button className="cp-counter-btn" onClick={onCounter}>COUNTER!</button>
          <button className="ui-btn small" onClick={onPass}>Take the hit</button>
          <span className="cp-seconds">{(shown / 1000).toFixed(1)}s</span>
        </div>
      ) : (
        <p className="cp-waiting">Waiting for {names[attack.defender]} to respond… {(shown / 1000).toFixed(1)}s</p>
      )}
    </div>
  );
}
