import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import {
  AETHER_TYPES, CARD_TYPES, EMPTY_CARD, IDOL_TYPES, TYPE_ACTIONS, addCard, deleteCard, watchCards,
} from '../firebase/db.js';
import { MAX_ART_UPLOAD_BYTES, compressImage } from '../firebase/cardArt.js';
import Card from '../components/Card.jsx';
import ImportCardsModal from '../components/deck/ImportCardsModal.jsx';
import FormatGuideModal from '../components/deck/FormatGuideModal.jsx';


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

function NumberField({ id, label, value, onChange }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" min={0} max={9999} className="ui-input" value={value} onChange={onChange} />
    </div>
  );
}

function AddCardModal({ uid, onClose }) {
  const [card, setCard] = useState(EMPTY_CARD);
  const [artDataUrl, setArtDataUrl] = useState(''); // compressed image, also used as the preview
  const [artBusy, setArtBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setCard({ ...card, [k]: e.target.value });

  const pickArt = async (e) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    const reject = (msg) => {
      setError(msg);
      input.value = '';
    };
    if (!file.type.startsWith('image/')) return reject('Card art must be an image file.');
    if (file.size > MAX_ART_UPLOAD_BYTES) return reject('Card art must be 2 MB or smaller.');
    setError('');
    setArtBusy(true);
    try {
      setArtDataUrl(await compressImage(file));
    } catch (err) {
      console.error(err);
      reject('Could not read that image. Try a PNG, JPG or WebP file.');
    } finally {
      setArtBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await addCard(uid, card, artDataUrl);
      onClose();
    } catch (err) {
      console.error(err);
      setError('Could not save the card. Try again.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="panel modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="add-card-title">
        <h2 id="add-card-title">Add a Card</h2>
        <div className="card-editor">
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="card-title">Card Title</label>
              <input id="card-title" className="ui-input" value={card.title} onChange={set('title')} required maxLength={40} autoFocus />
            </div>
            <div className="field-row">
              <Select id="card-type" label="Card Type" value={card.cardType} onChange={set('cardType')} options={CARD_TYPES} />
              <Select id="card-action" label="Type Action" value={card.typeAction} onChange={set('typeAction')} options={TYPE_ACTIONS} />
            </div>
            <div className="field-row three">
              <NumberField id="card-soul" label="SOUL Cost" value={card.soulCost} onChange={set('soulCost')} />
              <NumberField id="card-health" label="Health" value={card.health} onChange={set('health')} />
              <NumberField id="card-damage" label="Damage" value={card.damage} onChange={set('damage')} />
            </div>
            <div className="field-row">
              <Select id="card-aether" label="Aether Type" value={card.aetherType} onChange={set('aetherType')} options={AETHER_TYPES} />
              <Select id="card-idol" label="Idol Type" value={card.idolType} onChange={set('idolType')} options={IDOL_TYPES} />
            </div>
            <div className="field">
              <label htmlFor="card-desc">Card Description</label>
              <textarea id="card-desc" className="ui-textarea" value={card.description} onChange={set('description')} maxLength={300} />
            </div>
            <div className="field">
              <label htmlFor="card-art">Primary Card Art (max 2 MB)</label>
              <input id="card-art" type="file" accept="image/*" className="ui-input" onChange={pickArt} disabled={artBusy} />
            </div>
            {error && <p className="ui-msg error">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="ui-btn" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className="ui-btn primary" disabled={busy || artBusy}>
                {busy ? 'Saving…' : artBusy ? 'Processing art…' : 'Add Card'}
              </button>
            </div>
          </form>
          <div className="card-preview" aria-label="Live preview">
            <Card card={{ ...card, artUrl: artDataUrl }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DeckManager() {
  const { user } = useAuth();
  const [cards, setCards] = useState(null);
  const [filter, setFilter] = useState('All');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [guide, setGuide] = useState(false);

  useEffect(() => watchCards(user.uid, setCards), [user.uid]);

  const shown = (cards || []).filter((c) => filter === 'All' || c.cardType === filter);

  return (
    <main className="page">
      <div className="page-inner">
        <header className="page-header">
          <div>
            <h1 className="page-title">Deck <span className="accent">Manager</span></h1>
            <p className="page-sub">{cards ? `${cards.length} card${cards.length === 1 ? '' : 's'} in your collection` : 'Loading…'}</p>
          </div>
          <Link to="/" className="ui-btn small">Back to Lobby</Link>
        </header>

        <section className="panel">
          <div className="deck-toolbar">
            <button className="ui-btn primary" onClick={() => setAdding(true)}>+ Add Card</button>
            <button className="ui-btn" onClick={() => setImporting(true)}>Import JSON</button>
            <button className="ui-btn" onClick={() => setGuide(true)}>Format Guide</button>
            <select className="ui-select" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by card type">
              <option>All</option>
              {CARD_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>

          {cards && shown.length === 0 && (
            <p className="empty">{cards.length === 0 ? 'No cards yet. Add your first card to begin.' : 'No cards of this type.'}</p>
          )}

          <div className="card-grid">
            {shown.map((c) => (
              <Card key={c.id} card={c}>
                <button
                  className="ui-btn danger small card-delete"
                  onClick={() => confirm(`Remove "${c.title}" from your collection?`) && deleteCard(user.uid, c)}
                >
                  Remove
                </button>
              </Card>
            ))}
          </div>
        </section>
      </div>

      {adding && <AddCardModal uid={user.uid} onClose={() => setAdding(false)} />}
      {importing && !guide && (
        <ImportCardsModal uid={user.uid} onClose={() => setImporting(false)} onOpenGuide={() => setGuide(true)} />
      )}
      {guide && <FormatGuideModal onClose={() => setGuide(false)} />}
    </main>
  );
}
