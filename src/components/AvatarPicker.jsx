import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import {
  MAX_NAME_LENGTH, avatarCropOf, avatarOf, cleanDisplayName, displayNameOf, saveAvatar, watchProfile,
} from '../firebase/db.js';
import { DEFAULT_CROP, MAX_ART_UPLOAD_BYTES, compressAvatar } from '../firebase/cardArt.js';
import ArtCropper from './deck/ArtCropper.jsx';
import PlayerIcon from './PlayerIcon.jsx';

// Lobby profile control: the player's icon (shown with their SOUL aura in the arena).
// Clicking it opens a window to change the display name, upload an icon and frame it.
export default function AvatarPicker() {
  const { user } = useAuth();
  const uid = user.uid;
  const name = displayNameOf(user);
  const [profile, setProfile] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => watchProfile(uid, setProfile), [uid]);

  return (
    <>
      <button
        type="button"
        className="avatar-picker-btn"
        onClick={() => setOpen(true)}
        title="Edit your name and player icon"
        aria-label="Edit your name and player icon"
      >
        <PlayerIcon src={avatarOf(profile)} crop={avatarCropOf(profile)} name={name} size={64} />
        <span className="avatar-picker-edit">Edit</span>
      </button>
      {open && <ProfileModal profile={profile} onClose={() => setOpen(false)} />}
    </>
  );
}

function ProfileModal({ profile, onClose }) {
  const { user, updateDisplayName } = useAuth();
  const [name, setName] = useState(displayNameOf(user));
  // Image being edited: undefined = unchanged, '' = removed, data URL = newly uploaded
  const [newImage, setNewImage] = useState(undefined);
  const [crop, setCrop] = useState(avatarCropOf(profile));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef(null);

  const custom = newImage !== undefined ? newImage : profile?.avatar || '';
  const shown = custom || (newImage === '' ? profile?.photoURL : avatarOf(profile)) || '';

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/')) return setError('Choose an image file.');
    if (file.size > MAX_ART_UPLOAD_BYTES) return setError('That image is over 2 MB.');
    try {
      setNewImage(await compressAvatar(file));
      setCrop(DEFAULT_CROP);
    } catch (err) {
      console.error(err);
      setError('Could not read that image.');
    }
  };

  const save = async (e) => {
    e.preventDefault();
    const clean = cleanDisplayName(name);
    if (!clean) return setError('Enter a display name.');
    setBusy(true);
    setError('');
    try {
      if (clean !== displayNameOf(user)) await updateDisplayName(clean);
      await saveAvatar(user.uid, newImage, crop);
      onClose();
    } catch (err) {
      console.error(err);
      setError('Could not save your profile. Check your connection and try again.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="panel modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <h2 id="profile-title">Your Profile</h2>
        <form onSubmit={save}>
          <label className="field">
            <span className="field-label">Display name</span>
            <input
              className="ui-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME_LENGTH}
              required
              autoFocus
            />
          </label>

          <div className="field">
            <span className="field-label">Player icon</span>
            {custom ? (
              <ArtCropper src={custom} crop={crop} onChange={setCrop} round />
            ) : (
              <div className="profile-icon-empty">
                <PlayerIcon src={shown} name={name} size={120} />
                <p className="cropper-hint">
                  {shown ? 'Using your sign-in photo. Upload an image to use and frame your own.' : 'Upload an image to use as your icon.'}
                </p>
              </div>
            )}
            <div className="art-buttons">
              <button type="button" className="ui-btn small" onClick={() => input.current?.click()} disabled={busy}>
                {custom ? 'Change image' : 'Upload image'}
              </button>
              {custom && (
                <button type="button" className="ui-btn small" onClick={() => setNewImage('')} disabled={busy}>Remove</button>
              )}
              <span className="art-status">Max 2 MB</span>
            </div>
            <input ref={input} type="file" accept="image/*" hidden onChange={pick} />
          </div>

          {custom && (
            <div className="profile-preview" aria-hidden="true">
              <PlayerIcon src={custom} crop={crop} name={name} soul={4} size={56} />
              <span>Arena preview</span>
            </div>
          )}

          {error && <p className="ui-msg error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="ui-btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="ui-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
