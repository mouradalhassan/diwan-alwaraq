'use strict';

// ---------------------------------------------------------------------------
// Bot player for Leekha. Rule-abiding (it only ever picks from the engine's
// legal set) with simple, sensible heuristics:
//   gift  → pass away the most dangerous cards
//   lead  → lowest, safest card
//   follow→ duck under the current winner when possible; if forced to win,
//           win as cheaply as possible; if last to play and no points on the
//           table, take it with the highest card
//   void  → dump the most dangerous card (the engine already forces Q♠/10♦)
// ---------------------------------------------------------------------------

const { suitOf, rankOf, RANKS, cardPoints, mostDangerous: dangerous } = require('./leekha');

const rv = (c) => RANKS.indexOf(rankOf(c));
const isPoint = (c) => cardPoints(c) > 0;

const lowest = (cards) => cards.slice().sort((a, b) => rv(a) - rv(b))[0];
const highest = (cards) => cards.slice().sort((a, b) => rv(b) - rv(a))[0];
const mostDangerous = (cards) => dangerous(cards, 1)[0];

function chooseGift(hand) {
  return dangerous(hand, 3);
}

function choosePlay(engine, seat) {
  const legal = engine.legalPlay(seat);
  const cards = legal.cards;
  const plays = engine.trick.plays;

  if (plays.length === 0) {
    const safe = cards.filter((c) => !isPoint(c) && c !== 'AS' && c !== 'KS');
    return lowest(safe.length ? safe : cards);
  }

  const led = suitOf(plays[0].card);
  const winning = plays
    .filter((p) => suitOf(p.card) === led)
    .sort((a, b) => rv(b.card) - rv(a.card))[0];
  const pointsOnTable = plays.reduce((s, p) => s + cardPoints(p.card), 0);
  const isLast = plays.length === 3;

  if (legal.reason === 'follow') {
    const below = cards.filter((c) => rv(c) < rv(winning.card));
    if (below.length) return highest(below);
    if (isLast && pointsOnTable === 0) return highest(cards);
    return lowest(cards);
  }
  // void in the led suit (reason 'leekha' or 'any')
  return mostDangerous(cards);
}

const BOT_NAMES = ['أبو سمرة', 'الحاج نعيم', 'أم فادي', 'الأستاذ رامز', 'عمّو جورج', 'ست نهى', 'أبو الزوز', 'الشيخ حمزة'];

module.exports = { chooseGift, choosePlay, BOT_NAMES };
