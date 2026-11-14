// Game rules engine. All state changes run as Firestore transactions so both players stay in sync.
//
// Public state lives on the session doc as `game` (both players can read it):
//   phase: 'setup' | 'start' | 'draw' | 'equip' | 'strike' | 'over'
//   round, turnNo (increments every turn), turn (uid), first (uid), winner (uid|null)
//   players: { [uid]: { name, health, ready, dealt, deckCount, handCount, soulCount,
//                       aetherType, idolType, incantationTurn, status } }
//     status: { burn 0-3, purge 0-3, freeze 0-2, frostbite 0-1, stun: null | { zone, by } }
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

export const STARTING_HEALTH = 400;
export const OPENING_HAND = 6;
export const DRAW_PER_TURN = 3;
export const FREEZE_DRAW_LIMIT = 2;
export const COUNTER_WINDOW_MS = 4000;
const STATUS_DAMAGE_PER_STACK = 10;

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
    desc: 'The stunning player picks one Ability slot; it is restricted until the end of the affected player’s turn.' },
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
  soulCount: 0,
  aetherType: null,
  idolType: null,
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
export const isSoulCard = (c) => c.cardType === 'Soul';
export const soulInHand = (hand, exceptIid) => hand.filter((c) => isSoulCard(c) && c.iid !== exceptIid).length;
export const canAfford = (hand, card) => soulInHand(hand, card.iid) >= (card.soulCost || 0);

// A card can only be played if it matches the player's Aether and Idol tokens (SOUL cards are neutral).
export const affinityOk = (player, card) =>
  isSoulCard(card) || (card.aetherType === player?.aetherType && card.idolType === player?.idolType);

// The value a card contributes when played as a COUNTER!: Defend cards block, Attack cards strike back.
export const counterValue = (card) => (card.cardType === 'Defend' ? card.block || 0 : card.damage || 0);

// Empty zones this card may legally be placed into right now.
export function validZonesFor(game, uid, card) {
  if (isSoulCard(card)) return [];
  const board = game.board[uid] || {};
  const player = game.players[uid];
  const stunned = player?.status?.stun?.zone;
  const zones = game.phase === 'start' ? ['body-armor'] : PLAYABLE_ZONES;
  return zones.filter((z) => {
    if (!zoneAccepts(z, card) || z === stunned) return false;
    if (z === 'incantation') {
      return (board.incantation || []).length < MAX_INCANTATIONS && player.incantationTurn !== game.turnNo;
    }
    // Abilities may replace an Ability already in play (still max 2 slots); the old one is discarded
    if (ABILITY_ZONES.includes(z) && game.phase === 'equip') return true;
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
  aetherType: c.aetherType,
  idolType: c.idolType,
  art: c.art || null,
  artCrop: c.artCrop || null,
  inflictStatus: c.inflictStatus || '',
  inflictStacks: Number(c.inflictStacks) || 1,
  inflictOn: c.inflictOn || 'hit',
});

// Reset in-play state when a card returns to the deck from the discard pile.
const freshCopy = (c) => {
  const { revealed, usedTurn, ...rest } = c; // eslint-disable-line no-unused-vars
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
      p.soulCount = soulInHand(ctx.hand.hand);
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
}

const ensureStatus = (game, uid) => {
  const p = game.players[uid];
  p.status = { ...emptyStatus(), ...(p.status || {}) };
  return p.status;
};

const bothReady = (game) =>
  Object.keys(game.players).length === 2 && Object.values(game.players).every((p) => p.ready);

// Discards SOUL cards from hand to pay for `card`. Throws if the player can't afford it.
function paySoul(ctx, card) {
  const cost = card.soulCost || 0;
  if (cost <= 0) return;
  const available = soulInHand(ctx.hand.hand, card.iid);
  if (available < cost) {
    fail(`"${card.title}" costs ${cost} SOUL, but you only have ${available} SOUL card${available === 1 ? '' : 's'} in hand.`);
  }
  for (let paid = 0; paid < cost; paid++) {
    const i = ctx.hand.hand.findIndex((c) => isSoulCard(c) && c.iid !== card.iid);
    pushDiscard(ctx, ctx.uid, ctx.hand.hand.splice(i, 1)[0]);
  }
  ctx.log(`${ctx.name(ctx.uid)} paid ${cost} SOUL for "${card.title}".`);
}

function requireAffinity(ctx, card) {
  const p = ctx.game.players[ctx.uid];
  if (!affinityOk(p, card)) {
    fail(`"${card.title}" is ${card.aetherType}/${card.idolType}, but your tokens are ${p.aetherType}/${p.idolType}.`);
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
  return drawn;
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
// Player picks a deck plus their Aether and Idol tokens; the whole deck is shuffled.
export function setupReady(sid, uid, deckCards, aetherType, idolType) {
  return act(sid, uid, (ctx) => {
    const { game } = ctx;
    if (game.phase !== 'setup') fail('Setup is already over.');
    if (game.players[uid].ready) return false;
    if (!aetherType || !idolType) fail('Choose your Aether and Idol tokens.');
    if (deckCards.length === 0) fail('That deck has no cards.');

    const deck = shuffle(deckCards.map(toPlayable));
    ctx.hand = { deck, hand: [], dealt: false, latent: {} };
    game.board[uid] = { incantation: [] };
    game.discard[uid] = [];
    (game.exhausted ||= {})[uid] = [];
    Object.assign(game.players[uid], { aetherType, idolType, ready: true, status: emptyStatus() });
    ctx.log(`${ctx.name(uid)} set their tokens — Aether: ${aetherType}, Idol: ${idolType} — and shuffled a ${deck.length}-card deck.`);

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
      ctx.log(`${ctx.name(game.first)}'s Equip phase.`, 'phase');
    }
  });
}

// ---------- Placing cards ----------
export function placeCard(sid, uid, iid, zoneId) {
  return act(sid, uid, (ctx) => {
    const { game } = ctx;
    const card = findInHand(ctx, iid);
    if (isSoulCard(card)) fail('SOUL cards are resources. Keep them in your hand to pay for other cards.');

    if (game.phase === 'start') {
      if (game.players[uid].ready) fail('You have already readied up.');
      if (card.cardType !== 'Body Armor') fail('Only Body Armor can be set during the Start phase.');
    } else if (game.phase === 'equip') {
      if (game.turn !== uid) fail("It's not your turn.");
      if (game.attack) fail('Resolve the current attack first.');
    } else {
      fail('Cards can only be equipped during the Equip phase.');
    }

    requireAffinity(ctx, card);
    if (!validZonesFor(game, uid, card).includes(zoneId)) {
      if (zoneId === 'incantation' && game.players[uid].incantationTurn === game.turnNo) fail('Only 1 Incantation can be played per turn.');
      if (game.players[uid].status?.stun?.zone === zoneId) fail(`${zoneLabel(zoneId)} is restricted by Stun.`);
      fail(`"${card.title}" can't be placed in ${zoneLabel(zoneId)}.`);
    }

    paySoul(ctx, card);
    takeFromHand(ctx, iid);
    const board = game.board[uid];

    if (isLatentCard(card)) {
      // Real card stays private; the board only shows a face-down card
      ctx.hand.latent[zoneId] = card;
      board[zoneId] = { faceDown: true };
      ctx.log(`${ctx.name(uid)} set a face-down Latent card in ${zoneLabel(zoneId)}.`);
    } else if (zoneId === 'incantation') {
      board.incantation = [...(board.incantation || []), card];
      game.players[uid].incantationTurn = game.turnNo;
      const n = board.incantation.length;
      ctx.log(`${ctx.name(uid)} played Incantation "${card.title}" (${n}/${MAX_INCANTATIONS}).`);
      if (n === MAX_INCANTATIONS) ctx.log(`${ctx.name(uid)}'s Incantations awaken — all ${MAX_INCANTATIONS} are now in effect!`, 'phase');
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

// ---------- Turn flow ----------
function endTurnEffects(ctx, uid) {
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

function startTurnEffects(ctx, uid) {
  // Face-up Latent cards that grow each turn they stay active (e.g. Summon Illy!)
  autoLatents(ctx, uid, 'reduce-incoming').forEach((c) => {
    const grow = effectOf(c).growPerTurn || 0;
    if (!grow) return;
    c.block = (c.block || 0) + grow;
    ctx.log(`"${c.title}" grows — it now reduces incoming damage by ${c.block}.`, 'counter');
  });
  const s = ensureStatus(ctx.game, uid);
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
    game.phase = 'equip';
    ctx.log(`${ctx.name(uid)}'s Equip phase.`, 'phase');
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
// opts.stunZone: Ability slot the attacker chooses to restrict when the card stuns.
export function declareAttack(sid, uid, source, target, opts = {}) {
  return act(sid, uid, (ctx) => {
    const { game } = ctx;
    if (game.phase !== 'strike' || game.turn !== uid) fail('Attacks can only be declared during your STRIKE! phase.');
    if (game.attack) fail('An attack is already in progress.');
    const defender = opponentOf(game, uid);
    if (target.kind === 'card') {
      const t = game.board[defender]?.[target.zone];
      if (!t || t.faceDown || Array.isArray(t) || !(t.health > 0)) fail('Only face-up cards with health can be targeted.');
    }

    const { card, fromLatent } = takeSource(ctx, source, ['Attack'], 'attack');
    game.attack = {
      id: crypto.randomUUID(),
      by: uid,
      defender,
      card,
      fromLatent,
      damage: card.damage,
      target,
      targetTitle: target.kind === 'card' ? game.board[defender][target.zone].title : null,
      status: 'open',
      at: Date.now(),
    };
    game.clash = { by: uid, defender, attackCard: card, counterCard: null };
    ctx.log(`${ctx.name(uid)} attacks ${targetLabel(ctx, defender, target)} with "${card.title}" for ${card.damage} damage!`, 'attack');

    if (card.inflictStatus) {
      const inflict = { status: card.inflictStatus, stacks: card.inflictStacks || 1, on: card.inflictOn || 'hit', zone: opts.stunZone || null };
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

export function playCounter(sid, uid, source) {
  return act(sid, uid, (ctx) => {
    const a = ctx.game.attack;
    if (!a || a.status !== 'countering' || a.defender !== uid) fail('There is no COUNTER! to play.');
    const { card, fromLatent } = takeSource(ctx, source, ['Attack', 'Defend'], 'COUNTER!');
    resolveAttack(ctx, { card, fromLatent, value: counterValue(card) });
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
  // Shield: once per turn, direct damage triggers a roll — even: reduce by 80, odd: nullify it.
  Instinct: { shieldRoll: { even: 80 } },
  // Defend: block 30, then roll — odd: negate any remaining damage.
  'Brace For Impact!': { counterRoll: 'odd-negates' },
  // Defend: block 40; if "Instinct" is in play it gains Instinct's roll (even: −80, odd: nullify).
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
};
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
    if (dmg <= 0 || !(c.block > 0)) return;
    const reduced = Math.min(c.block, dmg);
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
    ctx.log(`"${c.title}" strikes ${ctx.name(opp)} for ${c.damage} damage!`, 'attack');
    const dmg = reduceIncoming(ctx, opp, c.damage);
    if (dmg > 0) applyDirectDamage(ctx, opp, dmg);
    else ctx.log(`${ctx.name(opp)} takes no damage.`, 'counter');
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
    const slot = ABILITY_ZONES.includes(zone) ? zone : ABILITY_ZONES[0];
    s.stun = { zone: slot, by };
    ctx.log(`${ctx.name(target)} is stunned${from} — ${zoneLabel(slot)} is restricted until the end of their turn.`, 'status');
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

function runEquipEffect(ctx, uid, card) {
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

  const armor = board['body-armor'];
  if (dmg > 0 && armor && armor.block > 0) {
    const reduced = Math.min(armor.block, dmg);
    dmg -= reduced;
    ctx.log(`"${armor.title}" reduces direct damage by ${reduced}.`, 'damage');
  }

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
    const r = rollDie(ctx, def, `"${counterCard.title}" (Instinct)`, (v) => (v % 2 === 0 ? 'Even — reduce damage by 80' : 'Odd — nullify all damage'));
    const after = r % 2 === 0 ? Math.max(0, net - 80) : 0;
    ctx.log(`"${counterCard.title}" gains Instinct's roll: ${r} — damage ${net} → ${after}.`, 'dice');
    return after;
  }
  return net;
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
  }
  if (net > 0) net = reduceIncoming(ctx, def, net);

  let landed = 0;
  if (net === 0) {
    ctx.log('The attack is fully countered!', 'counter');
  } else if (a.target.kind === 'player') {
    landed = applyDirectDamage(ctx, def, net);
  } else {
    const card = game.board[def][a.target.zone];
    if (card && !Array.isArray(card)) {
      const before = card.health;
      card.health = Math.max(0, card.health - net);
      landed = before - card.health;
      ctx.log(`"${card.title}" takes ${net} damage (${before} → ${card.health}).`, 'damage');
      if (card.health <= 0) {
        delete game.board[def][a.target.zone];
        ctx.log(`"${card.title}" is destroyed.`, 'damage');
        removeFromPlay(ctx, def, card);
      }
    }
  }

  // Cards that grow each time they're attacked (e.g. Summon Inty), if still in play
  if (a.target.kind === 'card') {
    const t = game.board[def][a.target.zone];
    const grow = effectOf(t).growOnAttacked;
    if (t && !Array.isArray(t) && grow) {
      t.damage = (t.damage || 0) + grow;
      ctx.log(`"${t.title}" was attacked — its damage grows to ${t.damage}.`, 'attack');
    }
  }

  // On-hit status from the attacking card (e.g. Burn) once damage actually lands
  if (a.inflict?.on === 'hit' && landed > 0) {
    inflictStatus(ctx, a.by, def, a.inflict.status, a.inflict.stacks, a.inflict.zone, a.card.title);
  }

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
