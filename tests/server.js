// Pruebas por red real: servidor HTTP/WebSocket, partidas entre dos clientes y tramas malformadas.
// Uso: node tests/server.js   (requiere Node 22+ por el WebSocket nativo del cliente de prueba)
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { createServer } = require('../server/server.js');

let failures = 0, total = 0;
function check(name, cond, extra) {
  total++;
  if (!cond) { failures++; console.log('  ✗ ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
  else console.log('  ✓ ' + name);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(port, path, headers) {
  return new Promise((resolve, reject) => {
    http.get({ port, path, headers, host: '127.0.0.1' }, (res) => {
      let body = ''; res.on('data', (d) => body += d); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

// Cliente WebSocket nativo de Node con buzón de mensajes.
function client(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
    const c = { ws, inbox: [], closed: null,
      send(o) { ws.send(JSON.stringify(o)); },
      last(t) { for (let i = this.inbox.length - 1; i >= 0; i--) if (this.inbox[i].t === t) return this.inbox[i]; return null; },
      async wait(t, ms) {
        const end = Date.now() + (ms || 2000);
        while (Date.now() < end) { const m = this.last(t); if (m) return m; if (this.closed) break; await sleep(10); }
        return null;
      },
      clear() { this.inbox = []; } };
    ws.onmessage = (e) => c.inbox.push(JSON.parse(e.data));
    ws.onclose = (e) => { c.closed = e.code; };
    ws.onopen = () => resolve(c);
    ws.onerror = () => reject(new Error('no se pudo conectar'));
  });
}

// Cliente crudo: arma las tramas a mano para probar casos raros.
function maskedFrame(opcode, payload, opts) {
  opts = opts || {};
  const fin = opts.fin === false ? 0 : 0x80;
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([fin | opcode, (opts.unmasked ? 0 : 0x80) | len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = fin | opcode; head[1] = (opts.unmasked ? 0 : 0x80) | 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = fin | opcode; head[1] = (opts.unmasked ? 0 : 0x80) | 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
  if (opts.unmasked) return Buffer.concat([head, payload]);
  const mask = crypto.randomBytes(4);
  const body = Buffer.alloc(len);
  for (let i = 0; i < len; i++) body[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([head, mask, body]);
}

function rawClient(port, extraHeaders, key) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    key = key || crypto.randomBytes(16).toString('base64');
    const r = { sock, buf: Buffer.alloc(0), header: null, frames: [], ended: false, key };
    sock.on('data', (d) => {
      r.buf = Buffer.concat([r.buf, d]);
      if (!r.header) {
        const i = r.buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        r.header = r.buf.subarray(0, i).toString();
        r.buf = r.buf.subarray(i + 4);
        resolve(r);
      }
      while (r.buf.length >= 2) {          // tramas del servidor (sin máscara)
        let len = r.buf[1] & 0x7f, off = 2;
        if (len === 126) { if (r.buf.length < 4) break; len = r.buf.readUInt16BE(2); off = 4; }
        if (r.buf.length < off + len) break;
        r.frames.push({ op: r.buf[0] & 0x0f, payload: r.buf.subarray(off, off + len) });
        r.buf = r.buf.subarray(off + len);
      }
    });
    sock.on('end', () => { r.ended = true; });
    sock.on('close', () => { r.ended = true; if (!r.header) resolve(r); });
    sock.on('error', reject);
    const hs = ['GET /ws HTTP/1.1', 'Host: localhost', 'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Key: ' + key, 'Sec-WebSocket-Version: 13']
      .concat(Object.entries(extraHeaders || {}).map(([k, v]) => k + ': ' + v));
    sock.write(hs.join('\r\n') + '\r\n\r\n');
    r.closeCode = () => { const f = r.frames.find((x) => x.op === 8); return f ? f.payload.readUInt16BE(0) : null; };
    r.json = () => r.frames.filter((x) => x.op === 1).map((x) => JSON.parse(x.payload.toString()));
  });
}

(async () => {
  const { server, manager } = createServer({ heartbeatMs: 150 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  console.log('Servidor de archivos');
  {
    const home = await httpGet(port, '/');
    check('la página principal se entrega', home.status === 200 && /<title>/.test(home.body) && /text\/html/.test(home.headers['content-type']));
    check('trae política de seguridad de contenido', /default-src 'self'/.test(home.headers['content-security-policy'] || ''));
    check('se entregan css y js', (await httpGet(port, '/css/styles.css')).status === 200 && (await httpGet(port, '/js/chess.js')).status === 200);
    check('el código del servidor NO se publica', (await httpGet(port, '/server/rooms.js')).status === 404 && (await httpGet(port, '/server/server.js')).status === 404);
    check('tests, herramientas y package.json NO se publican', (await httpGet(port, '/tests/rules.js')).status === 404 && (await httpGet(port, '/package.json')).status === 404 && (await httpGet(port, '/tools/build.js')).status === 404);
    check('no se puede salir de la carpeta (../)', (await httpGet(port, '/js/../server/rooms.js')).status === 404 && (await httpGet(port, '/js/%2e%2e/server/rooms.js')).status === 404 && (await httpGet(port, '/%2e%2e/%2e%2e/etc/passwd')).status === 404);
    check('ruta con byte nulo rechazada', [400, 404].includes((await httpGet(port, '/js/chess.js%00.png')).status));
    check('healthz responde ok', (await httpGet(port, '/healthz')).body === 'ok');
    check('método POST rechazado', await new Promise((resolve) => { const r = http.request({ port, method: 'POST', path: '/', host: '127.0.0.1' }, (res) => resolve(res.statusCode === 405)); r.end(); }));
  }

  console.log('Protocolo WebSocket (tramas a mano)');
  {
    const r = await rawClient(port, {}, 'dGhlIHNhbXBsZSBub25jZQ==');
    check('handshake: devuelve la clave de aceptación del estándar RFC 6455', /101 Switching Protocols/.test(r.header) && /Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/.test(r.header), r.header);
    r.sock.write(maskedFrame(0x9, Buffer.from('hola')));
    await sleep(80);
    const pong = r.frames.find((f) => f.op === 0xA);
    check('ping -> pong con el mismo contenido', pong && pong.payload.toString() === 'hola');

    const msg = Buffer.from(JSON.stringify({ t: 'create', name: 'Frag', color: 'white', time: 'none' }));
    const a = msg.subarray(0, 10), b = msg.subarray(10, 25), c = msg.subarray(25);
    r.sock.write(maskedFrame(0x1, a, { fin: false }));
    r.sock.write(maskedFrame(0x9, Buffer.from('x')));            // un ping en medio es válido
    r.sock.write(maskedFrame(0x0, b, { fin: false }));
    r.sock.write(maskedFrame(0x0, c));
    await sleep(120);
    check('mensaje fragmentado en 3 partes (con ping en medio) se entiende', r.json().some((m) => m.t === 'created'), r.json());

    const big = Buffer.from(JSON.stringify({ t: 'create', name: 'X'.repeat(400), color: 'black', time: 'none' }));   // > 125 bytes: longitud de 16 bits
    r.frames.length = 0;
    r.sock.write(maskedFrame(0x1, big));
    await sleep(120);
    const created = r.json().find((m) => m.t === 'state');
    check('mensaje largo (longitud de 16 bits) se procesa y el nombre se recorta', created && created.names[1].length === 16 && created.you === 1, created && created.names);

    r.sock.write(maskedFrame(0x8, Buffer.from([0x03, 0xe8])));
    await sleep(120);
    check('cierre ordenado: el servidor responde con el mismo código', r.closeCode() === 1000 && r.ended);
  }
  {
    const r = await rawClient(port);
    r.sock.write(maskedFrame(0x1, Buffer.from('{"t":"ping"}'), { unmasked: true }));
    await sleep(120);
    check('trama sin máscara -> cierre por error de protocolo (1002)', r.closeCode() === 1002);
  }
  {
    const r = await rawClient(port);
    r.sock.write(maskedFrame(0x1, Buffer.alloc(9000, 0x61)));
    await sleep(150);
    check('mensaje de más de 8 KB -> cierre por tamaño (1009)', r.closeCode() === 1009);
  }
  {
    const r = await rawClient(port);
    const h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeUInt32BE(0x1, 2); h.writeUInt32BE(0, 6);   // declara 4 GB
    r.sock.write(Buffer.concat([h, Buffer.alloc(4)]));
    await sleep(150);
    check('longitud declarada de 4 GB se rechaza sin reservar memoria (1009)', r.closeCode() === 1009);
  }
  {
    const r = await rawClient(port);
    r.sock.write(maskedFrame(0x2, Buffer.from([1, 2, 3])));
    await sleep(120);
    check('mensaje binario -> 1003', r.closeCode() === 1003);
  }
  {
    const r = await rawClient(port);
    r.sock.write(maskedFrame(0x1, Buffer.from('{"t":"ping"'), {}));   // JSON roto
    await sleep(120);
    const m = r.json()[0];
    check('JSON roto -> error claro sin cerrar la conexión', m && m.t === 'error' && m.code === 'bad-message' && r.closeCode() === null, m);
  }
  {
    const bad = await new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1');
      let d = ''; s.on('data', (x) => d += x); s.on('close', () => resolve(d));
      s.write('GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: corta\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    check('handshake con clave inválida -> 400', /^HTTP\/1.1 400/.test(bad), bad);
    const wrongPath = await new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1'); let d = ''; s.on('data', (x) => d += x); s.on('close', () => resolve(d));
      s.write('GET /otra HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    check('upgrade a una ruta distinta de /ws se descarta', !/101/.test(wrongPath));
  }
  {
    const r = await rawClient(port);                 // no responde a los ping del servidor
    await sleep(700);
    check('el latido cierra las conexiones que no responden', r.ended);
  }

  console.log('Partida completa entre dos clientes por red');
  {
    const A = await client(port), B = await client(port);
    A.send({ t: 'create', name: 'Ana', color: 'white', time: '5+0' });
    const created = await A.wait('created');
    check('se crea la sala', created && /^[A-HJ-NP-Z2-9]{6}$/.test(created.code), created);
    B.send({ t: 'join', code: created.code.toLowerCase(), name: 'Beto' });
    const sa = await A.wait('state'); await sleep(50);
    const stA = A.last('state'), stB = await B.wait('state');
    check('los dos reciben la partida en curso', stA.status === 'playing' && stB.status === 'playing' && stA.you === 0 && stB.you === 1, [stA.status, stB.status]);
    check('foto de estado de más de 125 bytes llega bien (trama de 16 bits servidor->cliente)', JSON.stringify(stB).length > 125 && stB.names[0] === 'Ana');

    const moves = [[A, 'e2e4'], [B, 'e7e5'], [A, 'd1h5'], [B, 'b8c6'], [A, 'f1c4'], [B, 'g8f6'], [A, 'h5f7']];
    for (const [who, uci] of moves) { who.send({ t: 'move', uci }); await sleep(30); }
    const over = await B.wait('over');
    check('mate del pastor detectado por el servidor y avisado a los dos', over && over.over.reason === 'checkmate' && over.over.winner === 0 && A.last('over'), over);
    check('los dos recibieron las 7 jugadas en orden', B.inbox.filter((m) => m.t === 'move').map((m) => m.uci).join() === 'e2e4,e7e5,d1h5,b8c6,f1c4,g8f6,h5f7');

    A.clear(); B.clear();
    A.send({ t: 'rematch' });
    check('revancha: el rival recibe la oferta', !!(await B.wait('rematch-offer')));
    B.send({ t: 'rematch' });
    const ra = await A.wait('state'), rb = await B.wait('state');
    check('revancha aceptada: nueva partida con colores invertidos', ra.you === 1 && rb.you === 0 && ra.moves.length === 0 && ra.status === 'playing');

    // B pierde la conexión: A debe enterarse (la reconexión con token se prueba en el bloque siguiente)
    A.clear();
    B.ws.close();
    const pres = await A.wait('presence');
    check('A se entera de que B se desconectó', pres && pres.oppOnline === false);
    A.send({ t: 'move', uci: 'e7e5' });                      // A ahora es negras: no es su turno
    await sleep(60);
    check('jugar fuera de turno no cambia nada', A.last('state') && A.last('state').moves.length === 0);

    A.ws.close();
  }
  {
    // reconexión con token real
    const A = await client(port), B = await client(port);
    A.send({ t: 'create', name: 'Ana', color: 'white', time: 'none' });
    const created = await A.wait('created');
    B.send({ t: 'join', code: created.code, name: 'Beto' });
    const joined = await B.wait('joined'); await B.wait('state');
    A.send({ t: 'move', uci: 'e2e4' }); await sleep(40);
    A.clear();
    B.ws.close();
    await A.wait('presence');
    const B2 = await client(port);
    B2.send({ t: 'resume', code: created.code, token: joined.token });
    const st = await B2.wait('state');
    check('reconexión con token: recupera la partida y su color', st && st.you === 1 && st.moves.join() === 'e2e4' && st.status === 'playing', st);
    const back = await A.wait('presence');
    check('A ve que B volvió', back && back.oppOnline === true);
    B2.send({ t: 'move', uci: 'e7e5' });
    check('B puede seguir jugando', !!(await A.wait('move')));
    A.ws.close(); B2.ws.close();
  }

  console.log('Límites y protección');
  {
    const A = await client(port);
    for (let i = 0; i < 80; i++) A.send({ t: 'ping' });
    await sleep(300);
    check('exceso de mensajes por segundo -> cierre (1008)', A.closed === 1008, A.closed);
  }
  {
    const strict = createServer({ allowedOrigins: ['https://mi-juego.example'] });
    await new Promise((r) => strict.server.listen(0, '127.0.0.1', r));
    const p2 = strict.server.address().port;
    const denied = await rawClient(p2, { Origin: 'https://malo.example' });
    check('origen no permitido -> 403', /^HTTP\/1.1 403/.test(denied.header || ''), denied.header);
    const noOrigin = await rawClient(p2);
    check('sin origen cuando hay lista permitida -> 403', /^HTTP\/1.1 403/.test(noOrigin.header || ''));
    const ok = await rawClient(p2, { Origin: 'https://mi-juego.example' });
    check('origen permitido -> 101', /101 Switching/.test(ok.header || ''));
    ok.sock.destroy();
    strict.server.close();
  }

  server.close();
  console.log(`\n${total - failures}/${total} pruebas correctas`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('Error en la prueba:', e); process.exit(1); });
