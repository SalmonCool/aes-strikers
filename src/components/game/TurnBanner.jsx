import { useEffect, useRef, useState } from 'react';
import { playTurnChime, preloadSounds } from '../../game/sounds.js';

const BANNER_MS = 2200;
const TURN_PHASES = ['draw', 'equip', 'strike'];

// Announces the start of each turn: a big banner (louder for your own turn), a chime when it's yours,
// and a "Your turn!" tab title while the tab is in the background.
export default function TurnBanner({ game, me }) {
  const [banner, setBanner] = useState(null); // { key, mine, name }
  const lastTurnNo = useRef(null);

  useEffect(preloadSounds, []);

  const inTurns = TURN_PHASES.includes(game.phase);
  const turnNo = inTurns ? game.turnNo : null;

  useEffect(() => {
    if (turnNo == null) return;
    const prev = lastTurnNo.current;
    lastTurnNo.current = turnNo;
    // Skip the first value seen (e.g. reloading mid-match) — only announce real turn changes
    if (prev === null || prev === turnNo) return;
    const mine = game.turn === me;
    setBanner({ key: turnNo, mine, name: game.players[game.turn]?.name });
    if (mine) playTurnChime();
  }, [turnNo, game.turn, game.players, me]);

  // First turn of the match: announce when the Start phase hands off to round 1
  const prevPhase = useRef(game.phase);
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = game.phase;
    if (was === 'start' && inTurns) {
      lastTurnNo.current = game.turnNo;
      const mine = game.turn === me;
      setBanner({ key: `first-${game.turnNo}`, mine, name: game.players[game.turn]?.name });
      if (mine) playTurnChime();
    }
  }, [game.phase, inTurns, game.turnNo, game.turn, game.players, me]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), BANNER_MS);
    return () => clearTimeout(t);
  }, [banner]);

  // Background tab: flag the title until the player comes back
  const myTurn = inTurns && game.turn === me;
  useEffect(() => {
    const base = 'AES Strikers';
    const update = () => { document.title = myTurn && document.hidden ? '⚔ Your turn! — AES Strikers' : base; };
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      document.title = base;
    };
  }, [myTurn]);

  if (!banner) return null;
  return (
    <div key={banner.key} className={`turn-banner ${banner.mine ? 'mine' : 'theirs'}`} role="status" aria-live="assertive">
      <div className="turn-banner-inner">
        <span className="turn-banner-gem" aria-hidden="true" />
        <span className="turn-banner-text">{banner.mine ? 'Your Turn' : `${banner.name}'s Turn`}</span>
        {banner.mine && <span className="turn-banner-sub">Strike with purpose</span>}
      </div>
    </div>
  );
}
