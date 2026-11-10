import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { joinSession, watchSession } from '../firebase/db.js';
import {
  declareAttack, declareCounter, dealOpeningHand, drawForTurn, endPhase, opponentOf, placeCard,
  playCounter, resolveWithoutCounter, setupReady, startReady, watchHand, watchLog,
} from '../game/engine.js';
import { PLAYABLE_ZONES } from '../game/zones.js';
import PlayerMat from '../components/PlayerMat.jsx';
import PhaseTracker from '../components/game/PhaseTracker.jsx';
import EventLog from '../components/game/EventLog.jsx';
import Hand from '../components/game/Hand.jsx';
import CounterPrompt from '../components/game/CounterPrompt.jsx';
import SetupPanel from '../components/game/SetupPanel.jsx';
import './GameBoard.css';

function InviteButton({ sessionId }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/play/${sessionId}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Clipboard API blocked (e.g. non-secure context): fall back to a prompt the user can copy from
      window.prompt('Copy this invite link:', link);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button className="arena-btn" onClick={copy}>
      {copied ? 'Link Copied!' : 'Copy Invite Link'}
    </button>
  );
}

function Notice({ title, text }) {
  return (
    <div className="game-page center">
      <div className="panel arena-notice">
        <h2>{title}</h2>
        <p>{text}</p>
        <Link to="/" className="ui-btn primary">Back to Lobby</Link>
      </div>
    </div>
  );
}

export default function GameBoard() {
  const { sessionId } = useParams();
  const { user } = useAuth();
  const me = user.uid;
  const [session, setSession] = useState(undefined); // undefined = loading, null = not found
  const [role, setRole] = useState(null); // 'host' | 'guest' | 'full'
  const [error, setError] = useState('');
  const [hand, setHand] = useState({ deck: [], hand: [], dealt: false });
  const [log, setLog] = useState([]);
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState('');

  // ----- Join + subscriptions -----
  useEffect(() => {
    let cancelled = false;
    joinSession(sessionId, user)
      .then((r) => {
        if (cancelled) return;
        if (r === 'missing') setSession(null);
        else setRole(r);
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setError('Could not join this arena.');
      });
    return () => { cancelled = true; };
  }, [sessionId, user]);

  const seated = role === 'host' || role === 'guest';

  useEffect(() => {
    if (!seated) return;
    const unsubs = [
      watchSession(sessionId, setSession, (e) => {
        console.error(e);
        setError('Lost connection to the arena.');
      }),
      watchHand(sessionId, me, setHand),
      watchLog(sessionId, setLog),
    ];
    return () => unsubs.forEach((u) => u());
  }, [sessionId, me, seated]);

  const game = session?.game;

  const run = useCallback((promise) => {
    promise.catch((e) => {
      console.error(e);
      setToast(e.message || 'Something went wrong.');
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // ----- Automatic steps (idempotent: the engine ignores repeats) -----
  const needsDeal = game?.phase === 'start' && game.players[me] && !game.players[me].dealt;
  const needsDraw = game?.phase === 'draw' && game.turn === me;
  useEffect(() => { if (needsDeal) run(dealOpeningHand(sessionId, me)); }, [needsDeal, sessionId, me, run]);
  useEffect(() => { if (needsDraw) run(drawForTurn(sessionId, me)); }, [needsDraw, sessionId, me, run]);

  // Clear selection if the card left the hand
  const selectedCard = hand.hand.find((c) => c.iid === selected) || null;

  // ----- What can be clicked right now -----
  const opp = game ? opponentOf(game, me) : null;
  const myTurn = game?.turn === me;
  const attack = game?.attack || null;
  const amDefender = attack?.defender === me;
  const countering = attack?.status === 'countering' && amDefender;

  const mode = useMemo(() => {
    if (!game || !selectedCard || game.phase === 'over') return null;
    if (game.phase === 'start' && !game.players[me]?.ready && selectedCard.cardType === 'Body Armor') return 'place';
    if (game.phase === 'equip' && myTurn && !attack) return 'place';
    if (game.phase === 'strike' && myTurn && !attack && selectedCard.cardType === 'Attack') return 'target';
    return null;
  }, [game, selectedCard, me, myTurn, attack]);

  const myHighlight = useMemo(() => {
    if (mode !== 'place') return null;
    const board = game.board[me] || {};
    const zones = game.phase === 'start' ? ['body-armor'] : PLAYABLE_ZONES;
    return new Set(zones.filter((z) => !board[z]));
  }, [mode, game, me]);

  const oppHighlight = useMemo(() => {
    if (mode !== 'target' || !opp) return null;
    const board = game.board[opp] || {};
    return new Set(Object.keys(board).filter((z) => board[z]?.health > 0));
  }, [mode, game, opp]);

  const isPlayable = useCallback((c) => {
    if (!game) return false;
    if (countering) return c.cardType === 'Attack';
    if (game.phase === 'start') return !game.players[me]?.ready && c.cardType === 'Body Armor';
    if (game.phase === 'equip') return myTurn && !attack;
    if (game.phase === 'strike') return myTurn && !attack && c.cardType === 'Attack';
    return false;
  }, [game, countering, me, myTurn, attack]);

  const onPlace = (zone) => {
    run(placeCard(sessionId, me, selected, zone));
    setSelected(null);
  };
  const onTarget = (target) => {
    run(declareAttack(sessionId, me, selected, target));
    setSelected(null);
  };

  const onCounterTimeout = useCallback(
    () => attack && run(resolveWithoutCounter(sessionId, me, attack.id, 'timeout')),
    [attack, sessionId, me, run],
  );

  // ----- Render guards -----
  if (error) return <Notice title="Arena Unavailable" text={error} />;
  if (session === null) return <Notice title="Arena Unavailable" text="This arena does not exist." />;
  if (role === 'full') return <Notice title="Arena Full" text="This arena already has two players." />;
  if (!session || !role) return <div className="screen-loading">Entering the arena…</div>;
  if (!game) return <Notice title="Outdated Arena" text="This arena was created before gameplay was added. Open a new one from the lobby." />;

  const names = Object.fromEntries(Object.entries(game.players).map(([u, p]) => [u, p.name]));
  const oppName = opp ? names[opp] : 'Awaiting challenger';

  // ----- Action bar: hint + buttons for the current situation -----
  let hint = '';
  const buttons = [];
  if (game.phase === 'over') {
    hint = game.winner === me ? 'Victory! You won the match.' : `${names[game.winner]} won the match.`;
  } else if (game.phase === 'setup') {
    hint = game.players[me]?.ready
      ? opp ? `Waiting for ${oppName} to finish setup…` : 'Waiting for an opponent to join. Share the invite link!'
      : 'Choose your Idol and Aether cards.';
  } else if (game.phase === 'start') {
    if (game.players[me]?.ready) hint = `Waiting for ${oppName} to ready up…`;
    else {
      hint = 'Optional: select a Body Armor card from your hand and place it, then ready up.';
      buttons.push(<button key="ready" className="ui-btn primary" onClick={() => run(startReady(sessionId, me))}>Ready to Begin</button>);
    }
  } else if (countering) {
    hint = 'COUNTER! — select an Attack card from your hand to counter with.';
    if (selectedCard?.cardType === 'Attack') {
      buttons.push(
        <button key="c" className="ui-btn primary" onClick={() => { run(playCounter(sessionId, me, selected)); setSelected(null); }}>
          Counter with “{selectedCard.title}”
        </button>,
      );
    }
    buttons.push(<button key="none" className="ui-btn" onClick={() => run(resolveWithoutCounter(sessionId, me, attack.id, 'pass'))}>No counter card</button>);
  } else if (attack) {
    hint = attack.status === 'countering' ? `${names[attack.defender]} declared COUNTER! and is choosing a card…` : '';
  } else if (myTurn && game.phase === 'equip') {
    hint = 'Equip phase: select a card in your hand, then click an empty zone to equip it.';
    buttons.push(<button key="next" className="ui-btn primary" onClick={() => run(endPhase(sessionId, me))}>Go to STRIKE!</button>);
  } else if (myTurn && game.phase === 'strike') {
    hint = mode === 'target'
      ? 'Choose a target: a glowing enemy card, or strike the player directly.'
      : 'STRIKE! phase: select an Attack card from your hand to attack.';
    if (mode === 'target') {
      buttons.push(<button key="face" className="ui-btn primary" onClick={() => onTarget({ kind: 'player' })}>Strike {oppName} directly</button>);
    }
    buttons.push(<button key="end" className="ui-btn" onClick={() => run(endPhase(sessionId, me))}>End Turn</button>);
  } else if (!myTurn) {
    hint = `${names[game.turn]}'s ${game.phase === 'strike' ? 'STRIKE!' : game.phase} phase…`;
  }

  return (
    <div className="game-page">
      <aside className="arena-side left">
        <div className="arena-bar">
          <Link to="/" className="arena-btn">Leave</Link>
          <InviteButton sessionId={sessionId} />
        </div>
        <PhaseTracker game={game} me={me} />
      </aside>

      <main className="arena-center">
        <div className="board">
          {/* Opponent's half: same mat rotated 180° so it faces them */}
          <PlayerMat
            side="opponent"
            playerName={oppName}
            cards={opp ? game.board[opp] : {}}
            deckCount={opp ? game.players[opp].deckCount : 0}
            discard={opp ? game.discard[opp] : []}
            highlight={oppHighlight}
            highlightKind="target"
            onZoneClick={(zone) => onTarget({ kind: 'card', zone })}
          />
          <div className="board-divider" aria-hidden="true"><span /></div>
          <PlayerMat
            side="self"
            playerName={names[me]}
            cards={game.board[me]}
            deckCount={hand.deck.length}
            discard={game.discard[me]}
            highlight={myHighlight}
            onZoneClick={onPlace}
          />
        </div>

        <div className="action-bar">
          <p className="action-hint">{hint}</p>
          <div className="action-buttons">{buttons}</div>
        </div>
        <Hand cards={hand.hand} selected={selected} onSelect={setSelected} isPlayable={isPlayable} />
      </main>

      <aside className="arena-side right">
        <EventLog entries={log} />
      </aside>

      {attack?.status === 'open' && (
        <CounterPrompt
          key={attack.id}
          attack={attack}
          me={me}
          names={names}
          onCounter={() => run(declareCounter(sessionId, me, attack.id))}
          onPass={() => run(resolveWithoutCounter(sessionId, me, attack.id, 'pass'))}
          onTimeout={onCounterTimeout}
        />
      )}

      {game.phase === 'setup' && !game.players[me]?.ready && (
        <SetupPanel uid={me} onReady={(cards, idol, aether) => setupReady(sessionId, me, cards, idol, aether).catch((e) => setToast(e.message))} />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
