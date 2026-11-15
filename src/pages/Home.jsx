import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { createSession, displayNameOf } from '../firebase/db.js';
import AvatarPicker from '../components/AvatarPicker.jsx';

export default function Home() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const startArena = async () => {
    setCreating(true);
    setError('');
    try {
      const id = await createSession(user);
      navigate(`/play/${id}`);
    } catch (e) {
      console.error(e);
      setError('Could not open an arena. Check your connection and try again.');
      setCreating(false);
    }
  };

  return (
    <main className="page">
      <div className="page-inner">
        <header className="page-header">
          <div className="home-identity">
            <AvatarPicker />
            <div>
              <h1 className="page-title">AES <span className="accent">STRIKERS</span></h1>
              <p className="page-sub">Welcome, {displayNameOf(user)}</p>
            </div>
          </div>
          <button className="ui-btn small" onClick={logout}>Log out</button>
        </header>

        {error && <p className="ui-msg error" style={{ marginBottom: 16 }}>{error}</p>}

        <div className="lobby-grid">
          <button className="lobby-tile featured" onClick={startArena} disabled={creating}>
            <span className="gem" />
            <h3>{creating ? 'Opening Arena…' : 'Open an Arena'}</h3>
            <p>Start a new match session and share the invite link with a friend.</p>
          </button>
          <Link to="/deck" className="lobby-tile">
            <span className="gem" />
            <h3>Deck Manager</h3>
            <p>View your card collection and add new cards.</p>
          </Link>
          <Link to="/friends" className="lobby-tile">
            <span className="gem" />
            <h3>Friends</h3>
            <p>Add players by email and manage friend requests.</p>
          </Link>
        </div>
      </div>
    </main>
  );
}
