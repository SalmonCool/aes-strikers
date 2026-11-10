// Game rules engine. All state changes run as Firestore transactions so both players stay in sync.
//
// Public state lives on the session doc as `game` (both players can read it):
//   phase: 'setup' | 'start' | 'draw' | 'equip' | 'strike' | 'over'
//   round, turn (uid), first (uid), winner (uid|null)
//   players: { [uid]: { name, health, ready, dealt, deckCount, handCount } }
//   board:   { [uid]: { [zoneId]: card } }
//   discard: { [uid]: card[] }
//   attack:  null | { id, by, defender, card, damage, target, status: 'open'|'countering', at }
// Private state (only the owner can read): sessions/{id}/hands/{uid}  { deck: card[], hand: card[], dealt }
// Event log: sessions/{id}/log/{auto}  { text, kind, uid, at }
import { collection, doc, limitToLast, onSnapshot, orderBy, query, runTransaction } from 'firebase/firestore';
import { db } from '../firebase/config.js';
import { PLAYABLE_ZONES, zoneLabel } from './zones.js';

export const STARTING_HEALTH = 400;
export const OPENING_HAND = 6;
export const DRAW_PER_TURN = 3;
export const COUNTER_WINDOW_MS = 4000;

export const PHASES = [
  { id: 'setup', label: 'Setup', repeats: false },
  { id: 'start', label: 'Start', repeats: false },
  { id: 'draw', label: 'Draw', repeats: true },
  { id: 'equip', label: 'Equip', repeats: true },
  { id: 'strike', label: 'STRIKE!', repeats: true },
];

export const newPlayer = (name) => ({
  name, health: STARTING_HEALTH, ready: false, dealt: false, deckCount: 0, handCount: 0,
});

export const newGame = (hostUid, hostName) => ({
  phase: 'setup',
  round: 0,
  turn: null,
  first: hostUid, // host takes the first turn
  winner: null,
  players: { [hostUid]: newPlayer(hostName) },
  board: { [hostUid]: {} },
  discard: { [hostUid]: [] },
  attack: null,
});

export const opponentOf = (game, uid) => Object.keys(game.players).find((u) => u !== uid) || null;

const sessionRef = (sid) => doc(db, 'sessions', sid);
const handRef = (sid, uid) => doc(db, 'sessions', sid, 'hands', uid);
const logCol = (sid) => collection(db, 'sessions', sid, 'log');

// ---------- Subscriptions ----------
export const watchHand = (sid, uid, cb) =>
  onSnapshot(handRef(sid, uid), (s) => cb(s.exists() ? s.data() : { deck: [], hand: [], dealt: false }));

export const watchLog = (sid, cb) =>
  onSnapshot(query(logCol(sid), orderBy('at'), limitToLast(300)), (s) =>
    cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

// ---------- Helpers ----------
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Copy of a collection card for use in a match (each copy gets a unique instance id).
const toPlayable = (c) => ({
  iid: crypto.randomUUID(),
  cardId: c.id,
  title: c.title || 'Untitled',
  cardType: c.cardType,
  typeAction: c.typeAction,
  description: c.description || '',
  soulCost: Number(c.soulCost) || 0,
  health: Number(c.health) || 0,
  damage: Number(c.damage) || 0,
  aetherType: c.aetherType,
  idolType: c.idolType,
  art: c.art || null,
});

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
      hand = h.exists() ? h.data() : { deck: [], hand: [], dealt: false };
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
      game.players[uid].deckCount = ctx.hand.deck.length;
      game.players[uid].handCount = ctx.hand.hand.length;
      tx.set(handRef(sid, uid), ctx.hand);
    }
    tx.update(sessionRef(sid), { game });
    const now = Date.now();
    logs.forEach((l, i) => tx.set(doc(logCol(sid)), { ...l, uid, at: now + i }));
    return true;
  });
}

const takeFromHand = (ctx, iid) => {
  const i = ctx.hand.hand.findIndex((c) => c.iid === iid);
  if (i < 0) fail('That card is no longer in your hand.');
  return ctx.hand.hand.splice(i, 1)[0];
};

const bothReady = (game) =>
  Object.keys(game.players).length === 2 && Object.values(game.players).every((p) => p.ready);

// ---------- Setup ----------
// Player picks an Idol card and an Aether card from their collection; the rest becomes their shuffled deck.
export function setupReady(sid, uid, collectionCards, idolId, aetherId) {
  return act(sid, uid, (ctx) => {
    const { game } = ctx;
    if (game.phase !== 'setup') fail('Setup is already over.');
    if (game.players[uid].ready) return false;
    const idol = collectionCards.find((c) => c.id === idolId);
    const aether = collectionCards.find((c) => c.id === aetherId);
    if (!idol || !aether || idolId === aetherId) fail('Choose two different cards for your Idol and Aether.');

    const deck = shuffle(collectionCards.filter((c) => c.id !== idolId && c.id !== aetherId).map(toPlayable));
    ctx.hand = { deck, hand: [], dealt: false };
    game.board[uid] = { idol: toPlayable(idol), aether: toPlayable(aether) };
    game.discard[uid] = [];
    game.players[uid].ready = true;
    ctx.log(`${ctx.name(uid)} set Idol "${idol.title}" and Aether "${aether.title}", then shuffled a ${deck.length}-card deck.`);

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
    const drawn = ctx.hand.deck.splice(0, OPENING_HAND);
    ctx.hand.hand.push(...drawn);
    ctx.hand.dealt = true;
    ctx.game.players[uid].dealt = true;
    ctx.log(`${ctx.name(uid)} drew ${drawn.length} cards.`);
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
    const card = ctx.hand.hand.find((c) => c.iid === iid);
    if (!card) fail('That card is no longer in your hand.');
    if (!PLAYABLE_ZONES.includes(zoneId)) fail('Cards cannot be placed there.');
    if (game.board[uid][zoneId]) fail('That zone is already occupied.');

    if (game.phase === 'start') {
      if (game.players[uid].ready) fail('You have already readied up.');
      if (card.cardType !== 'Body Armor' || zoneId !== 'body-armor') fail('Only Body Armor can be set during the Start phase.');
    } else if (game.phase === 'equip') {
      if (game.turn !== uid) fail("It's not your turn.");
    } else {
      fail('Cards can only be equipped during the Equip phase.');
    }

    takeFromHand(ctx, iid);
    game.board[uid][zoneId] = card;
    ctx.log(`${ctx.name(uid)} equipped "${card.title}" to ${zoneLabel(zoneId)}.`);
  }, { withHand: true });
}

// ---------- Turn flow ----------
export function endPhase(sid, uid) {
  return act(sid, uid, (ctx) => {
    const { game } = ctx;
    if (game.turn !== uid) fail("It's not your turn.");
    if (game.attack) fail('Resolve the current attack first.');

    if (game.phase === 'equip') {
      game.phase = 'strike';
      ctx.log(`${ctx.name(uid)}'s STRIKE! phase.`, 'phase');
    } else if (game.phase === 'strike') {
      const next = opponentOf(game, uid);
      game.turn = next;
      if (next === game.first) {
        game.round += 1;
        ctx.log(`Round ${game.round} begins.`, 'phase');
      }
      if (game.round === 1) {
        game.phase = 'equip';
        ctx.log(`${ctx.name(next)}'s turn. (No Draw phase in round 1.) Equip phase.`, 'phase');
      } else {
        game.phase = 'draw';
        ctx.log(`${ctx.name(next)}'s turn — Draw phase.`, 'phase');
      }
    } else {
      fail('Nothing to end right now.');
    }
  });
}

export function drawForTurn(sid, uid) {
  return act(sid, uid, (ctx) => {
    const { game } = ctx;
    if (game.phase !== 'draw' || game.turn !== uid) return false;
    const drawn = ctx.hand.deck.splice(0, DRAW_PER_TURN);
    ctx.hand.hand.push(...drawn);
    ctx.log(
      drawn.length
        ? `${ctx.name(uid)} drew ${drawn.length} card${drawn.length === 1 ? '' : 's'}.`
        : `${ctx.name(uid)}'s deck is empty — no cards drawn.`,
    );
    game.phase = 'equip';
    ctx.log(`${ctx.name(uid)}'s Equip phase.`, 'phase');
  }, { withHand: true });
}

// ---------- Attacks & COUNTER ----------
const targetLabel = (ctx, defender, target) =>
  target.kind === 'player'
    ? ctx.name(defender)
    : `${ctx.name(defender)}'s "${ctx.game.board[defender][target.zone]?.title}"`;

// target: { kind: 'player' } | { kind: 'card', zone }
export function declareAttack(sid, uid, iid, target) {
  return act(sid, uid, (ctx) => {
    const { game } = ctx;
    if (game.phase !== 'strike' || game.turn !== uid) fail('Attacks can only be declared during your STRIKE! phase.');
    if (game.attack) fail('An attack is already in progress.');
    const card = ctx.hand.hand.find((c) => c.iid === iid);
    if (!card) fail('That card is no longer in your hand.');
    if (card.cardType !== 'Attack') fail('Only Attack cards can be used to attack.');

    const defender = opponentOf(game, uid);
    if (target.kind === 'card') {
      const t = game.board[defender]?.[target.zone];
      if (!t || !(t.health > 0)) fail('Only cards with health can be targeted.');
    }

    takeFromHand(ctx, iid);
    game.attack = {
      id: crypto.randomUUID(),
      by: uid,
      defender,
      card,
      damage: card.damage,
      target,
      targetTitle: target.kind === 'card' ? game.board[defender][target.zone].title : null,
      status: 'open',
      at: Date.now(),
    };
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

export function playCounter(sid, uid, iid) {
  return act(sid, uid, (ctx) => {
    const a = ctx.game.attack;
    if (!a || a.status !== 'countering' || a.defender !== uid) fail('There is no COUNTER! to play.');
    const card = ctx.hand.hand.find((c) => c.iid === iid);
    if (!card) fail('That card is no longer in your hand.');
    if (card.cardType !== 'Attack') fail('Only Attack cards can be played as a COUNTER!');
    takeFromHand(ctx, iid);
    resolveAttack(ctx, card);
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

function resolveAttack(ctx, counterCard) {
  const { game } = ctx;
  const a = game.attack;
  const def = a.defender;
  const counter = counterCard ? counterCard.damage : 0;
  const net = Math.max(0, a.damage - counter);

  if (counterCard) {
    ctx.log(`${ctx.name(def)} counters with "${counterCard.title}" for ${counter} damage.`, 'counter');
  }

  if (net === 0) {
    ctx.log('The attack is fully countered!', 'counter');
  } else if (a.target.kind === 'player') {
    const p = game.players[def];
    const before = p.health;
    p.health = Math.max(0, p.health - net);
    ctx.log(`${ctx.name(def)} takes ${net} damage (${before} → ${p.health}).`, 'damage');
  } else {
    const card = game.board[def][a.target.zone];
    if (card) {
      const before = card.health;
      card.health = Math.max(0, card.health - net);
      ctx.log(`"${card.title}" takes ${net} damage (${before} → ${card.health}).`, 'damage');
      if (card.health <= 0) {
        delete game.board[def][a.target.zone];
        (game.discard[def] ||= []).push(card);
        ctx.log(`"${card.title}" is destroyed.`, 'damage');
      }
    }
  }

  (game.discard[a.by] ||= []).push(a.card);
  if (counterCard) (game.discard[def] ||= []).push(counterCard);
  game.attack = null;

  if (game.players[def].health <= 0) {
    game.phase = 'over';
    game.winner = a.by;
    ctx.log(`${ctx.name(a.by)} wins the match!`, 'victory');
  }
}
