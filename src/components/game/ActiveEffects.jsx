import { useState } from 'react';
import { activeEffectsFor } from '../../game/engine.js';

const ORDER = { hinder: 0, buff: 1, pending: 2, idle: 3 };
const KIND_LABEL = { buff: 'Buff', hinder: 'Hindrance', pending: 'Coming up', idle: 'Inactive' };
const STORE_KEY = 'aes-effects-collapsed';

const readCollapsed = () => {
  try {
    return localStorage.getItem(STORE_KEY) === '1';
  } catch {
    return false;
  }
};

// Slim strip above the hand listing everything buffing or hindering you right now, so you can see it
// before you play. Hindrances first, then buffs, then things still to come. Collapses to just the counts.
export default function ActiveEffects({ game, me }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const effects = activeEffectsFor(game, me).sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  if (!effects.length) return null;

  const count = (k) => effects.filter((e) => e.kind === k).length;
  const toggle = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(STORE_KEY, c ? '0' : '1'); } catch { /* storage unavailable */ }
      return !c;
    });
  };

  return (
    <section className={`fx-strip ${collapsed ? 'collapsed' : ''}`} aria-label="Effects on you">
      <button className="fx-strip-toggle" onClick={toggle} aria-expanded={!collapsed} title={collapsed ? 'Show effects' : 'Hide effects'}>
        <span className="fx-strip-title">Effects</span>
        {count('buff') > 0 && <span className="fx-count buff" title="Buffs">{count('buff')}</span>}
        {count('hinder') > 0 && <span className="fx-count hinder" title="Hindrances">{count('hinder')}</span>}
        {count('pending') > 0 && <span className="fx-count pending" title="Coming up">{count('pending')}</span>}
        <span className="fx-caret" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <ul className="fx-chips">
          {effects.map((e) => (
            <li key={e.id} className={`fx-chip ${e.kind}`} title={`${KIND_LABEL[e.kind]} · ${e.source}: ${e.text}`}>
              <span className="fx-dot" aria-hidden="true" />
              <span className="fx-src">{e.source}</span>
              <span className="fx-text">{e.text}</span>
              <span className="sr-only"> ({KIND_LABEL[e.kind]})</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
