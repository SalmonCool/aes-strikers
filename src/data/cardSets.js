// Built-in card sets, transcribed from "Linx, Veil Walker Set V.1.pdf" and "Dremur Deck V.1.pdf".
// Players build decks by choosing cards (and copy counts) from these sets and their own "My Cards" set.
// Sets ship with the app (not Firestore), so they're read-only.
// Card ids are kept stable ("default-linx-01"...) because saved decks reference them.
// Stats shown as "20+" on the printed card are stored as the base number with damagePlus/healthPlus = true.

// Block values, taken from each card's "Reduce incoming/direct damage by X" text.
const BLOCK = {
  Reflex: 40, 'Flatside Nail': 40, Translucence: 40, 'Brace For Impact!': 30, "Prowler's Cloak": 50,
  'Fly! Illy!': 40, 'Summon Illy!': 40, 'Diamond Carapace': 80, Refraction: 40, 'Hidden Carapace': 20,
};

const card = (deckId, aetherType, idolType) => (index, title, cardType, typeAction, soulCost, health, damage, description, extra = {}) => ({
  id: `${deckId}-${String(index).padStart(2, '0')}`,
  title,
  cardType,
  typeAction,
  soulCost,
  health,
  damage,
  block: BLOCK[title] || 0,
  aetherType,
  idolType,
  description,
  healthPlus: false,
  damagePlus: false,
  inflictStatus: '',
  inflictStacks: 1,
  inflictOn: 'hit',
  art: null,
  readOnly: true,
  ...extra,
});

const L = card('default-linx', 'Wind', 'Disgust');
const D = card('default-dremur', 'Earth', 'Happiness');

const LINX_CARDS = [
  L(1, 'Just a Touch', 'Ability', 'Equip', 0, 0, 0,
    'Whenever an attack successfully does damage, search your deck for a "Nail" card and put it into your hand.'),
  L(2, 'Skewer', 'Ability', 'Equip', 0, 40, 0,
    'If a "Nail" card is in play, increase all direct damage dealt by 20.'),
  L(3, 'Instant Reposition', 'Ability', 'Equip', 0, 60, 0,
    'Once during your STRIKE! phase, if you play an attack that costs SOUL!, choose one SOUL! card to retain from the selected card and add it into your hand.'),
  L(4, 'Start! Hunt!', 'Ability', 'Equip', 0, 70, 0,
    'This can only take effect once per turn. When an opponent draws a card outside of their draw phase, draw one card.'),
  L(5, 'Reflex', 'Defend', 'Cast', 0, 0, 0,
    'Reduce incoming damage by 40. If "Instinct" is in play, this card gains the same roll effect.'),
  L(6, 'Flatside Nail', 'Defend', 'Latent', 0, 80, 0,
    'Increase the effect of "Defend" cards by 40.\n\nDetonate: This effect can only take place during the COUNTER phase. Increase this card\'s value by 40 and use it to defend. Discard this card after use.'),
  L(7, 'Translucence', 'Defend', 'Cast', 0, 0, 0,
    'Reduce incoming damage by 40. You can choose to sacrifice 10 HP. If so, increase the cost of this card by 20.'),
  L(8, 'Illusionary Wind', 'Spatial', '', 0, 50, 0,
    'When an attack is fully blocked or countered, refund one SOUL! card from the selected attack to your hand.'),
  L(9, 'Purrgatory', 'Spatial', '', 0, 50, 10,
    'If you have the "Purge" status effect, increase damage done by 10.'),
  L(10, 'Strikethrough', 'Attack', 'Cast', 3, 0, 70,
    'Deal 70 damage. If the opponent declares COUNTER!, deal 30 damage directly to the opponent. This additional damage ignores the COUNTER! interaction and cannot be increased.'),
  L(11, 'Springboard', 'Attack', 'Cast', 1, 0, 20,
    'Deal 20 damage. Deal an additional 20 damage for each card with "Nail" in its name in play.', { damagePlus: true }),
  L(12, 'Nail', 'Attack', 'Latent', 2, 40, 40,
    'Nail: When this card is in play, reduce the SOUL! cost of attacks by 1. When this card is discarded, deal 20 damage directly. This damage ignores damage reduction.\n-Detonate: On the caster\'s STRIKE! phase they can choose to discard this card. If this is done, deal 40 damage directly. This damage cannot be boosted or negated.'),
  L(13, 'Veil Piercer', 'Ability', 'Equip', 2, 50, 40,
    'Discard all "Nail" cards in play, increase the damage of this card by 20 for each card discarded in this way. Deal 40 damage and apply one stack of Purge to the opponent for each "Nail" discarded in this way.', { damagePlus: true }),
  L(14, 'MEENOS!', 'Incantation', '', 0, 50, 0,
    'Retain cards that would otherwise be discarded.\n\nOnly 1 Incantation can be played per turn.'),
  L(15, 'GRANT ME!', 'Incantation', '', 0, 50, 0,
    'Only 1 Incantation may be played per turn.'),
  L(16, 'AGILITY!', 'Incantation', '', 0, 50, 0,
    'Draw additional cards on your draw phase equal to the amount of "Nail" cards in play.\n\nOnly 1 Incantation may be played per turn.'),
  L(17, 'Permeable Paws', 'Weapon', 'Equip', 0, 50, 0,
    'When equipped allows the user to ignore the damage reduction effect of the opponents Armor Set.'),
  L(18, 'Instinct', 'Shield', 'Equip', 0, 80, 0,
    'This effect can only be used once per turn. If damage is declared directly, roll a die. If even, reduce damage by 80. If odd, nullify all damage declared.'),
  L(19, "Prowler's Cloak", 'Body Armor', '', 0, 100, 0,
    'Draw 1 additional card during your draw phase, reduce direct damage by 50.'),
  L(20, 'Brace For Impact!', 'Defend', 'Cast', 0, 50, 0,
    'Reduce incoming damage by 30. Roll a die. If odd, negate any remaining damage.'),
];

const DREMUR_CARDS = [
  D(1, 'Regenerating Carapace', 'Ability', 'Equip', 0, 0, 0,
    'After 3 turns of this card being in play, return your "Armor Set" to an active state and discard this card.'),
  D(2, 'Chain Of Command-Illy', 'Ability', 'Equip', 2, 60, 0,
    'If the card "Summon Inty" is in play, discard it. "Summon Inty" cannot be played while this card is in play. Reduce direct damage by 20. If "Summon Inty" was discarded due to this card\'s effect, add the card\'s value to this card.'),
  D(3, 'Chain of Command-Inty', 'Ability', 'Equip', 2, 60, 20,
    'If the card "Summon Illy" is in play, discard it. "Summon Illy" cannot be played while this card is in play. Increase all damage done by 20. If "Summon Illy" was discarded due to this card\'s effect, add the card\'s value to this card.',
    { damagePlus: true }),
  D(4, 'Rending Carapace', 'Ability', 'Equip', 1, 40, 20,
    'When targeting equipped items, increase damage by 20. Increase this damage by 10 for each active card containing the name "Inty".',
    { damagePlus: true }),
  D(5, 'Wand Of Command', 'Weapon', 'Equip', 0, 40, 40,
    'Increase the power of "Summon Inty" and "Summon Illy" by 40 as long as this card is active.'),
  D(6, 'Little Buddy', 'Shield', 'Equip', 0, 40, 0,
    'This card receives all direct damage declared until destroyed.'),
  D(7, 'Hidden Carapace', 'Body Armor', 'Equip', 0, 100, 0,
    'Reduce direct damage by 20. Increase damage reduced by the damage counters on this card.'),
  D(8, 'Fly! Illy!', 'Defend', 'Cast', 1, 40, 0,
    'Reduce incoming damage by 40. When "Summon Illy" is in play, add that card\'s value to this card.',
    { healthPlus: true }),
  D(9, 'Summon Illy!', 'Defend', 'Latent', 3, 60, 0,
    'During the opponent\'s STRIKE! phase, reduce incoming damage by 40. Increase damage reduced by 20 for each turn this card is active.'),
  D(10, 'Diamond Carapace', 'Defend', 'Cast', 3, 80, 0,
    'Diamond Carapace: Reduce incoming direct damage by 80. If incoming damage exceeds 80, take 30 damage instead and discard a card.'),
  D(11, 'Refraction', 'Defend', 'Cast', 1, 40, 20,
    'Reduce incoming damage by 40. When damage exceeds 40, deal 20 damage to all opponent\'s equip cards.'),
  D(12, 'Churning Constriction', 'Attack', 'Cast', 2, 0, 50,
    'Deal 50 damage. If the target has the stun status, discard a random card from their hand and deal 10 damage to all of the opponent\'s equip cards.'),
  D(13, 'Summon Inty', 'Attack', 'Latent', 1, 80, 40,
    'During the STRIKE! phase, freely apply 40 damage. Increase this card\'s damage by 10 each time it is attacked.',
    { damagePlus: true }),
  D(14, 'Crashing Mandibles', 'Attack', 'Cast', 3, 0, 50,
    'Deal 50 damage. If the opponent has active "Body Armor", deal 30 to the "Body Armor". If "Chain of Command-Inty" is in play, increase damage dealt to "Body Armor" by 10.',
    { damagePlus: true }),
  D(15, 'Reckless Lunge', 'Attack', 'Cast', 1, 0, 40,
    'Deal 40 damage. Inflict stun if a direct attack is declared. Discard a card from your hand and search your deck for a "Churning Constriction" card.',
    { inflictStatus: 'stun', inflictOn: 'direct' }),
  D(16, 'Chain of Command: Gravity', 'Spatial', '', 0, 0, 0,
    'Any player suffering the "Stun" status loses an extra card on dice roll.'),
  D(17, 'Maxees!', 'Incantation', '', 0, 0, 0,
    'Reduce the SOUL! cost of all cards played by the player by 1.\n\nIncantations can only be played once per turn.'),
  D(18, 'Grant Me!', 'Incantation', '', 0, 0, 0,
    'Incantations can only be played once per turn.'),
  D(19, 'STRENGTH!', 'Incantation', '', 0, 0, 40,
    'Strength: Increase damage of all attacks declared by 40.\n\nIncantations can only be played once per turn.'),
  D(20, 'Tilled Earth', 'Spatial', '', 0, 0, 0,
    'Each player draws 1 additional card during their draw phase.'),
];

export const CARD_SETS = [
  { id: 'set-linx', name: 'Linx, Veil Walker', builtIn: true, aetherType: 'Wind', idolType: 'Disgust', cards: LINX_CARDS },
  { id: 'set-dremur', name: 'Dremur', builtIn: true, aetherType: 'Earth', idolType: 'Happiness', cards: DREMUR_CARDS },
];

// Starter deck recipe for a set: one copy of every card. (SOUL is gained each turn, not drawn.)
export const starterDeckCards = (set) => Object.fromEntries(set.cards.map((c) => [c.id, 1]));
