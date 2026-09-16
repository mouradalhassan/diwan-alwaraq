'use strict';

// ---------------------------------------------------------------------------
// ليخة (Leekha) — game engine. Pure state machine, no I/O.
//
// Partnership game for 4: seats 0 & 2 are one team, seats 1 & 3 the other.
//
// Card ids are rank + suit, e.g. "10H", "QD", "AS".
//   Suits:  H = كبة (hearts)   D = دينار (diamonds)
//           C = سباتي (clubs)  S = بستوني (spades)
//   Ranks (low → high): 2 3 4 5 6 7 8 9 10 J Q K A
//
// Round flow:
//   gift  → every seat picks 3 cards. Odd rounds they go to the RIGHT
//           (seat + 1), even rounds to the LEFT (seat + 3). 20 second timer,
//           unpicked seats get random cards.
//   play  → the seat to the dealer's right leads any card; others must
//           follow suit if they can. Highest card of the led suit takes the
//           pile ("الليخة") and leads next.
//   Leekha principle: a player void in the led suit who holds Q♠ or 10♦
//           MUST play one of them (their choice if they hold both).
//   Points (all "eaten" by the trick taker):
//           Q♠ = 13, 10♦ = 10, every heart = 1.   (36 per round)
//   Match:  after a round, if any player has ≥ 101 or any team's total is
//           ≥ 101, the match ends and the team with the LOWER total wins.
// ---------------------------------------------------------------------------

const SUITS = ['C', 'D', 'S', 'H'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SEATS = 4;
const HAND_SIZE = 13;
const GIFT_SIZE = 3;
const MATCH_LIMIT = 101;
const LEEKHA_CARDS = ['QS', '10D'];

const suitOf = (c) => c.slice(-1);
const rankOf = (c) => c.slice(0, -1);
const rankValue = (c) => RANKS.indexOf(rankOf(c));
const teamOf = (seat) => seat % 2;

function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sortHand(hand) {
  return hand
    .slice()
    .sort(
      (a, b) =>
        SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)) ||
        rankValue(a) - rankValue(b)
    );
}

function cardPoints(card) {
  if (card === 'QS') return 13;
  if (card === '10D') return 10;
  if (suitOf(card) === 'H') return 1;
  return 0;
}

class Leekha {
  constructor() {
    this.roundNo = 0;
    this.totals = [0, 0, 0, 0];
    this.phase = 'idle'; // idle | gift | play | roundEnd | gameOver
    this.hands = [[], [], [], []];
    this.winnerTeam = null;
  }

  teamTotals() {
    return [this.totals[0] + this.totals[2], this.totals[1] + this.totals[3]];
  }

  startRound(dealer, giftMs) {
    if (this.phase === 'gameOver') return;
    const deck = shuffle(makeDeck());
    this.hands = Array.from({ length: SEATS }, (_, s) =>
      sortHand(deck.slice(s * HAND_SIZE, (s + 1) * HAND_SIZE))
    );
    this.roundNo += 1;
    this.phase = 'gift';
    this.dealer = dealer % SEATS;
    this.passDir = this.roundNo % 2 === 1 ? 'right' : 'left';
    this.passOffset = this.passDir === 'right' ? 1 : 3;
    this.giftSel = [null, null, null, null];
    this.received = [[], [], [], []];
    this.giftDeadline = Date.now() + giftMs;
    this.roundPoints = [0, 0, 0, 0];
    this.taken = [[], [], [], []];
    this.trick = null;
    this.lastTrick = null;
    this.turn = null;
    this.firstLeader = (this.dealer + 1) % SEATS; // right of the dealer
  }

  // ---- gift phase ---------------------------------------------------------

  selectGift(seat, cards) {
    if (this.phase !== 'gift') return { ok: false, error: 'ليس وقت الهدية' };
    if (this.giftSel[seat]) return { ok: false, error: 'أرسلت هديتك مسبقاً' };
    if (!Array.isArray(cards) || cards.length !== GIFT_SIZE)
      return { ok: false, error: 'اختر ثلاث أوراق' };
    const uniq = new Set(cards);
    if (uniq.size !== GIFT_SIZE) return { ok: false, error: 'أوراق مكررة' };
    for (const c of cards) {
      if (!this.hands[seat].includes(c))
        return { ok: false, error: 'هذه الورقة ليست معك' };
    }
    this.giftSel[seat] = cards.slice();
    return { ok: true, allDone: this.giftSel.every(Boolean) };
  }

  autoGift() {
    for (let s = 0; s < SEATS; s++) {
      if (this.giftSel[s]) continue;
      this.giftSel[s] = shuffle(this.hands[s].slice()).slice(0, GIFT_SIZE);
    }
  }

  applyGifts() {
    if (this.phase !== 'gift') return;
    this.autoGift();
    for (let s = 0; s < SEATS; s++) {
      const gift = this.giftSel[s];
      this.hands[s] = this.hands[s].filter((c) => !gift.includes(c));
    }
    for (let s = 0; s < SEATS; s++) {
      const to = (s + this.passOffset) % SEATS;
      this.received[to] = this.giftSel[s].slice();
      this.hands[to] = sortHand(this.hands[to].concat(this.giftSel[s]));
    }
    this.phase = 'play';
    this.trick = { leader: this.firstLeader, plays: [], winner: null, points: 0 };
    this.turn = this.firstLeader;
  }

  // ---- play phase ---------------------------------------------------------

  // Returns { cards, reason } where reason is 'any' | 'follow' | 'leekha'.
  legalPlay(seat) {
    const hand = this.hands[seat];
    if (!this.trick || this.trick.plays.length === 0)
      return { cards: hand.slice(), reason: 'any' };
    const led = suitOf(this.trick.plays[0].card);
    const same = hand.filter((c) => suitOf(c) === led);
    if (same.length) return { cards: same, reason: 'follow' };
    const forced = hand.filter((c) => LEEKHA_CARDS.includes(c));
    if (forced.length) return { cards: forced, reason: 'leekha' };
    return { cards: hand.slice(), reason: 'any' };
  }

  legalCards(seat) {
    return this.legalPlay(seat).cards;
  }

  randomLegal(seat) {
    const cards = this.legalCards(seat);
    return cards[Math.floor(Math.random() * cards.length)];
  }

  playCard(seat, card) {
    if (this.phase !== 'play') return { ok: false, error: 'ليس وقت اللعب' };
    if (this.trick.winner !== null) return { ok: false, error: 'انتظر قليلاً' };
    if (this.turn !== seat) return { ok: false, error: 'ليس دورك' };
    if (!this.hands[seat].includes(card))
      return { ok: false, error: 'هذه الورقة ليست معك' };
    const legal = this.legalPlay(seat);
    if (!legal.cards.includes(card)) {
      if (legal.reason === 'leekha')
        return { ok: false, error: 'ليخة! يجب أن تلعب بنت البستوني أو عشرة الدينار' };
      const led = suitOf(this.trick.plays[0].card);
      return { ok: false, error: `يجب أن تلعب ${SUIT_NAMES[led]}` };
    }

    this.hands[seat] = this.hands[seat].filter((c) => c !== card);
    this.trick.plays.push({ seat, card });

    if (this.trick.plays.length === SEATS) {
      const led = suitOf(this.trick.plays[0].card);
      let best = null;
      for (const p of this.trick.plays) {
        if (suitOf(p.card) !== led) continue;
        if (!best || rankValue(p.card) > rankValue(best.card)) best = p;
      }
      this.trick.winner = best.seat;
      this.trick.points = this.trick.plays.reduce(
        (sum, p) => sum + cardPoints(p.card),
        0
      );
      this.turn = null;
      return { ok: true, trickComplete: true };
    }

    this.turn = (seat + 1) % SEATS;
    return { ok: true, trickComplete: false };
  }

  // Called by the server after the completed trick was shown for a moment.
  clearTrick() {
    if (this.phase !== 'play' || !this.trick || this.trick.winner === null) return;
    const w = this.trick.winner;
    this.roundPoints[w] += this.trick.points;
    this.taken[w].push(...this.trick.plays.map((p) => p.card));
    this.lastTrick = {
      winner: w,
      points: this.trick.points,
      plays: this.trick.plays.slice(),
    };

    const roundOver = this.hands.every((h) => h.length === 0);
    if (roundOver) {
      for (let s = 0; s < SEATS; s++) this.totals[s] += this.roundPoints[s];
      this.trick = null;
      this.turn = null;
      const teams = this.teamTotals();
      const busted =
        this.totals.some((t) => t >= MATCH_LIMIT) ||
        teams.some((t) => t >= MATCH_LIMIT);
      if (busted) {
        this.phase = 'gameOver';
        this.winnerTeam = teams[0] < teams[1] ? 0 : teams[1] < teams[0] ? 1 : null;
      } else {
        this.phase = 'roundEnd';
      }
      return;
    }
    this.trick = { leader: w, plays: [], winner: null, points: 0 };
    this.turn = w;
  }
}

const SUIT_NAMES = { H: 'كبة', D: 'دينار', C: 'سباتي', S: 'بستوني' };

module.exports = {
  Leekha,
  SUITS,
  RANKS,
  SUIT_NAMES,
  MATCH_LIMIT,
  LEEKHA_CARDS,
  cardPoints,
  suitOf,
  rankOf,
  teamOf,
};
