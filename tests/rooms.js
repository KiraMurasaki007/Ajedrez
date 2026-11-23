// Pruebas de la lógica de salas con reloj y conexiones simuladas (no usa red).
// Uso: node tests/rooms.js
const { RoomManager, cleanName } = require('../server/rooms.js');

let failures = 0, total = 0;
function check(name, cond, extra) {
  total++;
  if (!cond) { failures++; console.log('  ✗ ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
  else console.log('  ✓ ' + name);
}

// ---- reloj y temporizadores falsos
function makeEnv(limits) {
  let now = 1000000, seq = 0;
  const timers = [];
  const env = {
    advance(ms) {
      const target = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const t = timers[0];
        if (!t || t.at > target) break;
        timers.shift();
        now = t.at;
        t.fn();
      }
      now = target;
    },
    mgr: new RoomManager({
      now: () => now,
      setTimer: (fn, ms) => { const t = { at: now + ms, fn, id: ++seq }; timers.push(t); return t; },
      clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
      makeCode: (() => { let n = 0; return () => 'SALA' + String(++n).padStart(2, '0'); })(),
      randomBit: () => 0,
      limits
    })
  };
  return env;
}

function makeConn(name) {
  const c = { name, inbox: [], closed: false,
    send(s) { this.inbox.push(JSON.parse(s)); },
    close() { this.closed = true; },
    last(t) { for (let i = this.inbox.length - 1; i >= 0; i--) if (this.inbox[i].t === t) return this.inbox[i]; return null; },
    all(t) { return this.inbox.filter((m) => m.t === t); },
    clear() { this.inbox = []; } };
  return c;
}

function startGame(env, opts) {
  opts = opts || {};
  const a = makeConn('A'), b = makeConn('B');
  env.mgr.handle(a, { t: 'create', name: opts.nameA || 'Ana', color: opts.color || 'white', time: opts.time || 'none' });
  const code = a.last('created').code;
  env.mgr.handle(b, { t: 'join', code, name: opts.nameB || 'Beto' });
  return { a, b, code };
}
const play = (env, conn, uci) => env.mgr.handle(conn, { t: 'move', uci });

console.log('Crear y unirse');
{
  const env = makeEnv();
  const a = makeConn('A'), b = makeConn('B');
  env.mgr.handle(a, { t: 'create', name: 'Ana', color: 'white', time: '5+0' });
  const created = a.last('created');
  check('create devuelve código y token', created && /^SALA\d\d$/.test(created.code) && created.token.length === 32 && created.you === 0);
  check('sala en espera con una foto de estado', a.last('state').status === 'waiting' && a.last('state').oppOnline === false);
  env.mgr.handle(b, { t: 'join', code: ' sala01 ', name: 'Beto' });
  check('join acepta minúsculas y espacios', b.last('joined') && b.last('joined').you === 1);
  check('ambos reciben la partida en curso', a.last('state').status === 'playing' && b.last('state').status === 'playing');
  check('cada quien ve su color y los nombres', a.last('state').you === 0 && b.last('state').you === 1 && JSON.stringify(a.last('state').names) === '["Ana","Beto"]');
  check('el reloj parte completo (5 min)', JSON.stringify(a.last('state').rem) === '[300000,300000]');

  const c = makeConn('C');
  env.mgr.handle(c, { t: 'join', code: 'SALA01', name: 'Tercero' });
  check('una tercera persona no puede entrar', c.last('error') && c.last('error').code === 'full');
  env.mgr.handle(c, { t: 'join', code: 'NOEXISTE', name: 'X' });
  check('código inexistente da error claro', c.last('error') && c.last('error').code === 'no-room');

  const solo = makeConn('S');
  env.mgr.handle(solo, { t: 'create', name: 'Solo', color: 'black', time: 'none' });
  check('el creador elige negras', solo.last('created').you === 1);
  env.mgr.handle(solo, { t: 'join', code: solo.last('created').code, name: 'Solo' });
  check('no puedes unirte a tu propia sala', solo.last('error') && solo.last('error').code === 'own-room');
  const r = makeConn('R');
  env.mgr.handle(r, { t: 'create', name: 'R', color: 'random', time: 'no-existe' });
  check('tiempo inválido se trata como sin reloj', r.last('state').timeKey === 'none');
}

console.log('Nombres');
{
  check('recorta a 16 caracteres', cleanName('Nombre muy muy largo de verdad').length <= 16);
  check('vacío -> Jugador', cleanName('   ') === 'Jugador' && cleanName(null) === 'Jugador' && cleanName(42) === 'Jugador');
  check('quita caracteres de control y espacios dobles', cleanName('A\u0000na\n  B') === 'Ana B', cleanName('A\u0000na\n  B'));
  check('conserva acentos y emojis', cleanName('José 😀') === 'José 😀');
  check('el texto con etiquetas se guarda tal cual (el cliente lo muestra como texto)', cleanName('<b>x</b>') === '<b>x</b>');
}

console.log('Jugadas');
{
  const env = makeEnv();
  const { a, b } = startGame(env);
  a.clear(); b.clear();
  play(env, b, 'e7e5');
  check('negras no pueden mover primero', b.last('state') && !b.last('move') && !a.last('move'));
  a.clear(); b.clear();
  play(env, a, 'e2e5');
  check('jugada ilegal rechazada y el cliente se resincroniza', a.last('state') && a.last('state').moves.length === 0 && !b.last('move'));
  play(env, a, 'basura');
  check('formato inválido ignorado', a.last('state') && a.last('state').moves.length === 0);
  a.clear(); b.clear();
  play(env, a, 'e2e4');
  check('jugada legal llega a los dos', a.last('move').uci === 'e2e4' && b.last('move').uci === 'e2e4' && b.last('move').ply === 1);
  play(env, b, 'e7e5');
  check('respuesta de las negras', a.last('move').ply === 2);
  play(env, a, 'g1f3');
  env.mgr.handle(b, { t: 'resume', code: 'SALA01', token: 'x' });
  check('un token falso no sirve para reconectarse', b.last('error') && b.last('error').code === 'no-room');
}

console.log('Jaque mate y tablas por reglas');
{
  const env = makeEnv();
  const { a, b } = startGame(env);
  for (const [c, m] of [[a, 'f2f3'], [b, 'e7e5'], [a, 'g2g4'], [b, 'd8h4']]) play(env, c, m);
  const o = a.last('over');
  check('mate del tonto: gana negras por jaque mate', o && o.over.reason === 'checkmate' && o.over.winner === 1 && o.over.result === '0-1', o);
  play(env, a, 'a2a3');
  check('no se puede jugar después del fin', a.last('error') && a.last('error').code === 'not-playing');
  check('la foto de estado queda como terminada', (env.mgr.handle(a, { t: 'resume', code: 'SALA01', token: a.last('created').token }), a.last('state').status === 'over'));
}

console.log('Reloj en el servidor');
{
  const env = makeEnv();
  const { a, b } = startGame(env, { time: '3+2' });
  env.advance(30000);
  play(env, a, 'e2e4');
  check('la primera jugada de cada bando no gasta tiempo', JSON.stringify(a.last('move').rem) === '[180000,180000]', a.last('move').rem);
  env.advance(20000);
  play(env, b, 'e7e5');
  check('tampoco la respuesta de las negras', JSON.stringify(b.last('move').rem) === '[180000,180000]', b.last('move').rem);
  env.advance(10000);
  play(env, a, 'g1f3');
  check('desde la jugada 3 el reloj corre y suma el incremento (+2 s)', JSON.stringify(a.last('move').rem) === '[172000,180000]', a.last('move').rem);
  env.advance(7000);
  play(env, b, 'b8c6');
  check('el reloj de negras también descuenta e incrementa', JSON.stringify(b.last('move').rem) === '[172000,175000]', b.last('move').rem);

  // el tiempo se agota: lo decide el servidor
  env.advance(171000);
  check('con 1 s restante aún no hay fin', !a.last('over'));
  env.advance(2000);
  const o = a.last('over'), ob = b.last('over');
  check('se acaba el tiempo de las blancas: ganan negras', o && o.over.reason === 'timeout' && o.over.winner === 1 && ob && ob.over.winner === 1, o && o.over);
  check('el reloj del perdedor queda en 0', o.rem[0] === 0, o.rem);
}
{
  const env = makeEnv();
  const { a, b } = startGame(env, { time: '3+2' });
  play(env, a, 'e2e4'); play(env, b, 'e7e5');
  env.advance(179000);
  env.advance(900);
  check('1.9 s antes de agotarse, aún no termina', !a.last('over'));
  // la jugada llega justo cuando ya se acabó el tiempo, pero antes de que dispare el temporizador
  env.advance(200);
  check('si se agota el tiempo, el servidor lo detecta solo', a.last('over') && a.last('over').over.reason === 'timeout' && a.last('over').over.winner === 1);
}
{
  const env = makeEnv();
  const { a, b } = startGame(env, { time: 'none' });
  play(env, a, 'e2e4'); play(env, b, 'e7e5');
  env.advance(10 * 3600 * 1000);
  check('sin reloj nunca se acaba el tiempo', !a.last('over'));
}

console.log('Rendición y tablas');
{
  const env = makeEnv();
  const { a, b } = startGame(env);
  env.mgr.handle(b, { t: 'resign' });
  check('rendirse da la victoria al rival', a.last('over').over.reason === 'resign' && a.last('over').over.winner === 0 && b.last('over').over.result === '1-0');
}
{
  const env = makeEnv();
  const { a, b } = startGame(env);
  env.mgr.handle(a, { t: 'draw' });
  check('la oferta de tablas llega solo al rival', b.last('draw-offer') && !a.last('draw-offer'));
  env.mgr.handle(a, { t: 'draw-accept' });
  check('no puedes aceptar tu propia oferta', !a.last('over'));
  env.mgr.handle(b, { t: 'draw-accept' });
  check('aceptar la oferta termina en tablas por acuerdo', a.last('over').over.reason === 'agreement' && a.last('over').over.winner === null && a.last('over').over.result === '1/2-1/2');
}
{
  const env = makeEnv();
  const { a, b } = startGame(env);
  env.mgr.handle(a, { t: 'draw' });
  env.mgr.handle(b, { t: 'draw-decline' });
  check('rechazar avisa a quien ofreció', a.last('draw-declined') && !a.last('over'));
  env.mgr.handle(b, { t: 'draw-accept' });
  check('una oferta rechazada ya no se puede aceptar', !a.last('over'));
  env.mgr.handle(b, { t: 'draw' });
  env.mgr.handle(a, { t: 'draw' });
  check('si los dos ofrecen tablas, se aceptan', a.last('over') && a.last('over').over.reason === 'agreement');
}
{
  const env = makeEnv();
  const { a, b } = startGame(env);
  env.mgr.handle(a, { t: 'draw' });
  play(env, a, 'e2e4'); play(env, b, 'e7e5');
  env.mgr.handle(b, { t: 'draw-accept' });
  check('hacer una jugada cancela la oferta pendiente', !a.last('over'));
}

console.log('Revancha');
{
  const env = makeEnv();
  const { a, b } = startGame(env, { time: '5+0' });
  env.mgr.handle(a, { t: 'rematch' });
  check('no hay revancha mientras se juega', !b.last('rematch-offer'));
  env.mgr.handle(b, { t: 'resign' });
  a.clear(); b.clear();
  env.mgr.handle(a, { t: 'rematch' });
  check('pedir revancha avisa al rival', b.last('rematch-offer') && !b.last('state'));
  env.mgr.handle(b, { t: 'rematch' });
  const sa = a.last('state'), sb = b.last('state');
  check('al aceptar, empieza otra partida con colores invertidos', sa.status === 'playing' && sa.you === 1 && sb.you === 0 && sa.moves.length === 0, [sa.you, sb.you]);
  check('el reloj vuelve a empezar completo', JSON.stringify(sa.rem) === '[300000,300000]');
  check('los nombres siguen a sus jugadores', JSON.stringify(sa.names) === '["Beto","Ana"]', sa.names);
  play(env, b, 'e2e4');
  check('ahora b (blancas) puede mover', a.last('move') && a.last('move').uci === 'e2e4');
}

console.log('Desconexión y reconexión');
{
  const env = makeEnv();
  const { a, b } = startGame(env);
  const tokenA = a.last('created').token;
  a.clear(); b.clear();
  env.mgr.onClose(b);
  check('el rival ve que te desconectaste', a.last('presence') && a.last('presence').oppOnline === false);
  env.advance(30000);
  check('dentro del plazo no pasa nada', !a.last('over'));
  const b2 = makeConn('B2');
  env.mgr.handle(b2, { t: 'resume', code: 'SALA01', token: 'token-inventado' });
  check('con token falso no se puede entrar', b2.last('error') && b2.last('error').code === 'no-room' && !b2.last('state'));
  check('y el rival sigue viéndote desconectado', !a.last('presence') || a.last('presence').oppOnline === false);
}
{
  const env = makeEnv();
  const a = makeConn('A'), b = makeConn('B');
  env.mgr.handle(a, { t: 'create', name: 'Ana', color: 'white', time: 'none' });
  env.mgr.handle(b, { t: 'join', code: a.last('created').code, name: 'Beto' });
  const tokenB = b.last('joined').token;
  play(env, a, 'e2e4'); play(env, b, 'e7e5');
  a.clear();
  env.mgr.onClose(b);
  env.advance(60000);
  const b2 = makeConn('B2');
  env.mgr.handle(b2, { t: 'resume', code: 'SALA01', token: tokenB });
  const st = b2.last('state');
  check('al volver recibe la partida completa tal como estaba', st && st.status === 'playing' && st.moves.join() === 'e2e4,e7e5' && st.you === 1, st && st.moves);
  check('el rival ve que volvió', a.last('presence') && a.last('presence').oppOnline === true);
  env.advance(200000);
  check('ya no hay abandono porque volvió', !a.last('over'));
  play(env, a, 'g1f3');
  play(env, b2, 'g8f6');
  check('desde la conexión nueva puede jugar', a.last('move') && a.last('move').uci === 'g8f6' && a.last('move').ply === 4, a.last('move'));
}
{
  const env = makeEnv();
  const { a, b } = startGame(env);
  a.clear();
  env.mgr.onClose(b);
  env.advance(89000);
  check('a los 89 s todavía se espera', !a.last('over'));
  env.advance(2000);
  const o = a.last('over');
  check('a los 90 s sin volver, gana por abandono', o && o.over.reason === 'abandon' && o.over.winner === 0, o);
}
{
  const env = makeEnv();
  const a = makeConn('A'), b = makeConn('B');
  env.mgr.handle(a, { t: 'create', name: 'Ana', color: 'white', time: 'none' });
  env.mgr.handle(b, { t: 'join', code: a.last('created').code, name: 'Beto' });
  const old = b;
  const b2 = makeConn('B2');
  env.mgr.handle(b2, { t: 'resume', code: 'SALA01', token: b.last('joined').token });
  check('una conexión nueva reemplaza a la anterior', old.closed === true && b2.last('state').you === 1);
  env.mgr.onClose(old);
  check('cerrar la conexión vieja no desconecta a la nueva', !a.last('presence') || a.last('presence').oppOnline !== false);
}

console.log('Salir y limpieza');
{
  const env = makeEnv();
  const { a, b } = startGame(env);
  env.mgr.handle(b, { t: 'leave' });
  check('salir en plena partida cuenta como rendición', a.last('over').over.reason === 'resign' && a.last('over').over.winner === 0);
  check('quien salió ya no puede volver con su token', (() => { const x = makeConn('x'); env.mgr.handle(x, { t: 'resume', code: 'SALA01', token: b.last('joined').token }); return !!x.last('error'); })());
}
{
  const env = makeEnv();
  const a = makeConn('A');
  env.mgr.handle(a, { t: 'create', name: 'Ana', color: 'white', time: 'none' });
  env.mgr.handle(a, { t: 'leave' });
  const b = makeConn('B');
  env.mgr.handle(b, { t: 'join', code: 'SALA01', name: 'Beto' });
  check('si el creador sale antes de que llegue alguien, la sala desaparece', b.last('error') && b.last('error').code === 'no-room');
}
{
  const env = makeEnv();
  const a = makeConn('A');
  env.mgr.handle(a, { t: 'create', name: 'Ana', color: 'white', time: 'none' });
  env.advance(16 * 60 * 1000);
  env.mgr.sweep();
  check('una sala en espera se borra tras 15 min sin actividad', env.mgr.rooms.size === 0);
  const env2 = makeEnv({ maxRooms: 2 });
  const c1 = makeConn('1'), c2 = makeConn('2'), c3 = makeConn('3');
  for (const c of [c1, c2, c3]) env2.mgr.handle(c, { t: 'create', name: 'x', color: 'white', time: 'none' });
  check('hay un tope de salas', c3.last('error') && c3.last('error').code === 'busy' && env2.mgr.rooms.size === 2);
  env.mgr.handle(a, { t: 'move', uci: 'e2e4' });
  check('mensaje sin sala no rompe nada', a.last('error'));
  env.mgr.handle(a, { t: 'inventado' });
  env.mgr.handle(a, null);
  env.mgr.handle(a, { t: 5 });
  check('mensajes inválidos reciben error', a.all('error').length >= 3);
}

console.log(`\n${total - failures}/${total} pruebas correctas`);
process.exit(failures ? 1 : 0);
