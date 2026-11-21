import { PHASES, STARTING_HEALTH, STATUSES, SOUL_INCOME_CAP, opponentOf, soulIncome } from '../../game/engine.js';
import PlayerIcon from '../PlayerIcon.jsx';
import { resourceOf, tokenById } from '../../game/tokens.js';

const SOUL_PIPS = 5; // minimum pips shown so the meter has a stable shape

function HealthBar({ player, uid, isMe, avatar }) {
  if (!player) {
    return (
      <div className="pt-player empty">
        <div className="pt-player-name">Awaiting challenger…</div>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, (player.health / STARTING_HEALTH) * 100));
  const soul = player.soul || 0;
  const res = resourceOf(player.token);
  const token = tokenById(player.token);
  const nextGain = soulIncome((player.turnsTaken || 0) + 1);
  const st = { burn: 0, purge: 0, freeze: 0, frostbite: 0, stun: null, ...(player.status || {}) };
  const statuses = STATUSES.filter((d) => (d.id === 'stun' ? st.stun : st[d.id] > 0)).map((d) => ({
    ...d,
    text: d.id === 'stun' ? 'Stunned' : `${d.label} ×${st[d.id]}`,
  }));
  return (
    <div className={`pt-player ${isMe ? 'me' : 'opp'}`} data-player-plate={uid}>
      <div className="pt-player-head">
        <PlayerIcon src={avatar?.src} crop={avatar?.crop} name={player.name} soul={soul} resource={res.id} status={st} size={46} />
        <div className="pt-player-name">
          <span className="pt-name-text">{player.name}</span>{isMe && <span className="pt-you">You</span>}
        </div>
      </div>
      <div className="pt-health" role="meter" aria-valuemin={0} aria-valuemax={STARTING_HEALTH} aria-valuenow={player.health} aria-label={`${player.name} health`}>
        <div className="pt-health-fill" style={{ width: `${pct}%` }} />
        <span className="pt-health-text">{player.health} / {STARTING_HEALTH}</span>
      </div>
      <div className={`pt-soul res-${res.id}`} title={`Banked ${res.label}, spent to play cards. +${nextGain} next turn (income grows by 1 each turn, up to ${SOUL_INCOME_CAP}). Unspent ${res.label} is kept.`}>
        <span className="pt-soul-label">{res.label}</span>
        <span className="pt-soul-gems" aria-hidden="true">
          {Array.from({ length: Math.max(SOUL_PIPS, soul) }, (_, i) => (
            <span key={i} className={`pt-soul-pip ${i < soul ? 'on' : ''}`} />
          ))}
        </span>
        <span className="pt-soul-value" aria-label={`${soul} ${res.label} available`}>{soul}</span>
      </div>
      <div className={`pt-soul-income res-${res.id}`}>+{nextGain} {res.label} next turn</div>
      <div className="pt-counts">
        <span>Deck {player.deckCount}</span>
        <span>Hand {player.handCount}</span>
      </div>
      {token && (
        <div className="pt-tokens">
          <span className={`pt-token ${token.kind}`}>{token.kind === 'villain' ? 'Villain' : 'Hero'} · {token.name}</span>
          <span className="pt-token emotion">{token.emotion}</span>
        </div>
      )}
      {statuses.length > 0 && (
        <div className="pt-statuses">
          {statuses.map((st) => (
            <span key={st.id} className={`pt-status status-${st.id}`} title={st.desc}>{st.text}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PhaseTracker({ game, me, avatars = {} }) {
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
        <HealthBar player={game.players[opp]} uid={opp} avatar={avatars[opp]} />
        <HealthBar player={game.players[me]} uid={me} avatar={avatars[me]} isMe />
      </div>
    </div>
  );
}
