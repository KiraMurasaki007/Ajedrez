'use strict';
/*
 * ws.js — Servidor WebSocket mínimo (RFC 6455) usando solo módulos nativos de Node.
 *
 * Soporta: apretón de manos (handshake), mensajes de texto (con fragmentación),
 * ping/pong, cierre ordenado, límite de tamaño y validación de las tramas.
 * No soporta mensajes binarios ni extensiones (compresión), que este juego no usa.
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class Connection extends EventEmitter {
  constructor(socket, maxPayload) {
    super();
    this.socket = socket;
    this.maxPayload = maxPayload || 8192;
    this.buf = Buffer.alloc(0);
    this.frag = null;        // mensaje fragmentado en curso
    this.open = true;
    this.alive = true;       // se pone en false en cada ronda de latido; cualquier tráfico lo reactiva
    this.closeSent = false;
    socket.setNoDelay(true);
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._finish());
    socket.on('error', () => this._finish());
  }

  _finish() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  _onData(d) {
    if (!this.open || this.closeSent) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.open && !this.closeSent) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const rsv = b[0] & 0x70;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (rsv || !masked) return this.close(1002);   // los clientes deben enmascarar siempre
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        if (b.readUInt32BE(2) !== 0) return this.close(1009);
        len = b.readUInt32BE(6); off = 10;
      }
      if (len > this.maxPayload) return this.close(1009);
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = b[off + 4 + i] ^ mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      this._frame(fin, opcode, payload);
    }
  }

  _frame(fin, op, payload) {
    if (op >= 0x8) {                                  // tramas de control
      if (!fin || payload.length > 125) return this.close(1002);
      if (op === 0x8) {                               // cierre: devolvemos el código y terminamos
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
        return this.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000);
      }
      if (op === 0x9) { this.alive = true; return this._write(0xA, payload); }   // ping -> pong
      if (op === 0xA) { this.alive = true; return; }                             // pong
      return this.close(1002);
    }
    if (op === 0x0) {                                 // continuación
      if (!this.frag) return this.close(1002);
      this.frag.size += payload.length;
      if (this.frag.size > this.maxPayload) return this.close(1009);
      this.frag.chunks.push(payload);
      if (fin) {
        const full = Buffer.concat(this.frag.chunks);
        const first = this.frag.opcode;
        this.frag = null;
        this._message(first, full);
      }
      return;
    }
    if (op === 0x1 || op === 0x2) {
      if (this.frag) return this.close(1002);
      if (fin) return this._message(op, payload);
      this.frag = { opcode: op, chunks: [payload], size: payload.length };
      return;
    }
    this.close(1002);
  }

  _message(op, payload) {
    this.alive = true;
    if (op === 0x2) return this.close(1003);          // no aceptamos binarios
    this.emit('message', payload.toString('utf8'));
  }

  send(text) {
    if (!this.open || this.closeSent) return false;
    return this._write(0x1, Buffer.from(String(text), 'utf8'));
  }

  ping() { this._write(0x9, Buffer.alloc(0)); }

  close(code, reason) {
    if (!this.open) return;
    if (!this.closeSent) {
      this.closeSent = true;
      const rb = Buffer.from(reason || '', 'utf8').subarray(0, 100);
      const p = Buffer.alloc(2 + rb.length);
      p.writeUInt16BE(code || 1000, 0);
      rb.copy(p, 2);
      this._write(0x8, p, true);
    }
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 1500).unref();   // por si el otro lado no cierra
  }

  terminate() { this.socket.destroy(); }

  _write(op, payload, force) {
    if (!this.open || this.socket.destroyed || !this.socket.writable) return false;
    if (this.closeSent && !force) return false;
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
    head[0] = 0x80 | op;
    this.socket.write(Buffer.concat([head, payload]));
    return true;
  }
}

/**
 * Atiende una petición "Upgrade". Devuelve una Connection, o null si la rechazó.
 * opts: { maxPayload, allowedOrigins: [] }  (si hay orígenes permitidos, se exige coincidir)
 */
function acceptUpgrade(req, socket, head, opts) {
  opts = opts || {};
  const reject = (status, msg) => {
    try { socket.write('HTTP/1.1 ' + status + ' ' + msg + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); } catch (e) { /* ya cerrado */ }
    socket.destroy();
    return null;
  };
  const h = req.headers;
  const key = h['sec-websocket-key'];
  if (req.method !== 'GET') return reject(405, 'Method Not Allowed');
  if (String(h.upgrade || '').toLowerCase() !== 'websocket') return reject(400, 'Bad Request');
  if (!/upgrade/i.test(String(h.connection || ''))) return reject(400, 'Bad Request');
  if (h['sec-websocket-version'] !== '13') return reject(426, 'Upgrade Required');
  if (!key || Buffer.from(key, 'base64').length !== 16) return reject(400, 'Bad Request');
  if (opts.allowedOrigins && opts.allowedOrigins.length && opts.allowedOrigins.indexOf(h.origin) < 0) {
    return reject(403, 'Forbidden');
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const conn = new Connection(socket, opts.maxPayload);
  if (head && head.length) conn._onData(head);
  return conn;
}

module.exports = { acceptUpgrade, Connection };
