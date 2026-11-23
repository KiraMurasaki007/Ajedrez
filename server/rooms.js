'use strict';
/*
 * rooms.js — Salas de partidas en línea.
 *
 * El servidor es la autoridad: valida cada jugada con el mismo motor de reglas que usa el
 * navegador (js/chess.js) y lleva el reloj. Así nadie puede hacer jugadas ilegales ni
 * "congelar" su tiempo desde el cliente.
 *
 * Esta clase no sabe nada de sockets: recibe objetos "conn" con un método send(texto)
 * y (opcional) close(). Eso permite probarla con relojes y conexiones simuladas.
 *
 * Mensajes cliente -> servidor:
 *   create {name, color: white|black|random, time}   join {code, name}   resume {code, token}
 *   move {uci}   resign   draw   draw-accept   draw-decline   rematch   leave
 * Mensajes servidor -> cliente:
 *   state (foto completa)   move {ply, uci, rem}   over {over, rem}   presence {oppOnline}
 *   draw-offer   draw-declined   rematch-offer   error {code, message}
 */
const crypto = require('crypto');
const { Chess } = require('../js/chess.js');

const WHITE = 0, BLACK = 1;
const TIMES = { 'none': null, '3+2': [180, 2], '5+0': [300, 0], '10+0': [600, 0], '15+10': [900, 10], '30+0': [1800, 0] };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sin 0/O, 1/I para evitar confusiones al dictarlo
const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

const LIMITS = {
  graceMs: 90 * 1000,              // tiempo para reconectarse antes de perder por abandono
  waitingMs: 15 * 60 * 1000,       // una sala sin rival se borra tras 15 min sin actividad
  overMs: 30 * 60 * 1000,          // una partida terminada se conserva 30 min (para la revancha)
  idleMs: 3 * 60 * 60 * 1000,      // tope absoluto sin actividad
  maxRooms: 500
};

function cleanName(v) {
  let s = typeof v === 'string' ? v : '';
  s = s.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  s = Array.from(s).slice(0, 16).join('').trim();
  return s || 'Jugador';
}

function defaultCode() {
  let c = '';
  for (let i = 0; i < 6; i++) c += CODE_CHARS.charAt(crypto.randomInt(CODE_CHARS.length));
  return c;
}

class Room {
  constructor(mgr, code, timeKey) {
    this.mgr = mgr;
    this.code = code;
    this.timeKey = timeKey;
    const tc = TIMES[timeKey];
    this.baseMs = tc ? tc[0] * 1000 : 0;
    this.incMs = tc ? tc[1] * 1000 : 0;
    this.players = [null, null];       // por color: { name, token, conn, left }
    this.grace = [null, null];         // temporizadores de reconexión
    this.status = 'waiting';           // waiting | playing | over
    this.over = null;
    this.game = new Chess();
    this.rem = [this.baseMs, this.baseMs];
    this.lastTick = 0;
    this.timer = null;
    this.drawOffer = null;
    this.rematch = [false, false];
    this.touch();
  }

  touch() { this.lastActivity = this.mgr.now(); }
  hasClock() { return this.baseMs > 0; }
  ticking() { return this.status === 'playing' && this.hasClock() && this.game.history.length >= 2; }
  colorOf(conn) {
    for (let c = 0; c < 2; c++) if (this.players[c] && this.players[c].conn === conn) return c;
    return -1;
  }

  // Descuenta del reloj el tiempo transcurrido desde la última lectura.
  settle() {
    const now = this.mgr.now();
    if (this.ticking()) this.rem[this.game.turn] -= now - this.lastTick;
    this.lastTick = now;
  }

  schedule() {
    this.mgr.clearTimer(this.timer);
    this.timer = null;
    if (!this.ticking()) return;
    const wait = Math.max(0, this.rem[this.game.turn]) + 5;
    this.timer = this.mgr.setTimer(() => this.onTimer(), wait);
  }

  onTimer() {
    this.timer = null;
    if (this.status !== 'playing') return;
    this.settle();
    const loser = this.game.turn;
    if (this.ticking() && this.rem[loser] <= 0) {
      this.rem[loser] = 0;
      const winner = loser ^ 1;
      this.finish(this.game.canMate(winner) ? 'timeout' : 'timeout-draw', this.game.canMate(winner) ? winner : null);
    } else {
      this.schedule();
    }
  }

  snapshot(you) {
    const g = this.game;
    const opp = this.players[you ^ 1];
    return {
      t: 'state', code: this.code, you: you,
      names: [this.players[0] ? this.players[0].name : null, this.players[1] ? this.players[1].name : null],
      timeKey: this.timeKey, inc: this.incMs,
      rem: this.rem.map(Math.round),
      moves: g.history.map((r) => g.moveToUci(r.move)),
      status: this.status, over: this.over,
      oppOnline: !!(opp && opp.conn),
      drawOffer: this.drawOffer, rematch: this.rematch.slice()
    };
  }

  sendState(color) {
    const p = this.players[color];
    if (p && p.conn) this.mgr.send(p.conn, this.snapshot(color));
  }
  sendStateAll() { this.sendState(WHITE); this.sendState(BLACK); }
  sendTo(color, obj) {
    const p = this.players[color];
    if (p && p.conn) this.mgr.send(p.conn, obj);
  }
  broadcast(obj) { this.sendTo(WHITE, obj); this.sendTo(BLACK, obj); }

  start() {
    this.game = new Chess();
    this.rem = [this.baseMs, this.baseMs];
    this.status = 'playing';
    this.over = null;
    this.drawOffer = null;
    this.rematch = [false, false];
    this.lastTick = this.mgr.now();
    this.schedule();
    this.touch();
  }

  finish(reason, winner) {
    if (this.status === 'over') return;
    this.settle();
    this.status = 'over';
    this.over = {
      over: true, reason: reason,
      winner: winner === null || winner === undefined ? null : winner,
      result: winner === WHITE ? '1-0' : winner === BLACK ? '0-1' : '1/2-1/2'
    };
    this.drawOffer = null;
    this.mgr.clearTimer(this.timer);
    this.timer = null;
    this.broadcast({ t: 'over', over: this.over, rem: this.rem.map((v) => Math.max(0, Math.round(v))) });
    this.touch();
  }

  connectedCount() {
    return (this.players[0] && this.players[0].conn ? 1 : 0) + (this.players[1] && this.players[1].conn ? 1 : 0);
  }

  destroy() {
    this.mgr.clearTimer(this.timer);
    this.mgr.clearTimer(this.grace[0]);
    this.mgr.clearTimer(this.grace[1]);
  }
}

class RoomManager {
  constructor(deps) {
    deps = deps || {};
    this.now = deps.now || Date.now;
    this.setTimer = deps.setTimer || ((fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; });
    this.clearTimer = deps.clearTimer || ((t) => { if (t) clearTimeout(t); });
    this.makeCode = deps.makeCode || defaultCode;
    this.randomBit = deps.randomBit || (() => crypto.randomInt(2));
    this.limits = Object.assign({}, LIMITS, deps.limits || {});
    this.rooms = new Map();
    this.sessions = new Map();   // conn -> room
  }

  send(conn, obj) {
    try { conn.send(JSON.stringify(obj)); } catch (e) { /* conexión ya cerrada */ }
  }
  err(conn, code, message) { this.send(conn, { t: 'error', code: code, message: message }); }

  handle(conn, msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return this.err(conn, 'bad-message', 'Mensaje no válido.');
    const room = this.sessions.get(conn) || null;
    if (room) room.touch();
    switch (msg.t) {
      case 'create': return this.create(conn, msg);
      case 'join': return this.join(conn, msg);
      case 'resume': return this.resume(conn, msg);
      case 'move': return this.move(conn, room, msg);
      case 'resign': return this.resign(conn, room);
      case 'draw': return this.draw(conn, room);
      case 'draw-accept': return this.drawAccept(conn, room);
      case 'draw-decline': return this.drawDecline(conn, room);
      case 'rematch': return this.rematch(conn, room);
      case 'leave': return this.leave(conn);
      case 'ping': return this.send(conn, { t: 'pong' });
    }
    return this.err(conn, 'bad-message', 'Mensaje no válido.');
  }

  /* ---------------------------------------------------------------- crear / unirse */

  create(conn, msg) {
    this.leave(conn);
    if (this.rooms.size >= this.limits.maxRooms) return this.err(conn, 'busy', 'El servidor está lleno. Intenta de nuevo en unos minutos.');
    const timeKey = Object.prototype.hasOwnProperty.call(TIMES, msg.time) ? msg.time : 'none';
    let code;
    for (let i = 0; i < 20; i++) { code = this.makeCode(); if (!this.rooms.has(code)) break; code = null; }
    if (!code) return this.err(conn, 'busy', 'No pude crear la sala. Intenta otra vez.');
    const color = msg.color === 'white' ? WHITE : msg.color === 'black' ? BLACK : (this.randomBit() ? BLACK : WHITE);
    const room = new Room(this, code, timeKey);
    room.players[color] = { name: cleanName(msg.name), token: crypto.randomBytes(16).toString('hex'), conn: conn, left: false };
    this.rooms.set(code, room);
    this.sessions.set(conn, room);
    this.send(conn, { t: 'created', code: code, token: room.players[color].token, you: color });
    room.sendState(color);
  }

  join(conn, msg) {
    const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const room = this.rooms.get(code);
    if (!room) return this.err(conn, 'no-room', 'No encontré esa sala. Revisa el código.');
    if (room.status !== 'waiting') return this.err(conn, 'full', 'Esa sala ya tiene dos jugadores.');
    if (this.sessions.get(conn) === room) return this.err(conn, 'own-room', 'Esa sala es tuya. Comparte el enlace con tu rival.');
    this.leave(conn);
    const color = room.players[WHITE] ? BLACK : WHITE;
    room.players[color] = { name: cleanName(msg.name), token: crypto.randomBytes(16).toString('hex'), conn: conn, left: false };
    this.sessions.set(conn, room);
    this.send(conn, { t: 'joined', code: code, token: room.players[color].token, you: color });
    room.start();
    room.sendStateAll();
  }

  resume(conn, msg) {
    const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const token = typeof msg.token === 'string' ? msg.token : '';
    const room = this.rooms.get(code);
    let color = -1;
    if (room) for (let c = 0; c < 2; c++) if (room.players[c] && !room.players[c].left && room.players[c].token === token) color = c;
    if (!room || color < 0) return this.err(conn, 'no-room', 'Esa partida ya no está disponible.');
    const p = room.players[color];
    if (p.conn && p.conn !== conn) {            // una conexión anterior que ya no responde
      this.sessions.delete(p.conn);
      try { if (p.conn.close) p.conn.close(4000, 'replaced'); } catch (e) { /* ok */ }
    }
    if (this.sessions.get(conn) && this.sessions.get(conn) !== room) this.leave(conn);
    p.conn = conn;
    this.sessions.set(conn, room);
    this.clearTimer(room.grace[color]);
    room.grace[color] = null;
    room.settle();
    room.touch();
    room.sendState(color);
    room.sendTo(color ^ 1, { t: 'presence', oppOnline: true });
  }

  /* --------------------------------------------------------------------- partida */

  move(conn, room, msg) {
    if (!room) return this.err(conn, 'no-room', 'No estás en una partida.');
    const color = room.colorOf(conn);
    if (color < 0 || room.status !== 'playing') return this.err(conn, 'not-playing', 'La partida no está en curso.');
    const g = room.game;
    if (g.turn !== color || typeof msg.uci !== 'string' || !UCI_RE.test(msg.uci)) {
      return room.sendState(color);             // fuera de turno o formato raro: lo resincronizamos
    }
    room.settle();
    if (room.ticking() && room.rem[color] <= 0) {   // llegó la jugada, pero ya se había acabado el tiempo
      room.rem[color] = 0;
      const winner = color ^ 1;
      return room.finish(g.canMate(winner) ? 'timeout' : 'timeout-draw', g.canMate(winner) ? winner : null);
    }
    const m = g.moveFromUci(msg.uci);
    if (!m) return room.sendState(color);       // jugada ilegal: el cliente vuelve al estado real
    const before = g.history.length;
    const rec = g.move(m);
    if (!rec) return room.sendState(color);
    if (before >= 2 && room.hasClock()) room.rem[color] += room.incMs;
    room.lastTick = this.now();
    room.drawOffer = null;
    room.broadcast({ t: 'move', ply: g.history.length, uci: g.moveToUci(m), rem: room.rem.map(Math.round) });
    const st = g.status();
    if (st.over) return room.finish(st.reason, st.winner);
    room.schedule();
  }

  resign(conn, room) {
    if (!room) return;
    const color = room.colorOf(conn);
    if (color < 0 || room.status !== 'playing') return;
    room.finish('resign', color ^ 1);
  }

  draw(conn, room) {
    if (!room) return;
    const color = room.colorOf(conn);
    if (color < 0 || room.status !== 'playing') return;
    if (room.drawOffer === (color ^ 1)) return this.drawAccept(conn, room);   // los dos quieren tablas
    if (room.drawOffer === color) return;
    room.drawOffer = color;
    room.sendTo(color ^ 1, { t: 'draw-offer' });
  }

  drawAccept(conn, room) {
    if (!room) return;
    const color = room.colorOf(conn);
    if (color < 0 || room.status !== 'playing' || room.drawOffer !== (color ^ 1)) return;
    room.finish('agreement', null);
  }

  drawDecline(conn, room) {
    if (!room) return;
    const color = room.colorOf(conn);
    if (color < 0 || room.status !== 'playing' || room.drawOffer !== (color ^ 1)) return;
    room.drawOffer = null;
    room.sendTo(color ^ 1, { t: 'draw-declined' });
  }

  rematch(conn, room) {
    if (!room) return;
    const color = room.colorOf(conn);
    if (color < 0 || room.status !== 'over') return;
    room.rematch[color] = true;
    if (room.rematch[0] && room.rematch[1]) {
      room.players = [room.players[1], room.players[0]];   // se intercambian los colores
      room.grace = [room.grace[1], room.grace[0]];
      room.start();
      room.sendStateAll();
    } else {
      room.sendTo(color ^ 1, { t: 'rematch-offer' });
    }
  }

  /* ---------------------------------------------------------- salir / desconectar */

  // El jugador abandona la sala a propósito.
  leave(conn) {
    const room = this.sessions.get(conn);
    if (!room) return;
    this.sessions.delete(conn);
    const color = room.colorOf(conn);
    if (color < 0) return;
    const p = room.players[color];
    p.conn = null;
    p.left = true;
    if (room.status === 'playing') room.finish('resign', color ^ 1);
    if (room.status === 'waiting') return this.removeRoom(room);
    room.sendTo(color ^ 1, { t: 'presence', oppOnline: false });
    if (room.connectedCount() === 0) this.removeRoom(room);
  }

  // Se cayó la conexión (no es lo mismo que salir: puede volver con "resume").
  onClose(conn) {
    const room = this.sessions.get(conn);
    this.sessions.delete(conn);
    if (!room) return;
    const color = room.colorOf(conn);
    if (color < 0) return;
    room.players[color].conn = null;
    room.sendTo(color ^ 1, { t: 'presence', oppOnline: false });
    if (room.status === 'playing') {
      this.clearTimer(room.grace[color]);
      room.grace[color] = this.setTimer(() => {
        room.grace[color] = null;
        const p = room.players[color];
        if (room.status === 'playing' && p && !p.conn) room.finish('abandon', color ^ 1);
      }, this.limits.graceMs);
    }
  }

  removeRoom(room) {
    room.destroy();
    this.rooms.delete(room.code);
    for (const [conn, r] of this.sessions) if (r === room) this.sessions.delete(conn);
  }

  // Limpieza periódica de salas abandonadas.
  sweep() {
    const now = this.now();
    for (const room of Array.from(this.rooms.values())) {
      const idle = now - room.lastActivity;
      const empty = room.connectedCount() === 0;
      if (idle > this.limits.idleMs ||
          (room.status === 'waiting' && idle > this.limits.waitingMs) ||
          (room.status === 'over' && idle > this.limits.overMs) ||
          (empty && idle > this.limits.waitingMs)) {
        this.removeRoom(room);
      }
    }
  }

  shutdown() {
    for (const room of Array.from(this.rooms.values())) this.removeRoom(room);
  }
}

module.exports = { RoomManager, Room, TIMES, cleanName };
