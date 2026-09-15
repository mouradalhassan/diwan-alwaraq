'use strict';
// Tests:
//  1. engine unit checks (Leekha principle, points, match end)
//  2. end-to-end: 4 socket clients create/join a party and play two full
//     rounds (gift right, then gift left).
// Run:  node test/smoke.js   (uses port 3999)

process.env.PORT = '3999';
require('../server/index.js');
const { io } = require('socket.io-client');
const { Leekha, cardPoints } = require('../server/leekha');

const URL = 'http://localhost:3999';
const call = (s, ev, payload) => new Promise((r) => s.emit(ev, payload, r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } };

// ---------------------------------------------------------------- engine
function engineTests() {
  assert(cardPoints('QS') === 13 && cardPoints('10D') === 10 && cardPoints('7H') === 1 && cardPoints('QH') === 1 && cardPoints('AS') === 0, 'card points');

  const e = new Leekha();
  e.startRound(0, 1000);
  e.applyGifts(); // random gifts, we then overwrite hands
  e.hands = [
    ['2C', '3C', '4C'],
    ['QS', '10D', '5H'],   // void in clubs, holds both leekha cards
    ['9C', 'AH', '2H'],
    ['QS', '7H', '8H'].filter((c) => c !== 'QS').concat(['KS']), // void in clubs, no leekha cards
  ];
  e.trick = { leader: 0, plays: [], winner: null, points: 0 };
  e.turn = 0;
  assert(e.legalPlay(0).reason === 'any', 'leader may play anything');
  assert(e.playCard(0, '2C').ok, 'lead 2C');
  const l1 = e.legalPlay(1);
  assert(l1.reason === 'leekha' && l1.cards.length === 2 && l1.cards.includes('QS') && l1.cards.includes('10D'), 'leekha forces QS/10D, either allowed');
  assert(!e.playCard(1, '5H').ok, 'refuses 5H under leekha');
  assert(e.playCard(1, '10D').ok, 'plays 10D under leekha');
  assert(e.legalPlay(2).reason === 'follow' && e.legalPlay(2).cards.join() === '9C', 'must follow clubs');
  assert(e.playCard(2, '9C').ok, 'follows with 9C');
  assert(e.legalPlay(3).reason === 'any', 'void with no leekha cards → anything');
  const r = e.playCard(3, '7H');
  assert(r.ok && r.trickComplete && e.trick.winner === 2 && e.trick.points === 11, 'seat 2 wins with 9C and eats 11 (10D + 7H)');
  e.clearTrick();
  assert(e.roundPoints[2] === 11 && e.turn === 2, 'winner leads next');

  // match end: any player >= 101 or team >= 101 → lower team wins
  const m = new Leekha();
  m.startRound(0, 1000);
  m.applyGifts();
  m.hands = [['2C'], ['QS'], ['3C'], ['4H']];
  m.totals = [40, 60, 50, 30];
  m.trick = { leader: 0, plays: [], winner: null, points: 0 };
  m.turn = 0;
  // 3C (seat 2) wins the trick and eats QS + 4H = 14 → seat 2 = 64, team 0 = 104
  m.playCard(0, '2C'); m.playCard(1, 'QS'); m.playCard(2, '3C'); m.playCard(3, '4H');
  m.clearTrick();
  assert(m.phase === 'gameOver', 'match ends when a team passes 101: ' + m.phase);
  assert(m.teamTotals()[0] === 104 && m.winnerTeam === 1, 'team 1 (lower) wins');

  console.log('✓ engine: leekha principle, follow suit, points, match end');
}

// ------------------------------------------------------------ end-to-end
async function playRound(clients, views, expectedDir) {
  assert(views.every((v) => v.phase === 'gift' && v.hand.length === 13), 'all in gift with 13 cards');
  assert(views[0].passDir === expectedDir, 'pass direction ' + expectedDir + ', got ' + views[0].passDir);
  const offset = expectedDir === 'right' ? 1 : 3;

  const sent = [];
  for (let i = 0; i < 4; i++) {
    const cards = views[i].hand.slice(0, 3);
    sent[i] = cards;
    const g = await call(clients[i], 'gift', { cards });
    assert(g.ok, 'gift failed ' + JSON.stringify(g));
  }
  await sleep(50);
  assert(views.every((v) => v.phase === 'play' && v.hand.length === 13), 'play phase, 13 cards each');
  for (let i = 0; i < 4; i++) {
    const to = (views[i].mySeat + offset) % 4;
    const receiver = views.find((v) => v.mySeat === to);
    assert(sent[i].every((c) => receiver.hand.includes(c)), `gift went to the ${expectedDir}`);
  }
  assert(views[0].turn === (views[0].dealer + 1) % 4, 'right of dealer leads');
  console.log(`✓ gifts travelled to the ${expectedDir}, dealer's right leads`);

  let tricks = 0;
  let leekhaSeen = false;
  while (tricks < 13) {
    const turnSeat = views[0].turn;
    if (turnSeat === null || turnSeat === undefined) { await sleep(100); continue; }
    const idx = views.findIndex((v) => v.mySeat === turnSeat);
    const v = views[idx];
    assert(v.legal.length > 0, 'legal cards exist');
    if (v.legalReason === 'leekha') leekhaSeen = true;
    const illegal = v.hand.find((c) => !v.legal.includes(c));
    if (illegal) {
      const bad = await call(clients[idx], 'play', { card: illegal });
      assert(!bad.ok, 'illegal card refused');
    }
    const r = await call(clients[idx], 'play', { card: v.legal[0] });
    assert(r.ok, 'play failed: ' + JSON.stringify(r));
    await sleep(30);
    if (views[0].trick && views[0].trick.winner !== null) {
      tricks++;
      await sleep(1800);
    }
  }
  await sleep(100);
  const v = views[0];
  assert(v.phase === 'roundEnd' || v.phase === 'gameOver', 'round ended, phase=' + v.phase);
  const total = v.roundPoints.reduce((a, b) => a + b, 0);
  assert(total === 36, 'all 36 points distributed, got ' + total);
  assert(v.teamTotals[0] === v.totals[0] + v.totals[2], 'team totals');
  console.log(`✓ 13 tricks played, 36 points distributed: [${v.roundPoints}]${leekhaSeen ? ' (leekha principle triggered)' : ''}`);
}

(async () => {
  engineTests();

  const clients = [];
  const views = [];
  for (let i = 0; i < 4; i++) {
    const s = io(URL, { transports: ['websocket'] });
    s.on('state', (v) => { views[i] = v; });
    await new Promise((r) => s.on('connect', r));
    clients.push(s);
  }

  const host = clients[0];
  const c = await call(host, 'createParty', { playerId: 'p0', name: 'أبو خليل', game: 'leekha' });
  assert(c.ok, 'create failed: ' + JSON.stringify(c));
  const code = c.code;
  for (let i = 1; i < 4; i++) {
    const j = await call(clients[i], 'joinParty', { playerId: 'p' + i, name: 'لاعب ' + i, code });
    assert(j.ok, 'join failed: ' + JSON.stringify(j));
  }
  const fifth = io(URL, { transports: ['websocket'] });
  await new Promise((r) => fifth.on('connect', r));
  const j5 = await call(fifth, 'joinParty', { playerId: 'p5', name: 'زيادة', code });
  assert(!j5.ok, 'fifth player should be refused');
  fifth.close();
  console.log('✓ party of 4 created, 5th refused');

  assert((await call(host, 'startGame', {})).ok, 'start failed');
  await sleep(50);
  await playRound(clients, views, 'right');

  assert((await call(host, 'startGame', {})).ok, 'second round starts');
  await sleep(50);
  assert(views[0].round === 2, 'round 2');
  await playRound(clients, views, 'left');

  console.log('\nALL GOOD');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
