// One player's half of the board. Layout follows the reference playmat:
// 9-column grid (two narrow spacer columns: 3 and 6), 3 rows.
// The "strike" area (the big "Strike!" space) is where Attack and Defend cards are shown when cast.
export const ZONES = [
  { id: 'spatial', label: 'Spatial', col: 7, row: 1 },
  { id: 'aether', label: 'Aether', col: 8, row: 1 },
  { id: 'idol', label: 'Idol', col: 9, row: 1 },

  { id: 'latent-1', label: 'Latent', col: 1, row: 2 },
  { id: 'strike', label: 'Strike!', col: 2, row: 2, span: 3 },
  { id: 'latent-2', label: 'Latent', col: 5, row: 2 },
  { id: 'weapon', label: 'Weapon', col: 7, row: 2 },
  { id: 'shield', label: 'Shield', col: 8, row: 2 },
  { id: 'body-armor', label: 'Body Armor', col: 9, row: 2 },

  { id: 'discard', label: 'Discard', col: 1, row: 3 },
  { id: 'deck', label: 'Deck', col: 2, row: 3 },
  { id: 'ability-1', label: 'Ability Slot', col: 4, row: 3 },
  { id: 'ability-2', label: 'Ability Slot', col: 5, row: 3 },
  { id: 'incantation', label: 'Incantation', col: 7, row: 3, span: 3 },
];

export const zoneLabel = (id) => ({ 'ability-1': 'Ability Slot 1', 'ability-2': 'Ability Slot 2', 'latent-1': 'Latent Slot 1', 'latent-2': 'Latent Slot 2' })[id]
  || ZONES.find((z) => z.id === id)?.label || id;

export const MAX_INCANTATIONS = 3;
export const LATENT_ZONES = ['latent-1', 'latent-2'];
export const ABILITY_ZONES = ['ability-1', 'ability-2'];

// Zones cards can be placed into (piles, tokens and the strike area are not placement targets).
export const PLAYABLE_ZONES = ['spatial', 'weapon', 'shield', 'body-armor', ...LATENT_ZONES, ...ABILITY_ZONES, 'incantation'];

export const isLatentCard = (c) => c.typeAction === 'Latent';

// Which card types each zone accepts. Latent cards (any type) only go face-down into Latent slots.
const ZONE_TYPES = {
  spatial: 'Spatial',
  weapon: 'Weapon',
  shield: 'Shield',
  'body-armor': 'Body Armor',
  'ability-1': 'Ability',
  'ability-2': 'Ability',
  incantation: 'Incantation',
};

export function zoneAccepts(zoneId, card) {
  if (isLatentCard(card)) return LATENT_ZONES.includes(zoneId);
  return ZONE_TYPES[zoneId] === card.cardType;
}

// Attack and Defend cards (non-Latent) are cast from hand during STRIKE! / COUNTER!, never placed.
export const isCastCard = (c) => !isLatentCard(c) && (c.cardType === 'Attack' || c.cardType === 'Defend');

// Attack: Cast cards are spent the moment they're played, so they never have health.
export const hasNoHealth = (c) => c.cardType === 'Attack' && c.typeAction === 'Cast';
