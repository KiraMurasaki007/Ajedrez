/*!
 * chess.js — Motor de reglas de ajedrez (tablero 0x88, sin dependencias).
 *
 * Qué hace:
 *   - Genera todos los movimientos legales de todas las piezas.
 *   - Detecta jaque, jaque mate y tablas (ahogado, material insuficiente,
 *     regla de 50 movimientos y triple repetición).
 *   - Enroque, promoción de peones y captura al paso.
 *   - Notación algebraica (SAN), FEN y UCI.
 *
 * Representación:
 *   - Casilla = rango * 16 + columna (rango 0 = fila 1, columna 0 = "a").
 *   - Pieza   = tipo | (color << 3). Tipos: P=1 N=2 B=3 R=4 Q=5 K=6. Blancas=0, Negras=1.
 *   - Movimiento = entero: desde | hasta << 8 | promoción << 16 | banderas << 20.
 */
(function (root) {
  'use strict';

  var P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
  var WHITE = 0, BLACK = 1;

  var F_EP = 1, F_CASTLE = 2, F_DOUBLE = 4, F_CAPTURE = 8;
  var CR_WK = 1, CR_WQ = 2, CR_BK = 4, CR_BQ = 8;

  var FILES = 'abcdefgh';
  var PIECE_LETTERS = 'PNBRQK';
  var START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  var KNIGHT_OFF = [-33, -31, -18, -14, 14, 18, 31, 33];
  var BISHOP_OFF = [-17, -15, 15, 17];
  var ROOK_OFF = [-16, -1, 1, 16];
  var KING_OFF = [-17, -16, -15, -1, 1, 15, 16, 17];

  // Qué derechos de enroque se pierden al mover desde / hacia cada casilla.
  var CASTLE_MASK = new Uint8Array(128);
  for (var ci = 0; ci < 128; ci++) CASTLE_MASK[ci] = 15;
  CASTLE_MASK[4] = 15 & ~(CR_WK | CR_WQ);
  CASTLE_MASK[0] = 15 & ~CR_WQ;
  CASTLE_MASK[7] = 15 & ~CR_WK;
  CASTLE_MASK[116] = 15 & ~(CR_BK | CR_BQ);
  CASTLE_MASK[112] = 15 & ~CR_BQ;
  CASTLE_MASK[119] = 15 & ~CR_BK;

  function mk(from, to, promo, flags) {
    return from | (to << 8) | (promo << 16) | (flags << 20);
  }
  function sqName(sq) { return FILES[sq & 7] + (1 + (sq >> 4)); }
  function nameToSq(name) { return (name.charCodeAt(1) - 49) * 16 + (name.charCodeAt(0) - 97); }

  function addPromos(moves, from, to, flags) {
    moves.push(mk(from, to, Q, flags), mk(from, to, R, flags), mk(from, to, B, flags), mk(from, to, N, flags));
  }

  function Chess(fen) {
    this.board = new Int8Array(128);
    this.turn = WHITE;
    this.castling = 0;
    this.ep = -1;
    this.halfmove = 0;
    this.fullmove = 1;
    this.kingSq = [4, 116];
    // Pila de deshacer (usada tanto por la búsqueda de la IA como por la partida).
    this.uMove = [];
    this.uCapt = [];
    this.uCast = [];
    this.uEp = [];
    this.uHalf = [];
    // Historial de la partida (solo para movimientos hechos con move()).
    this.history = [];
    this.keys = [];
    this.load(fen || START_FEN);
  }

  /* ------------------------------------------------------------------ FEN */

  Chess.prototype.load = function (fen) {
    var parts = String(fen).trim().split(/\s+/);
    var rows = parts[0].split('/');
    if (rows.length !== 8) throw new Error('FEN inválido: se esperaban 8 filas');
    this.board.fill(0);
    this.kingSq = [-1, -1];
    for (var i = 0; i < 8; i++) {
      var rank = 7 - i, file = 0, row = rows[i];
      for (var j = 0; j < row.length; j++) {
        var ch = row.charAt(j);
        if (ch >= '1' && ch <= '8') {
          file += +ch;
        } else {
          var type = 'pnbrqk'.indexOf(ch.toLowerCase()) + 1;
          if (!type || file > 7) throw new Error('FEN inválido: ' + ch);
          var color = ch === ch.toUpperCase() ? WHITE : BLACK;
          var sq = rank * 16 + file;
          this.board[sq] = type | (color << 3);
          if (type === K) this.kingSq[color] = sq;
          file++;
        }
      }
    }
    if (this.kingSq[0] < 0 || this.kingSq[1] < 0) throw new Error('FEN inválido: falta un rey');
    this.turn = parts[1] === 'b' ? BLACK : WHITE;
    var cs = parts[2] || '-';
    this.castling = (cs.indexOf('K') >= 0 ? CR_WK : 0) | (cs.indexOf('Q') >= 0 ? CR_WQ : 0) |
                    (cs.indexOf('k') >= 0 ? CR_BK : 0) | (cs.indexOf('q') >= 0 ? CR_BQ : 0);
    this.ep = (parts[3] && parts[3] !== '-') ? nameToSq(parts[3]) : -1;
    this.halfmove = parseInt(parts[4], 10) || 0;
    this.fullmove = parseInt(parts[5], 10) || 1;
    this.uMove = []; this.uCapt = []; this.uCast = []; this.uEp = []; this.uHalf = [];
    this.history = [];
    this.keys = [this.positionKey()];
  };

  // ¿Puede algún peón del bando que mueve capturar al paso? (para FEN y repeticiones)
  Chess.prototype.epCapturable = function () {
    if (this.ep < 0) return false;
    var b = this.board, us = this.turn;
    var pawn = P | (us << 3);
    var row = us === WHITE ? this.ep - 16 : this.ep + 16;
    var l = row - 1, r = row + 1;
    return (!(l & 0x88) && b[l] === pawn) || (!(r & 0x88) && b[r] === pawn);
  };

  Chess.prototype.fen = function () {
    var rows = [];
    for (var r = 7; r >= 0; r--) {
      var s = '', empty = 0;
      for (var f = 0; f < 8; f++) {
        var p = this.board[r * 16 + f];
        if (!p) { empty++; continue; }
        if (empty) { s += empty; empty = 0; }
        var ch = 'pnbrqk'.charAt((p & 7) - 1);
        s += (p & 8) ? ch : ch.toUpperCase();
      }
      if (empty) s += empty;
      rows.push(s);
    }
    var c = this.castling;
    var cs = (c & CR_WK ? 'K' : '') + (c & CR_WQ ? 'Q' : '') + (c & CR_BK ? 'k' : '') + (c & CR_BQ ? 'q' : '');
    return rows.join('/') + ' ' + (this.turn === WHITE ? 'w' : 'b') + ' ' + (cs || '-') + ' ' +
           (this.epCapturable() ? sqName(this.ep) : '-') + ' ' + this.halfmove + ' ' + this.fullmove;
  };

  // Clave de posición para detectar repeticiones (sin contadores de movimientos).
  Chess.prototype.positionKey = function () {
    return this.fen().split(' ').slice(0, 4).join(' ');
  };

  Chess.prototype.clone = function () {
    var c = Object.create(Chess.prototype);
    c.board = new Int8Array(this.board);
    c.turn = this.turn;
    c.castling = this.castling;
    c.ep = this.ep;
    c.halfmove = this.halfmove;
    c.fullmove = this.fullmove;
    c.kingSq = [this.kingSq[0], this.kingSq[1]];
    c.uMove = []; c.uCapt = []; c.uCast = []; c.uEp = []; c.uHalf = [];
    c.history = [];
    c.keys = [];
    return c;
  };

  /* -------------------------------------------------------------- Ataques */

  Chess.prototype.isAttacked = function (sq, by) {
    var b = this.board, i, t, p, off, to;
    if (by === WHITE) {
      t = sq - 15; if (!(t & 0x88) && b[t] === P) return true;
      t = sq - 17; if (!(t & 0x88) && b[t] === P) return true;
    } else {
      t = sq + 15; if (!(t & 0x88) && b[t] === (P | 8)) return true;
      t = sq + 17; if (!(t & 0x88) && b[t] === (P | 8)) return true;
    }
    var bit = by << 3;
    var knight = N | bit, king = K | bit;
    for (i = 0; i < 8; i++) {
      t = sq + KNIGHT_OFF[i]; if (!(t & 0x88) && b[t] === knight) return true;
      t = sq + KING_OFF[i]; if (!(t & 0x88) && b[t] === king) return true;
    }
    var bishop = B | bit, rook = R | bit, queen = Q | bit;
    for (i = 0; i < 4; i++) {
      off = BISHOP_OFF[i]; to = sq + off;
      while (!(to & 0x88)) {
        p = b[to];
        if (p) { if (p === bishop || p === queen) return true; break; }
        to += off;
      }
      off = ROOK_OFF[i]; to = sq + off;
      while (!(to & 0x88)) {
        p = b[to];
        if (p) { if (p === rook || p === queen) return true; break; }
        to += off;
      }
    }
    return false;
  };

  Chess.prototype.inCheck = function (color) {
    if (color === undefined) color = this.turn;
    return this.isAttacked(this.kingSq[color], color ^ 1);
  };

  /* ---------------------------------------------- Generación de movimientos */

  // Movimientos pseudo-legales (pueden dejar al propio rey en jaque).
  Chess.prototype.generateMoves = function (capsOnly) {
    var moves = [], b = this.board, us = this.turn, them = us ^ 1;
    var sq, p, t, i, k, to, tp, offs, off;
    for (sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      p = b[sq];
      if (!p || (p >> 3) !== us) continue;
      t = p & 7;
      if (t === P) {
        var dir = us === WHITE ? 16 : -16;
        var startRank = us === WHITE ? 1 : 6;
        var promoRank = us === WHITE ? 7 : 0;
        to = sq + dir;
        if (!(to & 0x88) && !b[to]) {
          if ((to >> 4) === promoRank) {
            addPromos(moves, sq, to, 0);
          } else if (!capsOnly) {
            moves.push(mk(sq, to, 0, 0));
            if ((sq >> 4) === startRank && !b[to + dir]) moves.push(mk(sq, to + dir, 0, F_DOUBLE));
          }
        }
        for (k = 0; k < 2; k++) {
          to = sq + dir + (k ? 1 : -1);
          if (to & 0x88) continue;
          tp = b[to];
          if (tp && (tp >> 3) === them) {
            if ((to >> 4) === promoRank) addPromos(moves, sq, to, F_CAPTURE);
            else moves.push(mk(sq, to, 0, F_CAPTURE));
          } else if (to === this.ep) {
            moves.push(mk(sq, to, 0, F_EP | F_CAPTURE));
          }
        }
      } else if (t === N || t === K) {
        offs = t === N ? KNIGHT_OFF : KING_OFF;
        for (i = 0; i < 8; i++) {
          to = sq + offs[i];
          if (to & 0x88) continue;
          tp = b[to];
          if (!tp) { if (!capsOnly) moves.push(mk(sq, to, 0, 0)); }
          else if ((tp >> 3) === them) moves.push(mk(sq, to, 0, F_CAPTURE));
        }
        if (t === K && !capsOnly) this._genCastling(moves, us, them);
      } else {
        offs = t === B ? BISHOP_OFF : (t === R ? ROOK_OFF : KING_OFF);
        var n = offs.length;
        for (i = 0; i < n; i++) {
          off = offs[i];
          to = sq + off;
          while (!(to & 0x88)) {
            tp = b[to];
            if (!tp) {
              if (!capsOnly) moves.push(mk(sq, to, 0, 0));
            } else {
              if ((tp >> 3) === them) moves.push(mk(sq, to, 0, F_CAPTURE));
              break;
            }
            to += off;
          }
        }
      }
    }
    return moves;
  };

  Chess.prototype._genCastling = function (moves, us, them) {
    var b = this.board;
    var base = us === WHITE ? 0 : 112;
    if (b[base + 4] !== (K | (us << 3))) return;
    var ks = us === WHITE ? CR_WK : CR_BK;
    var qs = us === WHITE ? CR_WQ : CR_BQ;
    if ((this.castling & ks) && !b[base + 5] && !b[base + 6] && b[base + 7] === (R | (us << 3)) &&
        !this.isAttacked(base + 4, them) && !this.isAttacked(base + 5, them) && !this.isAttacked(base + 6, them)) {
      moves.push(mk(base + 4, base + 6, 0, F_CASTLE));
    }
    if ((this.castling & qs) && !b[base + 3] && !b[base + 2] && !b[base + 1] && b[base] === (R | (us << 3)) &&
        !this.isAttacked(base + 4, them) && !this.isAttacked(base + 3, them) && !this.isAttacked(base + 2, them)) {
      moves.push(mk(base + 4, base + 2, 0, F_CASTLE));
    }
  };

  /* ------------------------------------------ Hacer / deshacer (bajo nivel) */

  Chess.prototype.makeMove = function (m) {
    var b = this.board;
    var from = m & 0xff, to = (m >> 8) & 0xff, promo = (m >> 16) & 15, flags = m >> 20;
    var piece = b[from], captured = b[to], us = this.turn;
    if (flags & F_EP) {
      var cs = us === WHITE ? to - 16 : to + 16;
      captured = b[cs];
      b[cs] = 0;
    }
    this.uMove.push(m);
    this.uCapt.push(captured);
    this.uCast.push(this.castling);
    this.uEp.push(this.ep);
    this.uHalf.push(this.halfmove);

    b[to] = piece;
    b[from] = 0;
    if (flags & F_CASTLE) {
      if (to > from) { b[to - 1] = b[to + 1]; b[to + 1] = 0; }
      else { b[to + 1] = b[to - 2]; b[to - 2] = 0; }
    }
    if (promo) b[to] = promo | (us << 3);
    if ((piece & 7) === K) this.kingSq[us] = to;
    this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
    this.ep = (flags & F_DOUBLE) ? (from + to) >> 1 : -1;
    this.halfmove = ((piece & 7) === P || captured) ? 0 : this.halfmove + 1;
    if (us === BLACK) this.fullmove++;
    this.turn = us ^ 1;
  };

  Chess.prototype.undoMove = function () {
    var m = this.uMove.pop(), captured = this.uCapt.pop();
    this.castling = this.uCast.pop();
    this.ep = this.uEp.pop();
    this.halfmove = this.uHalf.pop();
    var b = this.board;
    var from = m & 0xff, to = (m >> 8) & 0xff, promo = (m >> 16) & 15, flags = m >> 20;
    this.turn ^= 1;
    var us = this.turn;
    if (us === BLACK) this.fullmove--;
    var piece = promo ? (P | (us << 3)) : b[to];
    b[from] = piece;
    if (flags & F_EP) {
      b[to] = 0;
      b[us === WHITE ? to - 16 : to + 16] = captured;
    } else {
      b[to] = captured;
    }
    if (flags & F_CASTLE) {
      if (to > from) { b[to + 1] = b[to - 1]; b[to - 1] = 0; }
      else { b[to - 2] = b[to + 1]; b[to + 1] = 0; }
    }
    if ((piece & 7) === K) this.kingSq[us] = from;
  };

  /* --------------------------------------------------------- Movimientos legales */

  Chess.prototype.legalMoves = function () {
    var pseudo = this.generateMoves(false), out = [], us = this.turn, them = us ^ 1;
    for (var i = 0; i < pseudo.length; i++) {
      var m = pseudo[i];
      this.makeMove(m);
      if (!this.isAttacked(this.kingSq[us], them)) out.push(m);
      this.undoMove();
    }
    return out;
  };

  Chess.prototype.legalMovesFrom = function (sq) {
    var all = this.legalMoves(), out = [];
    for (var i = 0; i < all.length; i++) if ((all[i] & 0xff) === sq) out.push(all[i]);
    return out;
  };

  Chess.prototype.hasLegalMove = function () {
    var pseudo = this.generateMoves(false), us = this.turn, them = us ^ 1;
    for (var i = 0; i < pseudo.length; i++) {
      this.makeMove(pseudo[i]);
      var ok = !this.isAttacked(this.kingSq[us], them);
      this.undoMove();
      if (ok) return true;
    }
    return false;
  };

  // Busca el movimiento legal desde -> hasta (con promoción opcional). Devuelve 0 si no existe.
  Chess.prototype.moveFromTo = function (from, to, promo) {
    var legal = this.legalMoves();
    for (var i = 0; i < legal.length; i++) {
      var m = legal[i];
      if ((m & 0xff) === from && ((m >> 8) & 0xff) === to) {
        var mp = (m >> 16) & 15;
        if (!mp || mp === (promo || Q)) return m;
      }
    }
    return 0;
  };

  Chess.prototype.perft = function (depth) {
    if (depth === 0) return 1;
    var moves = this.generateMoves(false), n = 0, us = this.turn, them = us ^ 1;
    for (var i = 0; i < moves.length; i++) {
      this.makeMove(moves[i]);
      if (!this.isAttacked(this.kingSq[us], them)) n += depth === 1 ? 1 : this.perft(depth - 1);
      this.undoMove();
    }
    return n;
  };

  /* ------------------------------------------------------------ Notación */

  Chess.prototype._san = function (m, legal) {
    var b = this.board;
    var from = m & 0xff, to = (m >> 8) & 0xff, promo = (m >> 16) & 15, flags = m >> 20;
    var piece = b[from], t = piece & 7, s;
    if (flags & F_CASTLE) return to > from ? 'O-O' : 'O-O-O';
    var cap = (flags & F_CAPTURE) !== 0;
    if (t === P) {
      s = (cap ? FILES.charAt(from & 7) + 'x' : '') + sqName(to);
      if (promo) s += '=' + PIECE_LETTERS.charAt(promo - 1);
      return s;
    }
    s = PIECE_LETTERS.charAt(t - 1);
    var ambiguous = false, sameFile = false, sameRank = false;
    for (var i = 0; i < legal.length; i++) {
      var o = legal[i];
      if (o !== m && ((o >> 8) & 0xff) === to && b[o & 0xff] === piece) {
        ambiguous = true;
        if ((o & 7) === (from & 7)) sameFile = true;
        if (((o & 0xff) >> 4) === (from >> 4)) sameRank = true;
      }
    }
    if (ambiguous) {
      if (!sameFile) s += FILES.charAt(from & 7);
      else if (!sameRank) s += (1 + (from >> 4));
      else s += sqName(from);
    }
    if (cap) s += 'x';
    return s + sqName(to);
  };

  Chess.prototype.moveToUci = function (m) {
    var promo = (m >> 16) & 15;
    return sqName(m & 0xff) + sqName((m >> 8) & 0xff) + (promo ? 'nbrq'.charAt(promo - 2) : '');
  };

  Chess.prototype.moveFromUci = function (uci) {
    var promo = uci.length > 4 ? 'pnbrqk'.indexOf(uci.charAt(4)) + 1 : 0;
    return this.moveFromTo(nameToSq(uci.substr(0, 2)), nameToSq(uci.substr(2, 2)), promo);
  };

  /* ---------------------------------------------------- Partida (alto nivel) */

  // Juega un movimiento legal y lo registra en el historial. Devuelve el registro o null.
  Chess.prototype.move = function (m) {
    var legal = this.legalMoves();
    if (legal.indexOf(m) < 0) return null;
    var san = this._san(m, legal);
    var from = m & 0xff, to = (m >> 8) & 0xff, promo = (m >> 16) & 15, flags = m >> 20;
    var us = this.turn;
    var piece = this.board[from];
    var captured = 0;
    if (flags & F_EP) captured = P | ((us ^ 1) << 3);
    else if (flags & F_CAPTURE) captured = this.board[to];
    this.makeMove(m);
    var check = this.inCheck(this.turn);
    if (check) san += this.hasLegalMove() ? '+' : '#';
    var rec = {
      move: m, san: san, from: from, to: to, promo: promo, flags: flags,
      piece: piece, captured: captured, color: us, check: check, fen: this.fen()
    };
    this.history.push(rec);
    this.keys.push(this.positionKey());
    return rec;
  };

  Chess.prototype.undo = function () {
    if (!this.history.length) return null;
    this.undoMove();
    this.keys.pop();
    return this.history.pop();
  };

  Chess.prototype.repetitionCount = function () {
    var last = this.keys[this.keys.length - 1], n = 0;
    for (var i = 0; i < this.keys.length; i++) if (this.keys[i] === last) n++;
    return n;
  };

  // Tablas por material insuficiente (rey solo, rey + una menor, alfiles del mismo color).
  Chess.prototype.insufficientMaterial = function () {
    var b = this.board, minors = [], sq, p, t;
    for (sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      p = b[sq];
      if (!p) continue;
      t = p & 7;
      if (t === K) continue;
      if (t === P || t === R || t === Q) return false;
      minors.push({ t: t, sq: sq });
    }
    if (minors.length <= 1) return true;
    var shade = -1;
    for (var i = 0; i < minors.length; i++) {
      if (minors[i].t !== B) return false;
      var c = ((minors[i].sq >> 4) + (minors[i].sq & 7)) & 1;
      if (shade < 0) shade = c; else if (shade !== c) return false;
    }
    return true;
  };

  // ¿Tiene ese bando material con el que podría dar mate? (para pérdida por tiempo)
  Chess.prototype.canMate = function (color) {
    var b = this.board, minors = 0, sq, p, t;
    for (sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      p = b[sq];
      if (!p || (p >> 3) !== color) continue;
      t = p & 7;
      if (t === P || t === R || t === Q) return true;
      if (t === N || t === B) minors++;
    }
    return minors >= 2;
  };

  // Estado de la partida según las reglas.
  Chess.prototype.status = function () {
    var check = this.inCheck(this.turn);
    if (!this.hasLegalMove()) {
      if (check) {
        var winner = this.turn ^ 1;
        return { over: true, reason: 'checkmate', winner: winner, result: winner === WHITE ? '1-0' : '0-1', check: true };
      }
      return { over: true, reason: 'stalemate', winner: null, result: '1/2-1/2', check: false };
    }
    if (this.insufficientMaterial()) return { over: true, reason: 'insufficient', winner: null, result: '1/2-1/2', check: check };
    if (this.halfmove >= 100) return { over: true, reason: 'fifty', winner: null, result: '1/2-1/2', check: check };
    if (this.repetitionCount() >= 3) return { over: true, reason: 'repetition', winner: null, result: '1/2-1/2', check: check };
    return { over: false, check: check };
  };

  /* -------------------------------------------------------------- Exportar */

  Chess.START_FEN = START_FEN;
  Chess.WHITE = WHITE; Chess.BLACK = BLACK;
  Chess.P = P; Chess.N = N; Chess.B = B; Chess.R = R; Chess.Q = Q; Chess.K = K;
  Chess.F_EP = F_EP; Chess.F_CASTLE = F_CASTLE; Chess.F_DOUBLE = F_DOUBLE; Chess.F_CAPTURE = F_CAPTURE;
  Chess.from = function (m) { return m & 0xff; };
  Chess.to = function (m) { return (m >> 8) & 0xff; };
  Chess.promo = function (m) { return (m >> 16) & 15; };
  Chess.flags = function (m) { return m >> 20; };
  Chess.pieceType = function (p) { return p & 7; };
  Chess.pieceColor = function (p) { return p >> 3; };
  Chess.sqName = sqName;
  Chess.nameToSq = nameToSq;

  root.Chess = Chess;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Chess: Chess };
})(typeof globalThis !== 'undefined' ? globalThis : this);
