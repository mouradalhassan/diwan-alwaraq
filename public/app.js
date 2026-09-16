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
  const FRAGMENTS = 'عحهقنولمكيصطغضجسبدرز';
  const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const ar = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[d]);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initial = (name) => (name || '').trim().charAt(0) || '؟';
  const suitOf = (c) => c.slice(-1);
  const rankOf = (c) => c.slice(0, -1);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  };

  function playerId() {
    let id = store.get('diwan.playerId');
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now();
      store.set('diwan.playerId', id);
    }
    return id;
  }
  const PID = playerId();

  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 2400);
    setTimeout(() => el.remove(), 2900);
  }

  // ---------------------------------------------------------------------
  // sound — synthesized with Web Audio, no files
  // ---------------------------------------------------------------------
  const SFX = (() => {
    let ctx = null;
    let muted = store.get('diwan.muted') === '1';
    function ac() {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(f, { t = 0, dur = 0.15, type = 'sine', gain = 0.16, slide = null } = {}) {
      const c = ac();
      const o = c.createOscillator();
      const g = c.createGain();
      const at = c.currentTime + t;
      o.type = type;
      o.frequency.setValueAtTime(f, at);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, at + dur);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g).connect(c.destination);
      o.start(at);
      o.stop(at + dur + 0.05);
    }
    function noise({ t = 0, dur = 0.06, gain = 0.25, freq = 1800, q = 1 } = {}) {
      const c = ac();
      const len = Math.max(1, Math.floor(c.sampleRate * dur));
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = c.createBufferSource();
      s.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.value = gain;
      s.connect(f).connect(g).connect(c.destination);
      s.start(c.currentTime + t);
    }
    const S = {
      click: () => noise({ dur: 0.03, gain: 0.1, freq: 2600 }),
      join: () => { tone(523, { dur: 0.12 }); tone(659, { t: 0.1, dur: 0.2 }); },
      leave: () => { tone(659, { dur: 0.12 }); tone(494, { t: 0.1, dur: 0.22 }); },
      deal: () => { for (let i = 0; i < 10; i++) noise({ t: i * 0.045, dur: 0.04, gain: 0.14, freq: 1400 + Math.random() * 900 }); },
      card: () => { noise({ dur: 0.05, gain: 0.32, freq: 1900, q: 0.8 }); noise({ t: 0.02, dur: 0.09, gain: 0.14, freq: 500 }); },
      turn: () => { tone(880, { dur: 0.22, gain: 0.14 }); tone(1320, { t: 0.09, dur: 0.28, gain: 0.07 }); },
      tick: () => tone(1100, { dur: 0.035, type: 'square', gain: 0.04 }),
      gift: () => { noise({ dur: 0.28, gain: 0.18, freq: 800, q: 0.5 }); tone(440, { dur: 0.25, slide: 880, gain: 0.07 }); },
      trickGood: () => [523, 659, 784].forEach((f, i) => tone(f, { t: i * 0.07, dur: 0.22, gain: 0.13 })),
      trickBad: () => { tone(196, { dur: 0.35, type: 'triangle', gain: 0.2 }); tone(185, { t: 0.12, dur: 0.45, type: 'triangle', gain: 0.14 }); },
      trickNeutral: () => noise({ dur: 0.12, gain: 0.14, freq: 1100 }),
      roundEnd: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, { t: i * 0.1, dur: 0.4, gain: 0.11 })),
      win: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, { t: i * 0.12, dur: 0.55, gain: 0.13, type: 'triangle' })),
      lose: () => [392, 349, 311, 262].forEach((f, i) => tone(f, { t: i * 0.18, dur: 0.5, gain: 0.13, type: 'triangle' })),
      error: () => tone(150, { dur: 0.2, type: 'sawtooth', gain: 0.07 }),
      notice: () => tone(740, { dur: 0.12, gain: 0.07 }),
      start: () => [392, 523, 659, 784].forEach((f, i) => tone(f, { t: i * 0.09, dur: 0.3, gain: 0.12 })),
    };
    function play(name) {
      if (muted || !S[name]) return;
      try { S[name](); } catch (_) { /* audio unavailable */ }
    }
    function toggle() {
      muted = !muted;
      store.set('diwan.muted', muted ? '1' : '0');
      return muted;
    }
    document.addEventListener('pointerdown', () => { try { ac(); } catch (_) {} }, { once: true });
    return { play, toggle, get muted() { return muted; } };
  })();

  function syncMuteButtons() {
    $$('.nav-mute').forEach((b) => b.classList.toggle('muted', SFX.muted));
  }
  $$('.nav-mute').forEach((b) => b.addEventListener('click', () => { SFX.toggle(); syncMuteButtons(); if (!SFX.muted) SFX.play('click'); }));
  syncMuteButtons();

  // sound on every button press
  document.addEventListener('click', (e) => {
    if (e.target.closest('button') && !e.target.closest('.nav-mute')) SFX.play('click');
  });

  // ---------------------------------------------------------------------
  // calligraphic oval field (SVG) — dot grid + floating Thuluth fragments
  // ---------------------------------------------------------------------
  function calliField(w, h, { letters = 130, glow = false, dark = 1 } = {}) {
    const cx = w / 2, cy = h / 2, rx = w * 0.47, ry = h * 0.48;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#333333"/><stop offset=".3" stop-color="#4d4d4d"/>
          <stop offset=".7" stop-color="#b3b3b3"/><stop offset="1" stop-color="#d9d9d9"/>
        </linearGradient>
        <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">
          <rect x="5" y="5" width="2.2" height="2.2" fill="#000" fill-opacity=".22"/>
          <rect x="18" y="18" width="3" height="3" fill="#000" fill-opacity=".16" transform="rotate(45 19.5 19.5)"/>
        </pattern>
        <radialGradient id="glow" cx=".5" cy=".5" r=".5">
          <stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".55" stop-color="#fff" stop-opacity=".92"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </radialGradient>
        <clipPath id="oval"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/></clipPath>
      </defs>
      <g clip-path="url(#oval)">
        <rect width="${w}" height="${h}" fill="url(#g)" opacity="${dark}"/>
        <rect width="${w}" height="${h}" fill="url(#dots)"/>`;
    for (let i = 0; i < letters; i++) {
      const r = Math.pow(Math.random(), 0.55);
      const a = Math.random() * Math.PI * 2;
      const x = cx + Math.cos(a) * r * rx * 0.96;
      const y = cy + Math.sin(a) * r * ry * 0.96;
      const size = 14 + Math.random() * 56 * (1 - r * 0.5);
      const rot = (Math.random() - 0.5) * 110;
      const ty = (y - (cy - ry)) / (2 * ry); // 0 top → 1 bottom
      const lum = Math.round(235 - ty * 215); // light glyphs on the dark top, dark on the light bottom
      const fill = `rgb(${lum},${lum},${lum})`;
      const op = (0.18 + (1 - r) * 0.42).toFixed(2);
      const ch = FRAGMENTS[Math.floor(Math.random() * FRAGMENTS.length)];
      s += `<text x="0" y="0" font-family="Katibeh, Amiri, serif" font-size="${size.toFixed(0)}" fill="${fill}" fill-opacity="${op}" transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) rotate(${rot.toFixed(0)})" text-anchor="middle">${ch}</text>`;
    }
    if (glow) s += `<ellipse cx="${cx}" cy="${cy}" rx="${(rx * 0.72).toFixed(0)}" ry="${(ry * 0.36).toFixed(0)}" fill="url(#glow)"/>`;
    s += `</g><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#1a1a1a" stroke-opacity=".08"/></svg>`;
    return s;
  }

  function paintFields() {
    $('#calli-home').innerHTML = calliField(600, 800, { letters: 150, glow: true });
    $('#felt').innerHTML = calliField(700, 480, { letters: 70 });
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(paintFields);
  paintFields();

  // ---------------------------------------------------------------------
  // card element
  // ---------------------------------------------------------------------
  function cardEl(card) {
    const s = suitOf(card);
    const r = rankOf(card);
    const el = document.createElement('div');
    el.className = 'card ' + (s === 'H' || s === 'D' ? 'red' : 'black');
    el.dataset.card = card;
    el.title = `${r} ${SUIT_NAME[s]}`;
    const idx = `<div class="idx"><span>${r}</span><small>${SUIT_GLYPH[s]}</small></div>
                 <div class="idx b"><span>${r}</span><small>${SUIT_GLYPH[s]}</small></div>`;
    if (FACE_NAME[r]) {
      const frag = FRAGMENTS[(r.charCodeAt(0) + s.charCodeAt(0)) % FRAGMENTS.length];
      el.innerHTML = `${idx}<div class="face"><span class="frag">${frag}</span><b>${r}</b><i>${FACE_NAME[r]} ${SUIT_GLYPH[s]}</i></div>`;
    } else {
      const n = parseInt(r, 10);
      const cols = n <= 3 ? 1 : 2;
      el.innerHTML = `${idx}<div class="pips n${n}" style="--cols:${cols}">${Array.from({ length: n }, () => `<span>${SUIT_GLYPH[s]}</span>`).join('')}</div>`;
    }
    return el;
  }
  function backEl() {
    const el = document.createElement('div');
    el.className = 'card back';
    return el;
  }

  // ---------------------------------------------------------------------
  // flight animations
  // ---------------------------------------------------------------------
  function fly(el, from, to, { duration = 420, scaleTo = 1, fade = false, rotate = 0 } = {}) {
    const layer = $('#fly');
    el.style.left = from.left + 'px';
    el.style.top = from.top + 'px';
    el.style.width = from.width + 'px';
    el.style.height = from.height + 'px';
    layer.appendChild(el);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const sc = (to.width / from.width) * scaleTo;
    const anim = el.animate(
      [
        { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx}px,${dy}px) scale(${sc}) rotate(${rotate}deg)`, opacity: fade ? 0 : 1 },
      ],
      { duration, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }
    );
    return new Promise((res) => { anim.onfinish = () => { el.remove(); res(); }; });
  }
  const rectOf = (el) => el.getBoundingClientRect();
  const centerRect = (el, size = 20) => {
    const r = rectOf(el);
    return { left: r.left + r.width / 2 - size / 2, top: r.top + r.height / 2 - size / 2, width: size, height: size * 1.4 };
  };

  // ---------------------------------------------------------------------
  // screens + nav
  // ---------------------------------------------------------------------
  const NAV = {
    'screen-home': { back: null, step: '' },
    'screen-choose': { back: 'screen-home', step: '١ · اللعبة' },
    'screen-party': { back: 'screen-choose', step: '٢ · الاسم والرمز' },
    'screen-lobby': { back: 'leave', step: '٣ · المجلس' },
    'screen-table': null, // nav disappears in-game
  };
  let current = 'screen-home';
  function show(id) {
    if (current !== id) {
      $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
      current = id;
    }
    const nav = $('#nav');
    const cfg = NAV[id];
    nav.classList.toggle('hidden', !cfg);
    if (cfg) {
      $('#nav-back').hidden = !cfg.back;
      $('#nav-back').dataset.to = cfg.back || '';
      $('#nav-step').textContent = cfg.step;
    }
  }
  $('#nav-back').addEventListener('click', async () => {
    const to = $('#nav-back').dataset.to;
    if (to === 'leave') {
      await emit('leaveParty', {});
      state = null;
      show('screen-choose');
    } else if (to) show(to);
  });
  $('#nav-brand').addEventListener('click', () => { if (!state) show('screen-home'); });

  // ---------------------------------------------------------------------
  // socket
  // ---------------------------------------------------------------------
  const socket = io({ transports: ['websocket', 'polling'] });
  let state = null;
  let prev = null;
  let chosenGame = 'leekha';
  let pendingCode = new URLSearchParams(location.search).get('code');

  const emit = (ev, payload) => new Promise((resolve) => socket.emit(ev, payload, resolve));

  socket.on('connect', async () => {
    const res = await emit('hello', { playerId: PID });
    if ((!res || !res.inRoom) && pendingCode) {
      pendingCode = pendingCode.toUpperCase();
      const peek = await emit('peek', { code: pendingCode });
      if (peek.ok) {
        chosenGame = peek.game;
        $('#inp-code').value = pendingCode;
        $('#party-game').textContent = GAME_NAMES[chosenGame];
        show('screen-party');
        toast(`دُعيت إلى ديوان ${peek.gameName}`);
      } else toast(peek.error, 'err');
      history.replaceState(null, '', location.pathname);
      pendingCode = null;
    }
  });
  socket.on('disconnect', () => toast('انقطع الاتصال… نحاول العودة', 'err'));
  socket.on('state', onState);

  // ---------------------------------------------------------------------
  // home / choose / party
  // ---------------------------------------------------------------------
  $('#btn-enter').addEventListener('click', () => show('screen-choose'));

  $$('.tile').forEach((tile) => {
    tile.addEventListener('click', () => {
      const g = tile.dataset.game;
      if (tile.classList.contains('soon')) return toast(`${GAME_NAMES[g]} قادمة قريباً`);
      chosenGame = g;
      $('#party-game').textContent = GAME_NAMES[g];
      show('screen-party');
      $('#inp-name').focus();
    });
  });

  $('#inp-name').value = store.get('diwan.name') || '';
  $('#btn-bots').hidden = false;

  function myName() {
    const n = $('#inp-name').value.trim();
    if (!n) { toast('اكتب اسمك أولاً', 'err'); $('#inp-name').focus(); return null; }
    store.set('diwan.name', n);
    return n;
  }

  async function go() {
    const name = myName();
    if (!name) return;
    const code = $('#inp-code').value.trim().toUpperCase();
    let res;
    if (code) {
      if (code.length !== 6) return toast('الرمز مكوّن من ستة أحرف', 'err');
      res = await emit('joinParty', { playerId: PID, name, code });
    } else {
      res = await emit('createParty', { playerId: PID, name, game: chosenGame });
    }
    if (!res.ok) { toast(res.error, 'err'); SFX.play('error'); }
  }
  $('#btn-go').addEventListener('click', go);
  $('#inp-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  $('#inp-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  $('#inp-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

  $('#btn-bots').addEventListener('click', async () => {
    const name = myName();
    if (!name) return;
    const res = await emit('createParty', { playerId: PID, name, game: chosenGame, withBots: true });
    if (!res.ok) return toast(res.error, 'err');
  });

  // ---------------------------------------------------------------------
  // lobby
  // ---------------------------------------------------------------------
  $('#btn-share').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?code=${state.code}`;
    const text = `تعال العب ${state.gameName} معنا — الرمز ${state.code}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'ديوان الورق', text, url }); return; } catch (_) { /* cancelled */ }
    }
    try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('نُسخ رابط الدعوة'); }
    catch (_) { toast(`الرمز: ${state.code}`); }
  });
  $('#btn-start').addEventListener('click', async () => {
    const res = await emit('startGame', {});
    if (!res.ok) toast(res.error, 'err');
  });
  $('#btn-fill').addEventListener('click', async () => {
    const res = await emit('addBots', {});
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
      el.className = 'seat ' + (p ? 'filled' : 'empty') + (p && p.isBot ? ' bot' : '') + (p && !p.connected ? ' offline' : '');
      const tag = !p ? '' : p.isBot ? 'بوت' : p.isHost ? 'المضيف' : `مقعد ${ar(s + 1)}`;
      el.innerHTML = `
        <div class="seat-medal">${p ? (p.isBot ? '⌘' : initial(p.name)) : ''}</div>
        <div class="seat-name">${p ? esc(p.name) : 'مقعد فارغ'}</div>
        <div class="seat-tag">${tag}${p && p.id === state.myId ? ' · أنت' : ''}${p && !p.connected ? ' · انقطع' : ''}</div>`;
      seats.appendChild(el);
    }
    const n = state.players.length;
    const st = $('#lobby-status');
    if (n < 4) st.textContent = `حضر ${ar(n)} من ٤`;
    else st.textContent = state.isHost ? 'اكتمل المجلس' : 'اكتمل المجلس — بانتظار المضيف';
    $('#btn-start').hidden = !state.isHost;
    $('#btn-start').disabled = !(state.isHost && n === 4);
    $('#btn-fill').hidden = !(state.isHost && state.allowBots && n < 4);
  }

  // ---------------------------------------------------------------------
  // table
  // ---------------------------------------------------------------------
  const posOf = (seat) => (seat - state.mySeat + 4) % 4;
  const seatAt = (pos) => (state.mySeat + pos) % 4;
  const playerAtSeat = (seat) => state.players.find((p) => p.seat === seat);
  const seatSpot = (seat) => $(`.seat-spot.pos-${posOf(seat)}`);
  const slotOf = (seat) => $(`.trick-slot.pos-${posOf(seat)}`);

  let giftPick = [];
  let lastRound = 0;
  const pending = new Set(); // cards in flight → hidden in the trick until they land
  let lastTap = {};

  function renderTable() {
    $('#hud-game').textContent = state.gameName;
    $('#hud-round').textContent = `الجولة ${ar(state.round)}`;
    if (state.round !== lastRound) { giftPick = []; lastRound = state.round; }
    renderSeats();
    renderHand();
    renderTrick();
    renderGift();
    renderHud();
    renderTotals();
    renderScoresOverlay();
  }

  function renderSeats() {
    for (let pos = 0; pos < 4; pos++) {
      const spot = $(`.seat-spot.pos-${pos}`);
      const seat = seatAt(pos);
      const p = playerAtSeat(seat);
      const wasTurn = spot.classList.contains('turn');
      spot.className = `seat-spot pos-${pos}`;
      if (!p) { spot.classList.add('empty'); spot.innerHTML = `<div class="avatar-wrap"><div class="avatar"></div></div>`; continue; }
      if (!p.connected) spot.classList.add('offline');
      if (p.isBot) spot.classList.add('bot');
      if (seat === state.mySeat) spot.classList.add('me');
      spot.classList.add(seat % 2 === state.mySeat % 2 ? 'team-mine' : 'team-theirs');
      const isTurn = state.phase === 'play' && state.turn === seat && state.trick && state.trick.winner === null;
      if (isTurn) spot.classList.add('turn');
      const gifted = state.phase === 'gift' && state.gift.done[seat];
      const pts = state.roundPoints ? state.roundPoints[seat] : 0;
      const prevPts = prev && prev.roundPoints ? prev.roundPoints[seat] : pts;
      const role = pos === 2 ? 'شريكك' : pos === 0 ? 'أنت' : 'خصم';
      spot.innerHTML = `
        <div class="avatar-wrap">
          <svg class="ring" viewBox="0 0 100 100"><circle class="ring-bg" cx="50" cy="50" r="46"/><circle class="ring-fg" cx="50" cy="50" r="46"/></svg>
          <div class="avatar">${p.isBot ? 'بوت' : initial(p.name)}</div>
          <div class="cube ${pts === 0 ? 'zero' : ''} ${pts !== prevPts ? 'bump' : ''}" title="نقاط هذه الجولة">${ar(pts)}</div>
          ${gifted ? '<span class="gifted">✓</span>' : ''}
          ${state.dealer === seat ? '<span class="dealer" title="الموزّع">م</span>' : ''}
        </div>
        <div class="sname">${esc(p.name)}</div>
        <div class="srole">${role}</div>`;
      if (isTurn && !wasTurn && seat !== state.mySeat) spot.querySelector('.avatar').animate([{ transform: 'scale(.9)' }, { transform: 'scale(1.06)' }], { duration: 300, easing: 'ease-out' });
    }
  }

  function renderTotals() {
    const box = $('#totals');
    if (!state.totals) { box.innerHTML = ''; return; }
    box.innerHTML = [0, 1, 2, 3].map((pos) => {
      const seat = seatAt(pos);
      const p = playerAtSeat(seat);
      const cls = seat === state.mySeat ? 'row-me' : seat % 2 === state.mySeat % 2 ? 'row-mine' : 'row-them';
      return `<span class="tn ${cls}">${p ? esc(p.name) : '—'}</span><span class="tv ${cls}">${ar(state.totals[seat])}</span>`;
    }).join('');
  }

  // ---- hand -----------------------------------------------------------
  function renderHand() {
    const hand = $('#hand');
    const cards = state.hand || [];
    const legal = new Set(state.legal || []);
    const received = new Set(state.received || []);
    const n = cards.length;
    hand.innerHTML = '';
    const myTurn = state.phase === 'play' && state.turn === state.mySeat && state.trick && state.trick.winner === null;
    cards.forEach((c, i) => {
      const el = cardEl(c);
      const t = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0;
      el.style.setProperty('--rot', `${(t * 8).toFixed(2)}deg`);
      el.style.setProperty('--lift', `${(Math.abs(t) * 12).toFixed(1)}px`);
      el.style.zIndex = i;
      if (pending.has(c)) el.classList.add('gone');

      if (state.phase === 'gift') {
        if (received.has(c)) el.classList.add('received');
        if (giftPick.includes(c)) el.classList.add('gone');
        if (!state.gift.mine) el.addEventListener('click', () => toggleGift(c));
      } else if (state.phase === 'play') {
        if (received.has(c) && state.cardsLeft && state.cardsLeft[state.mySeat] === 13) el.classList.add('received');
        if (myTurn) {
          el.classList.add(legal.has(c) ? 'legal' : 'illegal');
          if (legal.has(c)) attachPlay(el, c);
        }
      }
      hand.appendChild(el);
    });
  }

  // drag to the table, or double-tap
  function attachPlay(el, card) {
    let down = null, ghost = null, dragging = false;
    const table = $('#table');
    const dropLine = () => rectOf($('#hand-wrap')).top;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, rect: rectOf(el) };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!dragging && Math.hypot(dx, dy) > 8) {
        dragging = true;
        ghost = cardEl(card);
        ghost.classList.add('ghost');
        Object.assign(ghost.style, { left: down.rect.left + 'px', top: down.rect.top + 'px', width: down.rect.width + 'px', height: down.rect.height + 'px' });
        $('#fly').appendChild(ghost);
        el.classList.add('dragging');
      }
      if (dragging) {
        const over = e.clientY < dropLine();
        ghost.style.transform = `translate(${dx}px,${dy}px) rotate(${(dx * 0.04).toFixed(1)}deg) scale(${over ? 1.04 : 1})`;
        ghost.classList.toggle('over', over);
        table.classList.toggle('drag-over', over);
      }
    });
    const finish = (e) => {
      if (!down) return;
      table.classList.remove('drag-over');
      if (dragging) {
        const g = ghost; ghost = null;
        if (e.clientY < dropLine()) {
          const r = rectOf(g);
          g.remove();
          el.classList.add('gone');
          playFrom(card, r);
        } else {
          g.animate([{ transform: g.style.transform }, { transform: 'translate(0,0)' }], { duration: 220, easing: 'ease-out' })
            .onfinish = () => { g.remove(); el.classList.remove('dragging'); };
        }
      } else {
        const now = Date.now();
        if (lastTap.card === card && now - lastTap.t < 420) {
          lastTap = {};
          el.classList.add('gone');
          playFrom(card, rectOf(el));
        } else {
          lastTap = { card, t: now };
          $$('.hand .card.raised').forEach((x) => x.classList.remove('raised'));
          el.classList.add('raised');
        }
      }
      down = null; dragging = false;
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', () => { if (ghost) { ghost.remove(); ghost = null; } el.classList.remove('dragging'); table.classList.remove('drag-over'); down = null; dragging = false; });
  }

  async function playFrom(card, fromRect) {
    pending.add(card);
    const flight = fly(cardEl(card), fromRect, rectOf(slotOf(state.mySeat)), { duration: 380 });
    SFX.play('card');
    const res = await emit('play', { card });
    if (!res.ok) {
      toast(res.error, 'err');
      SFX.play('error');
      pending.delete(card);
      renderHand();
      return;
    }
    await flight;
    pending.delete(card);
    revealInTrick(card);
  }

  function revealInTrick(card) {
    const el = $(`#trick .card[data-card="${card}"]`);
    if (el) el.classList.remove('pending');
  }

  // ---- trick ----------------------------------------------------------
  function renderTrick() {
    const trick = $('#trick');
    const banner = $('#trick-banner');
    $$('.trick-slot', trick).forEach((s) => { s.innerHTML = ''; s.classList.remove('winner'); });
    if (state.phase !== 'play' || !state.trick) { banner.classList.remove('show'); return; }
    for (const p of state.trick.plays) {
      const el = cardEl(p.card);
      if (pending.has(p.card)) el.classList.add('pending');
      const slot = slotOf(p.seat);
      slot.appendChild(el);
      if (state.trick.winner === p.seat) slot.classList.add('winner');
    }
    if (state.trick.winner !== null && state.trick.winner !== undefined) {
      const w = playerAtSeat(state.trick.winner);
      const pts = state.trick.points;
      banner.textContent = pts ? `${w ? w.name : ''} أكل ${ar(pts)}` : `${w ? w.name : ''} أخذ الليخة`;
      banner.classList.add('show');
    } else banner.classList.remove('show');
  }

  function renderHud() {
    const msg = $('#hud-msg');
    if (state.phase === 'gift') {
      msg.textContent = state.gift.mine ? 'بانتظار هدايا الآخرين' : 'اختر ثلاث أوراق للهديّة';
    } else if (state.phase === 'play') {
      if (state.trick.winner !== null) msg.textContent = '';
      else if (state.turn === state.mySeat) {
        msg.innerHTML = state.legalReason === 'leekha'
          ? '<span class="leekha">ليخة — العب بنت البستوني أو عشرة الدينار</span>'
          : '<span class="me">دورك — اسحب ورقة إلى الطاولة أو انقرها مرتين</span>';
      } else {
        const p = playerAtSeat(state.turn);
        msg.textContent = `دور ${p ? p.name : '…'}`;
      }
    } else if (state.phase === 'roundEnd') msg.textContent = 'انتهت الجولة';
    else if (state.phase === 'gameOver') msg.textContent = 'انتهت المباراة';
    else msg.textContent = '';
  }

  // ---- gift -----------------------------------------------------------
  function toggleGift(card) {
    if (state.phase !== 'gift' || state.gift.mine) return;
    const i = giftPick.indexOf(card);
    if (i >= 0) giftPick.splice(i, 1);
    else if (giftPick.length < 3) giftPick.push(card);
    else return toast('ثلاث أوراق فقط', 'err');
    SFX.play('click');
    renderHand();
    renderGift();
  }

  function renderGift() {
    const box = $('#giftbox');
    if (state.phase !== 'gift') { box.hidden = true; return; }
    box.hidden = false;
    $('#gift-sub').textContent = state.passDir === 'left' ? 'ثلاث أوراق لمن على يسارك' : 'ثلاث أوراق لمن على يمينك';
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
    $('#btn-gift').hidden = !!state.gift.mine;
    $('#btn-gift').disabled = giftPick.length !== 3;
    $('#gift-wait').hidden = !state.gift.mine;
  }

  $('#btn-gift').addEventListener('click', async () => {
    if (giftPick.length !== 3) return;
    const res = await emit('gift', { cards: giftPick.slice() });
    if (!res.ok) { toast(res.error, 'err'); giftPick = []; renderHand(); renderGift(); return; }
    SFX.play('gift');
  });

  // ---- timers (rings) -------------------------------------------------
  let lastTickSecond = -1;
  setInterval(() => {
    if (!state || current !== 'screen-table') return;
    const now = Date.now();
    for (let pos = 0; pos < 4; pos++) {
      const spot = $(`.seat-spot.pos-${pos}`);
      const seat = seatAt(pos);
      let deadline = null, total = 0;
      if (state.phase === 'gift' && !state.gift.done[seat]) { deadline = state.gift.deadline; total = state.giftSeconds * 1000; }
      else if (state.phase === 'play' && state.turn === seat && state.turnDeadline) { deadline = state.turnDeadline; total = state.turnSeconds * 1000; }
      const fg = spot.querySelector('.ring-fg');
      if (!fg) continue;
      if (!deadline) { spot.classList.remove('timing', 'urgent'); continue; }
      const left = Math.max(0, deadline - now);
      const frac = left / total;
      fg.style.strokeDashoffset = (289 * (1 - frac)).toFixed(1);
      spot.classList.add('timing');
      spot.classList.toggle('urgent', left < 5000);
      if (seat === state.mySeat && left < 5000 && left > 0) {
        const sec = Math.ceil(left / 1000);
        if (sec !== lastTickSecond) { lastTickSecond = sec; SFX.play('tick'); }
      }
    }
  }, 120);

  // ---------------------------------------------------------------------
  // scores overlay (round end / match end)
  // ---------------------------------------------------------------------
  let scoresOpen = false;
  let roundEndShown = 0;
  $('#btn-close-scores').addEventListener('click', () => { scoresOpen = false; renderScoresOverlay(); });
  $('#btn-next-round').addEventListener('click', async () => {
    const res = await emit('startGame', {});
    if (!res.ok) toast(res.error, 'err');
    scoresOpen = false;
  });

  function teamLabel(team) {
    return [team, team + 2].map((s) => playerAtSeat(s)).filter(Boolean).map((p) => esc(p.name)).join(' و ') || '—';
  }

  function renderScoresOverlay() {
    const ov = $('#overlay-scores');
    if (!state || !state.totals) { ov.hidden = true; return; }
    const isEnd = state.phase === 'roundEnd' || state.phase === 'gameOver';
    if (isEnd && roundEndShown !== state.round) { roundEndShown = state.round; scoresOpen = true; }
    ov.hidden = !scoresOpen;
    if (!scoresOpen) return;

    const over = state.phase === 'gameOver';
    const myTeam = state.mySeat % 2;
    $('#scores-title').textContent = over ? 'انتهت المباراة' : `الجولة ${ar(state.round)}`;
    const tt = state.teamTotals;
    $('#teams').innerHTML = [0, 1].map((t) => `
      <div class="team ${t === myTeam ? 'mine' : ''} ${over && state.winnerTeam === t ? 'winner' : ''}">
        <div class="team-name">${teamLabel(t)}${t === myTeam ? ' <small>(فريقك)</small>' : ''}</div>
        <div class="team-total">${ar(tt[t])}</div>
        <div class="team-cap">${over && state.winnerTeam === t ? 'الفائزون' : `من ${ar(state.matchLimit)}`}</div>
      </div>`).join('<div class="team-vs">×</div>');
    const verdict = $('#scores-verdict');
    verdict.hidden = !over;
    if (over) verdict.textContent = state.winnerTeam === null ? 'تعادل' : state.winnerTeam === myTeam ? 'فاز فريقك' : 'فاز الخصوم';

    const rows = [0, 1, 2, 3].map((s) => ({ seat: s, p: playerAtSeat(s), round: state.roundPoints[s], total: state.totals[s] }));
    const best = Math.min(...rows.map((r) => r.total));
    $('#scores-table').innerHTML = `<tr><th>اللاعب</th><th>الجولة</th><th>المجموع</th></tr>` +
      rows.map((r) => `<tr class="${r.seat === state.mySeat ? 'me' : ''} ${r.total === best ? 'best' : ''} ${r.total >= state.matchLimit ? 'busted' : ''}">
        <td>${r.p ? esc(r.p.name) : '—'}</td><td class="num">${ar(r.round)}</td><td class="num">${ar(r.total)}</td></tr>`).join('');
    const next = $('#btn-next-round');
    next.hidden = !(isEnd && state.isHost);
    next.textContent = over ? 'مباراة جديدة' : 'جولة جديدة';
    $('#scores-wait').hidden = !(isEnd && !state.isHost);
    $('#scores-wait').textContent = over ? 'بانتظار المضيف لمباراة جديدة' : 'بانتظار المضيف للجولة التالية';
  }

  // ---------------------------------------------------------------------
  // state transitions → sounds + animations
  // ---------------------------------------------------------------------
  async function onState(view) {
    prev = state;
    state = view;
    const p = prev;

    if (state.notice) { toast(state.notice); SFX.play('notice'); }

    // lobby comings and goings
    if (p && state.phase === 'lobby' && p.phase === 'lobby') {
      if (state.players.length > p.players.length) SFX.play('join');
      else if (state.players.length < p.players.length) SFX.play('leave');
    }

    // a completed trick is being collected → fly the four cards to the winner
    if (p && p.phase === 'play' && p.trick && p.trick.winner !== null && (!state.trick || state.trick.plays.length === 0 || state.phase !== 'play')) {
      const winnerSpot = seatSpot(p.trick.winner);
      const to = winnerSpot ? centerRect(winnerSpot.querySelector('.avatar') || winnerSpot, 24) : null;
      if (to) {
        for (const play of p.trick.plays) {
          const el = $(`#trick .card[data-card="${play.card}"]`);
          if (el) fly(cardEl(play.card), rectOf(el), to, { duration: 480, fade: true, scaleTo: 0.6 });
        }
      }
      const mine = p.trick.winner % 2 === state.mySeat % 2;
      if (p.trick.points === 0) SFX.play('trickNeutral');
      else SFX.play(mine ? 'trickBad' : 'trickGood');
    }

    // cards other players just threw → fly from their seat
    if (state.phase === 'play' && state.trick) {
      const before = new Set(p && p.trick ? p.trick.plays.map((x) => x.card) : []);
      for (const play of state.trick.plays) {
        if (before.has(play.card) || play.seat === state.mySeat || pending.has(play.card)) continue;
        pending.add(play.card);
        const spot = seatSpot(play.seat);
        const from = spot ? centerRect(spot.querySelector('.avatar') || spot, 30) : rectOf($('#felt'));
        SFX.play('card');
        fly(cardEl(play.card), from, rectOf(slotOf(play.seat)), { duration: 420 }).then(() => { pending.delete(play.card); revealInTrick(play.card); });
      }
      if (state.trick.plays.length === 0) pending.clear();
    }

    // my turn / leekha
    if (state.phase === 'play' && state.turn === state.mySeat && state.trick && state.trick.winner === null && !(p && p.phase === 'play' && p.turn === state.mySeat && p.trick && p.trick.winner === null)) {
      SFX.play('turn');
      lastTickSecond = -1;
    }

    // phase changes
    if (!p || p.phase !== state.phase) {
      if (state.phase === 'roundEnd') SFX.play('roundEnd');
      if (state.phase === 'gameOver') SFX.play(state.winnerTeam === state.mySeat % 2 ? 'win' : 'lose');
      if (state.phase === 'play' && p && p.phase === 'gift' && state.gift === undefined) { /* gifts applied */ }
    }

    render();

    // new round → deal animation
    if (state.phase === 'gift' && (!p || p.round !== state.round || p.phase === 'lobby')) {
      await dealAnimation();
    }
  }

  async function dealAnimation() {
    SFX.play('start');
    const felt = $('#felt');
    const from = centerRect(felt, 30);
    const hand = $$('#hand .card');
    hand.forEach((c) => c.classList.add('dealt'));
    const box = $('#giftbox');
    box.hidden = true;
    await sleep(120);
    SFX.play('deal');
    // other seats get a few backs, then my hand lands one by one
    for (let pos = 1; pos < 4; pos++) {
      const spot = $(`.seat-spot.pos-${pos}`);
      for (let k = 0; k < 4; k++) {
        setTimeout(() => fly(backEl(), from, centerRect(spot.querySelector('.avatar') || spot, 26), { duration: 320, fade: true, scaleTo: 0.5 }), k * 45 + pos * 40);
      }
    }
    hand.forEach((c, i) => {
      setTimeout(() => {
        const to = rectOf(c);
        fly(cardEl(c.dataset.card), from, to, { duration: 300 }).then(() => c.classList.remove('dealt'));
      }, 200 + i * 45);
    });
    await sleep(200 + hand.length * 45 + 320);
    if (state && state.phase === 'gift') { box.hidden = false; renderGift(); }
  }

  // ---------------------------------------------------------------------
  // master render
  // ---------------------------------------------------------------------
  function render() {
    if (!state) return;
    if (state.phase === 'lobby') {
      renderLobby();
      show('screen-lobby');
      $('#overlay-scores').hidden = true;
      scoresOpen = false; giftPick = []; lastRound = 0; roundEndShown = 0; pending.clear();
    } else {
      renderTable();
      show('screen-table');
    }
  }
})();
