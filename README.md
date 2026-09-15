# ديوان الورق — Diwan al-Waraq

Online Levantine card games with an old-Arabic manuscript look.
Currently playable: **ليخة (Leekha)**. Trix, Trix Complex and 400 are listed as "coming soon".

## Run

```bash
npm install
npm start          # http://localhost:3000
```

`npm run dev` restarts the server on file changes. `npm test` runs a 4-client smoke test that plays a full round.

## Structure

```
server/index.js   Express + Socket.IO: parties (6-letter codes), seats, timers, per-player views
server/leekha.js  Leekha engine (deal, gift, follow-suit, trick resolution, points)
public/           index.html, style.css, app.js — vanilla frontend
test/smoke.js     end-to-end test with 4 socket clients
```

## Flow

Home → **انضم إلى اللعبة** → choose game → enter name → **أنشئ ديواناً** (get a code, share it) or **ادخل برمز**.
Invite links look like `http://host/?code=ABC123` and drop the friend straight onto the join screen.
4 seats; the host starts when the table is full. A refreshed tab keeps its seat (player id stored in localStorage).

## Leekha rules as implemented

- Partnership game: seats 0 & 2 vs seats 1 & 3 (partners sit opposite).
- 52-card deck shuffled, 13 cards each. Rank order: 2 … 10, J (شاب), Q (بنت), K (شيخ), A (قص).
- **Gift**: each player picks 3 cards (20 s timer, random cards if late). Odd rounds they go to the **right**, even rounds to the **left**.
- The player to the dealer's right leads any card; others must follow suit if they can. Highest card of the led suit takes the pile and leads next. The deal rotates right each round, starting with the host.
- **Leekha principle**: a player void in the led suit who holds Q♠ or 10♦ must play one of them (either, if both).
- Points eaten by the trick taker: **Q♠ = 13**, **10♦ = 10**, every ♥ = 1 (36 per round). Points are per player; team score = sum of partners.
- Match ends after a round in which any player or any team reaches **101**; the team with the lower total wins. The host can then start a fresh match.
