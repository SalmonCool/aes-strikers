// Player tokens and the resources they earn.
//
// Each player places one token at setup: a Hero or a Villain. A token decides
//   - which cards the player can play (cards carry the token id they belong to), and
//   - which resource the player earns each turn. Heroes earn SOUL; Villains earn SHADOW or DRIVE.
// All resources work exactly like SOUL (same per-turn income and banking); only the look and name differ.
//
// Hero variations are separate tokens: the same hero with a different emotion than the main one
// (e.g. a future { id: 'linx-anger', name: 'Linx', emotion: 'Anger', ... }).

// Resource themes. `colors` drive the aura, gems and cost orbs (see the CSS variables in PlayerIcon.css / ui.css).
export const RESOURCES = {
  soul: { id: 'soul', label: 'SOUL', name: 'Soul' },
  shadow: { id: 'shadow', label: 'SHADOW', name: 'Shadow' },
  drive: { id: 'drive', label: 'DRIVE', name: 'Drive' },
};

export const EMOTIONS = ['Anger', 'Fear', 'Sadness', 'Disgust', 'Happiness', 'Surprise'];

// kind: 'hero' | 'villain'
// legacy: the old [Aether, Idol] pair cards used before tokens, so older saved cards still find their token.
export const TOKENS = [
  { id: 'linx', name: 'Linx', kind: 'hero', emotion: 'Disgust', resource: 'soul', legacy: ['Wind', 'Disgust'] },
  { id: 'dremur', name: 'Dremur', kind: 'hero', emotion: 'Happiness', resource: 'soul', legacy: ['Earth', 'Happiness'] },
  // Villains go here, e.g.:
  // { id: 'name', name: 'Name', kind: 'villain', emotion: 'Fear', resource: 'shadow' },
];

export const tokenById = (id) => TOKENS.find((t) => t.id === id) || null;

// The token a card belongs to: its `token` field, or one matched from older Aether/Idol fields.
export const cardTokenId = (card) => {
  if (!card) return null;
  if (card.token && tokenById(card.token)) return card.token;
  return TOKENS.find((t) => t.legacy && t.legacy[0] === card.aetherType && t.legacy[1] === card.idolType)?.id || null;
};

// "Linx · Disgust", or a fallback for cards with no recognised token.
export const tokenLabel = (id) => {
  const t = tokenById(id);
  return t ? `${t.name} · ${t.emotion}` : 'No token';
};

// The resource a token earns (SOUL when unknown, e.g. matches from before tokens).
export const resourceOf = (tokenId) => RESOURCES[tokenById(tokenId)?.resource] || RESOURCES.soul;
