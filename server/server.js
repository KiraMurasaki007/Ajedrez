'use strict';
/*
 * server.js — Servidor del juego: entrega la página y conecta a los jugadores en línea.
 *
 * Uso:  node server/server.js        (o: npm start)
 * Variables de entorno (todas opcionales):
 *   PORT              puerto (por defecto 3000)
 *   HOST              interfaz (por defecto 0.0.0.0)
 *   ALLOWED_ORIGINS   orígenes que pueden abrir el WebSocket, separados por coma
 *                     (por ejemplo https://mi-juego.netlify.app). Vacío = cualquiera.
 *
 * No necesita instalar nada: solo Node.js 18 o superior.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { acceptUpgrade } = require('./ws');
const { RoomManager } = require('./rooms');

const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'"
].join('; ');

const MAX_CONNECTIONS = 2000;
const MAX_MSGS_PER_SECOND = 40;

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch (e) { res.writeHead(400); return res.end(); }
  if (pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (pathname === '/') pathname = '/index.html';
  if (pathname.indexOf('\0') >= 0) { res.writeHead(400); return res.end(); }

  // Solo se publican index.html, css/ y js/. Nada de server/, tests/ ni tools/.
  const rel = path.posix.normalize(pathname).replace(/^\/+/, '');
  const first = rel.split('/')[0];
  const ext = path.extname(rel);
  const allowed = (rel === 'index.html' || first === 'css' || first === 'js') && MIME[ext];
  const file = path.join(ROOT, rel);
  if (!allowed || file.indexOf(ROOT + path.sep) !== 0) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
    const headers = {
      'Content-Type': MIME[ext],
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    };
    if (ext === '.html') headers['Content-Security-Policy'] = CSP;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

function createServer(options) {
  options = options || {};
  const allowedOrigins = options.allowedOrigins ||
    (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const manager = new RoomManager(options.manager || {});
  const conns = new Set();
  const server = http.createServer(serveStatic);

  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try { pathname = new URL(req.url, 'http://x').pathname; } catch (e) { /* inválida */ }
    if (pathname !== '/ws' || conns.size >= MAX_CONNECTIONS) return socket.destroy();
    const conn = acceptUpgrade(req, socket, head, { maxPayload: 8192, allowedOrigins: allowedOrigins });
    if (!conn) return;
    conns.add(conn);
    let count = 0, windowStart = Date.now();
    conn.on('message', (text) => {
      const now = Date.now();
      if (now - windowStart > 1000) { windowStart = now; count = 0; }
      if (++count > MAX_MSGS_PER_SECOND) return conn.close(1008, 'demasiados mensajes');
      let msg;
      try { msg = JSON.parse(text); } catch (e) { return manager.err(conn, 'bad-message', 'Mensaje no válido.'); }
      try { manager.handle(conn, msg); }
      catch (e) { console.error('Error al procesar mensaje:', e); manager.err(conn, 'server-error', 'Error del servidor.'); }
    });
    conn.on('close', () => { conns.delete(conn); manager.onClose(conn); });
  });

  // Latido: detecta conexiones muertas y mantiene vivas las de los proxies del hosting.
  const heartbeat = setInterval(() => {
    for (const c of conns) {
      if (!c.alive) { c.terminate(); continue; }
      c.alive = false;
      c.ping();
    }
  }, options.heartbeatMs || 25000);
  const sweeper = setInterval(() => manager.sweep(), 60000);
  heartbeat.unref(); sweeper.unref();

  server.on('close', () => { clearInterval(heartbeat); clearInterval(sweeper); manager.shutdown(); });
  return { server, manager, conns };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const { server } = createServer();
  server.listen(port, host, () => {
    console.log('Ajedrez listo en http://localhost:' + port);
    console.log('Para jugar en línea, abre ese enlace en dos navegadores o dispositivos de la misma red.');
  });
  const stop = () => { server.close(); setTimeout(() => process.exit(0), 200).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

module.exports = { createServer };
