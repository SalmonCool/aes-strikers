import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AETHER_TYPES, CARD_TYPES, EMPTY_CARD, IDOL_TYPES, STATUS_IDS, TYPE_ACTIONS, addCard, updateCard,
} from '../../firebase/db.js';
import { DEFAULT_CROP, MAX_ART_UPLOAD_BYTES, compressImage, loadArt } from '../../firebase/cardArt.js';
import Card from '../Card.jsx';
import ArtCropper from './ArtCropper.jsx';
import { hasNoHealth } from '../../game/zones.js';

function Select({ id, label, value, onChange, options }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="ui-select" value={value} onChange={onChange}>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  );
}

function NumberField({ id, label, value, onChange, disabled }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" min={0} max={9999} className="ui-input" value={value} onChange={onChange} disabled={disabled} />
    </div>
  );
}

const editableFields = (c) => ({
  title: c.title || '',
  cardType: c.cardType || EMPTY_CARD.cardType,
  typeAction: c.typeAction ?? EMPTY_CARD.typeAction,
  healthPlus: Boolean(c.healthPlus),
  inflictStatus: c.inflictStatus || '',
  inflictStacks: c.inflictStacks || 1,
  inflictOn: c.inflictOn || 'hit',
  damagePlus: Boolean(c.damagePlus),
  description: c.description || '',
  soulCost: c.soulCost ?? 0,
  health: c.health ?? 0,
  damage: c.damage ?? 0,
  block: c.block ?? 0,
  aetherType: c.aetherType || EMPTY_CARD.aetherType,
  idolType: c.idolType || EMPTY_CARD.idolType,
  artCrop: c.artCrop || DEFAULT_CROP,
});

// Create a new card (existing = null) or edit an existing one, including its art and crop.
export default function CardEditorModal({ uid, existing, onClose }) {
  const isEdit = Boolean(existing);
  const [card, setCard] = useState(() => editableFields(existing || EMPTY_CARD));
  const [artSrc, setArtSrc] = useState(''); // what the cropper/preview shows
  const [artChange, setArtChange] = useState(undefined); // undefined = unchanged, null = removed, string = new
  const [artBusy, setArtBusy] = useState(Boolean(existing?.art));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const set = (k) => (e) => setCard((c) => ({ ...c, [k]: e.target.value }));
  const setCrop = useCallback((artCrop) => setCard((c) => ({ ...c, artCrop })), []);

  // Load the card's current art so it can be re-cropped without re-uploading
  useEffect(() => {
    if (!existing?.art) return;
    let cancelled = false;
    loadArt(existing.art)
      .then((url) => !cancelled && setArtSrc(url))
      .catch(() => !cancelled && setError('Could not load the current art. You can still upload a new image.'))
      .finally(() => !cancelled && setArtBusy(false));
    return () => { cancelled = true; };
  }, [existing]);

  const pickArt = async (e) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError('Card art must be an image file.');
    if (file.size > MAX_ART_UPLOAD_BYTES) return setError('Card art must be 2 MB or smaller.');
    setError('');
    setArtBusy(true);
    try {
      const url = await compressImage(file);
      setArtSrc(url);
      setArtChange(url);
      setCrop(DEFAULT_CROP); // new image starts centered
    } catch (err) {
      console.error(err);
      setError('Could not read that image. Try a PNG, JPG or WebP file.');
    } finally {
      setArtBusy(false);
    }
  };

  const removeArt = () => {
    setArtSrc('');
    setArtChange(existing?.art ? null : undefined);
    setCrop(DEFAULT_CROP);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (isEdit) await updateCard(uid, existing, card, artChange);
      else await addCard(uid, card, artChange || '');
      onClose();
    } catch (err) {
      console.error(err);
      setError('Could not save the card. Try again.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="panel modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="card-editor-title">
        <h2 id="card-editor-title">{isEdit ? 'Edit Card' : 'Add a Card'}</h2>
        <div className="card-editor">
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="card-title">Card Title</label>
              <input id="card-title" className="ui-input" value={card.title} onChange={set('title')} required maxLength={40} autoFocus />
            </div>
            <div className="field-row">
              <Select id="card-type" label="Card Type" value={card.cardType} onChange={set('cardType')} options={CARD_TYPES} />
              <div className="field">
                <label htmlFor="card-action">Type Action</label>
                <select id="card-action" className="ui-select" value={card.typeAction} onChange={set('typeAction')}>
                  <option value="">(none)</option>
                  {TYPE_ACTIONS.map((o) => <option key={o}>{o}</option>)}
                </select>
              </div>
            </div>
            <div className="field-row three">
              <NumberField id="card-soul" label="SOUL Cost" value={card.soulCost} onChange={set('soulCost')} />
              <NumberField id="card-health" label={hasNoHealth(card) ? 'Health (none: Attack Cast)' : 'Health'} value={hasNoHealth(card) ? 0 : card.health} onChange={set('health')} disabled={hasNoHealth(card)} />
              <NumberField id="card-damage" label="Damage" value={card.damage} onChange={set('damage')} />
            </div>
            <div className="field-row">
              <NumberField id="card-block" label="Block (Defend / Body Armor)" value={card.block} onChange={set('block')} />
              <p className="field-help">Defend cards block this much when used as a COUNTER!. Body Armor reduces direct damage by this much.</p>
            </div>
            <div className="field-row three">
              <div className="field">
                <label htmlFor="card-inflict">Applies Status</label>
                <select id="card-inflict" className="ui-select" value={card.inflictStatus} onChange={set('inflictStatus')}>
                  <option value="">(none)</option>
                  {STATUS_IDS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                </select>
              </div>
              <NumberField id="card-inflict-stacks" label="Stacks" value={card.inflictStacks} onChange={set('inflictStacks')} />
              <div className="field">
                <label htmlFor="card-inflict-on">When</label>
                <select id="card-inflict-on" className="ui-select" value={card.inflictOn} onChange={set('inflictOn')} disabled={!card.inflictStatus}>
                  <option value="hit">Its damage lands</option>
                  <option value="direct">Direct attack declared</option>
                </select>
              </div>
            </div>
            <div className="check-row">
              <label><input type="checkbox" checked={card.healthPlus} onChange={(e) => setCard((c) => ({ ...c, healthPlus: e.target.checked }))} /> Health is variable (shows “+”)</label>
              <label><input type="checkbox" checked={card.damagePlus} onChange={(e) => setCard((c) => ({ ...c, damagePlus: e.target.checked }))} /> Damage is variable (shows “+”)</label>
            </div>
            <div className="field-row">
              <Select id="card-aether" label="Aether Type" value={card.aetherType} onChange={set('aetherType')} options={AETHER_TYPES} />
              <Select id="card-idol" label="Idol Type" value={card.idolType} onChange={set('idolType')} options={IDOL_TYPES} />
            </div>
            <div className="field">
              <label htmlFor="card-desc">Card Description</label>
              <textarea id="card-desc" className="ui-textarea" value={card.description} onChange={set('description')} maxLength={300} />
            </div>

            <div className="field art-field">
              <label>Primary Card Art (max 2 MB)</label>
              <div className="art-buttons">
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickArt} />
                <button type="button" className="ui-btn small" onClick={() => fileRef.current?.click()} disabled={artBusy}>
                  {artSrc ? 'Replace Image' : 'Upload Image'}
                </button>
                {artSrc && (
                  <button type="button" className="ui-btn danger small" onClick={removeArt} disabled={artBusy}>Remove Art</button>
                )}
                {artBusy && <span className="art-status">Processing…</span>}
              </div>
              {artSrc && <ArtCropper src={artSrc} crop={card.artCrop} onChange={setCrop} />}
            </div>

            {error && <p className="ui-msg error">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="ui-btn" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className="ui-btn primary" disabled={busy || artBusy}>
                {busy ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Card'}
              </button>
            </div>
          </form>
          <div className="card-preview" aria-label="Live preview">
            <Card card={{ ...card, health: hasNoHealth(card) ? 0 : card.health, art: null, artUrl: artSrc }} />
          </div>
        </div>
      </div>
    </div>
  );
}
