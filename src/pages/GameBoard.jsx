import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { avatarCropOf, avatarOf, joinSession, watchProfile, watchSession } from '../firebase/db.js';
import {
  affinityOk, attackBreakdown, breakdownText, canAfford, canDetonate, chainLock, sacrificeOption, declareAttack, detonateLatent, declareCounter, dealOpeningHand, detonateStatus, drawForTurn,
  endPhase, isAutoLatent, isSoulCard, opponentOf, placeCard, pickOpponentCards, pickFromDeck, playCounter, resolvePendingDiscards, resolveWithoutCounter, revealLatent,
  setupReady, soulCostFor, soulIncome, startReady, validZonesFor, watchHand, watchLog,
} from '../game/engine.js';
import { LATENT_ZONES, isCastCard, isLatentCard } from '../game/zones.js';
import { cardTokenId, resourceOf, tokenLabel } from '../game/tokens.js';
import PlayerMat from '../components/PlayerMat.jsx';
import PhaseTracker from '../components/game/PhaseTracker.jsx';
import EventLog from '../components/game/EventLog.jsx';
import PileViewer from '../components/game/PileViewer.jsx';
import ActiveEffects from '../components/game/ActiveEffects.jsx';
import Hand from '../components/game/Hand.jsx';
import CounterPrompt from '../components/game/CounterPrompt.jsx';
import SetupPanel from '../components/game/SetupPanel.jsx';
import EffectsPanel from '../components/game/EffectsPanel.jsx';
import DiceRoll from '../components/game/DiceRoll.jsx';
import AttackFx from '../components/game/AttackFx.jsx';
import TurnBanner from '../components/game/TurnBanner.jsx';
import { isMuted, playTurnChime, setMuted } from '../game/sounds.js';

function SoundToggle() {
  const [muted, setMutedState] = useState(isMuted);
  const toggle = () => {
    setMuted(!muted);
    setMutedState(!muted);
    if (muted) playTurnChime(); // preview the sound when turning it back on
  };
  return (
    <button className="arena-btn" onClick={toggle} aria-pressed={!muted} title={muted ? 'Turn sounds on' : 'Turn sounds off'}>
      {muted ? 'Sound: Off' : 'Sound: On'}
    </button>
  );
}
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
  const [hand, setHand] = useState({ deck: [], hand: [], dealt: false, latent: {} });
  const [log, setLog] = useState([]);
  const [sel, setSel] = useState(null); // null | { from: 'hand', iid } | { from: 'board', zone }
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
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ----- Automatic steps (idempotent: the engine ignores repeats) -----
  const needsDeal = game?.phase === 'start' && game.players[me] && !game.players[me].dealt;
  const needsDraw = game?.phase === 'draw' && game.turn === me;
  useEffect(() => { if (needsDeal) run(dealOpeningHand(sessionId, me)); }, [needsDeal, sessionId, me, run]);
  useEffect(() => { if (needsDraw) run(drawForTurn(sessionId, me)); }, [needsDraw, sessionId, me, run]);
  // Discards an opponent's card forced on my (private) hand
  // ...and deck searches (e.g. "Just a Touch") earned while the opponent was acting
  const mine = game?.players[me];
  const needsDiscard = (mine?.pendingDiscard || 0) > 0 || (mine?.pendingDiscardPicks?.length || 0) > 0 || (mine?.pendingSearches?.length || 0) > 0 || (mine?.pendingDraws || 0) > 0;
  useEffect(() => { if (needsDiscard) run(resolvePendingDiscards(sessionId, me)); }, [needsDiscard, sessionId, me, run]);

  // ----- Derived state -----
  const opp = game ? opponentOf(game, me) : null;
  const player = game?.players[me];
  const myRes = resourceOf(player?.token);
  // Incantation deck search available this turn (e.g. Maxees! Turn 2)
  const deckPick = player?.deckPick?.turnNo === game?.turnNo ? player.deckPick : null;

  // Player icons come from each player's profile (kept off the game doc so it stays small)
  const [avatars, setAvatars] = useState({});
  useEffect(() => {
    const uids = [me, opp].filter(Boolean);
    const unsubs = uids.map((u) => watchProfile(u, (p) => setAvatars((a) => ({ ...a, [u]: { src: avatarOf(p), crop: avatarCropOf(p) } }))));
    return () => unsubs.forEach((un) => un());
  }, [me, opp]);
  const myBoard = useMemo(() => game?.board[me] || {}, [game, me]);
  const myTurn = game?.turn === me;
  const attack = game?.attack || null;
  const countering = attack?.status === 'countering' && attack.defender === me;
  const inMyStrike = game?.phase === 'strike' && myTurn && !attack;
  const canReveal = inMyStrike || countering;

  const selectedCard = !sel ? null
    : sel.from === 'hand' ? hand.hand.find((c) => c.iid === sel.iid) || null
      : (myBoard[sel.zone] && !myBoard[sel.zone].faceDown ? myBoard[sel.zone] : null);

  // Can this hand card be paid for and played by this player at all?
  const castable = useCallback(
    (c) => !isSoulCard(c) && affinityOk(player, c) && canAfford(game, me, c),
    [player, game, me],
  );

  // Is a revealed Latent card on my board usable right now?
  const usableLatent = useCallback((zone) => {
    const c = myBoard[zone];
    if (!c || c.faceDown || !c.revealed || c.usedTurn === game?.turnNo || isAutoLatent(c)) return false;
    if (inMyStrike) return c.cardType === 'Attack';
    if (countering) return c.cardType === 'Attack' || c.cardType === 'Defend';
    return false;
  }, [myBoard, game?.turnNo, inMyStrike, countering]);

  const canPlaceNow = game && (
    (game.phase === 'start' && !player?.ready) ||
    (game.phase === 'equip' && myTurn && !attack)
  );

  const placeZones = useMemo(() => {
    if (!game || sel?.from !== 'hand' || !selectedCard || !canPlaceNow || !castable(selectedCard)) return [];
    return validZonesFor(game, me, selectedCard);
  }, [game, sel, selectedCard, canPlaceNow, castable, me]);

  const selectionUsable = selectedCard && (sel.from === 'board' ? usableLatent(sel.zone) : castable(selectedCard) && isCastCard(selectedCard));
  const targeting = inMyStrike && selectionUsable && selectedCard.cardType === 'Attack';
  const counterReady = countering && selectionUsable && (selectedCard.cardType === 'Attack' || selectedCard.cardType === 'Defend');

  const myHighlight = useMemo(() => {
    const m = new Map(placeZones.map((z) => [z, myBoard[z] ? 'replace' : 'place']));
    LATENT_ZONES.forEach((z) => {
      const c = myBoard[z];
      if (!c) return;
      if (c.faceDown && canReveal) m.set(z, 'reveal');
      else if (sel?.from === 'board' && sel.zone === z) m.set(z, 'selected');
      else if (usableLatent(z)) m.set(z, 'use');
    });
    return m;
  }, [placeZones, myBoard, canReveal, sel, usableLatent]);

  const oppHighlight = useMemo(() => {
    if (!targeting || !opp) return null;
    const board = game.board[opp] || {};
    return new Map(
      Object.keys(board)
        .filter((z) => board[z] && !Array.isArray(board[z]) && !board[z].faceDown && board[z].health > 0)
        .map((z) => [z, 'target']),
    );
  }, [targeting, game, opp]);

  const isPlayable = useCallback((c) => {
    if (!game || !castable(c)) return false;
    if (countering) return isCastCard(c);
    if (game.phase === 'start' || game.phase === 'equip') return canPlaceNow && validZonesFor(game, me, c).length > 0;
    if (inMyStrike) return isCastCard(c) && c.cardType === 'Attack';
    return false;
  }, [game, castable, countering, canPlaceNow, me, inMyStrike]);

  const source = sel?.from === 'board' ? { kind: 'latent', zone: sel.zone } : sel ? { kind: 'hand', iid: sel.iid } : null;

  const onMyZone = (zone) => {
    if (placeZones.includes(zone)) {
      const slot = myBoard[zone];
      const replacing = slot?.faceDown ? hand?.latent?.[zone] : slot; // face-down: the real card is in my private hand
      const title = replacing?.title || 'this card';
      if (slot && !window.confirm(`Replace "${title}" with "${selectedCard.title}"? "${title}" will be discarded.`)) return;
      run(placeCard(sessionId, me, sel.iid, zone));
      setSel(null);
      return;
    }
    const c = myBoard[zone];
    if (c?.faceDown && canReveal) run(revealLatent(sessionId, me, zone));
    else if (usableLatent(zone)) setSel(sel?.from === 'board' && sel.zone === zone ? null : { from: 'board', zone });
  };
  const [pile, setPile] = useState(null); // { kind: 'deck' | 'discard', uid } while viewing a pile
  const onTarget = (target) => {
    run(declareAttack(sessionId, me, source, target));
    setSel(null);
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
  if (!game || game.turnNo === undefined) {
    return <Notice title="Outdated Arena" text="This arena was created with older rules. Open a new one from the lobby." />;
  }

  const names = Object.fromEntries(Object.entries(game.players).map(([u, p]) => [u, p.name]));
  const oppName = opp ? names[opp] : 'Awaiting challenger';
  const clashFor = (uid) => {
    const c = game.clash;
    if (attack?.by === uid) return attack.card;
    if (!c) return null;
    return c.by === uid ? c.attackCard : c.defender === uid ? c.counterCard : null;
  };

  // Why a selected card can't be played (if that's the case)
  let selectionHint = '';
  if (selectedCard && sel.from === 'hand') {
    const lock = chainLock(game, me, selectedCard);
    if (lock) selectionHint = `"${selectedCard.title}" can't be played while "${lock.title}" is in play.`;
    else if (!affinityOk(player, selectedCard)) selectionHint = `"${selectedCard.title}" belongs to ${tokenLabel(cardTokenId(selectedCard))} — it doesn't match your ${tokenLabel(player.token)} token.`;
    else if (!canAfford(game, me, selectedCard)) selectionHint = `"${selectedCard.title}" costs ${soulCostFor(game, me, selectedCard)} ${myRes.label}. You have ${player?.soul || 0}.`;
    else if (canPlaceNow && isCastCard(selectedCard)) selectionHint = `${selectedCard.cardType} cards are cast during STRIKE! or COUNTER!, not equipped.`;
    else if (canPlaceNow && placeZones.length === 0) selectionHint = `No open zone for "${selectedCard.title}".`;
    else if (canPlaceNow && isLatentCard(selectedCard)) {
      selectionHint = placeZones.some((z) => myBoard[z])
        ? `Latent card: place it face-down in a glowing slot, or click an orange slot to replace that Latent card (the old one is discarded). ${myRes.label} is paid now.`
        : `Latent card: place it face-down in a glowing Latent slot. ${myRes.label} is paid now.`;
    } else if (canPlaceNow && placeZones.some((z) => myBoard[z])) {
      selectionHint = `${selectedCard.cardType}: place it in an empty slot, or click an orange slot to replace that card (the old one is discarded).`;
    }
  }
  // Preview how a selected Attack's damage adds up before it's declared
  if (!selectionHint && selectedCard?.cardType === 'Attack' && game.phase === 'strike' && game.turn === me) {
    // Some bonuses depend on the target (e.g. Skewer for direct hits, Rending Carapace for cards)
    const direct = attackBreakdown(game, me, selectedCard, { kind: 'player' });
    const vsCard = attackBreakdown(game, me, selectedCard, { kind: 'card' });
    if (direct.total !== vsCard.total) {
      selectionHint = `"${selectedCard.title}" will deal ${breakdownText(direct)} directly, or ${breakdownText(vsCard)} to a card.`;
    } else if (direct.parts.length) {
      selectionHint = `"${selectedCard.title}" will deal ${breakdownText(direct)} damage.`;
    }
  }

  // ----- Action bar: hint + buttons for the current situation -----
  let hint = '';
  const buttons = [];
  if (game.phase === 'over') {
    hint = game.winner === me ? 'Victory! You won the match.' : `${names[game.winner]} won the match.`;
  } else if (game.phase === 'setup') {
    hint = player?.ready
      ? opp ? `Waiting for ${oppName} to finish setup…` : 'Waiting for an opponent to join. Share the invite link!'
      : 'Choose your deck and tokens.';
  } else if (game.phase === 'start') {
    if (player?.ready) hint = `Waiting for ${oppName} to ready up…`;
    else {
      hint = 'Optional: select a Body Armor card from your hand and place it, then ready up.';
      buttons.push(<button key="ready" className="ui-btn primary" onClick={() => run(startReady(sessionId, me))}>Ready to Begin</button>);
    }
  } else if (game.pendingPick?.by === me) {
    // I stunned the opponent: pick one of their face-down hand cards to discard (a blind pick)
    const pk = game.pendingPick;
    const size = game.players[pk.target]?.handCount || 0;
    hint = `"${pk.source}": pick one of ${names[pk.target]}'s face-down cards to discard.`;
    Array.from({ length: size }, (_, i) => buttons.push(
      <button key={`pick${i}`} className="ui-btn pick-card" aria-label={`Card ${i + 1}`} onClick={() => run(pickOpponentCards(sessionId, me, [i]))}>
        🂠 {i + 1}
      </button>,
    ));
  } else if (game.pendingPick) {
    hint = `${names[game.pendingPick.by]} is picking a card from ${game.pendingPick.target === me ? 'your' : `${names[game.pendingPick.target]}'s`} hand to discard…`;
  } else if (countering) {
    hint = 'COUNTER! — select an Attack or Defend card from your hand, or reveal / use a Latent card.';
    if (counterReady) {
      buttons.push(
        <button key="c" className="ui-btn primary" onClick={() => { run(playCounter(sessionId, me, source)); setSel(null); }}>
          Counter with “{selectedCard.title}”
        </button>,
      );
      // Optional HP sacrifice for more block (e.g. Translucence)
      const sac = sacrificeOption(selectedCard);
      if (sac) {
        buttons.push(
          <button key="cs" className="ui-btn" onClick={() => { run(playCounter(sessionId, me, source, { sacrifice: true })); setSel(null); }}>
            Sacrifice {sac.hp} HP: block +{sac.block}
          </button>,
        );
      }
    }
    buttons.push(<button key="none" className="ui-btn" onClick={() => run(resolveWithoutCounter(sessionId, me, attack.id, 'pass'))}>No counter</button>);
  } else if (attack) {
    hint = attack.status === 'countering' ? `${names[attack.defender]} declared COUNTER! and is choosing a card…` : '';
  } else if (myTurn && game.phase === 'equip') {
    hint = 'Equip phase: select a card, then click a glowing zone. Latent cards go face-down.';
    if (deckPick) {
      buttons.push(<button key="search" className="ui-btn" onClick={() => setPile({ kind: 'deck', uid: me, pick: true })}>Search deck ({deckPick.source})</button>);
    }
    buttons.push(<button key="next" className="ui-btn primary" onClick={() => run(endPhase(sessionId, me))}>Go to STRIKE!</button>);
  } else if (inMyStrike) {
    hint = targeting
      ? 'Choose a target: a glowing enemy card, or strike the player directly.'
      : 'STRIKE! phase: select an Attack card or a revealed Latent card. Click a face-down Latent card to reveal it.';
    if (targeting) {
      buttons.push(<button key="face" className="ui-btn primary" onClick={() => onTarget({ kind: 'player' })}>Strike {oppName} directly</button>);
    }
    // Revealed Latent cards with a STRIKE! Detonate (e.g. "Nail")
    LATENT_ZONES.filter((z) => canDetonate(myBoard[z])).forEach((z) => {
      const c = myBoard[z];
      buttons.push(
        <button
          key={`det-${z}`}
          className="ui-btn"
          onClick={() => {
            if (window.confirm(`Detonate "${c.title}"? It is discarded and ${oppName} takes direct damage.`)) run(detonateLatent(sessionId, me, z));
          }}
        >
          Detonate “{c.title}”
        </button>,
      );
    });
    buttons.push(<button key="end" className="ui-btn" onClick={() => run(endPhase(sessionId, me))}>End Turn</button>);
  } else if (!myTurn) {
    hint = `${names[game.turn]}'s ${game.phase === 'strike' ? 'STRIKE!' : game.phase} phase…`;
  }

  const turnActive = ['draw', 'equip', 'strike'].includes(game.phase);
  const turnClass = turnActive ? (myTurn ? 'turn-mine' : 'turn-theirs') : '';

  return (
    <div className={`game-page ${turnClass}`}>
      {pile && (
        <PileViewer
          kind={pile.kind}
          owner={pile.uid === me ? 'Your' : `${names[pile.uid]}'s`}
          cards={pile.kind === 'deck' ? hand.deck : game.discard[pile.uid] || []}
          onClose={() => setPile(null)}
          {...(pile.pick && deckPick ? {
            pickNote: `"${deckPick.source}": choose 1 card to add to your hand. Your deck is reshuffled afterwards.`,
            onPick: (c) => { run(pickFromDeck(sessionId, me, c.iid)); setPile(null); },
            onSkip: () => { run(pickFromDeck(sessionId, me, null)); setPile(null); },
          } : {})}
        />
      )}
      <aside className="arena-side left">
        <div className="arena-bar">
          <Link to="/" className="arena-btn">Leave</Link>
          <InviteButton sessionId={sessionId} />
          <SoundToggle />
        </div>
        <PhaseTracker game={game} me={me} avatars={avatars} />
      </aside>

      <main className="arena-center">
        <div className="board">
          {/* Opponent's half: same mat rotated 180° so it faces them */}
          <PlayerMat
            side="opponent"
            owner={opp}
            playerName={oppName}
            board={opp ? game.board[opp] : {}}
            token={opp ? game.players[opp].token : null}
            deckCount={opp ? game.players[opp].deckCount : 0}
            discard={opp ? game.discard[opp] : []}
            exhausted={opp ? game.exhausted?.[opp] : []}
            clashCard={opp ? clashFor(opp) : null}
            turnNo={game.turnNo}
            highlight={oppHighlight}
            onZoneClick={(zone) => onTarget({ kind: 'card', zone })}
            viewablePiles={opp ? ['discard'] : []}
            onPileClick={(kind) => setPile({ kind, uid: opp })}
          />
          <div className="board-divider" aria-hidden="true"><span /></div>
          <PlayerMat
            side="self"
            owner={me}
            playerName={names[me]}
            board={myBoard}
            latentCards={hand.latent}
            token={player?.token}
            deckCount={hand.deck.length}
            discard={game.discard[me]}
            exhausted={game.exhausted?.[me]}
            clashCard={clashFor(me)}
            turnNo={game.turnNo}
            highlight={myHighlight}
            onZoneClick={onMyZone}
            viewablePiles={['deck', 'discard']}
            onPileClick={(kind) => setPile({ kind, uid: me })}
          />
        </div>

        <div className="action-bar">
          <span className={`soul-count res-${myRes.id}`} title={`Banked ${myRes.label}. You gain ${soulIncome((player?.turnsTaken || 0) + 1)} at the start of your next turn (up to 6 per turn). Unspent ${myRes.label} is kept.`}>
            <span className="soul-gem" aria-hidden="true" />{myRes.label} {player?.soul || 0}
          </span>
          <p className="action-hint">{selectionHint || hint}</p>
          <div className="action-buttons">{buttons}</div>
        </div>
        {game.phase !== 'setup' && <ActiveEffects game={game} me={me} />}
        <Hand
          cards={hand.hand}
          selected={sel?.from === 'hand' ? sel.iid : null}
          onSelect={(iid) => setSel(iid ? { from: 'hand', iid } : null)}
          isPlayable={isPlayable}
        />
      </main>

      <aside className="arena-side right">
        <EffectsPanel
          game={game}
          me={me}
          canDetonate={inMyStrike}
          onDetonate={(id) => run(detonateStatus(sessionId, me, id))}
        />
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

      {game.phase === 'setup' && !player?.ready && (
        <SetupPanel uid={me} onReady={(cards, token) => setupReady(sessionId, me, cards, token).catch((e) => setToast(e.message))} />
      )}

      <TurnBanner game={game} me={me} />
      <DiceRoll rolls={game.rolls} names={names} />
      <AttackFx attack={attack} />

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
