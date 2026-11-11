// Small synthesized sound effects (Web Audio), so no audio files need to be loaded.
let ctx = null;

const MUTE_KEY = 'aes-strikers:muted';
export function isMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}
export function setMuted(muted) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // storage unavailable (private mode etc.) — mute just won't persist
  }
}

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  // Browsers suspend audio until the page has had a user interaction; resume is a no-op otherwise
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(ac, freq, start, duration, { type = 'triangle', volume = 0.18 } = {}) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

// ---------- Custom sound files (public/sounds) ----------
// Each effect looks for a user-supplied file; missing files fall back to the synthesized sound.
const SOUND_FILES = {
  turnStart: ['/sounds/sword-draw-effect.mp3', '/sounds/turn-start.mp3', '/sounds/turn-start.ogg', '/sounds/turn-start.wav'],
};
const resolved = {}; // name -> Promise<url | null>

// Finds the first candidate that is really an audio file. (Missing files return the app's
// index.html with a 200 status on both Vite and Vercel, so the content type is checked.)
function findSound(name) {
  if (!(name in resolved)) {
    resolved[name] = (async () => {
      for (const url of SOUND_FILES[name]) {
        try {
          const res = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
          if (res.ok && (res.headers.get('content-type') || '').startsWith('audio/')) return url;
        } catch {
          // network error: try the next candidate
        }
      }
      return null;
    })();
  }
  return resolved[name];
}

// Plays a custom sound file if one exists; otherwise runs `fallback`.
async function playFileOr(name, fallback) {
  if (isMuted()) return;
  const url = await findSound(name);
  if (url) {
    try {
      await new Audio(url).play();
      return;
    } catch {
      // autoplay blocked or decode error: fall through to the synthesized sound
    }
  }
  fallback();
}

// Start looking up custom sounds early so the first play has no delay.
export const preloadSounds = () => Object.keys(SOUND_FILES).forEach(findSound);

// "It's your turn": custom turn-start file if supplied, else a bright rising arpeggio.
export function playTurnChime() {
  playFileOr('turnStart', synthTurnChime);
}

function synthTurnChime() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.02;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(ac, f, t + i * 0.09, 0.5));
  tone(ac, 2093, t + 0.36, 0.7, { type: 'sine', volume: 0.06 });
}
