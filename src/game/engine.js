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
//   attack:  null | { id, by, defender, card, fromLatent, damage, target, targetTitle, status: 'open'|'countering', at }
//   clash:   null | { by, defender, attackCard, counterCard }   (shown in the Strike! areas until the turn ends)
// Private state (only the owner can read): sessions/{id}/hands/{uid}
//   { deck: card[], hand: card[], dealt, latent: { [zoneId]: card } }   (latent = the real face-down cards)
// Event log: sessions/{id}/log/{auto}  { text, kind, uid, at }
import { collection, doc, limitToLast, onSnapshot, orderBy, query, runTransaction } from 'firebase/firestore';
import { db } from '../firebase/config.js';
import { ABILITY_ZONES, LATENT_ZONES, MAX_INCANTATIONS, PLAYABLE_ZONES, isLatentCard, zoneAccepts, zoneLabel } from './zones.js';

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

const rollDie = () => 1 + Math.floor(Math.random() * 6);

// Copy of a deck card for use in a match (each copy gets a unique instance id).
const toPlayable = (c) => ({
  iid: crypto.randomUUID(),
  cardId: c.id,
  title: c.title || 'Untitled',
  cardType: c.cardType,
  typeAction: c.typeAction || '',
  description: c.description || '',
  soulCost: Number(c.soulCost) || 0,
  health: Number(c.health) || 0,
  baseHealth: Number(c.health) || 0,
  damage: Number(c.damage) || 0,
  block: Number(c.block) || 0,
  healthPlus: Boolean(c.healthPlus),
  damagePlus: Boolean(c.damagePlus),
  aetherType: c.aetherType,
  idolType: c.idolType,
  art: c.art || null,
  artCrop: c.artCrop || null,
});

// Reset in-play state when a card returns to the deck from the discard pile.
const freshCopy = (c) => {
  const { revealed, usedTurn, ...rest } = c; // eslint-disable-line no-unused-vars
  return { ...rest, health: c.baseHealth ?? c.health };
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
      board[zoneId] = card;
      ctx.log(`${ctx.name(uid)} equipped "${card.title}" to ${zoneLabel(zoneId)}.`);
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
  const s = ensureStatus(ctx.game, uid);
  if (s.burn > 0) damagePlayer(ctx, uid, s.burn * STATUS_DAMAGE_PER_STACK, `Burn ×${s.burn}`);
  if (s.purge > 0) damagePlayer(ctx, uid, s.purge * STATUS_DAMAGE_PER_STACK, `Purge ×${s.purge}`);
  if (s.freeze > 0) {
    const r = rollDie();
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

// Direct damage to a player: Shield absorbs first (losing health), then Body Armor reduces by its block value.
function applyDirectDamage(ctx, def, amount) {
  const board = ctx.game.board[def];
  let dmg = amount;

  const shield = board.shield;
  if (dmg > 0 && shield && !shield.faceDown && shield.health > 0) {
    const absorbed = Math.min(shield.health, dmg);
    shield.health -= absorbed;
    dmg -= absorbed;
    ctx.log(`"${shield.title}" absorbs ${absorbed} damage (${shield.health} health left).`, 'damage');
    if (shield.health <= 0) {
      delete board.shield;
      pushDiscard(ctx, def, shield);
      ctx.log(`"${shield.title}" is destroyed.`, 'damage');
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
}

function resolveAttack(ctx, counter) {
  const { game } = ctx;
  const a = game.attack;
  const def = a.defender;
  const net = Math.max(0, a.damage - (counter?.value || 0));

  if (counter) {
    const verb = counter.card.cardType === 'Defend' ? 'blocking' : 'striking back for';
    ctx.log(`${ctx.name(def)} counters with "${counter.card.title}", ${verb} ${counter.value}.`, 'counter');
  }

  if (net === 0) {
    ctx.log('The attack is fully countered!', 'counter');
  } else if (a.target.kind === 'player') {
    applyDirectDamage(ctx, def, net);
  } else {
    const card = game.board[def][a.target.zone];
    if (card && !Array.isArray(card)) {
      const before = card.health;
      card.health = Math.max(0, card.health - net);
      ctx.log(`"${card.title}" takes ${net} damage (${before} → ${card.health}).`, 'damage');
      if (card.health <= 0) {
        delete game.board[def][a.target.zone];
        pushDiscard(ctx, def, card);
        ctx.log(`"${card.title}" is destroyed.`, 'damage');
      }
    }
  }

  // Cast cards are spent; revealed Latent cards stay in play
  if (!a.fromLatent) pushDiscard(ctx, a.by, a.card);
  if (counter && !counter.fromLatent) pushDiscard(ctx, def, counter.card);
  game.clash = { by: a.by, defender: def, attackCard: a.card, counterCard: counter?.card || null };
  game.attack = null;
  checkDefeat(ctx);
}

// ---------- Status effects (applied by card effects, so players apply them manually) ----------
function requireActiveGame(game) {
  if (game.phase === 'setup' || game.phase === 'start' || game.phase === 'over') fail('Statuses can only be changed during the match.');
}

export function applyStatus(sid, uid, target, statusId, zone) {
  return act(sid, uid, (ctx) => {
    const { game } = ctx;
    requireActiveGame(game);
    const def = statusDef(statusId);
    const s = ensureStatus(game, target);

    if (statusId === 'stun') {
      if (s.stun) fail(`${ctx.name(target)} is already stunned.`);
      if (!ABILITY_ZONES.includes(zone)) fail('Choose which Ability slot to restrict.');
      s.stun = { zone, by: uid };
      ctx.log(`${ctx.name(uid)} stuns ${ctx.name(target)} — ${zoneLabel(zone)} is restricted until the end of their turn.`, 'status');
      return;
    }
    if (statusId === 'frostbite' && s.freeze < statusDef('freeze').max) {
      fail('Frostbite can only be applied when Freeze is at max stacks (2).');
    }
    if (s[statusId] >= def.max) fail(`${def.label} is already at max stacks (${def.max}).`);
    s[statusId] += 1;
    ctx.log(`${ctx.name(uid)} applies ${def.label} to ${ctx.name(target)} (${s[statusId]}/${def.max}).`, 'status');
  });
}

export function removeStatus(sid, uid, target, statusId) {
  return act(sid, uid, (ctx) => {
    const { game } = ctx;
    requireActiveGame(game);
    const def = statusDef(statusId);
    const s = ensureStatus(game, target);
    if (statusId === 'stun') {
      if (!s.stun) return false;
      s.stun = null;
    } else {
      if (!s[statusId]) return false;
      s[statusId] -= 1;
    }
    ctx.log(`${ctx.name(uid)} removes a ${def.label} stack from ${ctx.name(target)}.`, 'status');
  });
}

export function detonateStatus(sid, uid, target, statusId) {
  return act(sid, uid, (ctx) => {
    const { game } = ctx;
    requireActiveGame(game);
    const def = statusDef(statusId);
    if (!def.detonate) fail(`${def.label} can't be detonated.`);
    const s = ensureStatus(game, target);
    const stacks = s[statusId];
    if (!stacks) fail(`${ctx.name(target)} has no ${def.label} stacks.`);
    s[statusId] = 0;
    ctx.log(`${ctx.name(uid)} detonates ${def.label} ×${stacks} on ${ctx.name(target)}!`, 'attack');
    damagePlayer(ctx, target, stacks * STATUS_DAMAGE_PER_STACK, `${def.label} detonation`);
    checkDefeat(ctx);
  });
}

// For card text like "Roll a die": result is logged for both players.
export function rollDieForCard(sid, uid) {
  return act(sid, uid, (ctx) => {
    if (ctx.game.phase === 'setup' || ctx.game.phase === 'over') fail('No match in progress.');
    const r = rollDie();
    ctx.log(`${ctx.name(uid)} rolled a ${r} (${r % 2 === 0 ? 'even' : 'odd'}).`, 'dice');
  });
}

export { LATENT_ZONES };
