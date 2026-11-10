import { useState } from 'react';
import { addCard } from '../../firebase/db.js';
import { MAX_ART_UPLOAD_BYTES, compressImage } from '../../firebase/cardArt.js';
import { parseImport } from '../../game/cardFormat.js';

// Downloads an art URL and compresses it. Throws a readable message on failure.
async function fetchArt(url) {
  let blob;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
  } catch {
    throw new Error('could not download art (the host may block cross-origin downloads)');
  }
  if (!blob.type.startsWith('image/')) throw new Error('art URL is not an image');
  if (blob.size > MAX_ART_UPLOAD_BYTES) throw new Error('art is larger than 2 MB');
  return compressImage(blob);
}

export default function ImportCardsModal({ uid, deckId, deckName, onClose, onOpenGuide }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState(null); // { entries, fileError }
  const [progress, setProgress] = useState(null); // { done, total }
  const [result, setResult] = useState(null); // { added, warnings: [] }
  const [error, setError] = useState('');

  const valid = parsed?.entries.filter((e) => e.card) || [];
  const invalid = parsed?.entries.filter((e) => !e.card) || [];
  const totalCopies = valid.reduce((n, e) => n + e.card.copies, 0);
  const importing = progress && !result;

  const loadFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const t = await file.text();
    setText(t);
    setParsed(parseImport(t));
    setResult(null);
  };

  const validate = () => {
    setParsed(parseImport(text));
    setResult(null);
  };

  const runImport = async () => {
    setError('');
    const warnings = [];
    let added = 0;
    setProgress({ done: 0, total: totalCopies });
    try {
      for (const { card } of valid) {
        const { copies, artUrl, ...fields } = card;
        let art = '';
        if (artUrl) {
          try {
            art = await fetchArt(artUrl);
          } catch (err) {
            warnings.push(`"${card.title}": imported without art — ${err.message}.`);
          }
        }
        for (let i = 0; i < copies; i++) {
          await addCard(uid, deckId, fields, art);
          added += 1;
          setProgress({ done: added, total: totalCopies });
        }
      }
    } catch (err) {
      console.error(err);
      setError(`Import stopped after ${added} card${added === 1 ? '' : 's'}: ${err.message || 'save failed'}.`);
    }
    setResult({ added, warnings });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !importing && onClose()}>
      <div className="panel modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <h2 id="import-title">Import Cards into “{deckName}”</h2>

        {!result && (
          <>
            <p className="import-hint">
              Upload a <code>.json</code> file or paste JSON below.{' '}
              <button type="button" className="link-btn" onClick={onOpenGuide}>View the format guide</button>
            </p>
            <div className="import-input">
              <input type="file" accept=".json,application/json" className="ui-input" onChange={loadFile} disabled={importing} />
              <textarea
                className="ui-textarea import-text"
                placeholder='{ "format": "aes-strikers-cards", "version": 1, "cards": [ ... ] }'
                value={text}
                onChange={(e) => { setText(e.target.value); setParsed(null); }}
                spellCheck={false}
                disabled={importing}
              />
            </div>
          </>
        )}

        {parsed?.fileError && <p className="ui-msg error">{parsed.fileError}</p>}

        {parsed && !parsed.fileError && !result && (
          <div className="import-preview">
            <p className="import-summary">
              <span className="ok">{valid.length} valid</span>
              {invalid.length > 0 && <span className="bad">{invalid.length} with errors (will be skipped)</span>}
              <span>{totalCopies} card{totalCopies === 1 ? '' : 's'} will be added</span>
            </p>
            <ul className="import-list">
              {parsed.entries.map((e) => (
                <li key={e.index} className={e.card ? 'ok' : 'bad'}>
                  <span className="import-mark" aria-hidden="true">{e.card ? '✓' : '✕'}</span>
                  <span className="import-name">
                    {e.label}
                    {e.card && <small>{e.card.cardType}: {e.card.typeAction} · {e.card.aetherType}/{e.card.idolType}{e.card.copies > 1 ? ` · ×${e.card.copies}` : ''}{e.card.artUrl ? ' · art' : ''}</small>}
                    {e.errors.map((err) => <small key={err} className="import-err">{err}</small>)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {progress && !result && (
          <div className="import-progress">
            <div className="import-bar"><div style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
            <span>Importing {progress.done} / {progress.total}…</span>
          </div>
        )}

        {result && (
          <div className="import-result">
            <p className="ui-msg info">Added {result.added} card{result.added === 1 ? '' : 's'} to “{deckName}”.</p>
            {result.warnings.length > 0 && (
              <ul className="import-warnings">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            )}
          </div>
        )}
        {error && <p className="ui-msg error">{error}</p>}

        <div className="modal-actions">
          {result ? (
            <button className="ui-btn primary" onClick={onClose}>Done</button>
          ) : (
            <>
              <button className="ui-btn" onClick={onClose} disabled={importing}>Cancel</button>
              {!parsed ? (
                <button className="ui-btn primary" onClick={validate} disabled={!text.trim()}>Validate</button>
              ) : (
                <button className="ui-btn primary" onClick={runImport} disabled={importing || valid.length === 0}>
                  {importing ? 'Importing…' : `Import ${totalCopies} Card${totalCopies === 1 ? '' : 's'}`}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
