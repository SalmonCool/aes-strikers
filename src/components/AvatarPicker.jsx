import { useEffect, useRef, useState } from 'react';
import { avatarOf, setAvatar, watchProfile } from '../firebase/db.js';
import { MAX_ART_UPLOAD_BYTES, compressAvatar } from '../firebase/cardArt.js';
import PlayerIcon from './PlayerIcon.jsx';

// Lobby control for the player's icon (shown with their SOUL aura in the arena).
export default function AvatarPicker({ uid, name }) {
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef(null);

  useEffect(() => watchProfile(uid, setProfile), [uid]);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/')) return setError('Choose an image file.');
    if (file.size > MAX_ART_UPLOAD_BYTES) return setError('That image is over 2 MB.');
    setBusy(true);
    try {
      await setAvatar(uid, await compressAvatar(file));
    } catch (err) {
      console.error(err);
      setError('Could not save your icon.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await setAvatar(uid, '');
    } catch (err) {
      console.error(err);
      setError('Could not remove your icon.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="avatar-picker">
      <button
        type="button"
        className="avatar-picker-btn"
        onClick={() => input.current?.click()}
        disabled={busy}
        title="Change your player icon"
        aria-label="Change your player icon"
      >
        <PlayerIcon src={avatarOf(profile)} name={name} size={64} />
        <span className="avatar-picker-edit">{busy ? '…' : 'Edit'}</span>
      </button>
      <div className="avatar-picker-actions">
        <span className="avatar-picker-label">Player icon</span>
        {profile?.avatar && (
          <button type="button" className="link-btn" onClick={remove} disabled={busy}>Remove</button>
        )}
        {error && <span className="ui-msg error small">{error}</span>}
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={pick} />
    </div>
  );
}
