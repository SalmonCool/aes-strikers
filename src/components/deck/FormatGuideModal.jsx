import { useState } from 'react';
import { CARD_FIELDS, FORMAT_ID, FORMAT_VERSION, MAX_IMPORT_CARDS, buildAiPrompt, exampleJson } from '../../game/cardFormat.js';

function CopyButton({ text, label, primary }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this text:', text);
    }
  };
  return (
    <button type="button" className={`ui-btn small ${primary ? 'primary' : ''}`} onClick={copy}>
      {copied ? 'Copied!' : label}
    </button>
  );
}

function downloadTemplate() {
  const blob = new Blob([exampleJson()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'aes-strikers-cards-template.json';
  a.click();
  URL.revokeObjectURL(url);
}

const allowed = (f) => {
  if (f.kind === 'enum') return f.values.join(', ');
  if (f.kind === 'number') return `Whole number ${f.min}–${f.max}`;
  if (f.kind === 'string') return `Text, up to ${f.max} characters`;
  if (f.kind === 'boolean') return 'true or false';
  return 'https:// or data:image/ URL';
};

export default function FormatGuideModal({ onClose }) {
  const prompt = buildAiPrompt();

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel modal modal-wide format-guide" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <div className="guide-head">
          <h2 id="guide-title">Card Format Guide</h2>
          <button className="ui-btn small" onClick={onClose}>Close</button>
        </div>

        <section className="guide-section">
          <h3>File structure</h3>
          <p>
            A JSON object with <code>"format": "{FORMAT_ID}"</code>, <code>"version": {FORMAT_VERSION}</code>, and a{' '}
            <code>"cards"</code> array. A plain array of cards is also accepted. Up to {MAX_IMPORT_CARDS} entries per import.
            Values for list fields are matched without regard to capitalization.
          </p>
        </section>

        <section className="guide-section">
          <h3>Fields</h3>
          <div className="guide-table-wrap">
            <table className="guide-table">
              <thead>
                <tr><th>Field</th><th>Required</th><th>Allowed values</th><th>Description</th></tr>
              </thead>
              <tbody>
                {CARD_FIELDS.map((f) => (
                  <tr key={f.key}>
                    <td><code>{f.key}</code></td>
                    <td>{f.required ? 'Yes' : <span className="muted">No (default {JSON.stringify(f.default)})</span>}</td>
                    <td>{allowed(f)}</td>
                    <td>{f.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="guide-section">
          <div className="guide-row">
            <h3>Example</h3>
            <div className="guide-actions">
              <CopyButton text={exampleJson()} label="Copy example" />
              <button type="button" className="ui-btn small" onClick={downloadTemplate}>Download template</button>
            </div>
          </div>
          <pre className="guide-code">{exampleJson()}</pre>
        </section>

        <section className="guide-section guide-ai">
          <div className="guide-row">
            <h3>Using AI</h3>
            <CopyButton text={prompt} label="Copy AI prompt" primary />
          </div>
          <p>
            Paste this prompt into any AI assistant, followed by your card ideas, a list, or a spreadsheet export.
            It returns JSON in this exact format, ready to paste into <strong>Import Cards</strong>. Always
            click <strong>Validate</strong> before importing, since AI output can contain mistakes.
          </p>
          <details>
            <summary>Preview prompt</summary>
            <pre className="guide-code">{prompt}</pre>
          </details>
        </section>
      </div>
    </div>
  );
}
