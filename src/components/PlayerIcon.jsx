import './PlayerIcon.css';

// Brightest the aura gets; SOUL beyond this keeps the aura at full strength.
export const AURA_MAX_SOUL = 10;

// Round player portrait. With `soul` set, a blue spirit-flame aura surrounds it:
// each banked SOUL makes the aura a step larger and brighter, and spending SOUL dims it by the same step.
export default function PlayerIcon({ src, name = '', soul = null, size = 56, className = '' }) {
  const level = soul === null ? 0 : Math.min(soul, AURA_MAX_SOUL) / AURA_MAX_SOUL;
  const initial = (name.trim()[0] || '?').toUpperCase();
  return (
    <span
      className={`player-icon ${soul !== null ? 'has-aura' : ''} ${soul > 0 ? 'lit' : ''} ${className}`}
      style={{ '--size': `${size}px`, '--soul': level }}
      title={soul !== null ? `${name} · ${soul} SOUL` : name}
    >
      {soul !== null && (
        <span className="pi-aura" aria-hidden="true">
          <span className="pi-flame f1" />
          <span className="pi-flame f2" />
          <span className="pi-glow" />
        </span>
      )}
      <span className="pi-frame">
        {src ? <img src={src} alt="" draggable="false" referrerPolicy="no-referrer" /> : <span className="pi-initial">{initial}</span>}
      </span>
    </span>
  );
}
