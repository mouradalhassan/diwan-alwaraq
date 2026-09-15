/* ديوان الورق — client */
(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const GAME_NAMES = { leekha: 'ليخة', trix: 'تريكس', trixComplex: 'تريكس كومبلكس', four00: '٤٠٠' };
  const SUIT_GLYPH = { H: '♥', D: '♦', C: '♣', S: '♠' };
  const SUIT_NAME = { H: 'كبّة', D: 'دينار', C: 'سباتي', S: 'بستوني' };
  const FACE_NAME = { J: 'شاب', Q: 'بنت', K: 'شيخ', A: 'قص' };
  const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const ar = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[d]);

  const suitOf = (c) => c.slice(-1);
  const rankOf = (c) => c.slice(0, -1);

  function playerId() {
    let id = null;
    try { id = localStorage.getItem('diwan.playerId'); } catch (_) {}
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
      try { localStorage.setItem('diwan.playerId', id); } catch (_) {}
    }
    return id;
  }
  const PID = playerId();

  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; }, 2600);
    setTimeout(() => el.remove(), 3100);
  }

  // ---------------------------------------------------------------------
  // card element
  // ---------------------------------------------------------------------
  function cardEl(card, opts = {}) {
    const s = suitOf(card);
    const r = rankOf(card);
    const el = document.createElement('div');
    el.className = 'card ' + (s === 'H' || s === 'D' ? 'red' : 'black') + (opts.small ? ' small' : '');
    el.dataset.card = card;
    el.title = `${r} ${SUIT_NAME[s]}`;

    const idx = `<div class="idx"><span>${r}</span><small>${SUIT_GLYPH[s]}</small></div>
                 <div class="idx b"><span>${r}</span><small>${SUIT_GLYPH[s]}</small></div>`;

    if (FACE_NAME[r]) {
      el.innerHTML = `${idx}
        <div class="face">
          <svg viewBox="0 0 100 100"><use href="#star8"/></svg>
          <b>${r}</b><i>${FACE_NAME[r]} ${SUIT_GLYPH[s]}</i>
        </div>`;
    } else {
      const n = parseInt(r, 10);
      const cols = n <= 3 ? 1 : 2;
      const pips = Array.from({ length: n }, () => `<span>${SUIT_GLYPH[s]}</span>`).join('');
      el.innerHTML = `${idx}<div class="pips n${n}" style="--cols:${cols}">${pips}</div>`;
    }
    return el;
  }

  function backEl() {
    const el = document.createElement('div');
    el.className = 'card back';
    return el;
  }

  // ---------------------------------------------------------------------
  // screens
  // ---------------------------------------------------------------------
  let current = 'screen-home';
  function show(id) {
    if (current === id) return;
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    current = id;
  }
  $$('[data-back]').forEach((b) => b.addEventListener('click', () => show(b.dataset.back)));

  // ---------------------------------------------------------------------
  // socket
  // ---------------------------------------------------------------------
  const socket = io({ transports: ['websocket', 'polling'] });
  let state = null; // last server view
  let chosenGame = 'leekha';
  let pendingCode = new URLSearchParams(location.search).get('code');

  function emit(ev, payload) {
    return new Promise((resolve) => socket.emit(ev, payload, resolve));
  }

  socket.on('connect', async () => {
    const res = await emit('hello', { playerId: PID });
    if (!res || !res.inRoom) {
      if (pendingCode) {
        pendingCode = pendingCode.toUpperCase();
        const peek = await emit('peek', { code: pendingCode });
        if (peek.ok) {
          chosenGame = peek.game;
          $('#inp-code').value = pendingCode;
          $('#party-game').textContent = GAME_NAMES[chosenGame];
          show('screen-party');
          toast(`دُعيت إلى ديوان ${peek.gameName}`, 'gold');
        } else {
          toast(peek.error, 'err');
        }
        history.replaceState(null, '', location.pathname);
        pendingCode = null;
      }
    }
  });

  socket.on('disconnect', () => toast('انقطع الاتصال… نحاول العودة', 'err'));
  socket.on('state', (view) => {
    state = view;
    render();
  });

  // ---------------------------------------------------------------------
  // home / choose / party
  // ---------------------------------------------------------------------
  $('#btn-join').addEventListener('click', () => show('screen-choose'));

  $$('.game-tile').forEach((tile) => {
    tile.addEventListener('click', () => {
      const g = tile.dataset.game;
      if (g !== 'leekha') {
        toast(`${GAME_NAMES[g]} قادمة قريباً — اللعبة المتاحة الآن هي ليخة`, 'gold');
        return;
      }
      chosenGame = g;
      $$('.game-tile').forEach((t) => t.classList.toggle('selected', t === tile));
      $('#party-game').textContent = GAME_NAMES[g];
      show('screen-party');
    });
  });

  try { $('#inp-name').value = localStorage.getItem('diwan.name') || ''; } catch (_) {}

  function myName() {
    const n = $('#inp-name').value.trim();
    if (!n) {
      toast('اكتب اسمك أولاً', 'err');
      $('#inp-name').focus();
      return null;
    }
    try { localStorage.setItem('diwan.name', n); } catch (_) {}
    return n;
  }

  $('#btn-create').addEventListener('click', async () => {
    const name = myName();
    if (!name) return;
    const res = await emit('createParty', { playerId: PID, name, game: chosenGame });
    if (!res.ok) return toast(res.error, 'err');
    toast('أُنشئ الديوان — شارك الرمز مع رفاقك', 'gold');
  });

  $('#btn-joincode').addEventListener('click', joinByCode);
  $('#inp-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinByCode(); });
  $('#inp-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  async function joinByCode() {
    const name = myName();
    if (!name) return;
    const code = $('#inp-code').value.trim().toUpperCase();
    if (code.length !== 6) return toast('الرمز مكوّن من ستة أحرف', 'err');
    const res = await emit('joinParty', { playerId: PID, name, code });
    if (!res.ok) return toast(res.error, 'err');
  }

  // ---------------------------------------------------------------------
  // lobby
  // ---------------------------------------------------------------------
  function inviteUrl() {
    return `${location.origin}${location.pathname}?code=${state.code}`;
  }

  $('#btn-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.code);
      toast('نُسخ الرمز', 'gold');
    } catch (_) {
      toast(`الرمز: ${state.code}`);
    }
  });

  $('#btn-share').addEventListener('click', async () => {
    const url = inviteUrl();
    const text = `تعال العب ${state.gameName} معنا في ديوان الورق — الرمز ${state.code}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'ديوان الورق', text, url }); return; } catch (_) { /* cancelled */ }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast('نُسخ رابط الدعوة', 'gold');
    } catch (_) {
      prompt('انسخ الرابط:', url);
    }
  });

  $('#btn-leave').addEventListener('click', async () => {
    await emit('leaveParty', {});
    state = null;
    show('screen-home');
  });

  $('#btn-start').addEventListener('click', async () => {
    const res = await emit('startGame', {});
    if (!res.ok) toast(res.error, 'err');
  });

  function renderLobby() {
    $('#lobby-game').textContent = state.gameName;
    $('#lobby-code').textContent = state.code;
    const seats = $('#lobby-seats');
    seats.innerHTML = '';
    for (let s = 0; s < 4; s++) {
      const p = state.players.find((x) => x.seat === s);
      const el = document.createElement('div');
      el.className = 'seat ' + (p ? 'filled' : 'empty') + (p && !p.connected ? ' offline' : '');
      el.innerHTML = `
        <div class="seat-medal">${p ? initial(p.name) : '۝'}</div>
        <div class="seat-name">${p ? esc(p.name) : 'مقعد فارغ'}</div>
        <div class="seat-tag">${p ? (p.isHost ? 'المضيف' : `المقعد ${ar(s + 1)}`) : ''}${p && p.id === state.myId ? ' · أنت' : ''}</div>`;
      seats.appendChild(el);
    }
    const n = state.players.length;
    const status = $('#lobby-status');
    if (n < 4) status.textContent = `حضر ${ar(n)} من ٤ — بانتظار ${ar(4 - n)} ${4 - n === 1 ? 'لاعب' : 'لاعبين'}`;
    else status.textContent = state.isHost ? 'اكتمل المجلس — ابدأ متى شئت' : 'اكتمل المجلس — بانتظار المضيف';
    const start = $('#btn-start');
    start.disabled = !(state.isHost && n === 4);
    start.hidden = !state.isHost;
  }

  const initial = (name) => name.trim().charAt(0) || '؟';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------------------------------------------------------------
  // table
  // ---------------------------------------------------------------------
  const posOf = (seat) => (seat - state.mySeat + 4) % 4;
  const seatAt = (pos) => (state.mySeat + pos) % 4;
  const playerAtSeat = (seat) => state.players.find((p) => p.seat === seat);

  let giftPick = []; // cards chosen for the gift (before sending)
  let timerHandle = null;
  let lastRound = 0;
  let lastTrickKey = '';

  function renderTable() {
    $('#hud-game').textContent = state.gameName;
    $('#hud-round').textContent = `الجولة ${ar(state.round)}`;
    $('#hud-code').textContent = state.code;

    if (state.round !== lastRound) {
      giftPick = [];
      lastRound = state.round;
    }

    renderSeats();
    renderHand();
    renderTrick();
    renderGift();
    renderHud();
    renderScoresOverlay();
  }

  function renderSeats() {
    for (let pos = 0; pos < 4; pos++) {
      const spot = $(`.seat-spot.pos-${pos}`);
      const seat = seatAt(pos);
      const p = playerAtSeat(seat);
      spot.className = `seat-spot pos-${pos}`;
      if (!p) { spot.classList.add('empty'); spot.innerHTML = `<div class="medal">۝</div>`; continue; }
      if (!p.connected) spot.classList.add('offline');
      if (state.phase === 'play' && state.turn === seat) spot.classList.add('turn');
      if (seat === state.mySeat) spot.classList.add('me');
      const gifted = state.phase === 'gift' && state.gift.done[seat];
      const left = state.cardsLeft ? state.cardsLeft[seat] : 0;
      const pts = state.roundPoints ? state.roundPoints[seat] : 0;
      const isDealer = state.dealer === seat;
      spot.classList.add(seat % 2 === state.mySeat % 2 ? 'team-mine' : 'team-theirs');
      const role = pos === 2 ? 'شريكك' : pos === 0 ? 'أنت' : 'الخصم';
      spot.innerHTML = `
        <div class="medal">${initial(p.name)}
          <span class="badge">${ar(left)}</span>
          ${gifted ? '<span class="check">✓</span>' : ''}
          ${isDealer ? '<span class="dealer" title="الموزّع">م</span>' : ''}
        </div>
        <div class="plate"><span class="pts">${ar(pts)}</span>${esc(p.name)}</div>
        <div class="role">${role}</div>`;
    }
  }

  function renderHand() {
    const hand = $('#hand');
    const cards = state.hand || [];
    const legal = new Set(state.legal || []);
    const received = new Set(state.received || []);
    const n = cards.length;
    hand.innerHTML = '';
    cards.forEach((c, i) => {
      const el = cardEl(c);
      const t = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0; // -1 .. 1
      el.style.setProperty('--rot', `${(t * 9).toFixed(2)}deg`);
      el.style.setProperty('--lift', `${(Math.abs(t) * 14).toFixed(1)}px`);
      el.style.zIndex = i;
      el.tabIndex = 0;

      if (state.phase === 'gift') {
        if (received.has(c)) el.classList.add('received');
        if (giftPick.includes(c)) el.classList.add('gone');
        if (!state.gift.mine) el.addEventListener('click', () => toggleGift(c));
      } else if (state.phase === 'play') {
        if (received.has(c) && !state.trick?.plays?.length && state.cardsLeft?.[state.mySeat] === 13)
          el.classList.add('received');
        if (state.turn === state.mySeat) {
          el.classList.add(legal.has(c) ? 'legal' : 'illegal');
          if (legal.has(c)) el.addEventListener('click', () => playCard(c));
        }
      }
      hand.appendChild(el);
    });
  }

  function renderTrick() {
    const trick = $('#trick');
    const banner = $('#trick-banner');
    $$('.trick-slot', trick).forEach((s) => { s.innerHTML = ''; s.classList.remove('winner'); });
    if (state.phase !== 'play' || !state.trick) {
      banner.classList.remove('show');
      lastTrickKey = '';
      return;
    }
    const key = state.trick.plays.map((p) => p.card).join(',');
    for (const p of state.trick.plays) {
      const slot = $(`.trick-slot.pos-${posOf(p.seat)}`, trick);
      const el = cardEl(p.card);
      if (key.startsWith(lastTrickKey) && lastTrickKey && state.trick.plays.indexOf(p) < lastTrickKey.split(',').length)
        el.style.animation = 'none'; // already on the table — don't replay the throw
      slot.appendChild(el);
      if (state.trick.winner === p.seat) slot.classList.add('winner');
    }
    lastTrickKey = key;

    if (state.trick.winner !== null && state.trick.winner !== undefined) {
      const w = playerAtSeat(state.trick.winner);
      const pts = state.trick.points;
      banner.textContent = pts ? `${w ? w.name : ''} أكل ${ar(pts)} ${pts === 1 ? 'نقطة' : 'نقاط'}` : `${w ? w.name : ''} أخذ الأكلة`;
      banner.classList.add('show');
    } else {
      banner.classList.remove('show');
    }
  }

  function renderHud() {
    const msg = $('#hud-msg');
    if (state.phase === 'gift') {
      msg.textContent = state.gift.mine ? 'بانتظار هدايا الآخرين…' : 'اختر ثلاث أوراق للهديّة';
    } else if (state.phase === 'play') {
      if (state.trick.winner !== null && state.trick.winner !== undefined) {
        msg.textContent = '';
      } else if (state.turn === state.mySeat) {
        msg.innerHTML = state.legalReason === 'leekha'
          ? '<span class="turn-me leekha">ليخة! العب بنت البستوني أو عشرة الدينار</span>'
          : '<span class="turn-me">دورك — العب ورقة</span>';
      } else {
        const p = playerAtSeat(state.turn);
        msg.textContent = `دور ${p ? p.name : '…'}`;
      }
    } else if (state.phase === 'roundEnd') {
      msg.textContent = 'انتهت الجولة';
    } else if (state.phase === 'gameOver') {
      msg.textContent = 'انتهت المباراة';
    } else {
      msg.textContent = '';
    }
  }

  // ---- gift --------------------------------------------------------------
  function toggleGift(card) {
    if (state.phase !== 'gift' || state.gift.mine) return;
    const i = giftPick.indexOf(card);
    if (i >= 0) giftPick.splice(i, 1);
    else if (giftPick.length < 3) giftPick.push(card);
    else return toast('ثلاث أوراق فقط', 'err');
    renderHand();
    renderGift();
  }

  function renderGift() {
    const box = $('#giftbox');
    if (state.phase !== 'gift') {
      box.hidden = true;
      stopTimer();
      return;
    }
    box.hidden = false;
    $('.gift-sub', box).textContent = state.passDir === 'left'
      ? 'اختر ثلاث أوراق تُهديها لمن على يسارك'
      : 'اختر ثلاث أوراق تُهديها لمن على يمينك';
    const chosen = state.gift.mine || giftPick;
    $$('.gift-slot', box).forEach((slot, i) => {
      slot.innerHTML = '';
      slot.classList.toggle('filled', !!chosen[i]);
      if (chosen[i]) {
        const el = cardEl(chosen[i]);
        if (!state.gift.mine) el.addEventListener('click', () => toggleGift(chosen[i]));
        slot.appendChild(el);
      }
    });
    const btn = $('#btn-gift');
    btn.hidden = !!state.gift.mine;
    btn.disabled = giftPick.length !== 3;
    $('#gift-wait').hidden = !state.gift.mine;
    $('.gift-sub', box).hidden = !!state.gift.mine;
    startTimer(state.gift.deadline);
  }

  $('#btn-gift').addEventListener('click', async () => {
    if (giftPick.length !== 3) return;
    const res = await emit('gift', { cards: giftPick.slice() });
    if (!res.ok) { toast(res.error, 'err'); giftPick = []; renderHand(); renderGift(); }
  });

  function startTimer(deadline) {
    stopTimer();
    const fg = $('#gift-timer .t-fg');
    const num = $('#gift-timer-num');
    const timer = $('#gift-timer');
    const total = state.giftSeconds * 1000;
    const tick = () => {
      const left = Math.max(0, deadline - Date.now());
      const frac = left / total;
      fg.style.strokeDashoffset = (106.8 * (1 - frac)).toFixed(1);
      num.textContent = ar(Math.ceil(left / 1000));
      timer.classList.toggle('urgent', left < 6000);
      if (left <= 0) stopTimer();
    };
    tick();
    timerHandle = setInterval(tick, 200);
  }
  function stopTimer() { clearInterval(timerHandle); timerHandle = null; }

  // ---- play --------------------------------------------------------------
  async function playCard(card) {
    const res = await emit('play', { card });
    if (!res.ok) toast(res.error, 'err');
  }

  // ---- scores --------------------------------------------------------------
  let scoresOpen = false;
  let roundEndShown = 0;

  $('#btn-scores').addEventListener('click', () => { scoresOpen = true; renderScoresOverlay(); });
  $('#btn-close-scores').addEventListener('click', () => { scoresOpen = false; renderScoresOverlay(); });
  $('#btn-next-round').addEventListener('click', async () => {
    const res = await emit('startGame', {});
    if (!res.ok) toast(res.error, 'err');
    scoresOpen = false;
  });

  function teamLabel(team) {
    const names = [team, team + 2].map((s) => playerAtSeat(s)).filter(Boolean).map((p) => esc(p.name));
    return names.join(' و ') || '—';
  }

  function renderScoresOverlay() {
    const ov = $('#overlay-scores');
    if (!state || !state.totals) { ov.hidden = true; return; }
    const isEnd = state.phase === 'roundEnd' || state.phase === 'gameOver';
    if (isEnd && roundEndShown !== state.round) {
      roundEndShown = state.round;
      scoresOpen = true;
    }
    ov.hidden = !scoresOpen;
    if (!scoresOpen) return;

    const over = state.phase === 'gameOver';
    const myTeam = state.mySeat % 2;
    $('#scores-title').textContent = over
      ? 'انتهت المباراة'
      : isEnd ? `نتيجة الجولة ${ar(state.round)}` : 'النقاط';

    // teams
    const teams = $('#teams');
    const tt = state.teamTotals;
    const lead = tt[0] === tt[1] ? null : tt[0] < tt[1] ? 0 : 1;
    teams.innerHTML = [0, 1].map((t) => `
      <div class="team ${t === myTeam ? 'mine' : ''} ${over && state.winnerTeam === t ? 'winner' : ''} ${!over && lead === t ? 'leading' : ''}">
        <div class="team-name">${teamLabel(t)}${t === myTeam ? ' <small>(فريقك)</small>' : ''}</div>
        <div class="team-total">${ar(tt[t])}</div>
        <div class="team-cap">${over && state.winnerTeam === t ? 'الفائزون' : `من ${ar(state.matchLimit)}`}</div>
      </div>`).join('<div class="team-vs">ضد</div>');

    const verdict = $('#scores-verdict');
    if (over) {
      verdict.hidden = false;
      verdict.textContent = state.winnerTeam === null
        ? 'تعادل الفريقان!'
        : state.winnerTeam === myTeam ? 'مبروك — فاز فريقك بالمباراة!' : 'فاز الخصوم هذه المرّة';
    } else {
      verdict.hidden = true;
    }

    // players
    const rows = [0, 1, 2, 3].map((s) => ({
      seat: s,
      p: playerAtSeat(s),
      round: state.roundPoints[s],
      total: state.totals[s],
    }));
    const best = Math.min(...rows.map((r) => r.total));
    const tbl = $('#scores-table');
    tbl.innerHTML = `<tr><th>اللاعب</th><th>هذه الجولة</th><th>المجموع</th></tr>` +
      rows.map((r) => `
        <tr class="${r.seat === state.mySeat ? 'me' : ''} ${r.total === best ? 'best' : ''} ${r.total >= state.matchLimit ? 'busted' : ''}">
          <td>${r.p ? esc(r.p.name) : '—'}</td>
          <td class="num">${ar(r.round)}</td>
          <td class="num">${ar(r.total)}</td>
        </tr>`).join('');
    const next = $('#btn-next-round');
    next.hidden = !(isEnd && state.isHost);
    next.textContent = over ? 'مباراة جديدة' : 'جولة جديدة';
    $('#scores-wait').hidden = !(isEnd && !state.isHost);
    $('#scores-wait').textContent = over ? 'بانتظار المضيف ليبدأ مباراة جديدة…' : 'بانتظار المضيف ليبدأ جولة جديدة…';
  }

  // ---------------------------------------------------------------------
  // master render
  // ---------------------------------------------------------------------
  function render() {
    if (!state) return;
    if (state.notice) toast(state.notice, 'gold');
    if (state.phase === 'lobby') {
      renderLobby();
      show('screen-lobby');
      $('#overlay-scores').hidden = true;
      scoresOpen = false;
      giftPick = [];
      lastRound = 0;
      roundEndShown = 0;
    } else {
      renderTable();
      show('screen-table');
    }
  }

  // keyboard: Enter on name field jumps to create
  $('#inp-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-create').click(); });
})();
