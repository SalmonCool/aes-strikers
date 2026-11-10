import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { acceptFriendRequest, removeFriendship, sendFriendRequest, watchFriendships } from '../firebase/db.js';

function FriendRow({ name, note, children }) {
  return (
    <li className="friend-row">
      <span className="friend-avatar" aria-hidden="true">{(name || '?')[0].toUpperCase()}</span>
      <span className="friend-name">{name}{note && <small>{note}</small>}</span>
      <span className="friend-actions">{children}</span>
    </li>
  );
}

export default function Friends() {
  const { user } = useAuth();
  const [list, setList] = useState(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => watchFriendships(user.uid, setList), [user.uid]);

  const otherName = (f) => f.names?.[f.members.find((m) => m !== user.uid)] || 'Player';
  const friends = (list || []).filter((f) => f.status === 'accepted');
  const incoming = (list || []).filter((f) => f.status === 'pending' && f.requestedBy !== user.uid);
  const outgoing = (list || []).filter((f) => f.status === 'pending' && f.requestedBy === user.uid);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const target = await sendFriendRequest(user, email);
      setMsg({ type: 'info', text: `Friend request sent to ${target.displayName}.` });
      setEmail('');
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'Could not send request.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = (f, verb) => confirm(`${verb} ${otherName(f)}?`) && removeFriendship(f.id);

  return (
    <main className="page">
      <div className="page-inner">
        <header className="page-header">
          <div>
            <h1 className="page-title"><span className="accent">Friends</span></h1>
            <p className="page-sub">{list ? `${friends.length} friend${friends.length === 1 ? '' : 's'}` : 'Loading…'}</p>
          </div>
          <Link to="/" className="ui-btn small">Back to Lobby</Link>
        </header>

        <section className="panel">
          <h2>Add a Friend</h2>
          <form className="friend-add" onSubmit={submit}>
            <input
              type="email"
              className="ui-input"
              placeholder="Friend's email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button className="ui-btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send Request'}</button>
          </form>
          {msg && <p className={`ui-msg ${msg.type} friend-add-msg`}>{msg.text}</p>}
        </section>

        {incoming.length > 0 && (
          <section className="panel">
            <h2>Requests ({incoming.length})</h2>
            <ul className="friend-list">
              {incoming.map((f) => (
                <FriendRow key={f.id} name={otherName(f)} note="wants to be your friend">
                  <button className="ui-btn primary small" onClick={() => acceptFriendRequest(f.id)}>Accept</button>
                  <button className="ui-btn danger small" onClick={() => removeFriendship(f.id)}>Decline</button>
                </FriendRow>
              ))}
            </ul>
          </section>
        )}

        <section className="panel">
          <h2>Your Friends</h2>
          {list && friends.length === 0 && <p className="empty">No friends yet. Send a request above.</p>}
          <ul className="friend-list">
            {friends.map((f) => (
              <FriendRow key={f.id} name={otherName(f)}>
                <button className="ui-btn danger small" onClick={() => remove(f, 'Remove')}>Remove</button>
              </FriendRow>
            ))}
          </ul>
        </section>

        {outgoing.length > 0 && (
          <section className="panel">
            <h2>Sent Requests</h2>
            <ul className="friend-list">
              {outgoing.map((f) => (
                <FriendRow key={f.id} name={otherName(f)} note="pending">
                  <button className="ui-btn small" onClick={() => remove(f, 'Cancel request to')}>Cancel</button>
                </FriendRow>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
