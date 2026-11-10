import { PHASES, STARTING_HEALTH, opponentOf } from '../../game/engine.js';

function HealthBar({ player, isMe }) {
  if (!player) {
    return (
      <div className="pt-player empty">
        <div className="pt-player-name">Awaiting challenger…</div>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, (player.health / STARTING_HEALTH) * 100));
  return (
    <div className={`pt-player ${isMe ? 'me' : 'opp'}`}>
      <div className="pt-player-name">
        {player.name}{isMe && <span className="pt-you">You</span>}
      </div>
      <div className="pt-health" role="meter" aria-valuemin={0} aria-valuemax={STARTING_HEALTH} aria-valuenow={player.health} aria-label={`${player.name} health`}>
        <div className="pt-health-fill" style={{ width: `${pct}%` }} />
        <span className="pt-health-text">{player.health} / {STARTING_HEALTH}</span>
      </div>
      <div className="pt-counts">
        <span>Deck {player.deckCount}</span>
        <span>Hand {player.handCount}</span>
      </div>
    </div>
  );
}

export default function PhaseTracker({ game, me }) {
  const opp = opponentOf(game, me);
  const sharedPhase = game.phase === 'setup' || game.phase === 'start';
  const myTurn = game.turn === me;
  const attack = game.attack;

  let turnText;
  if (game.phase === 'over') turnText = game.winner === me ? 'Victory!' : 'Defeat';
  else if (sharedPhase) turnText = 'Both Players';
  else turnText = myTurn ? 'Your Turn' : `${game.players[game.turn]?.name}'s Turn`;

  return (
    <div className="panel phase-tracker">
      <div className="pt-round">{game.round > 0 ? `Round ${game.round}` : 'Pre-match'}</div>
      <div className={`pt-turn ${game.phase === 'over' ? 'over' : sharedPhase ? 'shared' : myTurn ? 'mine' : 'theirs'}`}>
        {turnText}
      </div>

      <ol className="pt-phases">
        {PHASES.map((p) => {
          const done = !p.repeats && game.phase !== p.id && (p.id === 'setup' ? game.phase !== 'setup' : !sharedPhase);
          const skipped = p.id === 'draw' && game.round === 1;
          return (
            <li
              key={p.id}
              className={`pt-phase ${game.phase === p.id ? 'active' : ''} ${done ? 'done' : ''} ${skipped ? 'skipped' : ''}`}
              aria-current={game.phase === p.id ? 'step' : undefined}
            >
              <span className="pt-gem" />
              <span className="pt-label">{p.label}</span>
              {skipped && <small>skipped in round 1</small>}
              {!p.repeats && <small>once</small>}
            </li>
          );
        })}
        <li className={`pt-phase counter ${attack ? 'active' : ''}`}>
          <span className="pt-gem" />
          <span className="pt-label">COUNTER!</span>
          <small>{attack ? (attack.status === 'countering' ? 'declared' : 'window open') : "opponent's STRIKE!"}</small>
        </li>
      </ol>

      <div className="pt-players">
        <HealthBar player={game.players[opp]} />
        <HealthBar player={game.players[me]} isMe />
      </div>
    </div>
  );
}
