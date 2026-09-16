'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Leekha, MATCH_LIMIT } = require('./leekha');
const Bot = require('./bot');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 4;
const GIFT_SECONDS = 20;
const TURN_SECONDS = 30;
const TRICK_HOLD_MS = 1800;
const LOBBY_DISCONNECT_GRACE_MS = 20000;
// Flip to true once testing is over: the host then needs four human players
// and bots are refused.
const REQUIRE_FOUR_HUMANS = false;

const GAMES = {
  leekha: { name: 'ليخة', ready: true },
  trix: { name: 'تريكس', ready: false },
  trixComplex: { name: 'تريكس كومبلكس', ready: false },
  four00: { name: '400', ready: false },
};

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---------------------------------------------------------------------------
// Rooms ("ديوان")
// ---------------------------------------------------------------------------

const rooms = new Map(); // code -> room
const playerRoom = new Map(); // playerId -> code

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++)
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  const n = String(name || '').trim().slice(0, 18);
  return n || 'ضيف';
}

function createRoom(gameKey) {
  const room = {
    code: genCode(),
    game: gameKey,
    hostId: null,
    players: [], // { id, name, seat, socketId, connected, isBot, graceTimer }
    engine: null,
    giftTimer: null,
    trickTimer: null,
    turnTimer: null,
    botTimers: [],
    notice: null,
    createdAt: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

const humans = (room) => room.players.filter((p) => !p.isBot);
const seatPlayer = (room, seat) => room.players.find((p) => p.seat === seat);

function freeSeat(room) {
  for (let s = 0; s < MAX_PLAYERS; s++) if (!seatPlayer(room, s)) return s;
  return -1;
}

function phaseOf(room) {
  return room.engine ? room.engine.phase : 'lobby';
}

function clearTimers(room) {
  clearTimeout(room.giftTimer);
  clearTimeout(room.trickTimer);
  clearTimeout(room.turnTimer);
  room.botTimers.forEach(clearTimeout);
  room.giftTimer = room.trickTimer = room.turnTimer = null;
  room.botTimers = [];
}

function destroyRoom(room) {
  clearTimers(room);
  for (const p of room.players) {
    clearTimeout(p.graceTimer);
    playerRoom.delete(p.id);
  }
  rooms.delete(room.code);
}

function removePlayer(room, player) {
  clearTimeout(player.graceTimer);
  room.players = room.players.filter((p) => p.id !== player.id);
  playerRoom.delete(player.id);

  if (humans(room).length === 0) {
    destroyRoom(room);
    return;
  }
  if (room.hostId === player.id) room.hostId = humans(room)[0].id;

  // A game cannot continue with an empty seat — fall back to the lobby.
  if (room.engine) {
    clearTimers(room);
    room.engine = null;
    room.notice = `${player.name} غادر الديوان — عادت الطاولة إلى المجلس`;
  }
  broadcast(room);
}

function addBots(room) {
  const used = new Set(room.players.map((p) => p.name));
  const pool = Bot.BOT_NAMES.filter((n) => !used.has(n));
  let n = 0;
  while (room.players.length < MAX_PLAYERS) {
    const seat = freeSeat(room);
    room.players.push({
      id: `bot:${room.code}:${seat}`,
      name: pool[n++ % pool.length],
      seat,
      socketId: null,
      connected: true,
      isBot: true,
      graceTimer: null,
    });
  }
}

function removeBots(room) {
  room.players = room.players.filter((p) => !p.isBot);
}

// ---------------------------------------------------------------------------
// Views (what each player is allowed to see)
// ---------------------------------------------------------------------------

function viewFor(room, me) {
  const e = room.engine;
  const view = {
    code: room.code,
    game: room.game,
    gameName: GAMES[room.game].name,
    phase: phaseOf(room),
    myId: me.id,
    mySeat: me.seat,
    hostId: room.hostId,
    isHost: room.hostId === me.id,
    giftSeconds: GIFT_SECONDS,
    turnSeconds: TURN_SECONDS,
    allowBots: !REQUIRE_FOUR_HUMANS,
    notice: room.notice,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      connected: p.connected,
      isBot: !!p.isBot,
      isHost: p.id === room.hostId,
    })),
  };
  if (!e) return view;

  view.round = e.roundNo;
  view.totals = e.totals;
  view.teamTotals = e.teamTotals();
  view.matchLimit = MATCH_LIMIT;
  view.roundPoints = e.roundPoints;
  view.dealer = e.dealer;
  view.passDir = e.passDir;
  view.hand = e.hands[me.seat];
  view.cardsLeft = e.hands.map((h) => h.length);
  view.received = e.received ? e.received[me.seat] : [];

  if (e.phase === 'gift') {
    view.gift = {
      deadline: e.giftDeadline,
      mine: e.giftSel[me.seat],
      done: e.giftSel.map(Boolean),
    };
  }
  if (e.phase === 'play') {
    view.trick = e.trick;
    view.turn = e.turn;
    view.turnDeadline = e.turnDeadline || null;
    const legal = e.turn === me.seat ? e.legalPlay(me.seat) : { cards: [], reason: 'any' };
    view.legal = legal.cards;
    view.legalReason = legal.reason;
    view.lastTrick = e.lastTrick;
  }
  if (e.phase === 'gameOver') {
    view.winnerTeam = e.winnerTeam;
  }
  return view;
}

function broadcast(room) {
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('state', viewFor(room, p));
  }
  room.notice = null;
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

const botDelay = (min, max) => min + Math.random() * (max - min);

function startRound(room) {
  // a finished match starts fresh with zeroed totals
  if (!room.engine || room.engine.phase === 'gameOver') room.engine = new Leekha();
  const e = room.engine;
  clearTimers(room);
  // the host deals first; the deal rotates to the right every round
  const hostSeat = room.players.find((p) => p.id === room.hostId).seat;
  e.startRound(hostSeat + e.roundNo, GIFT_SECONDS * 1000);
  room.giftTimer = setTimeout(() => finishGift(room), GIFT_SECONDS * 1000 + 250);
  broadcast(room);

  for (const bot of room.players.filter((p) => p.isBot)) {
    room.botTimers.push(
      setTimeout(() => {
        if (room.engine !== e || e.phase !== 'gift' || e.giftSel[bot.seat]) return;
        const res = e.selectGift(bot.seat, Bot.chooseGift(e.hands[bot.seat]));
        if (res.ok && res.allDone) finishGift(room);
        else broadcast(room);
      }, botDelay(1200, 3200))
    );
  }
}

function finishGift(room) {
  const e = room.engine;
  if (!e || e.phase !== 'gift') return;
  clearTimeout(room.giftTimer);
  room.giftTimer = null;
  e.applyGifts();
  scheduleTurn(room);
  broadcast(room);
}

// Arms the turn clock for whoever is on turn: bots play after a short
// "thinking" pause, humans get TURN_SECONDS before a random legal card is
// played for them.
function scheduleTurn(room) {
  clearTimeout(room.turnTimer);
  room.turnTimer = null;
  const e = room.engine;
  if (!e || e.phase !== 'play' || e.turn === null) {
    if (e) e.turnDeadline = null;
    return;
  }
  const seat = e.turn;
  const p = seatPlayer(room, seat);
  e.turnDeadline = Date.now() + TURN_SECONDS * 1000;
  const isBot = p && p.isBot;
  room.turnTimer = setTimeout(
    () => {
      if (room.engine !== e || e.phase !== 'play' || e.turn !== seat) return;
      const card = isBot ? Bot.choosePlay(e, seat) : e.randomLegal(seat);
      doPlay(room, seat, card);
    },
    isBot ? botDelay(700, 1600) : TURN_SECONDS * 1000 + 300
  );
}

function doPlay(room, seat, card) {
  const e = room.engine;
  const res = e.playCard(seat, card);
  if (!res.ok) return res;
  if (res.trickComplete) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
    e.turnDeadline = null;
    broadcast(room);
    room.trickTimer = setTimeout(() => {
      if (room.engine !== e) return;
      e.clearTrick();
      scheduleTurn(room);
      broadcast(room);
    }, TRICK_HOLD_MS);
  } else {
    scheduleTurn(room);
    broadcast(room);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Sockets
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  let me = null;
  let room = null;

  const ack = (cb, payload) => typeof cb === 'function' && cb(payload);

  function bind(r, p) {
    room = r;
    me = p;
    p.socketId = socket.id;
    p.connected = true;
    clearTimeout(p.graceTimer);
    p.graceTimer = null;
    socket.join(r.code);
  }

  function leaveCurrent() {
    if (!room || !me) return;
    const r = room;
    const p = me;
    socket.leave(r.code);
    room = me = null;
    removePlayer(r, p);
  }

  socket.on('hello', ({ playerId } = {}, cb) => {
    const code = playerRoom.get(playerId);
    const r = code && rooms.get(code);
    const p = r && r.players.find((x) => x.id === playerId);
    if (!r || !p) return ack(cb, { inRoom: false });
    bind(r, p);
    broadcast(r);
    ack(cb, { inRoom: true });
  });

  socket.on('peek', ({ code } = {}, cb) => {
    const r = rooms.get(String(code || '').toUpperCase());
    if (!r) return ack(cb, { ok: false, error: 'لا يوجد ديوان بهذا الرمز' });
    ack(cb, {
      ok: true,
      game: r.game,
      gameName: GAMES[r.game].name,
      players: r.players.length,
      phase: phaseOf(r),
    });
  });

  socket.on('createParty', ({ playerId, name, game, withBots } = {}, cb) => {
    if (!GAMES[game]) return ack(cb, { ok: false, error: 'لعبة غير معروفة' });
    if (!GAMES[game].ready)
      return ack(cb, { ok: false, error: `${GAMES[game].name} قادمة قريباً` });
    if (playerRoom.has(playerId)) leaveCurrent();

    const r = createRoom(game);
    const p = {
      id: playerId,
      name: cleanName(name),
      seat: 0,
      socketId: null,
      connected: false,
      isBot: false,
      graceTimer: null,
    };
    r.players.push(p);
    r.hostId = p.id;
    playerRoom.set(p.id, r.code);
    bind(r, p);
    if (withBots && !REQUIRE_FOUR_HUMANS) addBots(r);
    broadcast(r);
    ack(cb, { ok: true, code: r.code });
  });

  socket.on('joinParty', ({ playerId, name, code } = {}, cb) => {
    const r = rooms.get(String(code || '').trim().toUpperCase());
    if (!r) return ack(cb, { ok: false, error: 'لا يوجد ديوان بهذا الرمز' });
    const existing = r.players.find((p) => p.id === playerId);
    if (existing) {
      bind(r, existing);
      broadcast(r);
      return ack(cb, { ok: true, code: r.code });
    }
    if (playerRoom.has(playerId)) leaveCurrent();
    if (r.engine)
      return ack(cb, { ok: false, error: 'اللعبة بدأت في هذا الديوان' });
    // a human joining a bot-filled lobby takes a bot's seat
    if (r.players.length >= MAX_PLAYERS) {
      const bot = r.players.find((p) => p.isBot);
      if (!bot) return ack(cb, { ok: false, error: 'الديوان ممتلئ — أربعة مقاعد فقط' });
      r.players = r.players.filter((p) => p !== bot);
    }

    const p = {
      id: playerId,
      name: cleanName(name),
      seat: freeSeat(r),
      socketId: null,
      connected: false,
      isBot: false,
      graceTimer: null,
    };
    r.players.push(p);
    playerRoom.set(p.id, r.code);
    bind(r, p);
    r.notice = `${p.name} دخل الديوان`;
    broadcast(r);
    ack(cb, { ok: true, code: r.code });
  });

  socket.on('leaveParty', (_, cb) => {
    leaveCurrent();
    ack(cb, { ok: true });
  });

  socket.on('addBots', (_, cb) => {
    if (!room || !me) return ack(cb, { ok: false, error: 'لست في ديوان' });
    if (room.hostId !== me.id) return ack(cb, { ok: false, error: 'المضيف وحده يضيف البوتات' });
    if (REQUIRE_FOUR_HUMANS) return ack(cb, { ok: false, error: 'اللعب مع البوتات غير متاح' });
    if (room.engine) return ack(cb, { ok: false, error: 'اللعبة جارية' });
    addBots(room);
    room.notice = 'جلس البوتات على المقاعد الفارغة';
    broadcast(room);
    ack(cb, { ok: true });
  });

  socket.on('removeBots', (_, cb) => {
    if (!room || !me) return ack(cb, { ok: false, error: 'لست في ديوان' });
    if (room.hostId !== me.id) return ack(cb, { ok: false, error: 'المضيف وحده' });
    if (room.engine) return ack(cb, { ok: false, error: 'اللعبة جارية' });
    removeBots(room);
    broadcast(room);
    ack(cb, { ok: true });
  });

  socket.on('startGame', (_, cb) => {
    if (!room || !me) return ack(cb, { ok: false, error: 'لست في ديوان' });
    if (room.hostId !== me.id)
      return ack(cb, { ok: false, error: 'المضيف وحده يبدأ اللعبة' });
    if (room.players.length !== MAX_PLAYERS)
      return ack(cb, { ok: false, error: 'بانتظار اكتمال المقاعد الأربعة' });
    if (REQUIRE_FOUR_HUMANS && room.players.some((p) => p.isBot))
      return ack(cb, { ok: false, error: 'يلزم أربعة لاعبين حقيقيين' });
    const phase = phaseOf(room);
    if (phase !== 'lobby' && phase !== 'roundEnd' && phase !== 'gameOver')
      return ack(cb, { ok: false, error: 'الجولة جارية' });
    startRound(room);
    ack(cb, { ok: true });
  });

  socket.on('gift', ({ cards } = {}, cb) => {
    if (!room || !room.engine) return ack(cb, { ok: false, error: 'لا لعبة' });
    const res = room.engine.selectGift(me.seat, cards);
    if (!res.ok) return ack(cb, res);
    if (res.allDone) finishGift(room);
    else broadcast(room);
    ack(cb, { ok: true });
  });

  socket.on('play', ({ card } = {}, cb) => {
    if (!room || !room.engine) return ack(cb, { ok: false, error: 'لا لعبة' });
    const res = doPlay(room, me.seat, card);
    ack(cb, res.ok ? { ok: true, trickComplete: res.trickComplete } : res);
  });

  socket.on('disconnect', () => {
    if (!room || !me) return;
    const r = room;
    const p = me;
    if (p.socketId !== socket.id) return; // superseded by a newer connection
    p.socketId = null;
    p.connected = false;
    if (!r.engine) {
      // In the lobby a vanished player frees the seat after a short grace period.
      p.graceTimer = setTimeout(() => {
        if (!p.connected) removePlayer(r, p);
      }, LOBBY_DISCONNECT_GRACE_MS);
    }
    broadcast(r);
  });
});

// Garbage-collect stale rooms every 10 minutes.
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    const anyone = humans(r).some((p) => p.connected);
    if (!anyone && now - r.createdAt > 6 * 60 * 60 * 1000) destroyRoom(r);
  }
}, 10 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`ديوان الورق يستقبل الضيوف على http://localhost:${PORT}`);
});
