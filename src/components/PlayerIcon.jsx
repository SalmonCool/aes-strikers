import { AVATAR_ZOOM, cropStyle } from '../firebase/cardArt.js';
import './PlayerIcon.css';

// Brightest the aura gets; SOUL beyond this keeps the aura at full strength.
export const AURA_MAX_SOUL = 10;
const FREEZE_CRYSTALS = 3; // Freeze stacks, plus Frostbite at max Freeze as the third crystal
const STUN_STARS = 5;

// Round player portrait. With `soul` set, a blue spirit-flame aura surrounds it:
// each banked SOUL makes the aura a step larger and brighter, and spending SOUL dims it by the same step.
// `crop` frames the image ({ x, y, zoom }, same as card art).
// `status` ({ burn, purge, freeze, frostbite, stun }) adds an effect per active status:
//   Burn: a red-orange wisp circles the icon every few seconds.
//   Purge: a bright teal flame surges up through the icon every few seconds.
//   Freeze: one ice crystal per stack (Frostbite adds a third); crystals melt away as stacks are lost.
//   Stun: stars swirl around the icon until it wears off.
export default function PlayerIcon({ src, crop, name = '', soul = null, status = null, size = 56, className = '' }) {
  const level = soul === null ? 0 : Math.min(soul, AURA_MAX_SOUL) / AURA_MAX_SOUL;
  const initial = (name.trim()[0] || '?').toUpperCase();
  const s = status || {};
  const crystals = Math.min(FREEZE_CRYSTALS, (s.freeze || 0) + (s.frostbite ? 1 : 0));
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
        {src ? <img src={src} alt="" draggable="false" referrerPolicy="no-referrer" style={cropStyle(crop, AVATAR_ZOOM)} /> : <span className="pi-initial">{initial}</span>}
      </span>

      {status && (
        <span className="pi-status" aria-hidden="true">
          {s.burn > 0 && <span className="pi-burn"><span className="pi-wisp" /></span>}
          {s.purge > 0 && <span className="pi-purge"><span className="pi-surge" /></span>}
          {/* Crystals stay mounted so losing a stack plays the melt transition */}
          {Array.from({ length: FREEZE_CRYSTALS }, (_, i) => (
            <span key={i} className={`pi-crystal c${i + 1} ${i < crystals ? 'on' : ''}`} />
          ))}
          {s.stun && (
            <span className="pi-stun">
              {Array.from({ length: STUN_STARS }, (_, i) => (
                <span key={i} className="pi-star-arm" style={{ '--i': i, '--n': STUN_STARS }}><span className="pi-star" /></span>
              ))}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
