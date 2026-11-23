/*!
 * ai.js — Inteligencia artificial para el ajedrez.
 *
 * Búsqueda negamax con poda alfa-beta, profundización iterativa con límite de
 * tiempo, búsqueda de quietud (capturas), ordenación de movimientos (MVV-LVA,
 * killers, historial), poda por movimiento nulo y reducciones de movimientos
 * tardíos. La evaluación usa material + tablas de posición, pareja de alfiles
 * y una ayuda para rematar finales ganados (arrinconar al rey rival).
 *
 * Niveles (ver LEVELS): "easy", "medium" y "hard". Los niveles bajos buscan
 * poco y añaden ruido a la evaluación para cometer errores creíbles.
 *
 * Uso:  var move = ChessAI.chooseMove(game, 'medium', game.keys);
 */
(function (root) {
  'use strict';

  var Chess = (typeof module !== 'undefined' && module.exports) ? require('./chess.js').Chess : root.Chess;

  var P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
  var F_CAPTURE = 8, F_EP = 1;
  var MATE = 30000, INF = 32000;
  var VALUE = [0, 100, 320, 330, 500, 900, 0];

  var LEVELS = {
    easy:   { depth: 1, timeMs: 400,  noise: 200, randomChance: 0.10 },
    medium: { depth: 3, timeMs: 900,  noise: 30,  randomChance: 0 },
    hard:   { depth: 9, timeMs: 1500, noise: 0,   randomChance: 0 }
  };

  /* ----------------------------------------------- Tablas de posición (centipeones)
     Se leen de arriba abajo desde el punto de vista de las blancas (fila 8 primero). */
  var T_PAWN = [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0];
  var T_KNIGHT = [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50];
  var T_BISHOP = [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20];
  var T_ROOK = [
      0,  0,  0,  0,  0,  0,  0,  0,
      5, 10, 10, 10, 10, 10, 10,  5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
      0,  0,  0,  5,  5,  0,  0,  0];
  var T_QUEEN = [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20];
  var T_KING_MID = [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20];
  var T_KING_END = [
    -50,-40,-30,-20,-20,-30,-40,-50,
    -30,-20,-10,  0,  0,-10,-20,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-30,  0,  0,  0,  0,-30,-30,
    -50,-30,-30,-30,-30,-30,-30,-50];

  var TABLES = [null, T_PAWN, T_KNIGHT, T_BISHOP, T_ROOK, T_QUEEN];

  // PST[color][tipo][casilla 0x88]
  var PST = [[], []];
  var KING_MID = [new Int16Array(128), new Int16Array(128)];
  var KING_END = [new Int16Array(128), new Int16Array(128)];
  (function buildTables() {
    for (var sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      var r = sq >> 4, f = sq & 7;
      var wi = (7 - r) * 8 + f;   // índice visto desde las blancas
      var bi = r * 8 + f;         // espejo para las negras
      for (var t = 1; t <= 5; t++) {
        if (!PST[0][t]) { PST[0][t] = new Int16Array(128); PST[1][t] = new Int16Array(128); }
        PST[0][t][sq] = TABLES[t][wi];
        PST[1][t][sq] = TABLES[t][bi];
      }
      KING_MID[0][sq] = T_KING_MID[wi]; KING_MID[1][sq] = T_KING_MID[bi];
      KING_END[0][sq] = T_KING_END[wi]; KING_END[1][sq] = T_KING_END[bi];
    }
  })();

  function centerDist(sq) {
    var f = sq & 7, r = sq >> 4;
    return (f < 4 ? 3 - f : f - 4) + (r < 4 ? 3 - r : r - 4);
  }

  // Evaluación en centipeones desde el punto de vista del bando que mueve.
  function evaluate(c) {
    var b = c.board, score = 0, sq, p, t;
    var npW = 0, npB = 0, matW = 0, matB = 0, pawnsW = 0, pawnsB = 0, bishW = 0, bishB = 0;
    for (sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      p = b[sq];
      if (!p) continue;
      t = p & 7;
      if (t === K) continue;
      if (p & 8) {
        score -= VALUE[t] + PST[1][t][sq];
        matB += VALUE[t];
        if (t === P) pawnsB++; else { npB += VALUE[t]; if (t === B) bishB++; }
      } else {
        score += VALUE[t] + PST[0][t][sq];
        matW += VALUE[t];
        if (t === P) pawnsW++; else { npW += VALUE[t]; if (t === B) bishW++; }
      }
    }
    // Sin peones y sin material para mate: tablas.
    if (!pawnsW && !pawnsB && npW <= 330 && npB <= 330) return 0;

    var endgame = npW <= 1300 && npB <= 1300;
    var wk = c.kingSq[0], bk = c.kingSq[1];
    var kt = endgame ? KING_END : KING_MID;
    score += kt[0][wk] - kt[1][bk];
    if (bishW >= 2) score += 30;
    if (bishB >= 2) score -= 30;

    // Rematar finales ganados: empujar al rey rival a la esquina y acercar el propio.
    if (endgame) {
      var diff = matW - matB;
      if (diff >= 500 || diff <= -500) {
        var winnerK = diff > 0 ? wk : bk, loserK = diff > 0 ? bk : wk;
        var dist = Math.abs((winnerK & 7) - (loserK & 7)) + Math.abs((winnerK >> 4) - (loserK >> 4));
        var bonus = centerDist(loserK) * 10 + (14 - dist) * 4;
        score += diff > 0 ? bonus : -bonus;
      }
    }
    return c.turn === 0 ? score : -score;
  }

  /* --------------------------------------------------------------- Búsqueda */

  function Search(c, timeMs) {
    this.c = c;
    this.nodes = 0;
    this.stop = false;
    this.deadline = Date.now() + timeMs;
    this.killers = new Int32Array(128);
    this.hist = new Int32Array(128 * 128);
  }

  Search.prototype.hasPieces = function (color) {
    var b = this.c.board, sq, t;
    for (sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var p = b[sq];
      if (p && (p >> 3) === color) { t = p & 7; if (t !== P && t !== K) return true; }
    }
    return false;
  };

  Search.prototype.scoreMoves = function (moves, ply) {
    var b = this.c.board, n = moves.length, scores = new Array(n);
    var k1 = ply < 63 ? this.killers[ply * 2] : 0, k2 = ply < 63 ? this.killers[ply * 2 + 1] : 0;
    for (var i = 0; i < n; i++) {
      var m = moves[i], from = m & 0xff, to = (m >> 8) & 0xff, promo = (m >> 16) & 15, flags = m >> 20, s;
      if (flags & F_CAPTURE) {
        var victim = (flags & F_EP) ? P : (b[to] & 7);
        s = 100000 + VALUE[victim] * 16 - (b[from] & 7) + (promo ? VALUE[promo] : 0);
      } else if (promo) {
        s = 90000 + VALUE[promo];
      } else if (m === k1) {
        s = 80000;
      } else if (m === k2) {
        s = 79000;
      } else {
        s = this.hist[from * 128 + to];
      }
      scores[i] = s;
    }
    return scores;
  };

  function pick(moves, scores, start) {
    var best = start, n = moves.length;
    for (var j = start + 1; j < n; j++) if (scores[j] > scores[best]) best = j;
    if (best !== start) {
      var tm = moves[start]; moves[start] = moves[best]; moves[best] = tm;
      var ts = scores[start]; scores[start] = scores[best]; scores[best] = ts;
    }
  }

  Search.prototype.quiesce = function (alpha, beta, ply) {
    if ((++this.nodes & 2047) === 0 && Date.now() > this.deadline) this.stop = true;
    if (this.stop) return 0;
    var c = this.c;
    var stand = evaluate(c);
    if (ply > 48 || stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    var moves = c.generateMoves(true);
    var scores = this.scoreMoves(moves, ply);
    var us = c.turn, them = us ^ 1;
    for (var i = 0; i < moves.length; i++) {
      pick(moves, scores, i);
      var m = moves[i];
      // Poda delta: capturas que no pueden mejorar alfa ni de lejos.
      if (!((m >> 16) & 15) && stand + VALUE[((m >> 20) & F_EP) ? P : (c.board[(m >> 8) & 0xff] & 7)] + 200 < alpha) continue;
      c.makeMove(m);
      if (c.isAttacked(c.kingSq[us], them)) { c.undoMove(); continue; }
      var score = -this.quiesce(-beta, -alpha, ply + 1);
      c.undoMove();
      if (this.stop) return 0;
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  };

  Search.prototype.negamax = function (depth, alpha, beta, ply, allowNull) {
    if ((++this.nodes & 2047) === 0 && Date.now() > this.deadline) this.stop = true;
    if (this.stop) return 0;
    var c = this.c, us = c.turn, them = us ^ 1;
    var inCheck = c.isAttacked(c.kingSq[us], them);
    if (inCheck && ply < 24) depth++;
    if (depth <= 0) return this.quiesce(alpha, beta, ply);
    if (c.halfmove >= 100) return 0;

    // Poda por movimiento nulo.
    if (allowNull && !inCheck && depth >= 3 && beta < MATE - 100 && this.hasPieces(us)) {
      var savedEp = c.ep;
      c.ep = -1;
      c.turn = them;
      var ns = -this.negamax(depth - 3, -beta, -beta + 1, ply + 1, false);
      c.turn = us;
      c.ep = savedEp;
      if (this.stop) return 0;
      if (ns >= beta) return beta;
    }

    var moves = c.generateMoves(false);
    var scores = this.scoreMoves(moves, ply);
    var best = -INF, legal = 0, i, m, score, from, to, flags, promo, quiet, reduce;
    for (i = 0; i < moves.length; i++) {
      pick(moves, scores, i);
      m = moves[i];
      c.makeMove(m);
      if (c.isAttacked(c.kingSq[us], them)) { c.undoMove(); continue; }
      legal++;
      flags = m >> 20; promo = (m >> 16) & 15;
      quiet = !(flags & F_CAPTURE) && !promo;
      if (legal === 1) {
        score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
      } else {
        reduce = 0;
        if (depth >= 3 && legal > 4 && quiet && !inCheck && scores[i] < 79000 && !c.isAttacked(c.kingSq[them], us)) {
          reduce = (legal > 10 && depth >= 5) ? 2 : 1;
        }
        score = -this.negamax(depth - 1 - reduce, -alpha - 1, -alpha, ply + 1, true);
        if (!this.stop && score > alpha && (reduce || score < beta)) {
          score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
        }
      }
      c.undoMove();
      if (this.stop) return 0;
      if (score > best) best = score;
      if (score > alpha) {
        alpha = score;
        if (alpha >= beta) {
          if (quiet && ply < 63) {
            from = m & 0xff; to = (m >> 8) & 0xff;
            if (this.killers[ply * 2] !== m) {
              this.killers[ply * 2 + 1] = this.killers[ply * 2];
              this.killers[ply * 2] = m;
            }
            var h = this.hist[from * 128 + to] + depth * depth;
            this.hist[from * 128 + to] = h > 70000 ? 70000 : h;
          }
          break;
        }
      }
    }
    if (!legal) return inCheck ? -MATE + ply : 0;
    return best;
  };

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
  }

  /**
   * Elige el mejor movimiento para el bando que juega en `game`.
   * @param game   instancia de Chess (no se modifica)
   * @param level  'easy' | 'medium' | 'hard' (o un objeto como los de LEVELS)
   * @param keys   (opcional) claves de posición de la partida, para evitar/forzar repeticiones
   * @returns entero de movimiento, o 0 si no hay movimientos legales
   */
  function chooseMove(game, level, keys, info) {
    var cfg = typeof level === 'string' ? LEVELS[level] : level;
    if (!cfg) cfg = LEVELS.medium;
    var c = game.clone();
    var moves = c.legalMoves();
    if (!moves.length) return 0;
    if (moves.length === 1) return moves[0];
    shuffle(moves);
    if (cfg.randomChance && Math.random() < cfg.randomChance) return moves[0];

    var counts = {}, i;
    if (keys) for (i = 0; i < keys.length; i++) counts[keys[i]] = (counts[keys[i]] || 0) + 1;
    var rep = new Array(moves.length);
    for (i = 0; i < moves.length; i++) {
      c.makeMove(moves[i]);
      rep[i] = counts[c.positionKey()] || 0;
      c.undoMove();
    }

    var s = new Search(c, cfg.timeMs);
    var start = Date.now();
    var best = moves[0], bestScore = -INF, scores = null, reached = 0;

    for (var depth = 1; depth <= cfg.depth; depth++) {
      var alpha = -INF, iterBest = 0, iterBestScore = -INF, completed = true;
      var cur = new Array(moves.length);
      for (i = 0; i < moves.length; i++) {
        var m = moves[i], sc;
        c.makeMove(m);
        if (cfg.noise > 0) sc = -s.negamax(depth - 1, -INF, INF, 1, true);
        else sc = -s.negamax(depth - 1, -INF, -alpha, 1, true);
        c.undoMove();
        if (s.stop) { completed = false; break; }
        if (rep[i] >= 2) sc = 0; else if (rep[i] === 1) sc -= 15;
        cur[i] = sc;
        if (sc > iterBestScore) {
          iterBestScore = sc; iterBest = m;
          if (sc > alpha) alpha = sc;
        }
      }
      if (iterBest) { best = iterBest; bestScore = iterBestScore; }
      if (!completed) break;
      reached = depth;
      scores = cur;
      // Reordenar para la siguiente iteración: mejores primero.
      var idx = [];
      for (i = 0; i < moves.length; i++) idx.push(i);
      idx.sort(function (a, b2) { return cur[b2] - cur[a]; });
      var nm = [], nr = [], ns = [];
      for (i = 0; i < idx.length; i++) { nm.push(moves[idx[i]]); nr.push(rep[idx[i]]); ns.push(cur[idx[i]]); }
      moves = nm; rep = nr; scores = ns;
      if (bestScore >= MATE - 100 || bestScore <= -MATE + 100) break;
      if (Date.now() - start > cfg.timeMs * 0.45) break;
    }

    if (info) { info.depth = reached; info.nodes = s.nodes; info.score = bestScore; info.ms = Date.now() - start; }

    // Niveles bajos: elegir con ruido entre las jugadas evaluadas (siempre da el mate si lo ve).
    if (cfg.noise > 0 && scores) {
      var pickIdx = 0, pickVal = -Infinity;
      for (i = 0; i < moves.length; i++) {
        if (scores[i] >= MATE - 100) { pickIdx = i; break; }
        var v = scores[i] + (Math.random() * 2 - 1) * cfg.noise;
        if (v > pickVal) { pickVal = v; pickIdx = i; }
      }
      return moves[pickIdx];
    }
    return best;
  }

  var api = { chooseMove: chooseMove, evaluate: evaluate, LEVELS: LEVELS };
  root.ChessAI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
