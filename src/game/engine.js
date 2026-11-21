// Game rules engine. All state changes run as Firestore transactions so both players stay in sync.
//
// Public state lives on the session doc as `game` (both players can read it):
//   phase: 'setup' | 'start' | 'draw' | 'equip' | 'strike' | 'over'
//   round, turnNo (increments every turn), turn (uid), first (uid), winner (uid|null)
//   players: { [uid]: { name, health, ready, dealt, deckCount, handCount, soul, turnsTaken,
//                       token, incantationTurn, status } }
//     soul: banked SOUL. Each of the player's turns adds min(turnsTaken, SOUL_INCOME_CAP); unspent SOUL carries over.
//     status: { burn 0-3, purge 0-3, freeze 0-2, frostbite 0-1, stun: null | { by } }
//   board:   { [uid]: { [zoneId]: card | { faceDown: true } , incantation: card[] } }
//   discard: { [uid]: card[] }
//   exhausted: { [uid]: card[] }   (Body Armor that left play: never reshuffled into the deck)
//   attack:  null | { id, by, defender, card, fromLatent, damage, target, targetTitle, status: 'open'|'countering', at }
//   clash:   null | { by, defender, attackCard, counterCard }   (shown in the Strike! areas until the turn ends)
//   rolls:   [{ id, by, value, reason, outcome, at }]   (most recent die rolls, animated on both screens)
// Private state (only the owner can read): sessions/{id}/hands/{uid}
//   { deck: card[], hand: card[], dealt, latent: { [zoneId]: card } }   (latent = the real face-down cards)
// Event log: sessions/{id}/log/{auto}  { text, kind, uid, at }
import { collection, doc, limitToLast, onSnapshot, orderBy, query, runTransaction } from 'firebase/firestore';
import { db } from '../firebase/config.js';
import { ABILITY_ZONES, LATENT_ZONES, MAX_INCANTATIONS, PLAYABLE_ZONES, hasNoHealth, isLatentCard, zoneAccepts, zoneLabel } from './zones.js';
import { cardTokenId, resourceOf, tokenById, tokenLabel } from './tokens.js';

export const STARTING_HEALTH = 400;
export const OPENING_HAND = 6;
export const DRAW_PER_TURN = 3;
export const FREEZE_DRAW_LIMIT = 2;
export const COUNTER_WINDOW_MS = 4000;
const STATUS_DAMAGE_PER_STACK = 10;
export const SOUL_INCOME_CAP = 6; // SOUL gained per turn ramps 1, 2, 3… up to this
export const soulIncome = (turnsTaken) => Math.min(Math.max(turnsTaken, 1), SOUL_INCOME_CAP);

export const PHASES = [
  { id: 'setup', label: 'Setup', repeats: false },
  { id: 'start', label: 'Start', repeats: false },
  { id: 'draw', label: 'Draw', repeats: true },
  { id: 'equip', label: 'Equip', repeats: true },
  { id: 'strike', label: 'STRIKE!', repeats: true },
];

export const STATUSES = [
  { id: 'burn', label: 'Burn', max: 3, detonate: true,
    desc: 'Deals 10 damage per stack at the start of the affected player’s turn. Can be detonated for 10 damage per stack.' },
  { id: 'purge', label: 'Purge', max: 3, detonate: true,
    desc: 'Deals 10 damage per stack at the start of the affected player’s turn. Can be detonated. At the end of their turn, cleanses every status except Purge.' },
  { id: 'freeze', label: 'Freeze', max: 2,
    desc: 'Limits the Draw phase to at most 2 cards. At the start of their turn, roll a die: on even, remove one stack.' },
  { id: 'frostbite', label: 'Frostbite', max: 1,
    desc: 'Only applicable at max Freeze. Cannot draw during the Draw phase. Cleansed at the end of their turn.' },
  { id: 'stun', label: 'Stun', max: 1,
    desc: 'Max 1 stack. At the start of their turn the stunned player rolls a die. Even: the player who stunned them picks one of their hand cards at random to discard. Wears off at the end of that turn.' },
];
const statusDef = (id) => STATUSES.find((s) => s.id === id);

const emptyStatus = () => ({ burn: 0, purge: 0, freeze: 0, frostbite: 0, stun: null });
export const statusOf = (game, uid) => ({ ...emptyStatus(), ...(game.players[uid]?.status || {}) });

export const newPlayer = (name) => ({
  name,
  health: STARTING_HEALTH,
  ready: false,
  dealt: false,
  deckCount: 0,
  handCount: 0,
  soul: 0,
  turnsTaken: 0,
  token: null, // Hero/Villain token (game/tokens.js): decides playable cards and the resource earned
  incantationTurn: -1,
  status: emptyStatus(),
});

export const newGame = (hostUid, hostName) => ({
  phase: 'setup',
  round: 0,
  turnNo: 0,
  turn: null,
  first: hostUid, // host takes the first turn
  winner: null,
  players: { [hostUid]: newPlayer(hostName) },
  board: { [hostUid]: {} },
  discard: { [hostUid]: [] },
  exhausted: { [hostUid]: [] },
  attack: null,
  clash: null,
});

export const opponentOf = (game, uid) => Object.keys(game.players).find((u) => u !== uid) || null;

const sessionRef = (sid) => doc(db, 'sessions', sid);
const handRef = (sid, uid) => doc(db, 'sessions', sid, 'hands', uid);
const logCol = (sid) => collection(db, 'sessions', sid, 'log');

const emptyHand = () => ({ deck: [], hand: [], dealt: false, latent: {} });

// ---------- Subscriptions ----------
export const watchHand = (sid, uid, cb) =>
  onSnapshot(handRef(sid, uid), (s) => cb(s.exists() ? { ...emptyHand(), ...s.data() } : emptyHand()));

export const watchLog = (sid, cb) =>
  onSnapshot(query(logCol(sid), orderBy('at'), limitToLast(300)), (s) =>
    cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

// ---------- Card helpers (also used by the UI) ----------
// Legacy SOUL resource cards (decks used to hold them). They're dropped when a deck is shuffled for a match.
export const isSoulCard = (c) => c.cardType === 'Soul';
// What `card` costs uid right now, after ongoing discounts (e.g. face-up "Nail": Attacks cost 1 less each).
export const soulCostFor = (game, uid, card) => {
  let cost = card.soulCost || 0;
  if (card.cardType === 'Attack') cost -= latentPassiveTotal(game, uid, 'attack-discount');
  cost -= incantationTotal(game, uid, 'cost-discount'); // Incantation tier (e.g. Maxees! Turn 1)
  return Math.max(0, cost);
};
export const canAfford = (game, uid, card) => (game?.players[uid]?.soul || 0) >= soulCostFor(game, uid, card);

// A card can only be played if it belongs to the player's token (legacy SOUL cards are neutral).
export const affinityOk = (player, card) =>
  isSoulCard(card) || (Boolean(playerToken(player)) && cardTokenId(card) === playerToken(player));
// A player's token; arenas from before tokens stored an Aether/Idol pair instead, which maps the same way.
export const playerToken = (player) => player?.token || cardTokenId(player);
// The resource label ("SOUL", "SHADOW", "DRIVE") uid earns.
export const resourceLabel = (game, uid) => resourceOf(game?.players?.[uid]?.token).label;

// The value a card contributes when played as a COUNTER!: Defend cards block, Attack cards strike back.
export const counterValue = (card) => (card.cardType === 'Defend' ? card.block || 0 : card.damage || 0);

// Zones that can hold a new card over the one already there (the old card is discarded).
const REPLACEABLE_ZONES = ['spatial', ...LATENT_ZONES, ...ABILITY_ZONES];

// Zones this card may legally be placed into right now (empty, or replaceable).
export function validZonesFor(game, uid, card) {
  if (isSoulCard(card) || chainLock(game, uid, card)) return [];
  const board = game.board[uid] || {};
  const player = game.players[uid];
  const zones = game.phase === 'start' ? ['body-armor'] : PLAYABLE_ZONES;
  return zones.filter((z) => {
    if (!zoneAccepts(z, card)) return false;
    if (z === 'incantation') {
      return (board.incantation || []).length < MAX_INCANTATIONS && player.incantationTurn !== game.turnNo;
    }
    // Ability, Spatial and Latent cards may replace the card already in that zone; the old one is discarded
    if (REPLACEABLE_ZONES.includes(z) && game.phase === 'equip') return true;
    return !board[z];
  });
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const MAX_ROLLS_KEPT = 6;
// Rolls a die for a card or status effect. Each roll is recorded on the game so both
// players' screens can show the dice animation. outcome(value) describes what the roll did.
function rollDie(ctx, uid, reason, outcome) {
  const value = 1 + Math.floor(Math.random() * 6);
  const rolls = (ctx.game.rolls ||= []);
  rolls.push({ id: crypto.randomUUID(), by: uid, value, reason, outcome: outcome ? outcome(value) : '', at: Date.now() });
  if (rolls.length > MAX_ROLLS_KEPT) rolls.splice(0, rolls.length - MAX_ROLLS_KEPT);
  return value;
}

// Copy of a deck card for use in a match (each copy gets a unique instance id).
const toPlayable = (c) => ({
  iid: crypto.randomUUID(),
  cardId: c.id,
  title: c.title || 'Untitled',
  cardType: c.cardType,
  typeAction: c.typeAction || '',
  description: c.description || '',
  soulCost: Number(c.soulCost) || 0,
  health: hasNoHealth(c) ? 0 : Number(c.health) || 0,
  baseHealth: hasNoHealth(c) ? 0 : Number(c.health) || 0,
  damage: Number(c.damage) || 0,
  baseDamage: Number(c.damage) || 0,
  block: Number(c.block) || 0,
  baseBlock: Number(c.block) || 0,
  healthPlus: Boolean(c.healthPlus),
  damagePlus: Boolean(c.damagePlus),
  token: cardTokenId(c),
  art: c.art || null,
  artCrop: c.artCrop || null,
  inflictStatus: c.inflictStatus || '',
  inflictStacks: Number(c.inflictStacks) || 1,
  inflictOn: c.inflictOn || 'hit',
});

// Reset in-play state when a card returns to the deck from the discard pile.
const freshCopy = (c) => {
  const { revealed, usedTurn, turnsActive, ...rest } = c; // eslint-disable-line no-unused-vars
  return { ...rest, health: c.baseHealth ?? c.health, damage: c.baseDamage ?? c.damage, block: c.baseBlock ?? c.block };
};

const fail = (msg) => {
  throw new Error(msg);
};

// Runs `fn(ctx)` inside a transaction. fn mutates ctx.game / ctx.hand and calls ctx.log().
// Returning false from fn means "nothing to do" (used for idempotent auto-actions).
function act(sid, uid, fn, { withHand = false } = {}) {
  return runTransaction(db, async (tx) => {
    const sSnap = await tx.get(sessionRef(sid));
    if (!sSnap.exists()) fail('Arena not found.');
    const game = structuredClone(sSnap.data().game);
    let hand = null;
    if (withHand) {
      const h = await tx.get(handRef(sid, uid));
      hand = { ...emptyHand(), ...(h.exists() ? h.data() : {}) };
    }
    const logs = [];
    const ctx = {
      game,
      hand,
      uid,
      name: (u) => game.players[u]?.name || 'Player',
      log: (text, kind = 'info') => logs.push({ text, kind }),
    };

    if (fn(ctx) === false) return false;

    if (withHand && ctx.hand) {
      const p = game.players[uid];
      p.deckCount = ctx.hand.deck.length;
      p.handCount = ctx.hand.hand.length;
      tx.set(handRef(sid, uid), ctx.hand);
    }
    tx.update(sessionRef(sid), { game });
    const now = Date.now();
    logs.forEach((l, i) => tx.set(doc(logCol(sid)), { ...l, uid, at: now + i }));
    return true;
  });
}

const findInHand = (ctx, iid) => ctx.hand.hand.find((c) => c.iid === iid) || fail('That card is no longer in your hand.');

const takeFromHand = (ctx, iid) => {
  const i = ctx.hand.hand.findIndex((c) => c.iid === iid);
  if (i < 0) fail('That card is no longer in your hand.');
  return ctx.hand.hand.splice(i, 1)[0];
};

const pushDiscard = (ctx, uid, card) => (ctx.game.discard[uid] ||= []).push(card);

// A card leaving play: Body Armor is exhausted (out of the game for good); everything else is discarded.
function removeFromPlay(ctx, uid, card) {
  if (card.cardType === 'Body Armor') {
    ((ctx.game.exhausted ||= {})[uid] ||= []).push(card);
    ctx.log(`"${card.title}" is exhausted and will not return to the deck.`, 'damage');
  } else {
    pushDiscard(ctx, uid, card);
  }
  // "When this card is discarded" effects (e.g. Nail: 20 direct damage that ignores damage reduction)
  const hit = effectOf(card).onDiscardDirect;
  const opp = hit ? opponentOf(ctx.game, uid) : null;
  if (opp) {
    ctx.log(`"${card.title}" is discarded and strikes ${ctx.name(opp)} directly!`, 'attack');
    damagePlayer(ctx, opp, hit, `"${card.title}" (ignores damage reduction)`);
  }
}

const ensureStatus = (game, uid) => {
  const p = game.players[uid];
  p.status = { ...emptyStatus(), ...(p.status || {}) };
  return p.status;
};

const bothReady = (game) =>
  Object.keys(game.players).length === 2 && Object.values(game.players).every((p) => p.ready);

// Spends banked SOUL to pay for `card`. Throws if the player can't afford it.
function paySoul(ctx, card) {
  const cost = soulCostFor(ctx.game, ctx.uid, card);
  const discount = (card.soulCost || 0) - cost;
  if (discount > 0) ctx.log(`"${card.title}" costs ${discount} less ${resourceLabel(ctx.game, ctx.uid)} thanks to ongoing effects.`);
  if (cost <= 0) return;
  const p = ctx.game.players[ctx.uid];
  const available = p.soul || 0;
  if (available < cost) fail(`"${card.title}" costs ${cost} ${resourceLabel(ctx.game, ctx.uid)}, but you only have ${available}.`);
  p.soul = available - cost;
  ctx.log(`${ctx.name(ctx.uid)} spent ${cost} ${resourceLabel(ctx.game, ctx.uid)} on "${card.title}" (${p.soul} left).`);
}

// Start of a player's turn: SOUL income ramps 1, 2, 3… per turn, capped at SOUL_INCOME_CAP. Unspent SOUL is kept.
function gainSoul(ctx, uid) {
  const p = ctx.game.players[uid];
  p.turnsTaken = (p.turnsTaken || 0) + 1;
  const gain = soulIncome(p.turnsTaken);
  p.soul = (p.soul || 0) + gain;
  ctx.log(`${ctx.name(uid)} gains ${gain} ${resourceLabel(ctx.game, uid)} (${p.soul} banked).`);
}

function requireAffinity(ctx, card) {
  const p = ctx.game.players[ctx.uid];
  if (!affinityOk(p, card)) {
    fail(`"${card.title}" belongs to ${tokenLabel(cardTokenId(card))}, but your token is ${tokenLabel(p.token)}.`);
  }
}

// Draws up to n cards; when the deck runs out the discard pile is reshuffled into a new deck.
function drawCards(ctx, n) {
  const { hand, game, uid } = ctx;
  let drawn = 0;
  while (drawn < n) {
    if (hand.deck.length === 0) {
      const pile = game.discard[uid] || [];
      if (pile.length === 0) break;
      hand.deck = shuffle(pile.map(freshCopy));
      game.discard[uid] = [];
      ctx.log(`${ctx.name(uid)}'s deck ran out — the discard pile (${hand.deck.length}) was reshuffled into a new deck.`);
    }
    hand.hand.push(hand.deck.shift());
    drawn++;
  }
  if (drawn > 0) onOpponentDrew(ctx, uid);
  return drawn;
}

// "Start! Hunt!": once per turn, when uid's opponent draws, uid draws one card too.
// uid's deck is private, so the draw is queued and their own client carries it out.
function onOpponentDrew(ctx, drawer) {
  const { game } = ctx;
  if (game.phase === 'setup' || game.phase === 'start') return; // not for opening hands
  const hunter = opponentOf(game, drawer);
  if (!hunter) return;
  faceUpWith(game, hunter, 'drawOnOpponentDraw').forEach((c) => {
    if (c.usedTurn === game.turnNo) return;
    c.usedTurn = game.turnNo;
    const p = game.players[hunter];
    p.pendingDraws = (p.pendingDraws || 0) + effectOf(c).drawOnOpponentDraw;
    ctx.log(`"${c.title}": ${ctx.name(drawer)} drew, so ${ctx.name(hunter)} draws a card too.`);
  });
}

function damagePlayer(ctx, uid, amount, source) {
  const p = ctx.game.players[uid];
  const before = p.health;
  p.health = Math.max(0, p.health - amount);
  ctx.log(`${ctx.name(uid)} takes ${amount} damage from ${source} (${before} → ${p.health}).`, 'damage');
}

// Ends the match if anyone has hit 0 health. Returns true if the game is over.
function checkDefeat(ctx) {
  const { game } = ctx;
  if (game.phase === 'over') return true;
  const loser = Object.keys(game.players).find((u) => game.players[u].health <= 0);
  if (!loser) return false;
  game.phase = 'over';
  game.winner = opponentOf(game, loser);
  game.attack = null;
  ctx.log(`${ctx.name(game.winner)} wins the match!`, 'victory');
  return true;
}

// ---------- Setup ----------
// Player picks a deck plus their Hero/Villain token; the whole deck is shuffled.
export function setupReady(sid, uid, deckCards, token) {
  return act(sid, uid, (ctx) => {
    const { game } = ctx;
    if (game.phase !== 'setup') fail('Setup is already over.');
    if (game.players[uid].ready) return false;
    if (!tokenById(token)) fail('Choose your token.');
    const playable = deckCards.filter((c) => !isSoulCard(c)); // SOUL is no longer a deck card
    if (playable.length === 0) fail('That deck has no cards.');

    const deck = shuffle(playable.map(toPlayable));
    ctx.hand = { deck, hand: [], dealt: false, latent: {} };
    game.board[uid] = { incantation: [] };
    game.discard[uid] = [];
    (game.exhausted ||= {})[uid] = [];
    Object.assign(game.players[uid], { token, ready: true, status: emptyStatus() });
    const t = tokenById(token);
    ctx.log(`${ctx.name(uid)} placed the ${t.kind === 'villain' ? 'Villain' : 'Hero'} token ${tokenLabel(token)} (earns ${resourceOf(token).label}) and shuffled a ${deck.length}-card deck.`);

    if (bothReady(game)) {
      game.phase = 'start';
      Object.values(game.players).forEach((p) => { p.ready = false; });
      ctx.log(`Start phase: both players draw ${OPENING_HAND} cards and may set Body Armor.`, 'phase');
    }
  }, { withHand: true });
}

// ---------- Start ----------
export function dealOpeningHand(sid, uid) {
  return act(sid, uid, (ctx) => {
    if (ctx.game.phase !== 'start' || ctx.hand.dealt) return false;
    const n = drawCards(ctx, OPENING_HAND);
    ctx.hand.dealt = true;
    ctx.game.players[uid].dealt = true;
    ctx.log(`${ctx.name(uid)} drew ${n} cards.`);
  }, { withHand: true });
}

export function startReady(sid, uid) {
  return act(sid, uid, (ctx) => {
    const { game } = ctx;
    if (game.phase !== 'start') fail('Not in the Start phase.');
    if (!game.players[uid].dealt) fail('Your opening hand has not been dealt yet.');
    if (game.players[uid].ready) return false;
    game.players[uid].ready = true;
    ctx.log(`${ctx.name(uid)} is ready.`);

    if (bothReady(game)) {
      Object.values(game.players).forEach((p) => { p.ready = false; });
      game.round = 1;
      game.turnNo = 1;
      game.turn = game.first;
      game.phase = 'equip'; // no Draw phase in round 1
      ctx.log(`Round 1 — ${ctx.name(game.first)} takes the first turn. (No Draw phase in round 1.)`, 'phase');
      gainSoul(ctx, game.first);
      ctx.log(`${ctx.name(game.first)}'s Equip phase.`, 'phase');
    }
  });
}

// ---------- Placing cards ----------
export function placeCard(sid, uid, iid, zoneId) {
  return act(sid, uid, (ctx) => {
    const { game } = ctx;
    const card = findInHand(ctx, iid);
    if (isSoulCard(card)) fail('SOUL cards are no longer played. SOUL is gained each turn.');

    if (game.phase === 'start') {
      if (game.players[uid].ready) fail('You have already readied up.');
      if (card.cardType !== 'Body Armor') fail('Only Body Armor can be set during the Start phase.');
    } else if (game.phase === 'equip') {
      if (game.turn !== uid) fail("It's not your turn.");
      if (game.attack) fail('Resolve the current attack first.');
      if (game.pendingPick?.by === uid) fail('Pick the card to discard first.');
      if (game.pendingPick?.target === uid) fail('Wait for your opponent to pick the card you discard.');
    } else {
      fail('Cards can only be equipped during the Equip phase.');
    }

    requireAffinity(ctx, card);
    const lock = chainLock(game, uid, card);
    if (lock) fail(`"${card.title}" can't be played while "${lock.title}" is in play.`);
    if (!validZonesFor(game, uid, card).includes(zoneId)) {
      if (zoneId === 'incantation' && game.players[uid].incantationTurn === game.turnNo) fail('Only 1 Incantation can be played per turn.');
      fail(`"${card.title}" can't be placed in ${zoneLabel(zoneId)}.`);
    }

    paySoul(ctx, card);
    takeFromHand(ctx, iid);
    const board = game.board[uid];

    if (isLatentCard(card)) {
      // Replacing a Latent card (face-down or revealed) discards the old one
      const old = board[zoneId];
      const oldCard = old?.faceDown ? ctx.hand.latent[zoneId] : old;
      if (oldCard) {
        delete ctx.hand.latent[zoneId];
        removeFromPlay(ctx, uid, oldCard);
        ctx.log(`${ctx.name(uid)} replaced ${old.faceDown ? 'a face-down' : 'the revealed'} Latent card "${oldCard.title}" in ${zoneLabel(zoneId)}. It was discarded.`);
      }
      // Real card stays private; the board only shows a face-down card
      ctx.hand.latent[zoneId] = card;
      board[zoneId] = { faceDown: true };
      ctx.log(`${ctx.name(uid)} set a face-down Latent card in ${zoneLabel(zoneId)}.`);
      checkDefeat(ctx); // a replaced "Nail" strikes on discard
    } else if (zoneId === 'incantation') {
      board.incantation = [...(board.incantation || []), { ...card, tier: 0, playedTurn: game.turnNo }];
      game.players[uid].incantationTurn = game.turnNo;
      ctx.log(`${ctx.name(uid)} played Incantation "${card.title}". Its Turn 1 effect begins at the end of this turn.`);
    } else {
      const replaced = board[zoneId];
      if (replaced) {
        removeFromPlay(ctx, uid, replaced);
        ctx.log(`${ctx.name(uid)} replaced "${replaced.title}" with "${card.title}" in ${zoneLabel(zoneId)}. "${replaced.title}" was discarded.`);
      } else {
        ctx.log(`${ctx.name(uid)} equipped "${card.title}" to ${zoneLabel(zoneId)}.`);
      }
      board[zoneId] = card;
      runEquipEffect(ctx, uid, card);
      checkDefeat(ctx);
    }
  }, { withHand: true });
}

// Reveal a face-down Latent card: during your STRIKE! phase, or while you are COUNTER!-ing.
export function revealLatent(sid, uid, zoneId) {
  return act(sid, uid, (ctx) => {
    const { game } = ctx;
    const a = game.attack;
    const inStrike = game.phase === 'strike' && game.turn === uid && !a;
    const inCounter = a?.status === 'countering' && a.defender === uid;
    if (!inStrike && !inCounter) fail('Latent cards can only be revealed during your STRIKE! phase or a COUNTER!.');
    const slot = game.board[uid][zoneId];
    const card = ctx.hand.latent[zoneId];
    if (!slot?.faceDown || !card) fail('There is no face-down card there.');
    game.board[uid][zoneId] = { ...card, revealed: true };
    delete ctx.hand.latent[zoneId];
    ctx.log(`${ctx.name(uid)} reveals Latent "${card.title}"!`, 'attack');
    // A STRIKE! Latent revealed during your own STRIKE! phase acts right away
    if (inStrike) {
      fireStrikeLatents(ctx, uid);
      checkDefeat(ctx);
    }
  }, { withHand: true });
}

// Detonate a revealed Latent card during your STRIKE! phase (e.g. "Nail"): discard it for direct damage
// that can't be boosted or negated. Discarding it also sets off its "when discarded" effect.
export const canDetonate = (card) => Boolean(card && !card.faceDown && effectOf(card).detonate);
export function detonateLatent(sid, uid, zoneId) {
  return act(sid, uid, (ctx) => {
    const { game } = ctx;
    if (game.phase !== 'strike' || game.turn !== uid || game.attack) fail('Detonate during your STRIKE! phase.');
    if (game.pendingPick?.by === uid) fail('Pick the card to discard first.');
    const card = game.board[uid]?.[zoneId];
    if (!canDetonate(card)) fail('That card can\'t be detonated.');
    const opp = opponentOf(game, uid);
    if (!opp) fail('There is no opponent to strike.');
    const dmg = effectOf(card).detonate.direct;
    delete game.board[uid][zoneId];
    delete ctx.hand.latent[zoneId];
    ctx.log(`${ctx.name(uid)} detonates "${card.title}"!`, 'attack');
    damagePlayer(ctx, opp, dmg, `"${card.title}" detonation (can't be boosted or negated)`);
    removeFromPlay(ctx, uid, card); // discarded: "Nail" also strikes for its discard damage
    checkDefeat(ctx);
  }, { withHand: true });
}

// ---------- Turn flow ----------
function endTurnEffects(ctx, uid) {
  // Incantations: one more tier turns on at the end of each of the owner's turns
  (ctx.game.board[uid]?.incantation || []).forEach((c) => {
    const tiers = effectOf(c).incantationTiers || [];
    if ((c.tier || 0) >= tiers.length) return;
    c.tier = (c.tier || 0) + 1;
    const fx = tiers[c.tier - 1];
    ctx.log(`"${c.title}" — Turn ${c.tier} is now active: ${fx.text}.`, 'phase');
  });
  delete ctx.game.players[uid].deckPick;
  const s = ensureStatus(ctx.game, uid);
  if (s.purge > 0 && (s.burn || s.freeze || s.frostbite || s.stun)) {
    Object.assign(s, { burn: 0, freeze: 0, frostbite: 0, stun: null });
    ctx.log(`Purge cleanses ${ctx.name(uid)}'s other statuses.`, 'status');
  }
  if (s.frostbite) {
    s.frostbite = 0;
    ctx.log(`${ctx.name(uid)}'s Frostbite fades.`, 'status');
  }
  if (s.stun) {
    s.stun = null;
    ctx.log(`${ctx.name(uid)} is no longer stunned.`, 'status');
  }
  ctx.game.clash = null;
}

// "Regenerating Carapace": counts uid's turns while in play; after enough, restores their Body Armor (Armor Set)
// — bringing back an exhausted one at full health, or fully repairing one still in play — then is discarded.
function regenerateArmor(ctx, uid) {
  const { game } = ctx;
  const board = game.board[uid] || {};
  PLAYABLE_ZONES.filter((z) => z !== 'incantation').forEach((z) => {
    const c = board[z];
    const after = c && !c.faceDown ? effectOf(c).regenArmorAfter : 0;
    if (!after) return;
    c.turnsActive = (c.turnsActive || 0) + 1;
    if (c.turnsActive < after) {
      ctx.log(`"${c.title}": ${after - c.turnsActive} more turn${after - c.turnsActive === 1 ? '' : 's'} until ${ctx.name(uid)}'s Armor Set regenerates.`);
      return;
    }
    const worn = board['body-armor'];
    const spent = (game.exhausted?.[uid] || []).filter((x) => x.cardType === 'Body Armor');
    if (worn) {
      worn.health = worn.baseHealth ?? worn.health;
      ctx.log(`"${c.title}" fully restores "${worn.title}" (${worn.health} health).`, 'counter');
    } else if (spent.length) {
      const back = spent.at(-1);
      game.exhausted[uid] = game.exhausted[uid].filter((x) => x !== back);
      board['body-armor'] = { ...freshCopy(back), iid: back.iid };
      ctx.log(`"${c.title}" returns "${back.title}" to an active state!`, 'counter');
    } else {
      ctx.log(`"${c.title}" has no Armor Set to restore.`);
    }
    delete board[z];
    removeFromPlay(ctx, uid, c);
    ctx.log(`"${c.title}" is discarded.`);
  });
}

function startTurnEffects(ctx, uid) {
  // Face-up Latent cards that grow each turn they stay active (e.g. Summon Illy!)
  autoLatents(ctx, uid, 'reduce-incoming').forEach((c) => {
    const grow = effectOf(c).growPerTurn || 0;
    if (!grow) return;
    c.block = (c.block || 0) + grow;
    ctx.log(`"${c.title}" grows — it now reduces incoming damage by ${c.block}.`, 'counter');
  });
  regenerateArmor(ctx, uid);
  const s = ensureStatus(ctx.game, uid);
  // Stun: roll — on an even roll, the player who stunned them blind-picks a hand card to discard.
  // Each face-up "Chain of Command: Gravity" (either side) makes them lose one more.
  if (s.stun) {
    const r = rollDie(ctx, uid, 'Stun', (v) => (v % 2 === 0 ? 'Even — lose a card' : 'Odd — no card lost'));
    if (r % 2 === 0) {
      const gravity = Object.keys(ctx.game.players).reduce((n, u) => n + faceUpWith(ctx.game, u, 'stunExtraDiscard').length, 0);
      ctx.log(`${ctx.name(uid)} rolls ${r} (even) — Stun costs them ${1 + gravity} card${gravity ? 's' : ''}${gravity ? ' (Gravity)' : ''}.`, 'dice');
      const chooser = s.stun.by && s.stun.by !== uid ? s.stun.by : opponentOf(ctx.game, uid);
      forceHandDiscard(ctx, uid, 1 + gravity, 'Stun', { chooser });
    } else {
      ctx.log(`${ctx.name(uid)} rolls ${r} (odd) — Stun costs them nothing this turn.`, 'dice');
    }
  }
  if (s.burn > 0) damagePlayer(ctx, uid, s.burn * STATUS_DAMAGE_PER_STACK, `Burn ×${s.burn}`);
  if (s.purge > 0) damagePlayer(ctx, uid, s.purge * STATUS_DAMAGE_PER_STACK, `Purge ×${s.purge}`);
  if (s.freeze > 0) {
    const r = rollDie(ctx, uid, 'Freeze', (v) => (v % 2 === 0 ? 'Even — one Freeze stack thaws' : 'Odd — Freeze holds'));
    if (r % 2 === 0) {
      s.freeze -= 1;
      ctx.log(`${ctx.name(uid)} rolls ${r} (even) — one Freeze stack thaws (${s.freeze} left).`, 'dice');
    } else {
      ctx.log(`${ctx.name(uid)} rolls ${r} (odd) — Freeze holds.`, 'dice');
    }
  }
}

export function endPhase(sid, uid) {
  return act(sid, uid, (ctx) => {
    const { game } = ctx;
    if (game.turn !== uid) fail("It's not your turn.");
    if (game.attack) fail('Resolve the current attack first.');
    if (game.pendingPick?.by === uid) fail('Pick the card to discard first.');
    if (game.pendingPick?.target === uid) fail('Wait for your opponent to pick the card you discard.');

    if (game.phase === 'equip') {
      game.phase = 'strike';
      ctx.log(`${ctx.name(uid)}'s STRIKE! phase.`, 'phase');
      fireStrikeLatents(ctx, uid);
      checkDefeat(ctx);
      return;
    }
    if (game.phase !== 'strike') fail('Nothing to end right now.');

    endTurnEffects(ctx, uid);
    const next = opponentOf(game, uid);
    game.turn = next;
    game.turnNo = (game.turnNo || 0) + 1;
    if (next === game.first) {
      game.round += 1;
      ctx.log(`Round ${game.round} begins.`, 'phase');
    }
    ctx.log(`${ctx.name(next)}'s turn.`, 'phase');
    startTurnEffects(ctx, next);
    if (checkDefeat(ctx)) return;
    gainSoul(ctx, next);

    if (game.round === 1) {
      game.phase = 'equip';
      ctx.log(`(No Draw phase in round 1.) ${ctx.name(next)}'s Equip phase.`, 'phase');
    } else {
      game.phase = 'draw';
    }
  });
}

export function drawForTurn(sid, uid) {
  return act(sid, uid, (ctx) => {
    const { game } = ctx;
    if (game.phase !== 'draw' || game.turn !== uid) return false;
    const s = ensureStatus(game, uid);
    let n = DRAW_PER_TURN;
    // Extra draws from face-up cards: your own (e.g. "Prowler's Cloak") and ones for everyone (e.g. "Tilled Earth")
    Object.keys(game.players).forEach((owner) => {
      const board = game.board[owner] || {};
      PLAYABLE_ZONES.filter((z) => z !== 'incantation').forEach((z) => {
        const c = board[z];
        const fx = c && !c.faceDown ? effectOf(c) : {};
        if (!fx.extraDraw || (fx.drawFor === 'owner' && owner !== uid)) return;
        n += fx.extraDraw;
        ctx.log(`"${c.title}" lets ${ctx.name(uid)} draw ${fx.extraDraw} extra card${fx.extraDraw === 1 ? '' : 's'}.`);
      });
    });
    // Incantation "Turn 2" (MEENOS!): +1 draw per face-up "Nail" card (Freeze/Frostbite limits below still apply)
    const agility = incantationsWith(game, uid, 'draw-per-nail')[0]?.card;
    if (agility) {
      const nails = nailCardsInPlay(game, uid).length;
      if (nails) {
        n += nails;
        ctx.log(`"${agility.title}" lets ${ctx.name(uid)} draw ${nails} extra card${nails === 1 ? '' : 's'}.`);
      }
    }
    if (s.frostbite) {
      n = 0;
      ctx.log(`${ctx.name(uid)} has Frostbite and cannot draw this turn.`, 'status');
    } else if (s.freeze > 0) {
      n = Math.min(n, FREEZE_DRAW_LIMIT);
      ctx.log(`Freeze limits ${ctx.name(uid)}'s draw to ${n}.`, 'status');
    }
    if (n > 0) {
      const drawn = drawCards(ctx, n);
      ctx.log(drawn ? `${ctx.name(uid)} drew ${drawn} card${drawn === 1 ? '' : 's'}.` : `${ctx.name(uid)} has no cards left to draw.`);
    }
    // Incantation "Turn 2" (Maxees!): search the deck for any 1 card this turn (see pickFromDeck)
    const search = incantationsWith(game, uid, 'deck-pick')[0]?.card;
    if (search && ctx.hand.deck.length) {
      game.players[uid].deckPick = { source: search.title, turnNo: game.turnNo };
      ctx.log(`"${search.title}": ${ctx.name(uid)} may search their deck for 1 card.`);
    }
    game.phase = 'equip';
    ctx.log(`${ctx.name(uid)}'s Equip phase.`, 'phase');
  }, { withHand: true });
}

// Takes the chosen card (by instance id) from uid's deck into their hand and reshuffles. iid null = skip.
export function pickFromDeck(sid, uid, iid) {
  return act(sid, uid, (ctx) => {
    const p = ctx.game.players[uid];
    const pick = p.deckPick;
    if (!pick || pick.turnNo !== ctx.game.turnNo) fail('There is no deck search to make.');
    delete p.deckPick;
    if (!iid) {
      ctx.log(`${ctx.name(uid)} skips the "${pick.source}" search.`);
      return;
    }
    const card = ctx.hand.deck.find((c) => c.iid === iid) || fail('That card is no longer in your deck.');
    ctx.hand.deck = shuffle(ctx.hand.deck.filter((c) => c !== card));
    ctx.hand.hand.push(card);
    ctx.log(`"${pick.source}": ${ctx.name(uid)} searches their deck, takes a card and reshuffles.`);
  }, { withHand: true });
}

// ---------- Attacks & COUNTER ----------
// source: { kind: 'hand', iid } | { kind: 'latent', zone }  (a revealed Latent card, usable once per turn)
function takeSource(ctx, source, allowedTypes, verb) {
  const { game, uid } = ctx;
  if (source.kind === 'hand') {
    const card = findInHand(ctx, source.iid);
    if (!allowedTypes.includes(card.cardType)) fail(`Only ${allowedTypes.join(' or ')} cards can be used to ${verb}.`);
    if (isLatentCard(card)) fail('Latent cards must be set face-down first, then revealed.');
    requireAffinity(ctx, card);
    paySoul(ctx, card);
    takeFromHand(ctx, source.iid);
    return { card, fromLatent: null };
  }
  const card = game.board[uid][source.zone];
  if (!card || card.faceDown) fail('Reveal that Latent card first.');
  if (isAutoLatent(card)) fail(`"${card.title}" works automatically once revealed.`);
  if (!allowedTypes.includes(card.cardType)) fail(`Only ${allowedTypes.join(' or ')} cards can be used to ${verb}.`);
  if (card.usedTurn === game.turnNo) fail(`"${card.title}" has already been used this turn.`);
  card.usedTurn = game.turnNo; // SOUL was paid when it was set face-down
  return { card, fromLatent: source.zone };
}

const targetLabel = (ctx, defender, target) =>
  target.kind === 'player'
    ? ctx.name(defender)
    : `${ctx.name(defender)}'s "${ctx.game.board[defender][target.zone]?.title}"`;

// target: { kind: 'player' } | { kind: 'card', zone }
export function declareAttack(sid, uid, source, target) {
  return act(sid, uid, (ctx) => {
    const { game } = ctx;
    if (game.phase !== 'strike' || game.turn !== uid) fail('Attacks can only be declared during your STRIKE! phase.');
    if (game.attack) fail('An attack is already in progress.');
    if (game.pendingPick) fail('Finish picking the card to discard first.');
    const defender = opponentOf(game, uid);
    if (target.kind === 'card') {
      const t = game.board[defender]?.[target.zone];
      if (!t || t.faceDown || Array.isArray(t) || !(t.health > 0)) fail('Only face-up cards with health can be targeted.');
    }

    const paid = source.kind === 'hand' ? soulCostFor(game, uid, findInHand(ctx, source.iid)) : 0;
    const { card, fromLatent } = takeSource(ctx, source, ['Attack'], 'attack');
    const breakdown = attackBreakdown(game, uid, card, target);
    // "Instant Reposition": once per STRIKE!, an attack that cost SOUL refunds 1
    if (paid > 0) {
      faceUpWith(game, uid, 'refundOnPaidAttack').forEach((c) => {
        if (c.usedTurn === game.turnNo) return;
        c.usedTurn = game.turnNo;
        const n = effectOf(c).refundOnPaidAttack;
        game.players[uid].soul = (game.players[uid].soul || 0) + n;
        ctx.log(`"${c.title}" refunds ${n} ${resourceLabel(game, uid)} to ${ctx.name(uid)}.`);
      });
    }
    game.attack = {
      id: crypto.randomUUID(),
      by: uid,
      defender,
      card,
      fromLatent,
      damage: breakdown.total,
      breakdown: { base: breakdown.base, parts: breakdown.parts },
      target,
      targetTitle: target.kind === 'card' ? game.board[defender][target.zone].title : null,
      status: 'open',
      at: Date.now(),
    };
    game.clash = { by: uid, defender, attackCard: card, counterCard: null };
    ctx.log(`${ctx.name(uid)} attacks ${targetLabel(ctx, defender, target)} with "${card.title}" for ${breakdown.total} damage!`, 'attack');
    if (breakdown.parts.length) ctx.log(`"${card.title}" damage: ${breakdownText(breakdown)}.`, 'attack');

    // Incantation "Turn 3" (MEENOS!): every attack declared also deals unblockable damage
    incantationsWith(game, uid, 'strike-chip').forEach((e) => {
      damagePlayer(ctx, defender, e.fx.amount, `"${e.card.title}" (unblockable)`);
    });
    if (checkDefeat(ctx)) {
      if (!fromLatent) pushDiscard(ctx, uid, card);
      game.attack = null;
      game.clash = null;
      return;
    }

    const fx = effectOf(card);
    if (fx.onDeclare === 'lunge-search') {
      forceHandDiscard(ctx, uid, 1, card.title);
      searchDeck(ctx, uid, { title: fx.search }, card.title);
    }

    if (card.inflictStatus) {
      const inflict = { status: card.inflictStatus, stacks: card.inflictStacks || 1, on: card.inflictOn || 'hit', zone: null };
      if (inflict.on === 'direct') {
        // "If a direct attack is declared": applies immediately, regardless of COUNTER!
        if (target.kind === 'player') inflictStatus(ctx, uid, defender, inflict.status, inflict.stacks, inflict.zone, card.title);
      } else {
        game.attack.inflict = inflict;
      }
    }
  }, { withHand: true });
}

export function declareCounter(sid, uid, attackId) {
  return act(sid, uid, (ctx) => {
    const a = ctx.game.attack;
    if (!a || a.id !== attackId || a.status !== 'open') fail('Too late — the attack has already resolved.');
    if (a.defender !== uid) fail('Only the defending player can COUNTER!');
    a.status = 'countering';
    ctx.log(`${ctx.name(uid)} declares COUNTER!`, 'counter');
  });
}

// Defend cards with an optional HP sacrifice for more block (e.g. "Translucence").
export const sacrificeOption = (card) => (card?.cardType === 'Defend' ? effectOf(card).sacrifice || null : null);

// opts.sacrifice: pay the card's HP sacrifice for extra block.
export function playCounter(sid, uid, source, opts = {}) {
  return act(sid, uid, (ctx) => {
    const a = ctx.game.attack;
    if (!a || a.status !== 'countering' || a.defender !== uid) fail('There is no COUNTER! to play.');
    const taken = takeSource(ctx, source, ['Attack', 'Defend'], 'COUNTER!');
    const { card } = taken;
    let { fromLatent } = taken;
    // Detonating a Latent Defend card (e.g. "Flatside Nail"): it leaves play now, defends with +value, then is discarded
    const detonate = fromLatent ? effectOf(card).detonateCounter || 0 : 0;
    if (detonate) {
      delete ctx.game.board[uid][fromLatent];
      delete ctx.hand.latent[fromLatent];
      fromLatent = null; // so it goes to the discard pile after the attack resolves
      ctx.log(`${ctx.name(uid)} detonates "${card.title}" — it defends with ${detonate} extra and is discarded after use.`, 'counter');
    }
    // Face-up "Flatside Nail": Defend cards block 40 more for each one
    let boost = (card.cardType === 'Defend' ? latentPassiveTotal(ctx.game, uid, 'defend-boost') : 0) + detonate;
    if (boost - detonate) ctx.log(`Face-up Latent cards boost "${card.title}" by ${boost - detonate}.`, 'counter');
    // "Fly! Illy!": adds your face-up Summon Illy!'s block
    const summonTitle = effectOf(card).addSummon;
    const summon = summonTitle && faceUpCards(ctx.game, uid).find((c) => c.title === summonTitle);
    if (summon) {
      const add = summonPower(ctx.game, uid, summon);
      boost += add;
      ctx.log(`"${summon.title}" adds ${add} to "${card.title}".`, 'counter');
    }
    // "Translucence": sacrifice HP for extra block
    const sac = opts.sacrifice ? sacrificeOption(card) : null;
    if (sac) {
      damagePlayer(ctx, uid, sac.hp, `"${card.title}" (sacrificed)`);
      boost += sac.block;
      ctx.log(`${ctx.name(uid)} sacrifices ${sac.hp} HP — "${card.title}" blocks ${sac.block} more.`, 'counter');
    }
    // Attack cards struck back with keep their damage bonuses (e.g. Springboard's "Nail" bonus)
    const bd = card.cardType === 'Attack' ? attackBreakdown(ctx.game, uid, card) : null;
    if (bd?.parts.length) ctx.log(`"${card.title}" damage: ${breakdownText(bd)}.`, 'counter');
    resolveAttack(ctx, { card, fromLatent, value: (bd ? bd.total : counterValue(card)) + boost });
  }, { withHand: true });
}

// Resolves an attack with no counter. reason: 'timeout' | 'pass'
export function resolveWithoutCounter(sid, uid, attackId, reason) {
  return act(sid, uid, (ctx) => {
    const a = ctx.game.attack;
    if (!a || a.id !== attackId) return false;
    if (a.status === 'open') {
      if (reason === 'pass' && uid !== a.defender) return false;
      ctx.log(reason === 'pass' ? `${ctx.name(a.defender)} does not counter.` : 'No COUNTER! declared in time.');
    } else if (a.status === 'countering') {
      if (uid !== a.defender) return false;
      ctx.log(`${ctx.name(uid)} has no counter card to play.`);
    }
    resolveAttack(ctx, null);
  });
}

// ---------- Card effects ----------
// Effects that the engine applies automatically, keyed by card title (built-in sets).
// Generic effects for any card come from its fields: inflictStatus / inflictStacks / inflictOn.
const EFFECTS = {
  // Shield: once per turn, direct damage triggers a roll — even: reduce by 20, odd: nullify it.
  Instinct: { shieldRoll: { even: 20 } },
  // Defend: block 30, then roll — odd: negate any remaining damage.
  'Brace For Impact!': { counterRoll: 'odd-negates' },
  // Defend: block 40; if "Instinct" is in play it gains Instinct's roll (even: −20, odd: nullify).
  Reflex: { counterRoll: 'instinct-if-in-play' },
  // Ability (Equip): discard all your "Nail" cards in play; for each, opponent takes 40 damage and 1 Purge,
  // and this card's damage increases by 20.
  'Veil Piercer': { onEquip: 'veil-piercer' },
  // Attack (Latent): once face-up, deals its damage automatically at the start of each of your STRIKE! phases
  // (it can't be COUNTERed). Its damage grows by 10 each time it is attacked.
  'Summon Inty': { latentAuto: 'strike-damage', growOnAttacked: 10 },
  // Defend (Latent): once face-up, reduces every attack against you by its block value — no COUNTER! needed.
  // The reduction grows by 20 at the start of each of your turns while it stays face-up.
  'Summon Illy!': { latentAuto: 'reduce-incoming', growPerTurn: 20 },
  // Latent cards with an ongoing effect while face-up (they can still be used manually as normal):
  // Attack (Latent): Attack cards cost 1 less SOUL for each face-up "Nail".
  // When it's discarded from play (destroyed, replaced, or discarded by "Veil Piercer"), it deals 20 damage
  // straight to the opponent, skipping Shields, Body Armor and other damage reduction.
  // Detonate (STRIKE!): discard it to deal 40 direct damage that can't be boosted or negated.
  Nail: { latentPassive: 'attack-discount', amount: 1, onDiscardDirect: 20, detonate: { direct: 40 } },
  // Defend (Latent): Defend cards played as a COUNTER! block 40 more for each face-up "Flatside Nail".
  // Detonate (COUNTER!): used to defend, it blocks 40 more than its value and is discarded after use.
  'Flatside Nail': { latentPassive: 'defend-boost', amount: 40, detonateCounter: 40 },
  // Attack: +20 damage for each face-up card with "Nail" in its name on the attacker's board.
  Springboard: { attackBonus: { per: 'nail', amount: 20 } },
  // Ability: whenever your attack does damage, search your deck for a "Nail" card and put it into your hand.
  'Just a Touch': { onDamageSearch: 'nail' },
  // Ability: while you have a face-up "Nail" card, your direct damage (attacks on the player) is +20.
  Skewer: { directBonus: 20 },
  // Ability: once per STRIKE!, playing an attack that costs SOUL refunds 1 SOUL.
  'Instant Reposition': { refundOnPaidAttack: 1 },
  // Ability: once per turn, when your opponent draws a card, you draw one.
  'Start! Hunt!': { drawOnOpponentDraw: 1 },
  // Spatial: when your attack is fully blocked or countered, refund 1 SOUL.
  'Illusionary Wind': { refundOnBlocked: 1 },
  // Spatial: your damage is +10 while your opponent has Purge.
  Purrgatory: { purgeBonus: 10 },
  // Weapon: your direct damage ignores the opponent's Body Armor reduction.
  'Permeable Paws': { ignoreArmor: true },
  // Defend: optionally sacrifice 10 HP to block 20 more.
  Translucence: { sacrifice: { hp: 10, block: 20 } },

  // Dremur
  // Ability: after 3 of your turns in play, restores your Body Armor (Armor Set) and is discarded.
  'Regenerating Carapace': { regenArmorAfter: 3 },
  // Ability ("modes"): equipping it discards your "Summon Inty" (adding its damage to this card's reduction),
  // and "Summon Inty" can't be played while it's in play. Reduces direct damage by its value (20+).
  'Chain Of Command-Illy': { chain: { removes: 'Summon Inty', stat: 'block' }, directReduce: true },
  // Ability ("modes"): equipping it discards your "Summon Illy!" (adding its block to this card's damage),
  // and "Summon Illy!" can't be played while it's in play. All your damage is increased by its value (20+).
  'Chain of Command-Inty': { chain: { removes: 'Summon Illy!', stat: 'damage' }, allDamageBonus: true },
  // Ability: +20 damage when attacking a card, +10 more for each of your face-up cards with "Inty" in the name.
  'Rending Carapace': { cardTargetBonus: { amount: 20, perInty: 10 } },
  // Spatial: a stunned player who rolls even loses one extra card (applies to everyone).
  'Chain of Command: Gravity': { stunExtraDiscard: 1 },
  // Weapon: Summon Inty's damage and Summon Illy!'s block are +40.
  'Wand Of Command': { summonBoost: 40 },
  // Defend: adds your face-up "Summon Illy!"'s block to this card.
  'Fly! Illy!': { addSummon: 'Summon Illy!' },
  // Body Armor: its reduction grows by the damage it has taken.
  'Hidden Carapace': { blockGrowsWithDamage: true },
  // Body Armor: draw 1 more card in your draw phase.
  "Prowler's Cloak": { extraDraw: 1, drawFor: 'owner' },
  // Spatial: each player draws 1 more card in their draw phase.
  'Tilled Earth': { extraDraw: 1, drawFor: 'everyone' },
  // Attack: against a stunned opponent, they discard a card from their hand and all their equip cards take 10.
  'Churning Constriction': { onHitStunnedDiscard: 1, stunnedEquipHit: 10 },
  // Attack: if the opponent declares COUNTER!, 30 extra damage goes directly to them (ignores the COUNTER!).
  Strikethrough: { onCounteredDirect: 30 },
  // Attack: also deals 30 to the opponent's Body Armor (40 if "Chain of Command-Inty" is in play).
  'Crashing Mandibles': { armorHit: { amount: 30, bonus: 10, bonusWith: 'Chain of Command-Inty' } },
  // Defend: if the attack exceeds what this blocks, 20 damage to each of the attacker's equip cards.
  Refraction: { overflowEquipHit: 20 },
  // Attack: on declaring, discard a random card from your hand and search your deck for "Churning Constriction".
  'Reckless Lunge': { onDeclare: 'lunge-search', search: 'Churning Constriction' },
  // Defend: if the attack is bigger than what it blocks, you take 30 instead and discard a random card.
  'Diamond Carapace': { overflow: { take: 30, discard: 1 } },

  // Incantations power up over your turns: at the end of the turn you play one, its "Turn 1" effect turns on;
  // at the end of each of your next turns the next tier turns on (3 full turns for all of them). Tiers that are on
  // stay on for the rest of the game, unless a card says otherwise. Incantations can't be targeted.
  'MEENOS! Grant Me Agility!': {
    incantationTiers: [
      { kind: 'retain-hand', text: "Card effects and Stun can't make you discard from your hand" },
      { kind: 'draw-per-nail', text: 'Draw +1 card per "Nail" card in play each draw phase' },
      { kind: 'strike-chip', amount: 10, text: 'Every attack you declare also deals 10 unblockable damage' },
    ],
  },
  'Maxees! Grant me Strength!': {
    incantationTiers: [
      { kind: 'cost-discount', amount: 1, text: 'Every card you play costs 1 less' },
      { kind: 'deck-pick', text: 'Each draw phase, search your deck for 1 card' },
      { kind: 'attack-boost', amount: 40, text: 'Attacks you declare deal +40 damage' },
    ],
  },
};

// Every tier of uid's Incantations: { card, fx, tier (1-based), active }. card.tier = how many tiers are on.
export function incantationTiers(game, uid) {
  const list = game?.board?.[uid]?.incantation || [];
  return list.flatMap((c) => (effectOf(c).incantationTiers || []).map((fx, i) => ({ card: c, fx, tier: i + 1, active: i < (c.tier || 0) })));
}
// uid's active Incantation tiers with the given effect.
const incantationsWith = (game, uid, kind) => incantationTiers(game, uid).filter((e) => e.active && e.fx.kind === kind);
// A card effect forces uid to discard `n` random cards from their hand. An active MEENOS! tier (Turn 1) prevents it.
// Hands are private, so if uid isn't the one acting, the discard is queued and uid's client carries it out.
// opts.chooser: that player picks which of uid's face-down hand cards go (see pickOpponentCards).
function forceHandDiscard(ctx, uid, n, source, { chooser } = {}) {
  if (n <= 0) return;
  const meenos = incantationsWith(ctx.game, uid, 'retain-hand')[0]?.card;
  if (meenos) {
    ctx.log(`"${meenos.title}" lets ${ctx.name(uid)} keep the card${n === 1 ? '' : 's'} "${source}" would discard.`, 'counter');
    return;
  }
  if (chooser) {
    if (!(ctx.game.players[uid]?.handCount > 0)) {
      ctx.log(`${ctx.name(uid)} has no cards in hand to discard.`);
      return;
    }
    ctx.game.pendingPick = { by: chooser, target: uid, n, source };
    ctx.log(`${ctx.name(chooser)} picks ${n === 1 ? 'a card' : `${n} cards`} from ${ctx.name(uid)}'s hand to discard ("${source}").`, 'attack');
    return;
  }
  if (ctx.uid === uid && ctx.hand) discardRandomFromHand(ctx, n, source);
  else {
    const p = ctx.game.players[uid];
    p.pendingDiscard = (p.pendingDiscard || 0) + n;
    p.pendingDiscardSource = source;
  }
}
function discardRandomFromHand(ctx, n, source) {
  const { hand, uid } = ctx;
  for (let i = 0; i < n; i++) {
    if (!hand.hand.length) {
      ctx.log(`${ctx.name(uid)} has no cards left to discard.`);
      return;
    }
    const [c] = hand.hand.splice(Math.floor(Math.random() * hand.hand.length), 1);
    pushDiscard(ctx, uid, c);
    ctx.log(`"${source}" makes ${ctx.name(uid)} discard "${c.title}" from their hand.`, 'damage');
  }
}
// Deck searches. what: { title } (exact name) or { nail: true } (any card with "Nail" in its name).
const matchesSearch = (c, what) => (what.nail ? isNailCard(c) : c.title === what.title);
const searchLabel = (what) => (what.nail ? 'a "Nail" card' : `"${what.title}"`);

// uid searches their deck for a matching card, puts it into their hand and shuffles the deck.
// Decks are private, so if uid isn't the one acting, the search is queued and uid's client carries it out.
function searchDeck(ctx, uid, what, source) {
  if (ctx.uid !== uid || !ctx.hand) {
    const p = ctx.game.players[uid];
    p.pendingSearches = [...(p.pendingSearches || []), { ...what, source }];
    return;
  }
  const matches = ctx.hand.deck.filter((c) => matchesSearch(c, what));
  if (!matches.length) {
    ctx.log(`"${source}": ${ctx.name(uid)} searches their deck but finds no ${searchLabel(what)}.`);
    return;
  }
  const found = matches[Math.floor(Math.random() * matches.length)];
  ctx.hand.deck = shuffle(ctx.hand.deck.filter((c) => c !== found));
  ctx.hand.hand.push(found);
  ctx.log(`"${source}": ${ctx.name(uid)} searches their deck and adds "${found.title}" to their hand.`);
}

// "Just a Touch": whenever uid's attack does damage, search for a "Nail" card (once per face-up copy).
function onAttackDamaged(ctx, uid) {
  const board = ctx.game.board[uid] || {};
  PLAYABLE_ZONES.filter((z) => z !== 'incantation').forEach((z) => {
    const c = board[z];
    if (c && !c.faceDown && effectOf(c).onDamageSearch === 'nail') searchDeck(ctx, uid, { nail: true }, c.title);
  });
}

// Carries out discards and deck searches queued for uid while the opponent was acting (run by uid's own client).
export function resolvePendingDiscards(sid, uid) {
  return act(sid, uid, (ctx) => {
    const p = ctx.game.players[uid];
    const n = p?.pendingDiscard || 0;
    const picks = p?.pendingDiscardPicks || [];
    const searches = p?.pendingSearches || [];
    const draws = p?.pendingDraws || 0;
    if (!n && !picks.length && !searches.length && !draws) return false;
    delete p.pendingSearches;
    searches.forEach(({ source, ...what }) => searchDeck(ctx, uid, what, source));
    if (draws) {
      p.pendingDraws = 0;
      const got = drawCards(ctx, draws);
      ctx.log(got ? `${ctx.name(uid)} drew ${got} card${got === 1 ? '' : 's'}.` : `${ctx.name(uid)} has no cards left to draw.`);
    }
    if (!n && !picks.length) return;
    const source = p.pendingDiscardSource || 'A card effect';
    p.pendingDiscard = 0;
    delete p.pendingDiscardPicks;
    delete p.pendingDiscardSource;
    // Re-check MEENOS! in case it turned on in the meantime
    const meenos = incantationsWith(ctx.game, uid, 'retain-hand')[0]?.card;
    if (meenos) {
      ctx.log(`"${meenos.title}" lets ${ctx.name(uid)} keep the cards "${source}" would discard.`, 'counter');
      return;
    }
    // Cards the opponent picked by position, highest first so earlier positions stay valid
    [...new Set(picks)].sort((x, y) => y - x).forEach((i) => {
      if (i < 0 || i >= ctx.hand.hand.length) return;
      const [c] = ctx.hand.hand.splice(i, 1);
      pushDiscard(ctx, uid, c);
      ctx.log(`"${source}" makes ${ctx.name(uid)} discard "${c.title}" from their hand.`, 'damage');
    });
    if (n) discardRandomFromHand(ctx, n, source);
  }, { withHand: true });
}

// The player who stunned picks which of the opponent's face-down hand cards to discard.
// positions: indexes into the opponent's hand (they only see card backs, so it's a blind pick).
export function pickOpponentCards(sid, uid, positions) {
  return act(sid, uid, (ctx) => {
    const { game } = ctx;
    const pk = game.pendingPick;
    if (!pk || pk.by !== uid) fail('There is no card to pick.');
    const target = game.players[pk.target];
    const size = target.handCount || 0;
    const need = Math.min(pk.n, size);
    const chosen = [...new Set(positions)].filter((i) => Number.isInteger(i) && i >= 0 && i < size);
    if (chosen.length !== need) fail(`Pick ${need} card${need === 1 ? '' : 's'}.`);
    target.pendingDiscardPicks = [...(target.pendingDiscardPicks || []), ...chosen];
    target.pendingDiscardSource = pk.source;
    game.pendingPick = null;
  });
}
const incantationTotal = (game, uid, kind) => incantationsWith(game, uid, kind).reduce((sum, e) => sum + (e.fx.amount || 0), 0);

// Face-up cards on uid's board whose name contains "Nail" ("Nail", "Flatside Nail", ...).
const isNailCard = (c) => /\bnail\b/i.test(c?.title || '');
export function nailCardsInPlay(game, uid) {
  const board = game?.board?.[uid] || {};
  return PLAYABLE_ZONES.filter((z) => z !== 'incantation').map((z) => board[z]).filter((c) => c && !c.faceDown && isNailCard(c));
}

// Face-up cards on uid's board (Incantations excluded), and those with a given effect.
const faceUpCards = (game, uid) => {
  const b = game?.board?.[uid] || {};
  return PLAYABLE_ZONES.filter((z) => z !== 'incantation').map((z) => b[z]).filter((c) => c && !c.faceDown);
};
const faceUpWith = (game, uid, key) => faceUpCards(game, uid).filter((c) => effectOf(c)[key]);

// A summon's current power — Summon Inty's damage or Summon Illy!'s block — including "Wand Of Command".
export function summonPower(game, uid, c) {
  const base = c.cardType === 'Attack' ? c.damage || 0 : c.block || 0;
  return base + faceUpWith(game, uid, 'summonBoost').reduce((s, w) => s + effectOf(w).summonBoost, 0);
}

// "Chain of Command" lock: the face-up card stopping uid from playing `card`, if any.
export const chainLock = (game, uid, card) => faceUpCards(game, uid).find((c) => effectOf(c).chain?.removes === card?.title) || null;

// Ongoing damage bonuses from uid's other cards, for damage aimed at `target` ({ kind: 'player' | 'card' }).
function damageBonusParts(game, uid, target) {
  const parts = [];
  faceUpWith(game, uid, 'allDamageBonus').forEach((c) => c.damage > 0 && parts.push({ label: c.title, amount: c.damage }));
  if (target?.kind === 'player' && nailCardsInPlay(game, uid).length) {
    faceUpWith(game, uid, 'directBonus').forEach((c) => parts.push({ label: c.title, amount: effectOf(c).directBonus }));
  }
  if (target?.kind === 'card') {
    const inty = faceUpCards(game, uid).filter((c) => /inty/i.test(c.title)).length;
    faceUpWith(game, uid, 'cardTargetBonus').forEach((c) => {
      const b = effectOf(c).cardTargetBonus;
      parts.push({ label: inty ? `${c.title}, ${inty} "Inty"` : c.title, amount: b.amount + b.perInty * inty });
    });
  }
  const opp = opponentOf(game, uid);
  if (opp && statusOf(game, opp).purge > 0) {
    faceUpWith(game, uid, 'purgeBonus').forEach((c) => parts.push({ label: `${c.title}, Purge`, amount: effectOf(c).purgeBonus }));
  }
  return parts;
}

// How an Attack card's damage adds up right now: { base, parts: [{ label, amount }], total }.
// Used both to resolve the attack and to show players the math. target: { kind: 'player' | 'card' } or null.
export function attackBreakdown(game, uid, card, target = null) {
  const base = Number(card?.damage) || 0;
  const parts = [];
  const bonus = effectOf(card).attackBonus;
  if (bonus?.per === 'nail') {
    const n = nailCardsInPlay(game, uid).filter((c) => c !== card).length;
    if (n) parts.push({ label: `${n} "Nail" card${n === 1 ? '' : 's'} in play`, amount: bonus.amount * n });
  }
  parts.push(...damageBonusParts(game, uid, target));
  incantationsWith(game, uid, 'attack-boost').forEach((e) => parts.push({ label: e.card.title, amount: e.fx.amount }));
  return { base, parts, total: parts.reduce((s, p) => s + p.amount, base) };
}
export const breakdownText = ({ base, parts, total }) =>
  parts.length ? `${base} + ${parts.map((p) => `${p.amount} (${p.label})`).join(' + ')} = ${total}` : `${total}`;

// Total of an ongoing face-up Latent effect on uid's board (face-down cards don't count).
function latentPassiveTotal(game, uid, kind) {
  const board = game?.board?.[uid] || {};
  return LATENT_ZONES.reduce((sum, z) => {
    const c = board[z];
    const fx = c && !c.faceDown ? effectOf(c) : {};
    return fx.latentPassive === kind ? sum + (fx.amount || 0) : sum;
  }, 0);
}
const effectOf = (card) => EFFECTS[card?.title] || {};

// Latent cards whose effect runs on its own once revealed (they can't be used manually).
export const isAutoLatent = (card) => Boolean(effectOf(card).latentAuto);

// Face-up Latent cards on uid's board with the given automatic effect.
const autoLatents = (ctx, uid, kind) => {
  const board = ctx.game.board[uid] || {};
  return LATENT_ZONES.map((z) => board[z]).filter((c) => c && !c.faceDown && effectOf(c).latentAuto === kind);
};

// Reduces damage coming at `def` by their face-up damage-reducing Latent cards. Returns what's left.
function reduceIncoming(ctx, def, amount) {
  let dmg = amount;
  autoLatents(ctx, def, 'reduce-incoming').forEach((c) => {
    const power = summonPower(ctx.game, def, c); // includes "Wand Of Command"
    if (dmg <= 0 || !(power > 0)) return;
    const reduced = Math.min(power, dmg);
    dmg -= reduced;
    ctx.log(`"${c.title}" reduces incoming damage by ${reduced}.`, 'counter');
  });
  return dmg;
}

// Fires uid's face-up STRIKE! Latent cards (once per turn each): direct damage that can't be COUNTERed.
function fireStrikeLatents(ctx, uid) {
  const { game } = ctx;
  const opp = opponentOf(game, uid);
  if (!opp) return;
  autoLatents(ctx, uid, 'strike-damage').forEach((c) => {
    if (c.usedTurn === game.turnNo || game.phase === 'over') return;
    c.usedTurn = game.turnNo;
    // Its power (incl. "Wand Of Command") plus your ongoing direct-damage bonuses
    const bd = { base: summonPower(game, uid, c), parts: damageBonusParts(game, uid, { kind: 'player' }) };
    const total = bd.parts.reduce((s, p) => s + p.amount, bd.base);
    ctx.log(`"${c.title}" strikes ${ctx.name(opp)} for ${total} damage!`, 'attack');
    if (bd.parts.length) ctx.log(`"${c.title}" damage: ${breakdownText({ ...bd, total })}.`, 'attack');
    const dmg = reduceIncoming(ctx, opp, total);
    if (dmg > 0) {
      applyDirectDamage(ctx, opp, dmg);
      onAttackDamaged(ctx, uid);
    } else ctx.log(`${ctx.name(opp)} takes no damage.`, 'counter');
    checkDefeat(ctx);
  });
}

// Applies a status from a card effect, respecting max stacks and special rules.
function inflictStatus(ctx, by, target, statusId, stacks = 1, zone = null, source = '') {
  const def = statusDef(statusId);
  if (!def) return;
  const s = ensureStatus(ctx.game, target);
  const from = source ? ` (${source})` : '';
  if (statusId === 'stun') {
    if (s.stun) {
      ctx.log(`${ctx.name(target)} is already stunned${from}.`, 'status');
      return;
    }
    s.stun = { by };
    ctx.log(`${ctx.name(target)} is stunned${from} — at the start of their turn they roll to see if they lose a card.`, 'status');
    return;
  }
  if (statusId === 'frostbite' && s.freeze < statusDef('freeze').max) {
    ctx.log(`Frostbite${from} has no effect — ${ctx.name(target)} isn't at max Freeze.`, 'status');
    return;
  }
  const before = s[statusId];
  s[statusId] = Math.min(def.max, before + stacks);
  ctx.log(
    s[statusId] === before
      ? `${ctx.name(target)}'s ${def.label} is already at max (${def.max})${from}.`
      : `${ctx.name(target)} gains ${def.label}${from} (${s[statusId]}/${def.max}).`,
    'status',
  );
}

// "Chain of Command" (picking a side): equipping it discards your summon of the other side — face-up or
// face-down — and adds that summon's value to this card.
function runChainEquip(ctx, uid, card, chain) {
  const board = ctx.game.board[uid];
  LATENT_ZONES.forEach((z) => {
    const slot = board[z];
    const real = slot?.faceDown ? ctx.hand.latent[z] : slot;
    if (!real || real.title !== chain.removes) return;
    const value = real.cardType === 'Attack' ? real.damage || 0 : real.block || 0;
    delete board[z];
    delete ctx.hand.latent[z];
    removeFromPlay(ctx, uid, real);
    card[chain.stat] = (card[chain.stat] || 0) + value;
    ctx.log(`"${card.title}" discards "${real.title}" and absorbs its ${value} — now ${card[chain.stat]}.`, 'phase');
  });
}

function runEquipEffect(ctx, uid, card) {
  const chain = effectOf(card).chain;
  if (chain) return runChainEquip(ctx, uid, card, chain);
  if (effectOf(card).onEquip !== 'veil-piercer') return;
  const { game, hand } = ctx;
  const board = game.board[uid];
  let nails = 0;
  PLAYABLE_ZONES.filter((z) => z !== 'incantation').forEach((z) => {
    const c = board[z];
    const real = c?.faceDown ? hand.latent[z] : c;
    if (real && real.title === 'Nail' && real !== card) {
      delete board[z];
      if (c.faceDown) delete hand.latent[z];
      removeFromPlay(ctx, uid, real);
      nails++;
    }
  });
  if (!nails) {
    ctx.log(`"${card.title}" finds no "Nail" cards in play.`);
    return;
  }
  const opp = opponentOf(game, uid);
  card.damage += 20 * nails;
  ctx.log(`"${card.title}" discards ${nails} "Nail" card${nails === 1 ? '' : 's'} — its damage rises to ${card.damage}.`, 'attack');
  for (let i = 0; i < nails; i++) {
    applyDirectDamage(ctx, opp, 40);
    inflictStatus(ctx, uid, opp, 'purge', 1, null, card.title);
  }
}

// Direct damage to a player: Shield absorbs first (losing health), then Body Armor reduces by its block value.
// Returns the damage that reached the player.
function applyDirectDamage(ctx, def, amount) {
  const board = ctx.game.board[def];
  let dmg = amount;

  const shield = board.shield;
  if (dmg > 0 && shield && !shield.faceDown) {
    const roll = effectOf(shield).shieldRoll;
    if (roll && shield.usedTurn !== ctx.game.turnNo) {
      shield.usedTurn = ctx.game.turnNo;
      const r = rollDie(ctx, def, `"${shield.title}"`, (v) => (v % 2 === 0 ? `Even — reduce damage by ${roll.even}` : 'Odd — nullify all damage'));
      const before = dmg;
      dmg = r % 2 === 0 ? Math.max(0, dmg - roll.even) : 0;
      ctx.log(`"${shield.title}" rolls ${r} — damage ${before} → ${dmg}.`, 'dice');
    } else if (shield.health > 0) {
      const absorbed = Math.min(shield.health, dmg);
      shield.health -= absorbed;
      dmg -= absorbed;
      ctx.log(`"${shield.title}" absorbs ${absorbed} damage (${shield.health} health left).`, 'damage');
      if (shield.health <= 0) {
        delete board.shield;
        ctx.log(`"${shield.title}" is destroyed.`, 'damage');
        removeFromPlay(ctx, def, shield);
      }
    }
  }

  // Body Armor reduces direct damage by its block value and takes the damage it stopped,
  // so it wears down (and is exhausted at 0 health). Armor with no printed health just reduces.
  const armor = board['body-armor'];
  // "Hidden Carapace": its reduction grows by the damage it has already taken
  const armorBlock = (a) => (a.block || 0) + (effectOf(a).blockGrowsWithDamage ? Math.max(0, (a.baseHealth ?? a.health) - a.health) : 0);
  // "Permeable Paws": the attacker ignores Body Armor reduction
  const paws = faceUpWith(ctx.game, opponentOf(ctx.game, def), 'ignoreArmor')[0];
  if (dmg > 0 && armor && armorBlock(armor) > 0 && paws) {
    ctx.log(`"${paws.title}" slips past "${armor.title}" — its reduction is ignored.`, 'attack');
  } else if (dmg > 0 && armor && armorBlock(armor) > 0) {
    const takesHits = armor.health > 0;
    const reduced = Math.min(armorBlock(armor), dmg, takesHits ? armor.health : Infinity);
    dmg -= reduced;
    if (takesHits) {
      armor.health -= reduced;
      ctx.log(`"${armor.title}" reduces direct damage by ${reduced} and takes the hit (${armor.health} health left).`, 'damage');
      if (armor.health <= 0) {
        delete board['body-armor'];
        ctx.log(`"${armor.title}" is destroyed.`, 'damage');
        removeFromPlay(ctx, def, armor);
      }
    } else {
      ctx.log(`"${armor.title}" reduces direct damage by ${reduced}.`, 'damage');
    }
  }

  // Ability cards that reduce direct damage (e.g. "Chain Of Command-Illy")
  faceUpWith(ctx.game, def, 'directReduce').forEach((c) => {
    if (dmg <= 0 || !(c.block > 0)) return;
    const reduced = Math.min(c.block, dmg);
    dmg -= reduced;
    ctx.log(`"${c.title}" reduces direct damage by ${reduced}.`, 'counter');
  });

  if (dmg > 0) damagePlayer(ctx, def, dmg, 'the attack');
  else ctx.log(`${ctx.name(def)} takes no damage.`, 'counter');
  return dmg;
}

// Dice effects on counter cards. Returns the damage still coming through.
function applyCounterRoll(ctx, def, counterCard, net) {
  const kind = effectOf(counterCard).counterRoll;
  if (!kind || net <= 0) return net;
  if (kind === 'odd-negates') {
    const r = rollDie(ctx, def, `"${counterCard.title}"`, (v) => (v % 2 ? 'Odd — remaining damage negated' : 'Even — no extra effect'));
    if (r % 2) {
      ctx.log(`"${counterCard.title}" rolls ${r} (odd) — remaining damage negated!`, 'dice');
      return 0;
    }
    ctx.log(`"${counterCard.title}" rolls ${r} (even) — no extra effect.`, 'dice');
    return net;
  }
  if (kind === 'instinct-if-in-play') {
    const shield = ctx.game.board[def]?.shield;
    if (!shield || shield.faceDown || shield.title !== 'Instinct') return net;
    const cut = EFFECTS.Instinct.shieldRoll.even;
    const r = rollDie(ctx, def, `"${counterCard.title}" (Instinct)`, (v) => (v % 2 === 0 ? `Even — reduce damage by ${cut}` : 'Odd — nullify all damage'));
    const after = r % 2 === 0 ? Math.max(0, net - cut) : 0;
    ctx.log(`"${counterCard.title}" gains Instinct's roll: ${r} — damage ${net} → ${after}.`, 'dice');
    return after;
  }
  return net;
}

// Damages the card in owner's zone straight to its health (no Shield / Body Armor reduction). Destroys it at 0.
function damageCard(ctx, owner, zone, amount, source = '') {
  const card = ctx.game.board[owner]?.[zone];
  if (!card || Array.isArray(card) || card.faceDown || !(card.health > 0) || amount <= 0) return;
  const before = card.health;
  card.health = Math.max(0, card.health - amount);
  ctx.log(`"${card.title}" takes ${amount} damage${source ? ` from "${source}"` : ''} (${before} → ${card.health}).`, 'damage');
  if (card.health <= 0) {
    delete ctx.game.board[owner][zone];
    ctx.log(`"${card.title}" is destroyed.`, 'damage');
    removeFromPlay(ctx, owner, card);
    // Leftover damage carries over as direct damage, following the usual order: Shield → Body Armor → player.
    // (The destroyed card is already off the board, so it isn't hit twice.)
    const leftover = amount - before;
    if (leftover > 0 && ctx.game.players[owner]) {
      ctx.log(`${leftover} leftover damage carries over to ${ctx.name(owner)} — Shield, then Body Armor, then directly.`, 'damage');
      applyDirectDamage(ctx, owner, leftover);
    }
  }
}

// Zones holding "equip" cards (Weapon, Shield, Body Armor, Abilities).
const EQUIP_ZONES = ['weapon', 'shield', 'body-armor', ...ABILITY_ZONES];
const damageAllEquips = (ctx, owner, amount, source) => {
  const hit = EQUIP_ZONES.filter((z) => ctx.game.board[owner]?.[z]?.health > 0 && !ctx.game.board[owner][z].faceDown);
  if (!hit.length) {
    ctx.log(`"${source}" finds no equip cards to damage.`);
    return;
  }
  ctx.log(`"${source}" deals ${amount} damage to each of ${ctx.name(owner)}'s equip cards.`, 'attack');
  hit.forEach((z) => damageCard(ctx, owner, z, amount, source));
};
const hasFaceUp = (game, uid, title) =>
  PLAYABLE_ZONES.some((z) => { const c = game.board[uid]?.[z]; return c && !Array.isArray(c) && !c.faceDown && c.title === title; });

// Extra effects printed after an attack's or counter's main damage. They ignore the COUNTER! result.
function runFollowUps(ctx, a, counter) {
  const { game } = ctx;
  const atk = a.by;
  const def = a.defender;
  const fx = effectOf(a.card);
  // "Strikethrough": if the opponent declared COUNTER!, 30 more goes straight to them (can't be boosted)
  if (fx.onCounteredDirect && (counter || a.status === 'countering') && game.players[def]) {
    ctx.log(`"${a.card.title}" cuts through the COUNTER! — ${fx.onCounteredDirect} damage goes straight to ${ctx.name(def)}.`, 'attack');
    applyDirectDamage(ctx, def, fx.onCounteredDirect);
  }
  // "Crashing Mandibles": extra damage to the opponent's Body Armor (+10 with "Chain of Command-Inty")
  if (fx.armorHit && game.board[def]?.['body-armor']) {
    const bonus = fx.armorHit.bonusWith && hasFaceUp(game, atk, fx.armorHit.bonusWith) ? fx.armorHit.bonus : 0;
    damageCard(ctx, def, 'body-armor', fx.armorHit.amount + bonus, a.card.title);
  }
  // "Churning Constriction": against a stunned opponent, 10 damage to all of their equip cards
  if (fx.stunnedEquipHit && statusOf(game, def).stun) damageAllEquips(ctx, def, fx.stunnedEquipHit, a.card.title);
  // "Refraction" (Defend): if the attack was bigger than it blocks, 20 damage to all of the attacker's equip cards
  const cfx = counter ? effectOf(counter.card) : {};
  if (cfx.overflowEquipHit && a.damage > counter.value) damageAllEquips(ctx, atk, cfx.overflowEquipHit, counter.card.title);
}

function resolveAttack(ctx, counter) {
  const { game } = ctx;
  const a = game.attack;
  const def = a.defender;
  let net = Math.max(0, a.damage - (counter?.value || 0));

  if (counter) {
    const verb = counter.card.cardType === 'Defend' ? 'blocking' : 'striking back for';
    ctx.log(`${ctx.name(def)} counters with "${counter.card.title}", ${verb} ${counter.value}.`, 'counter');
    net = applyCounterRoll(ctx, def, counter.card, net);
    // "Diamond Carapace": if the attack exceeds what it blocks, take a fixed amount instead and discard a card
    const over = effectOf(counter.card).overflow;
    if (over && a.damage > counter.value) {
      net = over.take;
      ctx.log(`The attack exceeds "${counter.card.title}" — ${ctx.name(def)} takes ${over.take} instead.`, 'counter');
      forceHandDiscard(ctx, def, over.discard, counter.card.title);
    }
  }
  if (net > 0) net = reduceIncoming(ctx, def, net);
  if (net > 0) onAttackDamaged(ctx, a.by); // the attack got through and does damage

  if (net === 0) {
    ctx.log('The attack is fully countered!', 'counter');
    // "Illusionary Wind": a fully blocked attack refunds its attacker 1 SOUL
    faceUpWith(game, a.by, 'refundOnBlocked').forEach((c) => {
      const n = effectOf(c).refundOnBlocked;
      game.players[a.by].soul = (game.players[a.by].soul || 0) + n;
      ctx.log(`"${c.title}" refunds ${n} ${resourceLabel(game, a.by)} to ${ctx.name(a.by)}.`);
    });
  } else if (a.target.kind === 'player') {
    applyDirectDamage(ctx, def, net);
  } else {
    damageCard(ctx, def, a.target.zone, net);
  }

  // Second-part effects: they go off even when the main damage is fully blocked
  runFollowUps(ctx, a, counter);

  // Cards that grow each time they're attacked (e.g. Summon Inty), if still in play
  if (a.target.kind === 'card') {
    const t = game.board[def][a.target.zone];
    const grow = effectOf(t).growOnAttacked;
    if (t && !Array.isArray(t) && grow) {
      t.damage = (t.damage || 0) + grow;
      ctx.log(`"${t.title}" was attacked — its damage grows to ${t.damage}.`, 'attack');
    }
  }

  // Attack effects go off even when the damage is fully blocked — COUNTER! and reductions only stop damage.
  // Status from the attacking card (e.g. Burn)
  if (a.inflict?.on === 'hit') {
    inflictStatus(ctx, a.by, def, a.inflict.status, a.inflict.stacks, a.inflict.zone, a.card.title);
  }
  // "Churning Constriction": against a stunned opponent, the player who stunned them picks a card from their hand to discard
  const stunDiscard = effectOf(a.card).onHitStunnedDiscard;
  const stun = statusOf(game, def).stun;
  if (stunDiscard && stun) forceHandDiscard(ctx, def, stunDiscard, a.card.title, { chooser: stun.by || a.by });

  // Cast cards are spent; revealed Latent cards stay in play
  if (!a.fromLatent) pushDiscard(ctx, a.by, a.card);
  if (counter && !counter.fromLatent) pushDiscard(ctx, def, counter.card);
  game.clash = { by: a.by, defender: def, attackCard: a.card, counterCard: counter?.card || null };
  game.attack = null;
  checkDefeat(ctx);
}

// ---------- Detonation ----------
// Burn and Purge "can be detonated": the player who applied them may detonate during their own STRIKE! phase.
export function detonateStatus(sid, uid, statusId) {
  return act(sid, uid, (ctx) => {
    const { game } = ctx;
    if (game.phase !== 'strike' || game.turn !== uid || game.attack) fail('Detonate during your STRIKE! phase.');
    const def = statusDef(statusId);
    if (!def?.detonate) fail(`${def?.label || 'That status'} can't be detonated.`);
    const target = opponentOf(game, uid);
    const s = ensureStatus(game, target);
    const stacks = s[statusId];
    if (!stacks) fail(`${ctx.name(target)} has no ${def.label} stacks.`);
    s[statusId] = 0;
    ctx.log(`${ctx.name(uid)} detonates ${def.label} ×${stacks} on ${ctx.name(target)}!`, 'attack');
    damagePlayer(ctx, target, stacks * STATUS_DAMAGE_PER_STACK, `${def.label} detonation`);
    checkDefeat(ctx);
  });
}

export { LATENT_ZONES };

// ---------- Active effects (for the "what's affecting me" indicator) ----------
// Everything currently buffing or hindering uid, in plain words:
//   [{ id, kind: 'buff' | 'hinder' | 'pending' | 'idle', source, text }]
// 'pending' = something that turns on later (e.g. an Incantation tier); 'idle' = in play but not active right now.
export function activeEffectsFor(game, uid) {
  if (!game?.players?.[uid]) return [];
  const out = [];
  const add = (kind, source, text, key = `${source}|${text}`) => out.push({ id: key, kind, source, text });
  const opp = opponentOf(game, uid);
  const res = resourceOf(playerToken(game.players[uid])).label;
  const nails = nailCardsInPlay(game, uid).length;
  const oppStatus = opp ? statusOf(game, opp) : {};

  // Your face-up cards
  faceUpCards(game, uid).forEach((c) => {
    const fx = effectOf(c);
    if (fx.latentPassive === 'attack-discount') add('buff', c.title, `Attacks cost ${fx.amount} less ${res}`, `${c.iid}|disc`);
    if (fx.latentPassive === 'defend-boost') add('buff', c.title, `Defend cards block +${fx.amount}`, `${c.iid}|def`);
    if (fx.latentAuto === 'strike-damage') add('buff', c.title, `Strikes for ${summonPower(game, uid, c)} at the start of your STRIKE!`, `${c.iid}|strike`);
    if (fx.latentAuto === 'reduce-incoming') add('buff', c.title, `Reduces incoming attacks by ${summonPower(game, uid, c)}`, `${c.iid}|reduce`);
    if (fx.detonate && c.revealed) add('buff', c.title, `Can Detonate for ${fx.detonate.direct} direct damage`, `${c.iid}|det`);
    if (fx.onDamageSearch) add('buff', c.title, 'Damaging attacks fetch a "Nail" card', `${c.iid}|search`);
    if (fx.directBonus) {
      add(nails ? 'buff' : 'idle', c.title, nails ? `Direct damage +${fx.directBonus}` : `Direct damage +${fx.directBonus} (needs a face-up "Nail")`, `${c.iid}|skewer`);
    }
    if (fx.refundOnPaidAttack) {
      const used = c.usedTurn === game.turnNo;
      add(used ? 'idle' : 'buff', c.title, used ? 'Refund used this turn' : `Your first paid attack refunds ${fx.refundOnPaidAttack} ${res}`, `${c.iid}|refund`);
    }
    if (fx.drawOnOpponentDraw) add('buff', c.title, 'Draw a card when your opponent draws (once per turn)', `${c.iid}|hunt`);
    if (fx.refundOnBlocked) add('buff', c.title, `Fully blocked attacks refund ${fx.refundOnBlocked} ${res}`, `${c.iid}|wind`);
    if (fx.purgeBonus) {
      const on = oppStatus.purge > 0;
      add(on ? 'buff' : 'idle', c.title, on ? `Damage +${fx.purgeBonus} (opponent has Purge)` : `Damage +${fx.purgeBonus} while your opponent has Purge`, `${c.iid}|purr`);
    }
    if (fx.ignoreArmor) add('buff', c.title, 'Your direct damage ignores enemy Body Armor', `${c.iid}|paws`);
    if (fx.extraDraw && fx.drawFor === 'owner') add('buff', c.title, `Draw +${fx.extraDraw} each draw phase`, `${c.iid}|draw`);
    if (fx.regenArmorAfter) add('pending', c.title, `Restores your Armor Set in ${Math.max(0, fx.regenArmorAfter - (c.turnsActive || 0))} turn(s)`, `${c.iid}|regen`);
    if (fx.allDamageBonus && c.damage > 0) add('buff', c.title, `All your damage +${c.damage}`, `${c.iid}|all`);
    if (fx.directReduce && c.block > 0) add('buff', c.title, `Reduces direct damage by ${c.block}`, `${c.iid}|dr`);
    if (fx.chain) add('hinder', c.title, `You can't play "${fx.chain.removes}"`, `${c.iid}|lock`);
    if (fx.cardTargetBonus) {
      const inty = faceUpCards(game, uid).filter((x) => /inty/i.test(x.title)).length;
      add('buff', c.title, `+${fx.cardTargetBonus.amount + fx.cardTargetBonus.perInty * inty} damage when attacking cards`, `${c.iid}|rend`);
    }
    if (fx.summonBoost) add('buff', c.title, `Summon Inty / Summon Illy! +${fx.summonBoost}`, `${c.iid}|wand`);
    if (c.cardType === 'Body Armor') {
      const block = (c.block || 0) + (fx.blockGrowsWithDamage ? Math.max(0, (c.baseHealth ?? c.health) - c.health) : 0);
      if (block > 0) add('buff', c.title, `Reduces direct damage by ${block}${c.health > 0 ? ` (${c.health} health)` : ''}`, `${c.iid}|armor`);
    }
    if (c.cardType === 'Shield') {
      if (fx.shieldRoll) {
        const used = c.usedTurn === game.turnNo;
        add(used ? 'idle' : 'buff', c.title, used ? 'Roll used this turn' : `Direct damage: roll (even -${fx.shieldRoll.even}, odd nullify)`, `${c.iid}|shield`);
      } else if (c.health > 0) {
        add('buff', c.title, `Absorbs direct damage (${c.health} health)`, `${c.iid}|shield`);
      }
    }
  });
  // Cards that help everyone (e.g. Tilled Earth), on either side
  Object.keys(game.players).forEach((owner) => faceUpWith(game, owner, 'extraDraw').forEach((c) => {
    if (effectOf(c).drawFor === 'everyone') add('buff', c.title, `Draw +${effectOf(c).extraDraw} each draw phase (both players)`, `${c.iid}|everyone`);
  }));

  // Your Incantation: tiers that are on, and the ones still to come
  incantationTiers(game, uid).forEach((e) => {
    const left = e.tier - (e.card.tier || 0); // 1 = turns on at the end of your current/next turn
    const when = left === 1 ? 'the end of your turn' : `${left} of your turns from now`;
    add(e.active ? 'buff' : 'pending', `${e.card.title} · Turn ${e.tier}`, e.active ? e.fx.text : `${e.fx.text} (turns on at ${when})`, `${e.card.iid}|t${e.tier}`);
  });
  const pick = game.players[uid].deckPick;
  if (pick?.turnNo === game.turnNo) add('buff', pick.source, 'Deck search ready this turn', 'deckpick');

  // Statuses on you
  const s = statusOf(game, uid);
  if (s.burn > 0) add('hinder', 'Burn', `Take ${s.burn * STATUS_DAMAGE_PER_STACK} damage at the start of your turn (x${s.burn})`, 'st|burn');
  if (s.purge > 0) add('hinder', 'Purge', `Take ${s.purge * STATUS_DAMAGE_PER_STACK} damage at the start of your turn (x${s.purge})`, 'st|purge');
  if (s.frostbite) add('hinder', 'Frostbite', "You can't draw this turn", 'st|frostbite');
  else if (s.freeze > 0) add('hinder', 'Freeze', `Draws limited to ${FREEZE_DRAW_LIMIT} (x${s.freeze})`, 'st|freeze');
  if (s.stun) {
    const gravity = Object.keys(game.players).reduce((n, u) => n + faceUpWith(game, u, 'stunExtraDiscard').length, 0);
    add('hinder', 'Stun', `Roll at the start of your turn: even loses ${1 + gravity} card${gravity ? 's' : ''}`, 'st|stun');
  }

  // Opponent cards working against you
  if (opp) {
    faceUpCards(game, opp).forEach((c) => {
      const fx = effectOf(c);
      if (fx.ignoreArmor) add('hinder', c.title, 'Enemy direct damage ignores your Body Armor', `${c.iid}|opp`);
      if (fx.latentAuto === 'reduce-incoming') add('hinder', c.title, `Enemy reduces your attacks by ${summonPower(game, opp, c)}`, `${c.iid}|opp`);
      if (fx.latentAuto === 'strike-damage') add('hinder', c.title, `Enemy strikes you for ${summonPower(game, opp, c)} each of their turns`, `${c.iid}|opp`);
      if (fx.directReduce && c.block > 0) add('hinder', c.title, `Enemy reduces your direct damage by ${c.block}`, `${c.iid}|opp`);
      if (fx.drawOnOpponentDraw) add('hinder', c.title, 'Your opponent draws when you draw', `${c.iid}|opp`);
      if (fx.stunExtraDiscard) add('hinder', c.title, 'Stun costs 1 extra card', `${c.iid}|opp`);
    });
    incantationTiers(game, opp).filter((e) => e.active && e.fx.kind === 'strike-chip')
      .forEach((e) => add('hinder', e.card.title, `Enemy attacks also deal ${e.fx.amount} unblockable damage`, `${e.card.iid}|chip`));
  }
  return out;
}
