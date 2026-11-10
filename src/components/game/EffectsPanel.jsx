import { useState } from 'react';
import { STATUSES, opponentOf, statusOf } from '../../game/engine.js';
import { ABILITY_ZONES, zoneLabel } from '../../game/zones.js';

// Manual controls for effects that come from card text: statuses, detonations, and die rolls.
export default function EffectsPanel({ game, me, run, actions }) {
  const opp = opponentOf(game, me);
  const [targetSide, setTargetSide] = useState('opp');
  const [stunPicking, setStunPicking] = useState(false);
  const target = targetSide === 'opp' ? opp : me;
  const active = !['setup', 'start', 'over'].includes(game.phase) && opp;
  const s = target ? statusOf(game, target) : null;

  return (
    <div className="panel effects-panel">
      <div className="fx-head">
        <h2>Effects</h2>
        <button className="ui-btn small" onClick={() => run(actions.rollDie())} disabled={!active}>Roll a Die</button>
      </div>
      <div className="fx-target" role="radiogroup" aria-label="Effect target">
        {[['opp', game.players[opp]?.name || 'Opponent'], ['me', 'Yourself']].map(([k, label]) => (
          <button key={k} role="radio" aria-checked={targetSide === k} className={`fx-target-btn ${targetSide === k ? 'active' : ''}`} onClick={() => { setTargetSide(k); setStunPicking(false); }}>
            {label}
          </button>
        ))}
      </div>

      {!active ? (
        <p className="fx-note">Available once the match is underway.</p>
      ) : (
        <ul className="fx-list">
          {STATUSES.map((def) => {
            const value = def.id === 'stun' ? (s.stun ? 1 : 0) : s[def.id];
            const blocked = def.id === 'frostbite' && s.freeze < 2;
            return (
              <li key={def.id} className="fx-row" title={def.desc}>
                <span className={`fx-name status-${def.id}`}>{def.label}</span>
                <span className="fx-stacks">
                  {def.id === 'stun' && s.stun ? zoneLabel(s.stun.zone).replace('Ability ', '') : `${value}/${def.max}`}
                </span>
                <span className="fx-actions">
                  <button
                    className="fx-btn"
                    aria-label={`Add ${def.label}`}
                    disabled={value >= def.max || blocked}
                    title={blocked ? 'Requires max Freeze (2 stacks)' : `Add ${def.label}`}
                    onClick={() => (def.id === 'stun' ? setStunPicking(true) : run(actions.apply(target, def.id)))}
                  >+</button>
                  <button className="fx-btn" aria-label={`Remove ${def.label}`} disabled={!value} onClick={() => run(actions.remove(target, def.id))}>−</button>
                  {def.detonate && (
                    <button className="fx-btn detonate" disabled={!value} onClick={() => run(actions.detonate(target, def.id))} title={`Deal ${value * 10} damage and clear`}>
                      Detonate
                    </button>
                  )}
                </span>
                {def.id === 'stun' && stunPicking && (
                  <span className="fx-stun-pick">
                    Restrict:
                    {ABILITY_ZONES.map((z) => (
                      <button key={z} className="ui-btn small" onClick={() => { run(actions.apply(target, 'stun', z)); setStunPicking(false); }}>
                        {zoneLabel(z).replace('Ability ', '')}
                      </button>
                    ))}
                    <button className="ui-btn small" onClick={() => setStunPicking(false)}>Cancel</button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
