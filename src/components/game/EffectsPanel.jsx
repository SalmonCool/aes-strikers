import { STATUSES, opponentOf, statusOf } from '../../game/engine.js';

// Read-only view of both players' statuses. Statuses are applied and cleared by the rules engine;
// the only player action is detonating Burn/Purge on the opponent during your own STRIKE! phase.
export default function EffectsPanel({ game, me, canDetonate, onDetonate }) {
  const opp = opponentOf(game, me);

  const rows = (uid) => {
    const s = statusOf(game, uid);
    return STATUSES.filter((d) => (d.id === 'stun' ? s.stun : s[d.id] > 0)).map((d) => ({
      ...d,
      value: d.id === 'stun' ? 'Rolls at turn start' : `${s[d.id]}/${d.max}`,
      stacks: d.id === 'stun' ? 1 : s[d.id],
    }));
  };

  const section = (uid, label, mineToDetonate) => {
    const list = uid ? rows(uid) : [];
    return (
      <div className="fx-section">
        <h3>{label}</h3>
        {list.length === 0 ? (
          <p className="fx-note">No statuses.</p>
        ) : (
          <ul className="fx-list">
            {list.map((d) => (
              <li key={d.id} className="fx-row" title={d.desc}>
                <span className={`fx-name status-${d.id}`}>{d.label}</span>
                <span className="fx-stacks">{d.value}</span>
                <span className="fx-desc">{d.desc}</span>
                {mineToDetonate && d.detonate && (
                  <span className="fx-actions">
                    <button className="fx-btn detonate" disabled={!canDetonate} onClick={() => onDetonate(d.id)} title={canDetonate ? '' : 'Available during your STRIKE! phase'}>
                      Detonate ({d.stacks * 10} dmg)
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="panel effects-panel">
      <div className="fx-head">
        <h2>Statuses</h2>
      </div>
      {section(opp, game.players[opp]?.name || 'Opponent', true)}
      {section(me, 'You', false)}
      <p className="fx-note fx-foot">Statuses are applied automatically by card effects.</p>
    </div>
  );
}
