# ديوان الورق — Diwan al-Waraq

Online Levantine card games in a Damascene-royal design: deep emerald and burgundy, gold arabesque, carved-plaster frames, an ornamented rectangular walnut-and-velvet table, cream cards with red/black vector suits. Photographs of the Umayyad Mosque mosaics and Islamic carvings (Wikimedia Commons, CC BY-SA — see `public/img/ATTRIBUTION.md`).
Currently playable: **ليخة (Leekha)**. Trix, Trix Complex and 400 are listed as "coming soon".

Game-style features: illustrated avatars (12 Levantine characters), live presence panel + activity feed, quick emotes at the table, last-trick viewer, per-seat turn rings and round-score cubes, leave-anytime (HUD and scoreboard), synthesized sound effects.

## Run

```bash
npm install
npm start          # http://localhost:3000
```

`npm run dev` restarts the server on file changes. `npm test` runs the engine checks, a 4-human round, and a 1-human-vs-3-bots round.

## Structure

```
server/index.js   Express + Socket.IO: parties (6-letter codes), seats, gift/turn timers, bots, per-player views
server/leekha.js  Leekha engine (deal, gift, follow-suit, Leekha principle, trick resolution, points, 101 match)
server/bot.js     rule-abiding bot (gift + play heuristics)
public/           index.html, style.css, app.js — vanilla frontend
test/smoke.js     engine unit checks + end-to-end rounds
```

## Flow

Home → **ادخل** → choose game → name (+ optional code) → **ادخل** creates a party if the code is empty, joins it otherwise.
Invite links look like `http://host/?code=ABC123` and drop the friend straight onto the join screen.
4 seats; the host starts when the table is full. A refreshed tab keeps its seat (player id stored in localStorage).

**Bots** (testing mode): "العب وحدك مع ثلاثة بوتات" on the name screen, or "أكمل المقاعد بالبوتات" in the lobby. A human joining a bot-filled lobby takes a bot's seat. Set `REQUIRE_FOUR_HUMANS = true` in `server/index.js` to switch bots off and require four real players.

**Turn clock**: 30 s per play, shown as a ring around the avatar; on expiry a random legal card is played. Gift phase: 20 s.

**Playing a card**: drag it onto the table, or double-tap it. Sound effects are synthesized in-browser (Web Audio, no files) — mute with ♪.

## Leekha rules as implemented

- Partnership game: seats 0 & 2 vs seats 1 & 3 (partners sit opposite).
- 52-card deck shuffled, 13 cards each. Rank order: 2 … 10, J (شاب), Q (بنت), K (شيخ), A (قص).
- **Gift**: each player picks 3 cards (20 s timer; if late, the three most dangerous legal cards are picked automatically). Odd rounds they go to the **right**, even rounds to the **left**.
- **Gift rule**: a gift may not empty a suit you hold — except spades when every spade you hold is Q or higher, and diamonds when every diamond you hold is 10 or higher. Enforced for players, bots and the auto-pick.
- The player to the dealer's right leads any card; others must follow suit if they can. Highest card of the led suit takes the pile and leads next. The deal rotates right each round, starting with the host.
- **Leekha principle**: a player void in the led suit who holds Q♠ or 10♦ must play one of them (either, if both).
- Points eaten by the trick taker: **Q♠ = 13**, **10♦ = 10**, every ♥ = 1 (36 per round). Points are per player; team score = sum of partners.
- Match ends after a round in which any player or any team reaches **101**; the team with the lower total wins. The host can then start a fresh match.

## Deploy

`render.yaml` is included — deploy from GitHub on Render (free tier, supports WebSockets). Netlify cannot host this: it needs a persistent Node server.
