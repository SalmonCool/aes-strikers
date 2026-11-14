// Deck-building rules.
//
// Per-card copy limits by type (e.g. up to 4 copies of "Strikethrough").
// Some types are also capped across the whole deck (e.g. 2 Weapons total, any mix, duplicates allowed).
// SOUL is not a deck card: players gain it every turn. Old decks may still list SOUL / Soul-type cards;
// those entries are ignored everywhere below.
export const COPY_LIMITS = {
  Attack: 4,
  Defend: 4,
  Spatial: 2,
  Ability: 4,
  Incantation: 3,
};
export const TYPE_TOTAL_LIMITS = {
  'Body Armor': 1,
  Weapon: 2,
  Shield: 2,
};
export const BODY_ARMOR_PER_DECK = TYPE_TOTAL_LIMITS['Body Armor'];
export const DECK_SIZE_LIMIT = 30;

const isSoul = (card) => card.cardType === 'Soul';
// The deck's card for an entry id, or null if it no longer exists or is a legacy SOUL card.
const deckCard = (catalog, id) => (catalog[id] && !isSoul(catalog[id]) ? catalog[id] : null);

export const copyLimitFor = (card) => COPY_LIMITS[card.cardType] ?? TYPE_TOTAL_LIMITS[card.cardType] ?? 4;

export function limitLabel(card) {
  const total = TYPE_TOTAL_LIMITS[card.cardType];
  if (total) return `${total} ${card.cardType} per deck`;
  return `max ${copyLimitFor(card)}`;
}

const countWhere = (entries, catalog, pred) =>
  Object.entries(entries).reduce((sum, [id, n]) => (n > 0 && deckCard(catalog, id) && pred(id, catalog[id]) ? sum + n : sum), 0);

// The most copies of `card` this deck may hold, given everything else in it.
export function maxCopiesInDeck(card, entries, catalog) {
  if (isSoul(card)) return 0;
  const current = entries[card.id] || 0;
  let max = copyLimitFor(card);
  const typeCap = TYPE_TOTAL_LIMITS[card.cardType];
  if (typeCap) {
    const others = countWhere(entries, catalog, (id, c) => id !== card.id && c.cardType === card.cardType);
    max = Math.min(max, typeCap - others);
  }
  const used = countWhere(entries, catalog, () => true);
  max = Math.min(max, current + (DECK_SIZE_LIMIT - used));
  return Math.max(0, max);
}

// Summary + problems for a deck. Unknown card ids (e.g. a deleted custom card) and legacy SOUL cards are ignored.
export function validateDeck(entries, catalog) {
  const errors = [];
  const byType = {};
  let size = 0;

  for (const [id, count] of Object.entries(entries || {})) {
    const card = deckCard(catalog, id);
    if (!card || !(count > 0)) continue;
    size += count;
    byType[card.cardType] = (byType[card.cardType] || 0) + count;
    if (!TYPE_TOTAL_LIMITS[card.cardType] && count > copyLimitFor(card)) {
      errors.push(`"${card.title}": ${count} copies (max ${copyLimitFor(card)}).`);
    }
  }
  for (const [type, cap] of Object.entries(TYPE_TOTAL_LIMITS)) {
    if ((byType[type] || 0) > cap) errors.push(`${byType[type]} ${type} cards (max ${cap} per deck).`);
  }
  if (size > DECK_SIZE_LIMIT) errors.push(`${size} cards (max ${DECK_SIZE_LIMIT}).`);
  if (size === 0) errors.push('The deck is empty.');

  return { total: size, size, byType, errors, valid: errors.length === 0 };
}

// Expands { cardId: count } into an array of card objects (one per copy) for a match.
export const expandDeck = (entries, catalog) =>
  Object.entries(entries || {}).flatMap(([id, n]) => (deckCard(catalog, id) && n > 0 ? Array(n).fill(catalog[id]) : []));
