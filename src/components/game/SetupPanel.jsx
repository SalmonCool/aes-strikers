import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { watchCards } from '../../firebase/db.js';
import Card from '../Card.jsx';

// Setup phase: pick an Idol card and an Aether card; the rest of the collection becomes the deck.
export default function SetupPanel({ uid, onReady }) {
  const [cards, setCards] = useState(null);
  const [step, setStep] = useState('idol');
  const [idol, setIdol] = useState(null);
  const [aether, setAether] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => watchCards(uid, setCards), [uid]);

  const pick = (id) => {
    if (step === 'idol') {
      setIdol(id);
      if (aether === id) setAether(null);
      setStep('aether');
    } else {
      if (id === idol) return;
      setAether(id);
    }
  };

  const ready = async () => {
    setBusy(true);
    try {
      await onReady(cards, idol, aether);
    } finally {
      setBusy(false);
    }
  };

  const title = (id) => cards?.find((c) => c.id === id)?.title;

  return (
    <div className="modal-backdrop">
      <div className="panel modal modal-wide setup-panel" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <h2 id="setup-title">Setup Phase</h2>
        {cards && cards.length < 2 ? (
          <>
            <p className="setup-hint">You need at least 2 cards in your collection to play (one Idol, one Aether).</p>
            <Link to="/deck" className="ui-btn primary">Go to Deck Manager</Link>
          </>
        ) : (
          <>
            <div className="setup-steps">
              <button className={`setup-step ${step === 'idol' ? 'active' : ''}`} onClick={() => setStep('idol')}>
                Idol: <strong>{title(idol) || 'choose…'}</strong>
              </button>
              <button className={`setup-step ${step === 'aether' ? 'active' : ''}`} onClick={() => setStep('aether')}>
                Aether: <strong>{title(aether) || 'choose…'}</strong>
              </button>
            </div>
            <p className="setup-hint">
              Select a card for your <strong>{step === 'idol' ? 'Idol' : 'Aether'}</strong>. All remaining cards become your shuffled deck.
            </p>
            <div className="setup-grid">
              {(cards || []).map((c) => (
                <button
                  key={c.id}
                  className={`setup-card ${c.id === idol ? 'is-idol' : ''} ${c.id === aether ? 'is-aether' : ''}`}
                  onClick={() => pick(c.id)}
                  disabled={step === 'aether' && c.id === idol}
                >
                  <Card card={c} />
                  {c.id === idol && <span className="setup-tag">Idol</span>}
                  {c.id === aether && <span className="setup-tag">Aether</span>}
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="ui-btn primary" disabled={!idol || !aether || busy} onClick={ready}>
                {busy ? 'Shuffling…' : 'Ready'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
