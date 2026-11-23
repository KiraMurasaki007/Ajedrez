/*!
 * app.js — Interfaz del juego de ajedrez.
 * Conecta el motor (chess.js) y la IA (ai.js) con el tablero, el reloj,
 * el historial, los colores y los diálogos.
 */
(function () {
  'use strict';

  var Chess = window.Chess, AI = window.ChessAI;
  var WHITE = 0, BLACK = 1;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var LETTERS = ['', 'P', 'N', 'B', 'R', 'Q', 'K'];
  var VALUE = [0, 1, 3, 3, 5, 9, 0];

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var TIMES = { 'none': null, '3+2': [180, 2], '5+0': [300, 0], '10+0': [600, 0], '15+10': [900, 10], '30+0': [1800, 0] };
  var LEVEL_NAME = { easy: 'Fácil', medium: 'Medio', hard: 'Difícil' };
  var LEVEL_HINT = {
    easy: 'Piensa una jugada adelante y a veces se equivoca. Ideal para empezar.',
    medium: 'Calcula varias jugadas y casi no regala piezas. Un buen reto.',
    hard: 'Calcula muy profundo y aprovecha cada error. Tómate tu tiempo.'
  };
  var THEMES = [
    { id: 'lavanda', name: 'Lavanda', light: '#ebe4f4', dark: '#6e5a9e' },
    { id: 'madera', name: 'Madera', light: '#f0dcb8', dark: '#b07f4f' },
    { id: 'oceano', name: 'Océano', light: '#dcebf5', dark: '#4f86b0' },
    { id: 'menta', name: 'Menta', light: '#e6f1e4', dark: '#5f9a79' },
    { id: 'coral', name: 'Coral', light: '#fbe5dc', dark: '#d2776b' },
    { id: 'grafito', name: 'Grafito', light: '#dcdce2', dark: '#555a6b' }
  ];

  /* ------------------------------------------------------------ Persistencia */

  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem('ajedrez.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem('ajedrez.' + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ }
    }
  };

  /* ------------------------------------------------------------------ Estado */

  var S = {
    game: new Chess(),
    mode: 'ai', human: WHITE, level: 'medium', timeKey: 'none',
    orientation: WHITE,
    clock: null,
    view: null,          // null = posición actual; número = jugadas aplicadas
    viewBoard: null, viewFor: -1,
    over: null,
    thinking: false, searchId: 0,
    sel: -1, legal: [],
    promo: null, drag: null,
    sound: store.get('sound', true),
    name: store.get('name', ''),
    online: null,        // estado de la partida en línea (ver sección "En línea")
    pendingOnline: null, // petición en curso: crear, unirse o reanudar
    settings: store.get('settings', { mode: 'ai', level: 'medium', color: 'white', time: '10+0' })
  };

  /* ---------------------------------------------------------------- Elementos */

  var boardEl = $('#board'), promoEl = $('#promo');
  var piecesEl = null, sqEls = {};
  var topEl = $('#player-top'), botEl = $('#player-bottom');

  /* ------------------------------------------------------------------ Utilidades */

  function toCol(sq) { var f = sq & 7; return S.orientation === WHITE ? f : 7 - f; }
  function toRow(sq) { var r = sq >> 4; return S.orientation === WHITE ? 7 - r : r; }
  function toSq(col, row) {
    var f = S.orientation === WHITE ? col : 7 - col;
    var r = S.orientation === WHITE ? 7 - row : row;
    return r * 16 + f;
  }
  function plyCount() { return S.game.history.length; }
  function viewPly() { return S.view === null ? plyCount() : S.view; }

  function boardAt(ply) {
    if (ply === plyCount()) return S.game.board;
    if (S.viewFor !== ply) {
      S.viewBoard = new Chess(ply === 0 ? Chess.START_FEN : S.game.history[ply - 1].fen).board;
      S.viewFor = ply;
    }
    return S.viewBoard;
  }

  function findKing(board, color) {
    var target = Chess.K | (color << 3);
    for (var sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      if (board[sq] === target) return sq;
    }
    return -1;
  }

  // La notación interna usa letras inglesas; en español: C caballo, A alfil, T torre, D dama, R rey.
  var ES = { N: 'C', B: 'A', R: 'T', Q: 'D', K: 'R' };
  function esSan(san) {
    var s = san;
    if (/^[NBRQK]/.test(s)) s = ES[s.charAt(0)] + s.slice(1);
    return s.replace(/=([NBRQ])/, function (_, p) { return '=' + ES[p]; });
  }

  function colorName(c, plural) { return c === WHITE ? (plural ? 'las blancas' : 'blancas') : (plural ? 'las negras' : 'negras'); }

  /* -------------------------------------------------------------------- Sonido */

  var audio = null;
  function beep(freq, dur, type, gain, when) {
    if (!S.sound) return;
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      var t = audio.currentTime + (when || 0);
      var o = audio.createOscillator(), g = audio.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), t + dur);
      g.gain.setValueAtTime(gain || 0.12, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(audio.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* sin audio */ }
  }
  function sfx(kind) {
    if (kind === 'move') beep(300, 0.09, 'triangle', 0.16);
    else if (kind === 'capture') { beep(210, 0.12, 'square', 0.1); beep(120, 0.14, 'triangle', 0.16); }
    else if (kind === 'check') { beep(520, 0.1, 'square', 0.07); beep(390, 0.16, 'triangle', 0.12, 0.08); }
    else if (kind === 'end') { beep(392, 0.22, 'triangle', 0.14); beep(294, 0.3, 'triangle', 0.14, 0.18); }
  }

  /* ------------------------------------------------------------------ Tablero */

  function buildSquares() {
    boardEl.textContent = '';
    sqEls = {};
    for (var row = 0; row < 8; row++) {
      for (var col = 0; col < 8; col++) {
        var sq = toSq(col, row);
        var el = document.createElement('div');
        el.className = 'sq ' + (((sq >> 4) + (sq & 7)) % 2 === 0 ? 'dark' : 'light');
        el.dataset.sq = sq;
        if (row === 7) { var f = document.createElement('span'); f.className = 'coord f'; f.textContent = 'abcdefgh'.charAt(sq & 7); el.appendChild(f); }
        if (col === 0) { var r = document.createElement('span'); r.className = 'coord r'; r.textContent = String(1 + (sq >> 4)); el.appendChild(r); }
        boardEl.appendChild(el);
        sqEls[sq] = el;
      }
    }
    piecesEl = document.createElement('div');
    piecesEl.className = 'pieces';
    boardEl.appendChild(piecesEl);
  }

  function pieceNode(p) {
    var wrap = document.createElement('div');
    wrap.className = 'piece ' + ((p >> 3) ? 'b' : 'w');
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'pc');
    svg.setAttribute('viewBox', '0 0 100 100');
    var use = document.createElementNS(SVGNS, 'use');
    use.setAttribute('href', '#pc-' + LETTERS[p & 7]);
    svg.appendChild(use);
    wrap.appendChild(svg);
    return wrap;
  }

  function place(el, sq) {
    el.style.transform = 'translate(' + (toCol(sq) * 100) + '%,' + (toRow(sq) * 100) + '%)';
  }

  function pieceElAt(sq) { return piecesEl.querySelector('[data-sq="' + sq + '"]'); }

  // anims: lista de {from, to}; esas piezas se deslizan desde su casilla de origen.
  function renderPieces(anims) {
    var board = boardAt(viewPly());
    piecesEl.textContent = '';
    var from = {}, i;
    if (anims) for (i = 0; i < anims.length; i++) from[anims[i].to] = anims[i].from;
    var pending = [];
    for (var sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var p = board[sq];
      if (!p) continue;
      var el = pieceNode(p);
      el.dataset.sq = sq;
      if (from[sq] !== undefined) { el.style.transition = 'none'; place(el, from[sq]); pending.push({ el: el, sq: sq }); }
      else place(el, sq);
      piecesEl.appendChild(el);
    }
    if (pending.length) {
      void piecesEl.offsetWidth;
      requestAnimationFrame(function () {
        for (var j = 0; j < pending.length; j++) { pending[j].el.style.transition = ''; place(pending[j].el, pending[j].sq); }
      });
    }
  }

  function paintSquares() {
    var ply = viewPly(), board = boardAt(ply);
    var rec = ply > 0 ? S.game.history[ply - 1] : null;
    var lastFrom = rec ? rec.from : -1, lastTo = rec ? rec.to : -1;
    var checkSq = -1;
    if (rec && rec.check) checkSq = findKing(board, rec.color ^ 1);
    var legalMap = {};
    for (var i = 0; i < S.legal.length; i++) legalMap[Chess.to(S.legal[i])] = true;
    for (var sq in sqEls) {
      var n = +sq, c = 'sq ' + (((n >> 4) + (n & 7)) % 2 === 0 ? 'dark' : 'light');
      if (n === lastFrom || n === lastTo) c += ' last';
      if (n === S.sel) c += ' sel';
      if (n === checkSq) c += ' chk';
      if (legalMap[n]) c += board[n] || (S.game.ep === n && S.sel >= 0 && (board[S.sel] & 7) === Chess.P) ? ' legal cap' : ' legal';
      sqEls[sq].className = c;
    }
    boardEl.classList.toggle('can-move', canInteract());
  }

  /* ------------------------------------------------------------------ Jugadores */

  function playerName(color) {
    if (S.mode === 'online' && S.online) {
      var n = S.online.names[color];
      if (n) return n;
      return color === S.human ? 'Tú' : 'Esperando rival…';
    }
    if (S.mode === 'ai') return color === S.human ? (S.name || 'Tú') : 'Computadora · ' + LEVEL_NAME[S.level];
    return color === WHITE ? 'Jugador blancas' : 'Jugador negras';
  }

  function renderCaptured(el, color) {
    var ply = viewPly(), counts = {}, mine = 0, theirs = 0, i, rec;
    for (i = 0; i < ply; i++) {
      rec = S.game.history[i];
      if (!rec.captured) continue;
      var t = rec.captured & 7;
      if (rec.color === color) { counts[t] = (counts[t] || 0) + 1; mine += VALUE[t]; }
      else theirs += VALUE[t];
    }
    el.textContent = '';
    [5, 4, 3, 2, 1].forEach(function (t) {
      if (!counts[t]) return;
      var g = document.createElement('span');
      g.className = 'grp';
      for (var k = 0; k < counts[t]; k++) {
        var svg = document.createElementNS(SVGNS, 'svg');
        svg.setAttribute('class', 'pc ' + (color === WHITE ? 'b' : 'w'));
        svg.setAttribute('viewBox', '0 0 100 100');
        var use = document.createElementNS(SVGNS, 'use');
        use.setAttribute('href', '#pc-' + LETTERS[t]);
        svg.appendChild(use);
        g.appendChild(svg);
      }
      el.appendChild(g);
    });
    if (mine > theirs) { var adv = document.createElement('span'); adv.className = 'adv'; adv.textContent = '+' + (mine - theirs); el.appendChild(adv); }
  }

  function renderPlayers() {
    var topColor = S.orientation === WHITE ? BLACK : WHITE;
    var botColor = S.orientation;
    [[topEl, topColor], [botEl, botColor]].forEach(function (pair) {
      var el = pair[0], color = pair[1];
      el.dataset.color = color;
      $('.name', el).textContent = playerName(color);
      var chip = $('.chip .pc', el);
      chip.setAttribute('class', 'pc ' + (color === WHITE ? 'w' : 'b'));
      renderCaptured($('.caps', el), color);
    });
    renderClocks();
  }

  /* ---------------------------------------------------------------------- Reloj */

  function fmt(ms) {
    if (ms < 0) ms = 0;
    if (ms < 10000) { var t = Math.floor(ms / 100); return '0:0' + Math.floor(t / 10) + '.' + (t % 10); }
    var s = Math.ceil(ms / 1000), m = Math.floor(s / 60);
    return m + ':' + ('0' + (s % 60)).slice(-2);
  }

  function clockRunning() { return !!(S.clock && !S.over && plyCount() >= 2); }

  function renderClocks() {
    [topEl, botEl].forEach(function (el) {
      var c = $('.clock', el);
      if (!S.clock) { c.hidden = true; return; }
      c.hidden = false;
      var color = +el.dataset.color, rem = S.clock.rem[color];
      c.textContent = fmt(rem);
      c.classList.toggle('active', clockRunning() && S.game.turn === color);
      c.classList.toggle('low', rem < 30000);
    });
  }

  function tick() {
    if (!S.clock) return;
    var now = Date.now();
    if (clockRunning()) {
      var t = S.game.turn;
      S.clock.rem[t] -= now - S.clock.last;
      if (S.clock.rem[t] <= 0) {
        S.clock.rem[t] = 0; S.clock.last = now;
        if (S.mode !== 'online') timeout(t);   // en línea lo decide el servidor
        renderClocks();
        return;
      }
    }
    S.clock.last = now;
    renderClocks();
  }
  setInterval(tick, 100);

  function timeout(loser) {
    var winner = loser ^ 1;
    var draw = !S.game.canMate(winner);
    endGame({ over: true, reason: draw ? 'timeout-draw' : 'timeout', winner: draw ? null : winner, result: draw ? '1/2-1/2' : (winner === WHITE ? '1-0' : '0-1'), loser: loser });
  }

  /* ---------------------------------------------------------------- Estado / texto */

  function renderStatus() {
    var pip = $('#status-pip'), main = $('#status-main'), sub = $('#status-sub');
    pip.className = 'pip';
    $('#btn-live').hidden = S.view === null;
    var g = S.game;
    if (S.over) {
      var o = S.over;
      pip.classList.add('over');
      var t = overText(o);
      main.textContent = t.title;
      sub.textContent = t.text;
      return;
    }
    if (S.mode === 'online' && S.online) { renderOnlineStatus(pip, main, sub); return; }
    var turn = g.turn;
    pip.classList.add(turn === WHITE ? 'white' : 'black');
    if (S.mode === 'ai' && S.thinking) {
      pip.classList.add('think');
      main.textContent = 'La computadora está pensando…';
      sub.textContent = g.inCheck() ? 'Tiene el rey en jaque.' : '';
      return;
    }
    if (S.mode === 'ai') main.textContent = turn === S.human ? 'Tu turno' : 'Turno de la computadora';
    else main.textContent = 'Turno de las ' + colorName(turn);
    var st = g.inCheck();
    sub.textContent = st ? (S.mode === 'ai' && turn === S.human ? 'Tu rey está en jaque.' : 'Rey en jaque.') :
      (S.mode === 'ai' ? 'Juegas con ' + colorName(S.human) + '.' : '');
    if (S.view !== null) sub.textContent = 'Revisando una jugada anterior.';
  }

  function overText(o) {
    var w = o.winner;
    switch (o.reason) {
      case 'checkmate': return { title: 'Jaque mate', text: 'Ganan ' + colorName(w, true) + '.' };
      case 'stalemate': return { title: 'Tablas por ahogado', text: 'El rey no está en jaque, pero no hay jugadas legales.' };
      case 'insufficient': return { title: 'Tablas por material insuficiente', text: 'Ninguno de los dos puede dar mate.' };
      case 'fifty': return { title: 'Tablas por la regla de 50 movimientos', text: '50 jugadas sin capturas ni movimientos de peón.' };
      case 'repetition': return { title: 'Tablas por repetición', text: 'La misma posición apareció tres veces.' };
      case 'timeout': return { title: 'Se acabó el tiempo', text: 'Ganan ' + colorName(w, true) + '.' };
      case 'timeout-draw': return { title: 'Tablas por tiempo', text: 'Se acabó el tiempo, pero el rival no puede dar mate.' };
      case 'resign': return { title: 'Rendición', text: 'Ganan ' + colorName(w, true) + '.' };
      case 'agreement': return { title: 'Tablas por acuerdo', text: 'Los dos jugadores aceptaron las tablas.' };
      case 'abandon': return { title: 'El rival abandonó', text: 'Ganan ' + colorName(w, true) + ' porque el rival no volvió a la partida.' };
    }
    return { title: 'Fin de la partida', text: '' };
  }

  /* ------------------------------------------------------------------ Jugadas */

  function renderMoves() {
    var list = $('#moves'), h = S.game.history, cur = viewPly();
    $('#moves-empty').hidden = h.length > 0;
    list.hidden = h.length === 0;
    list.textContent = '';
    for (var i = 0; i < h.length; i += 2) {
      var num = document.createElement('span');
      num.className = 'num'; num.textContent = (i / 2 + 1) + '.';
      list.appendChild(num);
      for (var k = 0; k < 2; k++) {
        if (i + k >= h.length) { list.appendChild(document.createElement('span')); continue; }
        var b = document.createElement('button');
        b.type = 'button'; b.dataset.ply = i + k + 1;
        b.textContent = esSan(h[i + k].san);
        if (i + k + 1 === cur) { b.className = 'cur'; b.setAttribute('aria-current', 'true'); }
        list.appendChild(b);
      }
    }
    var active = $('button.cur', list);
    if (active) {
      var top = active.offsetTop, bottom = top + active.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top - 4;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
    }
  }

  // Ajustes rápidos del panel: nivel de la computadora y reloj, editables en cualquier momento.
  function syncQuick() {
    $('#field-level').hidden = S.mode !== 'ai';
    $$('input[name=qlevel]').forEach(function (r) { r.checked = r.value === S.level; });
    $('#q-time').value = S.timeKey;
    $('#q-time').disabled = S.mode === 'online';   // en línea el tiempo lo fija quien crea la sala
  }

  function setClock(key) {
    S.timeKey = key;
    var tc = TIMES[key];
    S.clock = tc ? { rem: [tc[0] * 1000, tc[0] * 1000], inc: tc[1] * 1000, last: Date.now() } : null;
    S.settings.time = key;
    store.set('settings', S.settings);
    renderPlayers();
  }

  $$('input[name=qlevel]').forEach(function (r) {
    r.addEventListener('change', function () {
      S.level = r.value;
      S.settings.level = r.value;
      store.set('settings', S.settings);
      renderPlayers();
    });
  });
  $('#q-time').addEventListener('change', function () { setClock(this.value); this.blur(); });

  function renderControls() {
    syncQuick();
    var n = plyCount(), cur = viewPly();
    $('#nav-first').disabled = $('#nav-prev').disabled = cur === 0;
    $('#nav-next').disabled = $('#nav-last').disabled = cur === n;
    var undoOk = n > 0 && !(S.over && (S.over.reason === 'timeout' || S.over.reason === 'resign'));
    if (S.mode === 'ai' && n === 1 && S.human === BLACK) undoOk = false;
    var online = S.mode === 'online' && !!S.online;
    var playingOnline = online && S.online.status === 'playing';
    $('#btn-undo').disabled = !undoOk;
    $('#btn-resign').disabled = !!S.over || (online ? !playingOnline : n === 0);
    $('#btn-restart').disabled = n === 0 && !S.over;
    $('#btn-undo').hidden = $('#btn-restart').hidden = online;      // no existen en línea
    $('#btn-draw').hidden = !online;
    $('#btn-draw').disabled = !playingOnline || !S.online.oppOnline || S.online.drawFrom !== null;
    renderNotice();
    var snd = $('#btn-sound');
    snd.setAttribute('aria-pressed', String(S.sound));
    $('use', snd).setAttribute('href', S.sound ? '#ic-sound' : '#ic-mute');
  }

  function renderAll(anims) {
    renderPieces(anims);
    paintSquares();
    renderPlayers();
    renderStatus();
    renderMoves();
    renderControls();
  }

  /* ---------------------------------------------------------------- Interacción */

  function canInteract() {
    return S.view === null && !S.over && !S.thinking && !S.promo &&
      (S.mode === 'local' ||
        (S.game.turn === S.human && (S.mode !== 'online' || (!!S.online && S.online.status === 'playing'))));
  }

  function sqFromEvent(e) {
    var r = boardEl.getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width * 8, y = (e.clientY - r.top) / r.height * 8;
    if (x < 0 || y < 0 || x >= 8 || y >= 8) return -1;
    return toSq(Math.floor(x), Math.floor(y));
  }

  function select(sq) {
    S.sel = sq;
    S.legal = sq >= 0 ? S.game.legalMovesFrom(sq) : [];
    paintSquares();
  }

  function legalTarget(sq) {
    for (var i = 0; i < S.legal.length; i++) if (Chess.to(S.legal[i]) === sq) return true;
    return false;
  }

  boardEl.addEventListener('pointerdown', function (e) {
    if (e.button > 0 || !canInteract()) return;
    var sq = sqFromEvent(e);
    if (sq < 0) return;
    var p = S.game.board[sq];
    if (S.sel >= 0 && legalTarget(sq)) { tryMove(S.sel, sq, false); return; }
    if (p && (p >> 3) === S.game.turn) {
      var was = S.sel === sq;
      select(sq);
      var el = pieceElAt(sq);
      S.drag = { sq: sq, x: e.clientX, y: e.clientY, moved: false, was: was, el: el, id: e.pointerId };
      try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    } else {
      select(-1);
    }
  });

  boardEl.addEventListener('pointermove', function (e) {
    var d = S.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) {
      d.moved = true;
      if (d.el) d.el.classList.add('drag');
      boardEl.classList.add('dragging');
    }
    if (d.moved && d.el) {
      var r = boardEl.getBoundingClientRect(), s = r.width / 8;
      var px = (e.clientX - r.left) / s - 0.5, py = (e.clientY - r.top) / s - 0.5;
      d.el.style.transform = 'translate(' + (px * 100) + '%,' + (py * 100) + '%)';
    }
  });

  function endDrag(e, cancel) {
    var d = S.drag;
    if (!d || e.pointerId !== d.id) return;
    S.drag = null;
    boardEl.classList.remove('dragging');
    try { boardEl.releasePointerCapture(e.pointerId); } catch (err) { /* ok */ }
    if (d.moved) {
      var target = cancel ? -1 : sqFromEvent(e);
      if (d.el) { d.el.classList.remove('drag'); place(d.el, d.sq); }
      if (target >= 0 && target !== d.sq && legalTarget(target)) tryMove(d.sq, target, true);
    } else if (d.was) {
      select(-1);
    }
  }
  boardEl.addEventListener('pointerup', function (e) { endDrag(e, false); });
  boardEl.addEventListener('pointercancel', function (e) { endDrag(e, true); });

  function tryMove(from, to, dragged) {
    var cands = S.game.legalMovesFrom(from).filter(function (m) { return Chess.to(m) === to; });
    if (!cands.length) return;
    if (Chess.promo(cands[0])) { showPromo(from, to, dragged); return; }
    playMove(cands[0], { noAnim: dragged });
  }

  function showPromo(from, to, dragged) {
    S.promo = { from: from, to: to, dragged: dragged };
    var color = S.game.turn;
    promoEl.textContent = '';
    var box = document.createElement('div'); box.className = 'promo-box';
    var title = document.createElement('p'); title.textContent = 'Corona tu peón con…';
    var opts = document.createElement('div'); opts.className = 'promo-opts';
    [Chess.Q, Chess.R, Chess.B, Chess.N].forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', { 5: 'Dama', 4: 'Torre', 3: 'Alfil', 2: 'Caballo' }[t]);
      b.appendChild(pieceNode(t | (color << 3)).firstChild);
      b.firstChild.parentNode.className = '';
      b.firstChild.setAttribute('class', 'pc ' + (color === WHITE ? 'w' : 'b'));
      b.addEventListener('click', function () {
        var m = S.game.moveFromTo(from, to, t);
        hidePromo();
        if (m) playMove(m, { noAnim: dragged });
      });
      opts.appendChild(b);
    });
    box.appendChild(title); box.appendChild(opts);
    promoEl.appendChild(box);
    promoEl.hidden = false;
    $('button', opts).focus();
    paintSquares();
  }
  function hidePromo() { S.promo = null; promoEl.hidden = true; promoEl.textContent = ''; paintSquares(); }
  promoEl.addEventListener('pointerdown', function (e) { if (e.target === promoEl) { hidePromo(); renderPieces(); } });

  /* ------------------------------------------------------------- Hacer jugadas */

  function playMove(m, opts) {
    opts = opts || {};
    var g = S.game;
    tick();
    if (S.over) return;
    var before = plyCount();
    var mover = g.turn;
    var rec = g.move(m);
    if (!rec) return;
    if (S.mode === 'online' && !opts.remote) Net.send({ t: 'move', uci: g.moveToUci(m) });
    S.sel = -1; S.legal = [];
    if (S.view !== null && S.view === before) S.view = null;
    if (S.clock) {
      if (before >= 2 && !opts.remote) S.clock.rem[mover] += S.clock.inc;   // las jugadas remotas traen el reloj del servidor
      S.clock.last = Date.now();
    }

    var anims = [];
    if (!opts.noAnim) {
      anims.push({ from: rec.from, to: rec.to });
      if (rec.flags & Chess.F_CASTLE) {
        if (rec.to > rec.from) anims.push({ from: rec.to + 1, to: rec.to - 1 });
        else anims.push({ from: rec.to - 2, to: rec.to + 1 });
      }
    }
    var st = g.status();
    sfx(st.over ? 'end' : rec.check ? 'check' : rec.captured ? 'capture' : 'move');
    if (S.view === null) renderAll(anims); else { paintSquares(); renderPlayers(); renderStatus(); renderMoves(); renderControls(); }

    if (S.mode === 'online') return;            // en línea, el final lo anuncia el servidor
    if (st.over) { endGame(st); return; }
    if (S.mode === 'ai' && g.turn !== S.human) requestAI();
  }

  function endGame(st) {
    S.over = st;
    S.thinking = false;
    S.searchId++;
    S.sel = -1; S.legal = [];
    if (S.clock) S.clock.last = Date.now();
    renderAll();
    sfx('end');
    setTimeout(function () { if (S.over === st) showOver(st); }, 700);
  }

  function showOver(st) {
    var t = overText(st), pip = $('#over-pip');
    $('#over-title').textContent = t.title;
    var text = t.text;
    if (S.mode === 'ai' && st.winner !== null && st.winner !== undefined) text = st.winner === S.human ? '¡Ganaste! ' + text : 'Esta vez ganó la computadora. ' + text;
    if (S.mode === 'online' && S.online && st.winner !== null && st.winner !== undefined) text = st.winner === S.human ? '¡Ganaste! ' + text : 'Ganó ' + playerName(st.winner) + '. ' + text;
    $('#over-text').textContent = text;
    $('#over-rematch').hidden = !(S.mode === 'online' && S.online && Net.isOpen());
    pip.className = 'over-pip' + (st.winner === WHITE ? ' white' : st.winner === BLACK ? ' black' : '');
    var d = $('#dlg-over');
    if (!d.open) d.showModal();
  }

  /* ----------------------------------------------------------------------- IA */

  var worker = null;
  var pendingCb = {};

  function makeWorker() {
    try {
      var inline = document.getElementById('worker-src');
      var w;
      if (inline) w = new Worker(URL.createObjectURL(new Blob([inline.textContent], { type: 'text/javascript' })));
      else w = new Worker('js/worker.js');
      w.onmessage = function (e) {
        var cb = pendingCb[e.data.id];
        delete pendingCb[e.data.id];
        if (cb) cb(e.data.move);
      };
      w.onerror = function () { worker = null; };
      return w;
    } catch (err) { return null; }
  }

  function runSearch(req, cb) {
    if (worker === null) worker = makeWorker() || false;
    if (worker) {
      pendingCb[req.id] = cb;
      worker.postMessage(req);
    } else {
      // Sin hilos de trabajo (por ejemplo, abriendo el archivo directo): piensa en el hilo principal.
      setTimeout(function () {
        var m = 0;
        try { m = AI.chooseMove(new Chess(req.fen), req.level, req.keys); } catch (err) { m = 0; }
        cb(m);
      }, 30);
    }
  }

  function cancelAI() {
    S.searchId++;
    if (S.thinking && worker) { try { worker.terminate(); } catch (e) { /* ok */ } worker = null; pendingCb = {}; }
    S.thinking = false;
  }

  function requestAI() {
    if (S.over) return;
    S.thinking = true;
    var id = ++S.searchId, t0 = Date.now();
    renderStatus(); paintSquares();
    runSearch({ id: id, fen: S.game.fen(), level: S.level, keys: S.game.keys.slice() }, function (mv) {
      if (id !== S.searchId) return;
      var wait = Math.max(0, 450 - (Date.now() - t0));
      setTimeout(function () {
        if (id !== S.searchId) return;
        S.thinking = false;
        if (mv) playMove(mv); else { renderStatus(); paintSquares(); }
      }, wait);
    });
  }

  /* ------------------------------------------------------------------ Acciones */

  function startGame(opts) {
    if (S.online || S.pendingOnline) leaveOnline();
    cancelAI();
    S.mode = opts.mode; S.level = opts.level; S.timeKey = opts.time;
    var c = opts.color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : opts.color;
    S.human = c === 'black' ? BLACK : WHITE;
    S.orientation = S.mode === 'ai' ? S.human : WHITE;
    S.game = new Chess();
    S.over = null; S.view = null; S.viewFor = -1; S.sel = -1; S.legal = []; S.promo = null;
    promoEl.hidden = true;
    var tc = TIMES[S.timeKey];
    S.clock = tc ? { rem: [tc[0] * 1000, tc[0] * 1000], inc: tc[1] * 1000, last: Date.now() } : null;
    S.settings = { mode: opts.mode, level: opts.level, color: opts.color, time: opts.time };
    store.set('settings', S.settings);
    buildSquares();
    renderAll();
    if (S.mode === 'ai' && S.game.turn !== S.human) requestAI();
  }

  function undo() {
    var n = plyCount();
    if (!n || S.mode === 'online') return;
    cancelAI();
    var g = S.game;
    if (S.mode === 'ai') {
      do { g.undo(); } while (g.turn !== S.human && g.history.length);
    } else {
      g.undo();
    }
    S.over = null; S.view = null; S.viewFor = -1; S.sel = -1; S.legal = [];
    if (S.clock) S.clock.last = Date.now();
    renderAll();
    if (S.mode === 'ai' && g.turn !== S.human) requestAI();
  }

  function setView(v) {
    var n = plyCount();
    v = Math.max(0, Math.min(n, v));
    S.view = v === n ? null : v;
    S.sel = -1; S.legal = [];
    S.promo = null; promoEl.hidden = true;
    renderPieces(); paintSquares(); renderPlayers(); renderStatus(); renderMoves(); renderControls();
  }

  var resignTimer = null;
  function resign() {
    var btn = $('#btn-resign'), label = $('span', btn);
    if (!btn.classList.contains('confirm')) {
      btn.classList.add('confirm'); label.textContent = '¿Seguro? Toca otra vez';
      resignTimer = setTimeout(resetResign, 3500);
      return;
    }
    resetResign();
    if (S.mode === 'online') { Net.send({ t: 'resign' }); return; }   // el servidor confirma con "over"
    var loser = S.mode === 'ai' ? S.human : S.game.turn;
    endGame({ over: true, reason: 'resign', winner: loser ^ 1, result: loser === WHITE ? '0-1' : '1-0', loser: loser });
  }
  function resetResign() {
    clearTimeout(resignTimer);
    var btn = $('#btn-resign');
    btn.classList.remove('confirm'); $('span', btn).textContent = 'Rendirse';
  }

  /* ------------------------------------------------------------------ Diálogos */

  var dlgNew = $('#dlg-new'), formNew = $('#form-new');

  var HINT_MODE = {
    ai: 'Juegas contra la computadora.',
    local: 'Dos personas juegan en el mismo dispositivo, por turnos.',
    online: 'Juegas contra otra persona, cada quien desde su dispositivo.'
  };

  function syncNewForm() {
    var el = formNew.elements;
    var mode = el.mode.value, online = mode === 'online';
    var joining = online && el.omode.value === 'join';
    $('#fs-level').hidden = mode !== 'ai';
    $('#fs-color').hidden = mode === 'local' || joining;
    $('#fs-name').hidden = mode === 'local';
    $('#fs-online').hidden = !online;
    $('#fs-code').hidden = !joining;
    $('#fs-time').hidden = joining;           // al unirte, el tiempo lo eligió quien creó la sala
    var available = !online || Net.available();
    $('#online-unavailable').hidden = available;
    $('#btn-start').disabled = !available;
    $('#btn-start').textContent = online ? (joining ? 'Unirme a la sala' : 'Crear sala') : 'Empezar partida';
    $('#hint-mode').textContent = HINT_MODE[mode];
    $('#hint-level').textContent = LEVEL_HINT[el.level.value];
    $('#hint-leave').hidden = !(S.mode === 'online' && S.online && S.online.status !== 'over');
    if (!online) $('#online-error').hidden = true;
  }
  formNew.addEventListener('change', syncNewForm);
  $('#in-code').addEventListener('input', function () {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  // opts (opcional): { mode:'online', omode:'join', code } para abrirlo desde un enlace de invitación
  function openNew(opts) {
    var s = S.settings, el = formNew.elements;
    el.mode.value = s.mode === 'local' ? 'local' : 'ai';
    el.level.value = s.level;
    el.color.value = s.color;
    el.time.value = s.time;
    el.nick.value = S.name;
    el.omode.value = 'create';
    el.code.value = '';
    $('#online-error').hidden = true;
    if (opts && opts.mode === 'online') {
      el.mode.value = 'online';
      if (opts.omode) el.omode.value = opts.omode;
      if (opts.code) el.code.value = opts.code;
    }
    syncNewForm();
    if (!dlgNew.open) dlgNew.showModal();
    if (opts && opts.code) el.nick.focus();
  }

  function cleanName(v) {
    return Array.from(String(v || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 16).join('');
  }

  formNew.addEventListener('submit', function (e) {
    var el = formNew.elements, mode = el.mode.value;
    if (mode !== 'local') { S.name = cleanName(el.nick.value); store.set('name', S.name); }
    if (mode === 'online') {
      e.preventDefault();                        // el diálogo se cierra solo cuando la sala está lista
      startOnline({
        action: el.omode.value, name: S.name, color: el.color.value,
        time: el.time.value, code: el.code.value
      });
      return;
    }
    startGame({ mode: mode, level: el.level.value, color: el.color.value, time: el.time.value });
  });

  $$('dialog [data-close]').forEach(function (b) { b.addEventListener('click', function () { b.closest('dialog').close(); }); });
  $$('dialog').forEach(function (d) {
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
  });
  $('#over-new').addEventListener('click', function () { $('#dlg-over').close(); openNew(); });
  $('#over-rematch').addEventListener('click', function () { $('#dlg-over').close(); askRematch(); });

  /* ------------------------------------------------------------------- Colores */

  var dlgTheme = $('#dlg-theme');

  function applyTheme(t, save) {
    document.documentElement.style.setProperty('--sq-light', t.light);
    document.documentElement.style.setProperty('--sq-dark', t.dark);
    $('#c-light').value = t.light; $('#c-dark').value = t.dark;
    if (save) store.set('theme', t);
    $$('.swatch').forEach(function (s) {
      var th = THEMES[+s.dataset.i];
      s.setAttribute('aria-checked', String(th.light === t.light && th.dark === t.dark));
    });
  }

  function buildSwatches() {
    var wrap = $('#swatches');
    THEMES.forEach(function (t, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'swatch'; b.dataset.i = i;
      b.setAttribute('role', 'radio');
      var prev = document.createElement('div'); prev.className = 'prev';
      [t.light, t.dark, t.dark, t.light].forEach(function (c) {
        var s = document.createElement('span'); s.style.background = c; prev.appendChild(s);
      });
      b.appendChild(prev); b.appendChild(document.createTextNode(t.name));
      b.addEventListener('click', function () { applyTheme(t, true); });
      wrap.appendChild(b);
    });
  }
  buildSwatches();
  ['#c-light', '#c-dark'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      applyTheme({ light: $('#c-light').value, dark: $('#c-dark').value }, true);
    });
  });
  $('#theme-reset').addEventListener('click', function () { applyTheme(THEMES[0], true); });
  applyTheme(store.get('theme', THEMES[0]), false);

  /* ------------------------------------------------------------------ Eventos */

  $('#btn-new').addEventListener('click', openNew);
  $('#btn-restart').addEventListener('click', function () { startGame(S.settings.color === 'random' ? Object.assign({}, S.settings, { color: S.human === BLACK ? 'black' : 'white' }) : S.settings); });
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-flip').addEventListener('click', function () {
    S.orientation ^= 1;
    buildSquares(); renderAll();
  });
  $('#btn-resign').addEventListener('click', resign);
  $('#btn-theme').addEventListener('click', function () { dlgTheme.showModal(); });
  $('#btn-sound').addEventListener('click', function () {
    S.sound = !S.sound; store.set('sound', S.sound); renderControls();
    if (S.sound) sfx('move');
  });

  $('#nav-first').addEventListener('click', function () { setView(0); });
  $('#nav-prev').addEventListener('click', function () { setView(viewPly() - 1); });
  $('#nav-next').addEventListener('click', function () { setView(viewPly() + 1); });
  $('#nav-last').addEventListener('click', function () { setView(plyCount()); });
  $('#btn-live').addEventListener('click', function () { setView(plyCount()); });
  $('#moves').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-ply]');
    if (b) setView(+b.dataset.ply);
  });

  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.key === 'ArrowLeft') { setView(viewPly() - 1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { setView(viewPly() + 1); e.preventDefault(); }
    else if (e.key === 'Home') { setView(0); e.preventDefault(); }
    else if (e.key === 'End') { setView(plyCount()); e.preventDefault(); }
    else if (e.key === 'Escape') { if (S.promo) { hidePromo(); renderPieces(); } else select(-1); }
  });

  window.addEventListener('beforeunload', function () { if (worker) { try { worker.terminate(); } catch (e) { /* ok */ } } });

  /* ---------------------------------------------------------------- En línea */
  /*
   * El servidor manda: valida las jugadas y lleva el reloj. Aquí solo mostramos lo que
   * llega y enviamos las jugadas propias (que aplicamos de inmediato para que se sienta
   * instantáneo; si el servidor las rechaza, nos manda la posición real y se corrige sola).
   *
   * S.online = { code, token, you, names:[blancas,negras], status:'waiting'|'playing'|'over',
   *              oppOnline, connected, drawFrom (color que ofreció tablas | null),
   *              rematch:[bool,bool], flash (aviso temporal) }
   */

  function newOnline(code, token) {
    return { code: code || null, token: token || null, you: WHITE, names: [null, null], status: 'waiting',
      oppOnline: false, connected: false, drawFrom: null, rematch: [false, false], flash: '', applied: false };
  }

  function saveSession() {
    var o = S.online;
    store.set('online', o && o.code && o.token ? { code: o.code, token: o.token } : null);
  }

  // Cierra cualquier partida en línea (avisando al servidor) y limpia lo guardado.
  function leaveOnline() {
    if (S.pendingOnline) { clearTimeout(S.pendingOnline.timer); S.pendingOnline = null; }
    if (S.online && S.online.token) Net.send({ t: 'leave' });
    Net.close();
    S.online = null;
    store.set('online', null);
    renderNotice();
  }

  function setOnlineError(text) {
    var box = $('#online-error');
    box.textContent = text || '';
    box.hidden = !text;
  }

  function startOnline(o) {
    setOnlineError('');
    if (!Net.available()) { syncNewForm(); return; }
    var joining = o.action === 'join';
    if (joining && !/^[A-Z0-9]{4,8}$/.test(o.code)) { setOnlineError('Escribe el código de la sala (6 letras o números).'); return; }
    if (S.online || S.pendingOnline) leaveOnline();
    cancelAI();
    S.pendingOnline = { action: o.action, name: o.name, color: o.color, time: o.time, code: o.code, sent: false };
    var p = S.pendingOnline;
    $('#btn-start').disabled = true;
    p.timer = setTimeout(function () {
      if (S.pendingOnline !== p) return;
      failOnline('No pude conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.');
    }, 8000);
    Net.open();
  }

  function failOnline(text) {
    var p = S.pendingOnline;
    if (p) clearTimeout(p.timer);
    S.pendingOnline = null;
    if (S.online && !S.online.applied) { S.online = null; store.set('online', null); Net.close(); }
    else if (!S.online) Net.close();
    if (!p || !p.silent) setOnlineError(text);
    syncNewForm();
  }

  function sendPending() {
    var p = S.pendingOnline;
    if (!p || p.sent) return;
    p.sent = true;
    if (p.action === 'create') Net.send({ t: 'create', name: p.name, color: p.color, time: p.time });
    else if (p.action === 'join') Net.send({ t: 'join', code: p.code, name: p.name });
    else Net.send({ t: 'resume', code: p.code, token: p.token });
  }

  Net.on('open', function () {
    if (S.online) S.online.connected = true;
    if (S.pendingOnline && !S.pendingOnline.sent) sendPending();
    else if (S.online && S.online.code && S.online.token) Net.send({ t: 'resume', code: S.online.code, token: S.online.token });
    if (S.mode === 'online') { renderStatus(); renderControls(); }
  });

  Net.on('close', function () {
    if (S.online) {
      S.online.connected = false;
      if (S.mode === 'online') { renderStatus(); renderControls(); }
    }
  });

  Net.on('message', function (m) {
    switch (m.t) {
      case 'created': case 'joined':
        S.online = newOnline(m.code, m.token);
        S.online.you = m.you;
        saveSession();
        break;
      case 'state': if (S.online) applySnapshot(m); break;
      case 'move': if (S.online) onRemoteMove(m); break;
      case 'over': if (S.online && S.mode === 'online') onRemoteOver(m); break;
      case 'presence':
        if (S.online) { S.online.oppOnline = !!m.oppOnline; renderStatus(); renderControls(); }
        break;
      case 'draw-offer':
        if (S.online) { S.online.drawFrom = S.human ^ 1; sfx('check'); renderControls(); }
        break;
      case 'draw-declined':
        if (S.online) { S.online.drawFrom = null; flash('Tu rival rechazó las tablas.'); }
        break;
      case 'rematch-offer':
        if (S.online) { S.online.rematch[S.human ^ 1] = true; sfx('check'); renderNotice(); }
        break;
      case 'error': onServerError(m); break;
    }
  });

  function onServerError(m) {
    var p = S.pendingOnline;
    if (p) return failOnline(m.message || 'No se pudo completar la operación.');
    if (m.code === 'no-room' && S.online) {          // la sala ya no existe en el servidor
      leaveOnline();
      startGame(S.settings);
      flash('La partida en línea ya no está disponible.', true);
      return;
    }
    if (S.online) flash(m.message || 'Ocurrió un error.');
  }

  var flashTimer = null;
  function flash(text, standalone) {
    var o = S.online;
    if (!o && !standalone) return;
    S.flashText = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { S.flashText = ''; renderNotice(); }, 5000);
    renderNotice();
  }

  function applySnapshot(s) {
    var o = S.online, first = !o.applied, prevYou = o.you;
    var p = S.pendingOnline;
    o.applied = true; o.connected = true;
    o.code = s.code; o.you = s.you;
    o.names = s.names.slice(); o.status = s.status; o.oppOnline = !!s.oppOnline;
    o.drawFrom = s.drawOffer; o.rematch = s.rematch.slice();

    S.mode = 'online'; S.human = s.you; S.thinking = false; S.searchId++;
    if (first || prevYou !== s.you) S.orientation = s.you;   // al empezar y cuando la revancha cambia los colores
    S.timeKey = s.timeKey;
    var g = new Chess();
    for (var i = 0; i < s.moves.length; i++) { var m = g.moveFromUci(s.moves[i]); if (!m || !g.move(m)) break; }
    S.game = g;
    S.over = s.status === 'over' && s.over ? { over: true, reason: s.over.reason, winner: s.over.winner, result: s.over.result } : null;
    S.clock = s.timeKey !== 'none' ? { rem: s.rem.slice(), inc: s.inc, last: Date.now() } : null;
    S.view = null; S.viewFor = -1; S.sel = -1; S.legal = []; S.promo = null;
    promoEl.hidden = true;
    if ($('#dlg-over').open && s.status === 'playing') $('#dlg-over').close();   // empezó la revancha
    buildSquares();
    renderAll();

    if (p) {                                   // era la respuesta a crear / unirse / reanudar
      clearTimeout(p.timer);
      S.pendingOnline = null;
      if (dlgNew.open) dlgNew.close();
      try { if (location.search) history.replaceState(null, '', location.pathname); } catch (e) { /* ok */ }
    }
  }

  function syncClock(rem) {
    if (!S.clock || !rem) return;
    S.clock.rem = rem.slice();
    S.clock.last = Date.now();
    renderClocks();
  }

  function resync() {
    if (S.online && S.online.code && S.online.token) Net.send({ t: 'resume', code: S.online.code, token: S.online.token });
  }

  function onRemoteMove(m) {
    var g = S.game, n = g.history.length;
    if (m.ply === n) { syncClock(m.rem); return; }             // eco de mi propia jugada
    if (m.ply !== n + 1) { resync(); return; }                  // nos perdimos algo: pedimos la posición completa
    var mv = g.moveFromUci(m.uci);
    if (!mv) { resync(); return; }
    S.online.drawFrom = null;
    playMove(mv, { remote: true });
    syncClock(m.rem);
  }

  function onRemoteOver(m) {
    S.online.status = 'over';
    S.online.drawFrom = null;
    S.online.rematch = [false, false];
    syncClock(m.rem);
    endGame({ over: true, reason: m.over.reason, winner: m.over.winner, result: m.over.result });
  }

  function askRematch() {
    if (!S.online) return;
    S.online.rematch[S.human] = true;
    Net.send({ t: 'rematch' });
    renderControls();
  }

  function renderOnlineStatus(pip, main, sub) {
    var o = S.online;
    if (o.status === 'waiting') {
      pip.classList.add('think');
      main.textContent = 'Esperando a tu rival…';
      sub.textContent = 'Comparte el enlace o el código de la sala.';
      return;
    }
    var turn = S.game.turn, opp = S.human ^ 1;
    pip.classList.add(turn === WHITE ? 'white' : 'black');
    main.textContent = turn === S.human ? 'Tu turno' : 'Turno de ' + playerName(turn);
    if (S.view !== null) sub.textContent = 'Revisando una jugada anterior.';
    else if (!o.connected) sub.textContent = 'Sin conexión. Reconectando…';
    else if (!o.oppOnline) sub.textContent = playerName(opp) + ' se desconectó.';
    else if (S.game.inCheck()) sub.textContent = turn === S.human ? 'Tu rey está en jaque.' : 'Rey en jaque.';
    else sub.textContent = 'Juegas con ' + colorName(S.human) + '.';
  }

  /* Tarjeta de avisos: invitación, tablas, desconexión, revancha */

  function noticeRow(parent, text, small) {
    var p = document.createElement('p');
    if (small) p.className = 'small';
    p.textContent = text;
    parent.appendChild(p);
    return p;
  }
  function noticeButtons(parent, list) {
    var box = document.createElement('div'); box.className = 'btns';
    list.forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn' + (b.primary ? ' primary' : '');
      btn.textContent = b.label;
      btn.addEventListener('click', b.fn);
      box.appendChild(btn);
    });
    parent.appendChild(box);
  }

  function inviteLink(code) { return location.origin + location.pathname + '?sala=' + code; }

  function copyText(text, done) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    else fallback();
  }

  function renderNotice() {
    var el = $('#notice');
    var o = S.mode === 'online' ? S.online : null;
    if (!o && !S.flashText) { el.hidden = true; el.textContent = ''; return; }
    el.textContent = '';
    var rows = 0;
    function section() {
      if (rows++) { var d = document.createElement('div'); d.className = 'divider'; el.appendChild(d); }
      var r = document.createElement('div'); r.className = 'row'; el.appendChild(r); return r;
    }
    if (S.flashText) noticeRow(section(), S.flashText);
    if (o) {
      var opp = S.human ^ 1, oppName = playerName(opp);
      if (!o.connected) noticeRow(section(), 'Sin conexión. Reconectando…');
      if (o.status === 'waiting') {
        var r = section();
        noticeRow(r, 'Código de la sala', true);
        var big = document.createElement('div'); big.className = 'code-big'; big.textContent = o.code || '······'; r.appendChild(big);
        var link = inviteLink(o.code || '');
        var row = document.createElement('div'); row.className = 'link';
        var input = document.createElement('input'); input.readOnly = true; input.value = link; input.setAttribute('aria-label', 'Enlace de invitación');
        input.addEventListener('focus', function () { input.select(); });
        row.appendChild(input); r.appendChild(row);
        var list = [{ label: 'Copiar enlace', primary: true, fn: function (e) {
          var b = e.currentTarget;
          copyText(link, function (ok) { b.textContent = ok ? '¡Enlace copiado!' : 'Selecciona y copia el enlace'; setTimeout(function () { b.textContent = 'Copiar enlace'; }, 2200); });
        } }];
        if (navigator.share) list.push({ label: 'Compartir', fn: function () { navigator.share({ title: 'Ajedrez', text: 'Juega conmigo una partida de ajedrez.', url: link }).catch(function () { /* cancelado */ }); } });
        noticeButtons(r, list);
        noticeRow(r, 'La partida empieza cuando tu rival abra el enlace o escriba el código.', true);
      }
      if (o.status === 'playing') {
        if (o.drawFrom === opp) {
          var d = section();
          noticeRow(d, oppName + ' propone tablas.');
          noticeButtons(d, [
            { label: 'Aceptar', primary: true, fn: function () { Net.send({ t: 'draw-accept' }); o.drawFrom = null; renderControls(); } },
            { label: 'Rechazar', fn: function () { Net.send({ t: 'draw-decline' }); o.drawFrom = null; renderControls(); } }
          ]);
        } else if (o.drawFrom === S.human) {
          noticeRow(section(), 'Propusiste tablas. Esperando la respuesta de ' + oppName + '…');
        }
        if (!o.oppOnline && o.connected) noticeRow(section(), oppName + ' se desconectó. Si no vuelve en 90 segundos, ganas la partida.');
      }
      if (o.status === 'over') {
        var v = section();
        if (o.rematch[opp] && !o.rematch[S.human]) {
          noticeRow(v, oppName + ' quiere la revancha.');
          noticeButtons(v, [{ label: 'Aceptar revancha', primary: true, fn: askRematch }]);
        } else if (o.rematch[S.human]) {
          noticeRow(v, 'Revancha pedida. Esperando la respuesta de ' + oppName + '…');
        } else if (o.oppOnline) {
          noticeRow(v, 'La partida terminó.');
          noticeButtons(v, [{ label: 'Pedir revancha', primary: true, fn: askRematch }]);
        } else {
          noticeRow(v, oppName + ' ya no está en la sala.');
        }
      }
    }
    el.hidden = rows === 0;
  }

  $('#btn-draw').addEventListener('click', function () {
    if (!S.online || S.online.status !== 'playing') return;
    S.online.drawFrom = S.human;
    Net.send({ t: 'draw' });
    renderControls();
  });

  // Para pruebas automáticas y depuración.
  window.__ajedrez = { state: S, startGame: startGame, playMove: playMove, undo: undo, setView: setView, tick: tick };

  /* ------------------------------------------------------------------- Inicio */

  startGame(S.settings);

  (function initOnline() {
    var invite = '';
    try { invite = (new URLSearchParams(location.search).get('sala') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); } catch (e) { /* ok */ }
    var saved = store.get('online', null);
    var canReconnect = saved && saved.code && saved.token && Net.available();
    if (canReconnect && (!invite || invite === saved.code)) {
      // Recarga de página o regreso a una partida en curso: volvemos a entrar a la misma sala.
      S.online = newOnline(saved.code, saved.token);
      var p = { action: 'resume', code: saved.code, token: saved.token, silent: true, sent: false };
      S.pendingOnline = p;
      p.timer = setTimeout(function () { if (S.pendingOnline === p) failOnline(''); }, 8000);
      Net.open();
    } else if (invite) {
      openNew({ mode: 'online', omode: 'join', code: invite });
    }
  })();
})();
