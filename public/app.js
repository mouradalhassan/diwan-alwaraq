/* ديوان الورق — client */
(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const GAME_NAMES = { leekha: 'ليخة', trix: 'تريكس', trixComplex: 'تريكس كومبلكس', four00: '٤٠٠' };
  const SUIT_NAME = { H: 'كبّة', D: 'دينار', C: 'سباتي', S: 'بستوني' };
  const FACE_NAME = { J: 'شاب', Q: 'بنت', K: 'شيخ', A: 'قص' };
  const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const ar = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[d]);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const suitOf = (c) => c.slice(-1);
  const rankOf = (c) => c.slice(0, -1);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const suitSvg = (s, cls = 's') => `<svg class="${cls}" viewBox="0 0 100 100"><use href="#s-${s}"/></svg>`;

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
      f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
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
      emote: () => { tone(660, { dur: 0.08, gain: 0.06 }); tone(880, { t: 0.06, dur: 0.1, gain: 0.05 }); },
      start: () => [392, 523, 659, 784].forEach((f, i) => tone(f, { t: i * 0.09, dur: 0.3, gain: 0.12 })),
    };
    function play(name) {
      if (muted || !S[name]) return;
      try { S[name](); } catch (_) { /* audio unavailable */ }
    }
    function toggle() { muted = !muted; store.set('diwan.muted', muted ? '1' : '0'); return muted; }
    document.addEventListener('pointerdown', () => { try { ac(); } catch (_) {} }, { once: true });
    return { play, toggle, get muted() { return muted; } };
  })();

  function syncMuteButtons() { $$('.nav-mute').forEach((b) => b.classList.toggle('muted', SFX.muted)); }
  $$('.nav-mute').forEach((b) => b.addEventListener('click', () => { SFX.toggle(); syncMuteButtons(); if (!SFX.muted) SFX.play('click'); }));
  syncMuteButtons();
  document.addEventListener('click', (e) => { if (e.target.closest('button') && !e.target.closest('.nav-mute')) SFX.play('click'); });

  // ---------------------------------------------------------------------
  // avatars — 12 illustrated Levantine characters (vector)
  // ---------------------------------------------------------------------
  const AV = [
    { bg: '#7a2230', skin: '#e8b892', hw: 'tarboosh', beard: 'mustache' },
    { bg: '#145239', skin: '#d9a077', hw: 'keffiyeh', kc: '#f4e9cf' },
    { bg: '#8d6d24', skin: '#f0c9a8', hw: 'hijab', hc: '#5c1a24' },
    { bg: '#2b3a67', skin: '#c98a62', hw: 'turban', beard: 'full' },
    { bg: '#5c1a24', skin: '#e8b892', hw: 'none', hair: '#2a1a12', beard: 'stubble' },
    { bg: '#0f3d2e', skin: '#f0c9a8', hw: 'hijab', hc: '#c9a445' },
    { bg: '#3d2b1f', skin: '#d9a077', hw: 'cap', beard: 'mustache' },
    { bg: '#b0862c', skin: '#e8b892', hw: 'none', hair: '#4a2c1a', long: true },
    { bg: '#1d4b5e', skin: '#c98a62', hw: 'keffiyeh', kc: '#e63946' },
    { bg: '#6b3a1f', skin: '#f0c9a8', hw: 'tarboosh', glasses: true },
    { bg: '#264d3b', skin: '#d9a077', hw: 'hijab', hc: '#1d4b5e' },
    { bg: '#4a2c5c', skin: '#e8b892', hw: 'turban', beard: 'full', glasses: true },
  ];
  function avatarSVG(i) {
    const a = AV[((i % AV.length) + AV.length) % AV.length];
    const hair = a.hair || '#2a1a12';
    let s = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="50" fill="${a.bg}"/>`;
    // shoulders
    s += `<path d="M14 100c2-20 16-28 36-28s34 8 36 28z" fill="${a.hw === 'hijab' ? a.hc : '#f4e9cf'}"/>`;
    if (a.long) s += `<path d="M28 48c-4 22 0 34 8 40h28c8-6 12-18 8-40z" fill="${hair}"/>`;
    if (a.hw === 'hijab') s += `<path d="M22 60c-2-30 12-42 28-42s30 12 28 42c-2 14-14 20-28 22-14-2-26-8-28-22z" fill="${a.hc}"/>`;
    // face
    s += `<ellipse cx="50" cy="52" rx="19" ry="23" fill="${a.skin}"/>`;
    // ears
    s += `<circle cx="31" cy="54" r="4" fill="${a.skin}"/><circle cx="69" cy="54" r="4" fill="${a.skin}"/>`;
    // hair / headwear
    if (a.hw === 'none') s += `<path d="M31 46c0-16 8-24 19-24s19 8 19 24c-4-8-10-12-19-12s-15 4-19 12z" fill="${hair}"/>`;
    if (a.hw === 'tarboosh') s += `<path d="M32 40c0-14 8-22 18-22s18 8 18 22z" fill="#b3202a"/><rect x="31" y="38" width="38" height="5" rx="2" fill="#8a1620"/><path d="M62 20l6-4" stroke="#1b1410" stroke-width="2"/><circle cx="68" cy="16" r="3" fill="#1b1410"/>`;
    if (a.hw === 'keffiyeh') s += `<path d="M26 44c0-18 10-26 24-26s24 8 24 26c-6-10-14-14-24-14s-18 4-24 14z" fill="${a.kc}"/><path d="M26 44c-6 10-6 24 0 34h6c-4-10-4-24 0-34z" fill="${a.kc}"/><path d="M74 44c6 10 6 24 0 34h-6c4-10 4-24 0-34z" fill="${a.kc}"/><ellipse cx="50" cy="40" rx="23" ry="4" fill="none" stroke="#1b1410" stroke-width="3"/>`;
    if (a.hw === 'turban') s += `<path d="M27 42c0-18 10-28 23-28s23 10 23 28c-6-8-14-11-23-11s-17 3-23 11z" fill="#f4e9cf"/><path d="M28 34q22-10 44 0" stroke="#c9a445" stroke-width="3" fill="none"/><path d="M30 42q20 8 40 0" stroke="#e9d9b5" stroke-width="3" fill="none"/>`;
    if (a.hw === 'cap') s += `<path d="M30 44c0-14 9-22 20-22s20 8 20 22z" fill="#1b1410"/><path d="M30 42h40" stroke="#c9a445" stroke-width="2"/>`;
    // eyes + brows
    s += `<ellipse cx="42" cy="52" rx="2.6" ry="3" fill="#1b1410"/><ellipse cx="58" cy="52" rx="2.6" ry="3" fill="#1b1410"/>`;
    s += `<path d="M37 45q5-3 10 0M53 45q5-3 10 0" stroke="${hair}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    if (a.glasses) s += `<circle cx="42" cy="52" r="6" fill="none" stroke="#1b1410" stroke-width="1.6"/><circle cx="58" cy="52" r="6" fill="none" stroke="#1b1410" stroke-width="1.6"/><path d="M48 52h4" stroke="#1b1410" stroke-width="1.6"/>`;
    // nose + mouth
    s += `<path d="M50 56v6" stroke="rgba(0,0,0,.25)" stroke-width="1.6" stroke-linecap="round"/>`;
    if (a.beard === 'full') s += `<path d="M32 58c2 16 8 22 18 22s16-6 18-22c-6 8-12 10-18 10s-12-2-18-10z" fill="${hair}"/>`;
    else s += `<path d="M44 66q6 4 12 0" stroke="#7a2230" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    if (a.beard === 'mustache') s += `<path d="M40 63q10-5 20 0q-5 3-10 2q-5 1-10-2z" fill="${hair}"/>`;
    if (a.beard === 'stubble') s += `<path d="M34 60c2 10 8 16 16 16s14-6 16-16" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="6" stroke-linecap="round"/>`;
    return s + '</svg>';
  }
  const botSVG = () => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="50" fill="#3a2415"/><rect x="28" y="30" width="44" height="40" rx="8" fill="#c9a445"/><rect x="34" y="40" width="10" height="8" rx="2" fill="#1b1410"/><rect x="56" y="40" width="10" height="8" rx="2" fill="#1b1410"/><rect x="38" y="56" width="24" height="4" rx="2" fill="#1b1410"/><rect x="47" y="18" width="6" height="12" fill="#c9a445"/><circle cx="50" cy="16" r="4" fill="#e6c66a"/><rect x="20" y="42" width="8" height="16" rx="3" fill="#8d6d24"/><rect x="72" y="42" width="8" height="16" rx="3" fill="#8d6d24"/></svg>`;
  const avatarOf = (p) => (p.isBot ? botSVG() : avatarSVG(p.avatar || 0));

  let myAvatar = parseInt(store.get('diwan.avatar'), 10);
  if (!Number.isFinite(myAvatar)) myAvatar = Math.floor(Math.random() * AV.length);
  function renderAvatarPicker() {
    const box = $('#avatars');
    box.innerHTML = AV.map((_, i) => `<button type="button" data-i="${i}" class="${i === myAvatar ? 'selected' : ''}" title="شخصية ${ar(i + 1)}">${avatarSVG(i)}</button>`).join('');
    $$('button', box).forEach((b) => b.addEventListener('click', () => {
      myAvatar = parseInt(b.dataset.i, 10);
      store.set('diwan.avatar', String(myAvatar));
      $$('button', box).forEach((x) => x.classList.toggle('selected', x === b));
    }));
  }
  renderAvatarPicker();

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
    const idx = `<div class="idx"><span>${r}</span>${suitSvg(s)}</div><div class="idx b"><span>${r}</span>${suitSvg(s)}</div>`;
    if (FACE_NAME[r]) {
      el.innerHTML = `${idx}<div class="face">${suitSvg(s, 'fs')}<b>${r}</b><i>${FACE_NAME[r]} ${suitSvg(s)}</i></div>`;
    } else {
      const n = parseInt(r, 10);
      const cols = n <= 3 ? 1 : 2;
      el.innerHTML = `${idx}<div class="pips n${n}" style="--cols:${cols}">${Array.from({ length: n }, () => suitSvg(s)).join('')}</div>`;
    }
    return el;
  }
  function backEl() { const el = document.createElement('div'); el.className = 'card back'; return el; }

  // ---------------------------------------------------------------------
  // flight animations
  // ---------------------------------------------------------------------
  function fly(el, from, to, { duration = 420, scaleTo = 1, fade = false, rotate = 0 } = {}) {
    const layer = $('#fly');
    Object.assign(el.style, { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px' });
    layer.appendChild(el);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const sc = (to.width / from.width) * scaleTo;
    const anim = el.animate(
      [{ transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(${sc}) rotate(${rotate}deg)`, opacity: fade ? 0 : 1 }],
      { duration, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }
    );
    return new Promise((res) => { anim.onfinish = () => { el.remove(); res(); }; });
  }
  const rectOf = (el) => el.getBoundingClientRect();
  const centerRect = (el, size = 20) => { const r = rectOf(el); return { left: r.left + r.width / 2 - size / 2, top: r.top + r.height / 2 - size / 2, width: size, height: size * 1.4 }; };

  // ---------------------------------------------------------------------
  // screens + nav
  // ---------------------------------------------------------------------
  const NAV = {
    'screen-home': { back: null },
    'screen-choose': { back: 'screen-home' },
    'screen-party': { back: 'screen-choose' },
    'screen-lobby': { back: 'leave' },
    'screen-table': null,
  };
  let current = 'screen-home';
  function show(id) {
    if (current !== id) { $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id)); current = id; }
    const cfg = NAV[id];
    $('#nav').classList.toggle('hidden', !cfg);
    if (cfg) { $('#nav-back').hidden = !cfg.back; $('#nav-back').dataset.to = cfg.back || ''; }
  }
  $('#nav-back').addEventListener('click', async () => {
    const to = $('#nav-back').dataset.to;
    if (to === 'leave') { await emit('leaveParty', {}); state = null; show('screen-choose'); }
    else if (to) show(to);
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
      if (peek.ok) { chosenGame = peek.game; $('#inp-code').value = pendingCode; $('#party-game').textContent = GAME_NAMES[chosenGame]; show('screen-party'); toast(`دُعيت إلى ديوان ${peek.gameName}`); }
      else toast(peek.error, 'err');
      history.replaceState(null, '', location.pathname);
      pendingCode = null;
    }
  });
  socket.on('disconnect', () => toast('انقطع الاتصال… نحاول العودة', 'err'));
  socket.on('state', onState);
  socket.on('presence', renderPresence);
  socket.on('emote', showEmote);

  // ---------------------------------------------------------------------
  // presence (home + lobby)
  // ---------------------------------------------------------------------
  const FEED_ICON = { create: '✦', join: '↳', start: '▶', bots: '⚙', leave: '←', win: '★', info: '·' };
  function timeAgo(t) {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return 'الآن';
    const m = Math.round(s / 60);
    if (m < 60) return `${ar(m)} د`;
    return `${ar(Math.round(m / 60))} س`;
  }
  let lastPresence = null;
  function renderPresence(p) {
    lastPresence = p;
    $('#nav-online').innerHTML = `<b>${ar(p.online)}</b> متصل`;
    $('#presence-stats').innerHTML = `
      <div class="stat"><b>${ar(p.online)}</b><span>متصل الآن</span></div>
      <div class="stat"><b>${ar(p.playing)}</b><span>يلعبون</span></div>
      <div class="stat"><b>${ar(p.tables)}</b><span>ديوان مفتوح</span></div>`;
    const items = (p.feed.length ? p.feed : [{ t: Date.now(), text: 'المجلس هادئ — كن أول من يفتح ديواناً', kind: 'info' }])
      .map((f) => `<li class="${f.kind}"><span class="ic">${FEED_ICON[f.kind] || '·'}</span><span>${esc(f.text)}</span><span class="tm">${timeAgo(f.t)}</span></li>`).join('');
    $('#feed').innerHTML = items;
    $('#feed-lobby').innerHTML = items;
  }
  setInterval(() => { if (lastPresence && (current === 'screen-home' || current === 'screen-lobby')) renderPresence(lastPresence); }, 30000);

  // ---------------------------------------------------------------------
  // home / choose / party
  // ---------------------------------------------------------------------
  $('#btn-enter').addEventListener('click', () => show('screen-choose'));
  $$('.tile').forEach((tile) => tile.addEventListener('click', () => {
    const g = tile.dataset.game;
    if (tile.classList.contains('soon')) return toast(`${GAME_NAMES[g]} قادمة قريباً`);
    chosenGame = g; $('#party-game').textContent = GAME_NAMES[g]; show('screen-party'); $('#inp-name').focus();
  }));
  $('#inp-name').value = store.get('diwan.name') || '';

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
      res = await emit('joinParty', { playerId: PID, name, avatar: myAvatar, code });
    } else res = await emit('createParty', { playerId: PID, name, avatar: myAvatar, game: chosenGame });
    if (!res.ok) { toast(res.error, 'err'); SFX.play('error'); }
  }
  $('#btn-go').addEventListener('click', go);
  $('#inp-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  $('#inp-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  $('#inp-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  $('#btn-bots').addEventListener('click', async () => {
    const name = myName();
    if (!name) return;
    const res = await emit('createParty', { playerId: PID, name, avatar: myAvatar, game: chosenGame, withBots: true });
    if (!res.ok) toast(res.error, 'err');
  });

  // ---------------------------------------------------------------------
  // lobby
  // ---------------------------------------------------------------------
  $('#btn-share').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?code=${state.code}`;
    const text = `تعال العب ${state.gameName} معنا في ديوان الورق — الرمز ${state.code}`;
    if (navigator.share) { try { await navigator.share({ title: 'ديوان الورق', text, url }); return; } catch (_) { /* cancelled */ } }
    try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('نُسخ رابط الدعوة'); } catch (_) { toast(`الرمز: ${state.code}`); }
  });
  $('#btn-start').addEventListener('click', async () => { const r = await emit('startGame', {}); if (!r.ok) toast(r.error, 'err'); });
  $('#btn-fill').addEventListener('click', async () => { const r = await emit('addBots', {}); if (!r.ok) toast(r.error, 'err'); });

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
      el.innerHTML = `<div class="seat-av">${p ? avatarOf(p) : ''}</div>
        <div class="seat-name">${p ? esc(p.name) : 'مقعد فارغ'}</div>
        <div class="seat-tag">${tag}${p && p.id === state.myId ? ' · أنت' : ''}${p && !p.connected ? ' · انقطع' : ''}</div>`;
      seats.appendChild(el);
    }
    const n = state.players.length;
    $('#lobby-status').textContent = n < 4 ? `حضر ${ar(n)} من ٤ — شارك الرمز مع رفاقك` : state.isHost ? 'اكتمل المجلس — ابدأ متى شئت' : 'اكتمل المجلس — بانتظار المضيف';
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
  const pending = new Set();
  let lastTap = {};

  function renderTable() {
    $('#hud-game').textContent = state.gameName;
    $('#hud-round').textContent = `الجولة ${ar(state.round)}`;
    if (state.round !== lastRound) { giftPick = []; lastRound = state.round; }
    renderSeats(); renderHand(); renderTrick(); renderGift(); renderHud(); renderTotals(); renderScoresOverlay();
    $('#btn-last').hidden = !(state.phase === 'play' && state.lastTrick);
  }

  function renderSeats() {
    for (let pos = 0; pos < 4; pos++) {
      const spot = $(`.seat-spot.pos-${pos}`);
      const seat = seatAt(pos);
      const p = playerAtSeat(seat);
      const wasTurn = spot.classList.contains('turn');
      const bubble = spot.querySelector('.emote-bubble');
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
          <div class="avatar">${avatarOf(p)}</div>
          <div class="cube ${pts === 0 ? 'zero' : ''} ${pts !== prevPts ? 'bump' : ''}" title="نقاط هذه الجولة">${ar(pts)}</div>
          ${gifted ? '<span class="gifted">✓</span>' : ''}
          ${state.dealer === seat ? '<span class="dealer" title="الموزّع">م</span>' : ''}
        </div>
        <div class="sname">${esc(p.name)}</div>
        <div class="srole">${role}</div>`;
      if (bubble) spot.appendChild(bubble);
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
        if (myTurn) { el.classList.add(legal.has(c) ? 'legal' : 'illegal'); if (legal.has(c)) attachPlay(el, c); }
      }
      hand.appendChild(el);
    });
  }

  function attachPlay(el, card) {
    let down = null, ghost = null, dragging = false;
    const table = $('#table');
    const dropLine = () => rectOf($('#hand-wrap')).top;
    el.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; down = { x: e.clientX, y: e.clientY, rect: rectOf(el) }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!dragging && Math.hypot(dx, dy) > 8) {
        dragging = true;
        ghost = cardEl(card); ghost.classList.add('ghost');
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
        if (e.clientY < dropLine()) { const r = rectOf(g); g.remove(); el.classList.add('gone'); playFrom(card, r); }
        else g.animate([{ transform: g.style.transform }, { transform: 'translate(0,0)' }], { duration: 220, easing: 'ease-out' }).onfinish = () => { g.remove(); el.classList.remove('dragging'); };
      } else {
        const now = Date.now();
        if (lastTap.card === card && now - lastTap.t < 420) { lastTap = {}; el.classList.add('gone'); playFrom(card, rectOf(el)); }
        else { lastTap = { card, t: now }; $$('.hand .card.raised').forEach((x) => x.classList.remove('raised')); el.classList.add('raised'); }
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
    if (!res.ok) { toast(res.error, 'err'); SFX.play('error'); pending.delete(card); renderHand(); return; }
    await flight;
    pending.delete(card);
    revealInTrick(card);
  }
  function revealInTrick(card) { const el = $(`#trick .card[data-card="${card}"]`); if (el) el.classList.remove('pending'); }

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
      banner.textContent = pts ? `${w ? w.name : ''} أكل ${ar(pts)} ${pts === 1 ? 'نقطة' : 'نقاط'}` : `${w ? w.name : ''} أخذ الليخة`;
      banner.classList.add('show');
    } else banner.classList.remove('show');
  }

  function renderHud() {
    const msg = $('#hud-msg');
    const felt = $('#felt-msg');
    felt.textContent = '';
    if (state.phase === 'gift') {
      msg.textContent = state.gift.mine ? 'بانتظار هدايا الآخرين' : 'اختر ثلاث أوراق للهديّة';
      felt.textContent = state.gift.mine ? 'بانتظار الهدايا…' : (state.passDir === 'left' ? 'الهديّة لمن على يسارك' : 'الهديّة لمن على يمينك');
    } else if (state.phase === 'play') {
      if (state.trick.winner !== null) msg.textContent = '';
      else if (state.turn === state.mySeat) {
        msg.innerHTML = state.legalReason === 'leekha' ? '<span class="leekha">ليخة — العب بنت البستوني أو عشرة الدينار</span>' : '<span class="me">دورك — اسحب ورقة إلى الطاولة أو انقرها مرتين</span>';
      } else { const p = playerAtSeat(state.turn); msg.textContent = `دور ${p ? p.name : '…'}`; }
    } else if (state.phase === 'roundEnd') msg.textContent = 'انتهت الجولة';
    else if (state.phase === 'gameOver') msg.textContent = 'انتهت المباراة';
    else msg.textContent = '';
  }

  // ---- gift (compact bar) --------------------------------------------
  function toggleGift(card) {
    if (state.phase !== 'gift' || state.gift.mine) return;
    const i = giftPick.indexOf(card);
    if (i >= 0) giftPick.splice(i, 1);
    else if (giftPick.length < 3) giftPick.push(card);
    else return toast('ثلاث أوراق فقط', 'err');
    SFX.play('click');
    renderHand(); renderGift();
  }
  function renderGift() {
    const bar = $('#giftbar');
    if (state.phase !== 'gift') { bar.hidden = true; return; }
    bar.hidden = false;
    $('#gift-sub').textContent = state.passDir === 'left' ? 'لمن على يسارك' : 'لمن على يمينك';
    const chosen = state.gift.mine || giftPick;
    $$('.gift-slot', bar).forEach((slot, i) => {
      slot.innerHTML = '';
      slot.classList.toggle('filled', !!chosen[i]);
      if (chosen[i]) { const el = cardEl(chosen[i]); if (!state.gift.mine) el.addEventListener('click', () => toggleGift(chosen[i])); slot.appendChild(el); }
    });
    $('#btn-gift').hidden = !!state.gift.mine;
    $('#btn-gift').disabled = giftPick.length !== 3;
    $('#gift-wait').hidden = !state.gift.mine;
    $('#gift-timer').hidden = !!state.gift.mine;
  }
  $('#btn-gift').addEventListener('click', async () => {
    if (giftPick.length !== 3) return;
    const res = await emit('gift', { cards: giftPick.slice() });
    if (!res.ok) { toast(res.error, 'err'); giftPick = []; renderHand(); renderGift(); return; }
    SFX.play('gift');
  });

  // ---- timers (rings + gift bar) --------------------------------------
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
      fg.style.strokeDashoffset = (289 * (1 - left / total)).toFixed(1);
      spot.classList.add('timing');
      spot.classList.toggle('urgent', left < 5000);
      if (seat === state.mySeat && left < 5000 && left > 0) { const sec = Math.ceil(left / 1000); if (sec !== lastTickSecond) { lastTickSecond = sec; SFX.play('tick'); } }
    }
    if (state.phase === 'gift' && !state.gift.mine) {
      const left = Math.max(0, state.gift.deadline - now);
      $('#gift-timer .t-fg').style.strokeDashoffset = (106.8 * (1 - left / (state.giftSeconds * 1000))).toFixed(1);
      $('#gift-timer-num').textContent = ar(Math.ceil(left / 1000));
      $('#gift-timer').classList.toggle('urgent', left < 6000);
    }
  }, 120);

  // ---- emotes, last trick, leave --------------------------------------
  $$('#emotes button').forEach((b) => b.addEventListener('click', () => socket.emit('emote', { id: b.dataset.emote })));
  function showEmote({ seat, id }) {
    if (!state || current !== 'screen-table') return;
    const spot = seatSpot(seat);
    if (!spot) return;
    spot.querySelectorAll('.emote-bubble').forEach((x) => x.remove());
    const el = document.createElement('div');
    el.className = 'emote-bubble';
    el.textContent = id;
    spot.appendChild(el);
    SFX.play('emote');
    setTimeout(() => el.remove(), 2300);
  }
  $('#btn-last').addEventListener('click', () => {
    const box = $('#last-trick');
    if (!box.hidden) { box.hidden = true; return; }
    if (!state.lastTrick) return;
    const w = playerAtSeat(state.lastTrick.winner);
    $('#last-title').textContent = `الأكلة السابقة — ${w ? w.name : ''} ${state.lastTrick.points ? `(${ar(state.lastTrick.points)} نقاط)` : ''}`;
    $('#last-cards').innerHTML = '';
    state.lastTrick.plays.forEach((p) => $('#last-cards').appendChild(cardEl(p.card)));
    box.hidden = false;
    setTimeout(() => { box.hidden = true; }, 4000);
  });
  let leaveArmed = null;
  async function leaveGame() { await emit('leaveParty', {}); state = null; prev = null; pending.clear(); $('#overlay-scores').hidden = true; show('screen-choose'); }
  $('#btn-leave-game').addEventListener('click', () => {
    const b = $('#btn-leave-game');
    if (leaveArmed) { clearTimeout(leaveArmed); leaveArmed = null; b.classList.remove('confirm'); b.textContent = 'غادر'; leaveGame(); return; }
    b.classList.add('confirm'); b.textContent = 'تأكيد المغادرة؟';
    leaveArmed = setTimeout(() => { leaveArmed = null; b.classList.remove('confirm'); b.textContent = 'غادر'; }, 3000);
  });
  $('#btn-leave-scores').addEventListener('click', leaveGame);

  // ---------------------------------------------------------------------
  // scores overlay
  // ---------------------------------------------------------------------
  let scoresOpen = false;
  let roundEndShown = 0;
  $('#btn-close-scores').addEventListener('click', () => { scoresOpen = false; renderScoresOverlay(); });
  $('#btn-next-round').addEventListener('click', async () => { const r = await emit('startGame', {}); if (!r.ok) toast(r.error, 'err'); scoresOpen = false; });
  const teamLabel = (team) => [team, team + 2].map((s) => playerAtSeat(s)).filter(Boolean).map((p) => esc(p.name)).join(' و ') || '—';

  function renderScoresOverlay() {
    const ov = $('#overlay-scores');
    if (!state || !state.totals) { ov.hidden = true; return; }
    const isEnd = state.phase === 'roundEnd' || state.phase === 'gameOver';
    if (isEnd && roundEndShown !== state.round) { roundEndShown = state.round; scoresOpen = true; }
    ov.hidden = !scoresOpen;
    if (!scoresOpen) return;
    const over = state.phase === 'gameOver';
    const myTeam = state.mySeat % 2;
    $('#scores-title').textContent = over ? 'انتهت المباراة' : isEnd ? `نتيجة الجولة ${ar(state.round)}` : 'النقاط';
    const tt = state.teamTotals;
    $('#teams').innerHTML = [0, 1].map((t) => `
      <div class="team ${t === myTeam ? 'mine' : ''} ${over && state.winnerTeam === t ? 'winner' : ''}">
        <div class="team-name">${teamLabel(t)}${t === myTeam ? ' <small>(فريقك)</small>' : ''}</div>
        <div class="team-total">${ar(tt[t])}</div>
        <div class="team-cap">${over && state.winnerTeam === t ? 'الفائزون' : `من ${ar(state.matchLimit)}`}</div>
      </div>`).join('<div class="team-vs">ضد</div>');
    const verdict = $('#scores-verdict');
    verdict.hidden = !over;
    if (over) verdict.textContent = state.winnerTeam === null ? 'تعادل الفريقان' : state.winnerTeam === myTeam ? 'مبروك — فاز فريقك' : 'فاز الخصوم هذه المرّة';
    const rows = [0, 1, 2, 3].map((s) => ({ seat: s, p: playerAtSeat(s), round: state.roundPoints[s], total: state.totals[s] }));
    const best = Math.min(...rows.map((r) => r.total));
    $('#scores-table').innerHTML = `<tr><th>اللاعب</th><th>الجولة</th><th>المجموع</th></tr>` +
      rows.map((r) => `<tr class="${r.seat === state.mySeat ? 'me' : ''} ${r.total === best ? 'best' : ''} ${r.total >= state.matchLimit ? 'busted' : ''}"><td>${r.p ? esc(r.p.name) : '—'}</td><td class="num">${ar(r.round)}</td><td class="num">${ar(r.total)}</td></tr>`).join('');
    const next = $('#btn-next-round');
    next.hidden = !(isEnd && state.isHost);
    next.textContent = over ? 'مباراة جديدة' : 'جولة جديدة';
    $('#scores-wait').hidden = !(isEnd && !state.isHost);
    $('#scores-wait').textContent = over ? 'بانتظار المضيف لمباراة جديدة — أو غادر الديوان' : 'بانتظار المضيف للجولة التالية';
  }

  // ---------------------------------------------------------------------
  // state transitions → sounds + animations
  // ---------------------------------------------------------------------
  async function onState(view) {
    prev = state;
    state = view;
    const p = prev;
    if (state.notice) { toast(state.notice); SFX.play('notice'); }
    if (p && state.phase === 'lobby' && p.phase === 'lobby') {
      if (state.players.length > p.players.length) SFX.play('join');
      else if (state.players.length < p.players.length) SFX.play('leave');
    }
    if (p && p.phase === 'play' && p.trick && p.trick.winner !== null && (!state.trick || state.trick.plays.length === 0 || state.phase !== 'play')) {
      const winnerSpot = seatSpot(p.trick.winner);
      const to = winnerSpot ? centerRect(winnerSpot.querySelector('.avatar') || winnerSpot, 24) : null;
      if (to) for (const play of p.trick.plays) { const el = $(`#trick .card[data-card="${play.card}"]`); if (el) fly(cardEl(play.card), rectOf(el), to, { duration: 480, fade: true, scaleTo: 0.6 }); }
      const mine = p.trick.winner % 2 === state.mySeat % 2;
      if (p.trick.points === 0) SFX.play('trickNeutral'); else SFX.play(mine ? 'trickBad' : 'trickGood');
    }
    if (state.phase === 'play' && state.trick) {
      const before = new Set(p && p.trick ? p.trick.plays.map((x) => x.card) : []);
      for (const play of state.trick.plays) {
        if (before.has(play.card) || play.seat === state.mySeat || pending.has(play.card)) continue;
        pending.add(play.card);
        const spot = seatSpot(play.seat);
        const from = spot ? centerRect(spot.querySelector('.avatar') || spot, 30) : rectOf($('.felt'));
        SFX.play('card');
        fly(cardEl(play.card), from, rectOf(slotOf(play.seat)), { duration: 420 }).then(() => { pending.delete(play.card); revealInTrick(play.card); });
      }
      if (state.trick.plays.length === 0) pending.clear();
    }
    if (state.phase === 'play' && state.turn === state.mySeat && state.trick && state.trick.winner === null && !(p && p.phase === 'play' && p.turn === state.mySeat && p.trick && p.trick.winner === null)) { SFX.play('turn'); lastTickSecond = -1; }
    if (!p || p.phase !== state.phase) {
      if (state.phase === 'roundEnd') SFX.play('roundEnd');
      if (state.phase === 'gameOver') SFX.play(state.winnerTeam === state.mySeat % 2 ? 'win' : 'lose');
    }
    render();
    if (state.phase === 'gift' && (!p || p.round !== state.round || p.phase === 'lobby')) await dealAnimation();
  }

  async function dealAnimation() {
    SFX.play('start');
    const from = centerRect($('.felt'), 30);
    const hand = $$('#hand .card');
    hand.forEach((c) => c.classList.add('dealt'));
    const bar = $('#giftbar');
    bar.hidden = true;
    await sleep(120);
    SFX.play('deal');
    for (let pos = 1; pos < 4; pos++) {
      const spot = $(`.seat-spot.pos-${pos}`);
      for (let k = 0; k < 4; k++) setTimeout(() => fly(backEl(), from, centerRect(spot.querySelector('.avatar') || spot, 26), { duration: 320, fade: true, scaleTo: 0.5 }), k * 45 + pos * 40);
    }
    hand.forEach((c, i) => setTimeout(() => { fly(cardEl(c.dataset.card), from, rectOf(c), { duration: 300 }).then(() => c.classList.remove('dealt')); }, 200 + i * 45));
    await sleep(200 + hand.length * 45 + 320);
    if (state && state.phase === 'gift') { bar.hidden = false; renderGift(); }
  }

  function render() {
    if (!state) return;
    if (state.phase === 'lobby') {
      renderLobby(); show('screen-lobby');
      $('#overlay-scores').hidden = true;
      scoresOpen = false; giftPick = []; lastRound = 0; roundEndShown = 0; pending.clear();
    } else { renderTable(); show('screen-table'); }
  }
})();
