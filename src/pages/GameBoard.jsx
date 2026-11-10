import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { joinSession, watchSession } from '../firebase/db.js';
import PlayerMat from '../components/PlayerMat.jsx';
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

export default function GameBoard() {
  const { sessionId } = useParams();
  const { user } = useAuth();
  const [session, setSession] = useState(undefined); // undefined = loading, null = not found
  const [role, setRole] = useState(null); // 'host' | 'guest' | 'full'
  const [error, setError] = useState('');

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

  useEffect(() => {
    if (!role) return;
    return watchSession(sessionId, setSession, (e) => {
      console.error(e);
      setError('Lost connection to the arena.');
    });
  }, [sessionId, role]);

  if (error || session === null || role === 'full') {
    const text = error || (session === null ? 'This arena does not exist.' : 'This arena already has two players.');
    return (
      <div className="game-page">
        <div className="panel arena-notice">
          <h2>Arena Unavailable</h2>
          <p>{text}</p>
          <Link to="/" className="ui-btn primary">Back to Lobby</Link>
        </div>
      </div>
    );
  }

  if (!session || !role) return <div className="screen-loading">Entering the arena…</div>;

  const isHost = role === 'host';
  const myName = isHost ? session.hostName : session.guestName;
  const opponentName = isHost ? session.guestName : session.hostName;

  return (
    <div className="game-page">
      <div className="arena-bar">
        <Link to="/" className="arena-btn">Leave</Link>
        <InviteButton sessionId={sessionId} />
        {!opponentName && <span className="arena-status">Waiting for an opponent…</span>}
      </div>
      <div className="board">
        {/* Opponent's half: same mat rotated 180° so it faces them */}
        <PlayerMat side="opponent" playerName={opponentName || 'Awaiting challenger'} />
        <div className="board-divider" aria-hidden="true"><span /></div>
        <PlayerMat side="self" playerName={myName} />
      </div>
    </div>
  );
}
