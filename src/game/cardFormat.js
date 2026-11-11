// The AES Strikers card JSON format, used for bulk import.
// This file is the single source of truth for the format guide, the validator, and the AI prompt.
import { AETHER_TYPES, CARD_TYPES, IDOL_TYPES, STATUS_IDS, TYPE_ACTIONS } from '../firebase/db.js';

export const FORMAT_ID = 'aes-strikers-cards';
export const FORMAT_VERSION = 1;
export const MAX_IMPORT_CARDS = 200;

// kind: 'string' | 'number' | 'enum' | 'url'
export const CARD_FIELDS = [
  { key: 'title', kind: 'string', required: true, max: 40,
    description: 'Card name shown in the banner at the top of the card.' },
  { key: 'cardType', kind: 'enum', required: true, values: CARD_TYPES,
    description: 'What kind of card this is. Shown on the left of the type tab above the description.' },
  { key: 'typeAction', kind: 'enum', required: false, default: '', values: TYPE_ACTIONS,
    description: 'How the card is used. Shown after the card type, e.g. "Ability: Equip". Leave empty for cards with no action, e.g. a plain "Spatial" or "Incantation".' },
  { key: 'soulCost', kind: 'number', required: false, default: 0, min: 0, max: 9999,
    description: 'SOUL resource cost to play the card. Shown in the top-left and bottom-right circles.' },
  { key: 'health', kind: 'number', required: false, default: 0, min: 0, max: 9999,
    description: 'Hit points of the card. Only cards with health above 0 can be targeted by attacks. Bottom-left of the art.' },
  { key: 'damage', kind: 'number', required: false, default: 0, min: 0, max: 9999,
    description: 'Damage dealt when this card attacks or counters. Bottom-right of the art.' },
  { key: 'block', kind: 'number', required: false, default: 0, min: 0, max: 9999,
    description: 'Defend cards: damage blocked when played as a COUNTER!. Body Armor: amount direct damage is reduced by. 0 for other cards.' },
  { key: 'healthPlus', kind: 'boolean', required: false, default: false,
    description: 'true if the printed health is variable and shows a "+", e.g. "40+".' },
  { key: 'damagePlus', kind: 'boolean', required: false, default: false,
    description: 'true if the printed damage is variable and shows a "+", e.g. "20+".' },
  { key: 'inflictStatus', kind: 'enum', required: false, default: '', values: STATUS_IDS,
    description: 'Status this card applies to the opponent when it attacks (applied automatically by the game). Leave empty for none.' },
  { key: 'inflictStacks', kind: 'number', required: false, default: 1, min: 1, max: 3,
    description: 'How many stacks of inflictStatus to apply (statuses still cap at their max).' },
  { key: 'inflictOn', kind: 'enum', required: false, default: 'hit', values: ['hit', 'direct'],
    description: '"hit": apply when the attack\'s damage lands. "direct": apply as soon as a direct attack on the player is declared.' },
  { key: 'aetherType', kind: 'enum', required: true, values: AETHER_TYPES,
    description: 'Elemental Aether affinity. Upper word in the top-right circle.' },
  { key: 'idolType', kind: 'enum', required: true, values: IDOL_TYPES,
    description: 'Emotional Idol affinity. Lower word in the top-right circle.' },
  { key: 'description', kind: 'string', required: false, default: '', max: 300,
    description: 'Rules text shown in the description box. Use \\n for line breaks.' },
  { key: 'artUrl', kind: 'url', required: false, default: '',
    description: 'Optional link to the primary card art (https:// image URL or data:image URL). The host must allow cross-origin downloads; otherwise the card imports without art and you can add art later.' },
];

export const EXAMPLE_FILE = {
  format: FORMAT_ID,
  version: FORMAT_VERSION,
  cards: [
    {
      title: 'Regenerating Carapace',
      cardType: 'Ability',
      typeAction: 'Equip',
      soulCost: 0,
      health: 50,
      damage: 0,
      aetherType: 'Air',
      idolType: 'Disgust',
      description: 'After 3 turns of this card being in play, return your "Armor Set" to an active state and discard this card.',
      artUrl: '',
    },
    {
      title: 'Ember Lance',
      cardType: 'Attack',
      typeAction: 'Cast',
      soulCost: 2,
      health: 0,
      damage: 40,
      damagePlus: true,
      aetherType: 'Fire',
      idolType: 'Anger',
      description: 'Deal 40 damage to a target with health.',
    },
  ],
};

export const exampleJson = () => JSON.stringify(EXAMPLE_FILE, null, 2);

// ---------- Validation ----------
const matchEnum = (value, values) =>
  values.find((v) => v.toLowerCase() === String(value).trim().toLowerCase());

// Returns { card, errors } where card is normalized (enums canonical-cased, defaults filled).
export function validateCard(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { card: null, errors: ['Entry is not an object.'] };

  const card = {};
  for (const f of CARD_FIELDS) {
    const v = raw[f.key];
    const missing = v === undefined || v === null || v === '';
    if (missing) {
      if (f.required) errors.push(`"${f.key}" is required.`);
      else card[f.key] = f.default;
      continue;
    }
    if (f.kind === 'string') {
      if (typeof v !== 'string') errors.push(`"${f.key}" must be text.`);
      else if (v.trim().length > f.max) errors.push(`"${f.key}" must be ${f.max} characters or fewer.`);
      else card[f.key] = v.trim();
    } else if (f.kind === 'number') {
      const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
      if (typeof n !== 'number' || !Number.isInteger(n)) errors.push(`"${f.key}" must be a whole number.`);
      else if (n < f.min || n > f.max) errors.push(`"${f.key}" must be between ${f.min} and ${f.max}.`);
      else card[f.key] = n;
    } else if (f.kind === 'enum') {
      const m = typeof v === 'string' ? matchEnum(v, f.values) : null;
      if (!m) errors.push(`"${f.key}" must be one of: ${f.values.join(', ')} (got "${v}").`);
      else card[f.key] = m;
    } else if (f.kind === 'boolean') {
      if (typeof v !== 'boolean') errors.push(`"${f.key}" must be true or false.`);
      else card[f.key] = v;
    } else if (f.kind === 'url') {
      if (typeof v !== 'string' || !/^(https:\/\/|data:image\/)/i.test(v.trim())) errors.push(`"${f.key}" must start with https:// or data:image/.`);
      else card[f.key] = v.trim();
    }
  }

  const known = new Set(CARD_FIELDS.map((f) => f.key));
  const unknown = Object.keys(raw).filter((k) => !known.has(k));
  if (unknown.length) errors.push(`Unknown field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.`);

  return { card: errors.length ? null : card, errors };
}

// Parses an import file's text. Accepts the full { format, version, cards } object or a bare array of cards.
// Returns { entries: [{ index, card, errors, label }], fileError }
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { entries: [], fileError: `Not valid JSON: ${e.message}` };
  }
  const list = Array.isArray(data) ? data : data?.cards;
  if (!Array.isArray(list)) return { entries: [], fileError: 'Expected a "cards" array (or a top-level array of cards).' };
  if (!Array.isArray(data) && data.format && data.format !== FORMAT_ID) {
    return { entries: [], fileError: `Unrecognized format "${data.format}". Expected "${FORMAT_ID}".` };
  }
  if (list.length === 0) return { entries: [], fileError: 'The "cards" array is empty.' };
  if (list.length > MAX_IMPORT_CARDS) return { entries: [], fileError: `Too many cards: ${list.length}. Import at most ${MAX_IMPORT_CARDS} entries at a time.` };

  return {
    entries: list.map((raw, index) => {
      const { card, errors } = validateCard(raw);
      return { index, card, errors, label: (raw && typeof raw.title === 'string' && raw.title) || `Card #${index + 1}` };
    }),
    fileError: null,
  };
}

// ---------- AI prompt ----------
export function buildAiPrompt() {
  const fieldLines = CARD_FIELDS.map((f) => {
    let rule;
    if (f.kind === 'enum') rule = `one of exactly: ${f.values.map((v) => `"${v}"`).join(', ')}`;
    else if (f.kind === 'number') rule = `whole number ${f.min}–${f.max}`;
    else if (f.kind === 'string') rule = `text, max ${f.max} characters`;
    else if (f.kind === 'boolean') rule = 'true or false';
    else rule = 'https:// image URL or data:image URL';
    const req = f.required ? 'REQUIRED' : `optional, default ${JSON.stringify(f.default)}`;
    return `- "${f.key}" (${req}; ${rule}): ${f.description}`;
  }).join('\n');

  return `You are helping me create cards for "AES Strikers", a 2-player fantasy card game. Convert the card ideas or card data I give you into JSON using the exact format below.

OUTPUT RULES
- Respond with ONLY a single JSON object, no commentary and no markdown code fences.
- Top level must be: { "format": "${FORMAT_ID}", "version": ${FORMAT_VERSION}, "cards": [ ... ] }
- Each entry in "cards" is one card object using ONLY these fields:
${fieldLines}
- Allowed values for enum fields are case-sensitive; use the spelling shown.
- Do not invent extra fields. Omit optional fields you have no value for (or use the default).
- Numbers must be plain integers, not strings.
- Keep "title" at 40 characters or fewer and "description" at 300 characters or fewer.
- Maximum ${MAX_IMPORT_CARDS} cards per file. List each distinct card once; copy counts are chosen later when building a deck.

GAME CONTEXT (to help you choose sensible values)
- Attack and Defend cards are cast from hand. Both can be played during COUNTER!: Attack cards subtract their "damage" from incoming damage, Defend cards subtract their "block".
- Attack cards with typeAction "Cast" have no health: always use 0 for their "health".
- Cards with typeAction "Latent" are set face-down (SOUL paid then) and revealed later.
- Shields absorb direct damage with their health; Body Armor reduces direct damage by its "block".
- A player can only play cards matching their chosen Aether and Idol types.
- "Soul" cards are resources: to play a card, the player discards SOUL cards from their hand equal to its "soulCost". A SOUL resource card itself uses cardType "Soul", no typeAction, and 0 for every number.
- Deck building: up to 4 copies per Attack, Defend and Ability card, 3 per Incantation, 2 per Spatial, and only 1 Body Armor per deck. Body Armor that leaves play is exhausted, not reshuffled.
- Players start with 400 health. Attacks are declared with "Attack" cards during the STRIKE! phase and deal their "damage".
- The defender may COUNTER! with an "Attack" card; its damage is subtracted from the incoming damage.
- Only cards with "health" above 0 can be targeted by attacks.
- "Body Armor" cards can be set before the match starts. "Equip" cards are placed on the board during the Equip phase.

EXAMPLE OUTPUT
${exampleJson()}

Here are the cards I want formatted:
`;
}
