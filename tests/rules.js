// Pruebas de reglas: jaque mate, ahogado, tablas, notación, enroque, captura al paso, promoción.
// Uso: node tests/rules.js
const { Chess } = require('../js/chess.js');

let failures = 0, total = 0;
function check(name, cond, extra) {
  total++;
  if (!cond) { failures++; console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')); }
  else console.log('  ✓ ' + name);
}
function play(g, sans) {
  // Juega una lista de movimientos en notación SAN buscando entre los legales.
  for (const san of sans) {
    const legal = g.legalMoves();
    let found = 0;
    for (const m of legal) {
      const s = g._san(m, legal).replace(/[+#]$/, '');
      if (s === san.replace(/[+#]$/, '')) { found = m; break; }
    }
    if (!found) throw new Error('Movimiento no encontrado: ' + san + ' en ' + g.fen());
    g.move(found);
  }
}

console.log('Jaque mate');
{
  const g = new Chess();
  play(g, ['f3', 'e5', 'g4', 'Qh4#']);
  const st = g.status();
  check('mate del tonto detectado', st.over && st.reason === 'checkmate' && st.winner === Chess.BLACK && st.result === '0-1');
  check('SAN de mate termina en #', g.history[g.history.length - 1].san === 'Qh4#');
}
{
  const g = new Chess();
  play(g, ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']);
  const st = g.status();
  check('mate del pastor detectado', st.over && st.reason === 'checkmate' && st.winner === Chess.WHITE);
}

console.log('Ahogado y tablas');
{
  const g = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  const st = g.status();
  check('ahogado detectado', st.over && st.reason === 'stalemate' && st.result === '1/2-1/2');
}
check('rey y alfil contra rey: material insuficiente', new Chess('8/8/8/4k3/8/8/3K4/6B1 w - - 0 1').status().reason === 'insufficient');
check('rey y caballo contra rey: material insuficiente', new Chess('8/8/8/4k3/8/8/3K4/6N1 w - - 0 1').status().reason === 'insufficient');
check('alfiles del mismo color: material insuficiente', new Chess('8/8/8/4kb2/8/8/3KB3/8 w - - 0 1').status().reason === 'insufficient');
check('alfiles de distinto color: NO es material insuficiente', !new Chess('8/8/8/4k1b1/8/8/3KB3/8 w - - 0 1').status().over);
check('rey y torre contra rey: la partida sigue', !new Chess('8/8/8/4k3/8/8/3K4/R7 w - - 0 1').status().over);
check('regla de 50 movimientos', new Chess('8/8/8/4k3/8/8/3K4/R7 w - - 100 80').status().reason === 'fifty');
check('99 medios movimientos: aún no hay tablas', !new Chess('8/8/8/4k3/8/8/3K4/R7 w - - 99 80').status().over);
{
  const g = new Chess();
  play(g, ['Nf3', 'Nf6', 'Ng1', 'Ng8']);
  check('dos apariciones: la partida sigue', !g.status().over);
  play(g, ['Nf3', 'Nf6', 'Ng1', 'Ng8']);
  const st = g.status();
  check('triple repetición', st.over && st.reason === 'repetition');
}

console.log('Enroque');
{
  const g = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const names = g.legalMoves().map(m => g._san(m, g.legalMoves()));
  check('enroque corto y largo disponibles', names.includes('O-O') && names.includes('O-O-O'));
  play(g, ['O-O']);
  check('rey en g1 y torre en f1', g.board[Chess.nameToSq('g1')] === Chess.K && g.board[Chess.nameToSq('f1')] === Chess.R && g.board[Chess.nameToSq('h1')] === 0);
  check('se pierden los derechos de las blancas', g.fen().split(' ')[2] === 'kq');
  play(g, ['O-O-O']);
  check('enroque largo negro: rey en c8, torre en d8', g.board[Chess.nameToSq('c8')] === (Chess.K | 8) && g.board[Chess.nameToSq('d8')] === (Chess.R | 8) && g.board[Chess.nameToSq('a8')] === 0);
  g.undo(); g.undo();
  check('deshacer restaura el enroque', g.fen() === 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', g.fen());
}
{
  // No se puede enrocar estando en jaque ni pasando por una casilla atacada.
  const enJaque = new Chess('4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  const l1 = enJaque.legalMoves().map(m => enJaque._san(m, enJaque.legalMoves()));
  check('sin enroque estando en jaque', !l1.includes('O-O') && !l1.includes('O-O-O'));
  const atacada = new Chess('5rk1/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  const l2 = atacada.legalMoves().map(m => atacada._san(m, atacada.legalMoves()));
  check('sin enroque corto pasando por casilla atacada', !l2.includes('O-O') && l2.includes('O-O-O'));
}

console.log('Captura al paso');
{
  const g = new Chess();
  play(g, ['e4', 'a6', 'e5', 'd5']);
  const legalSan = g.legalMoves().map(m => g._san(m, g.legalMoves()));
  check('exd6 es legal justo después de d7-d5', legalSan.includes('exd6'));
  play(g, ['exd6']);
  check('el peón negro de d5 desaparece', g.board[Chess.nameToSq('d5')] === 0 && g.board[Chess.nameToSq('d6')] === Chess.P);
  g.undo();
  check('deshacer devuelve el peón capturado', g.board[Chess.nameToSq('d5')] === (Chess.P | 8) && g.board[Chess.nameToSq('e5')] === Chess.P);
  // el derecho se pierde si no se usa de inmediato
  const h = new Chess();
  play(h, ['e4', 'a6', 'e5', 'd5', 'Nf3', 'a5']);
  check('la captura al paso caduca', !h.legalMoves().map(m => h._san(m, h.legalMoves())).includes('exd6'));
}

console.log('Promoción');
{
  const g = new Chess('8/P7/8/8/8/8/8/k6K w - - 0 1');
  const promos = g.legalMoves().filter(m => Chess.promo(m));
  check('cuatro promociones posibles', promos.length === 4);
  const m = g.moveFromTo(Chess.nameToSq('a7'), Chess.nameToSq('a8'), Chess.Q);
  const rec = g.move(m);
  check('SAN de promoción con jaque: a8=Q+', rec.san === 'a8=Q+', rec.san);
  check('aparece una dama blanca en a8', g.board[Chess.nameToSq('a8')] === Chess.Q);
  g.undo();
  check('deshacer devuelve el peón', g.board[Chess.nameToSq('a7')] === Chess.P && g.board[Chess.nameToSq('a8')] === 0);
  const under = new Chess('8/P7/8/8/8/8/8/k6K w - - 0 1');
  const r2 = under.move(under.moveFromTo(Chess.nameToSq('a7'), Chess.nameToSq('a8'), Chess.N));
  check('subpromoción a caballo', r2.san === 'a8=N' && under.board[Chess.nameToSq('a8')] === Chess.N, r2.san);
}

console.log('Notación y utilidades');
{
  const g = new Chess('4k3/8/8/8/8/8/4K3/R6R w - - 0 1');
  const legal = g.legalMoves();
  const san = legal.map(m => g._san(m, legal));
  check('desambiguación de torres: Rad1 / Rhd1', san.includes('Rad1') && san.includes('Rhd1') && !san.includes('Rd1'), san.filter(s => /d1/.test(s)).join(','));
  const g2 = new Chess('4k3/8/8/8/R7/8/8/R3K3 w - - 0 1');
  const l2 = g2.legalMoves();
  check('desambiguación por fila: R4a2 / R1a2', l2.map(m => g2._san(m, l2)).includes('R4a2') && l2.map(m => g2._san(m, l2)).includes('R1a2'));
  const h = new Chess();
  const e4 = h.moveFromUci('e2e4');
  check('UCI ida y vuelta', h.moveToUci(e4) === 'e2e4');
  h.move(e4);
  check('FEN tras 1.e4', h.fen() === 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', h.fen());
  check('movimiento ilegal rechazado', h.move(Chess.START_FEN ? 12345 : 0) === null);
  const clone = h.clone();
  clone.makeMove(clone.legalMoves()[0]);
  check('clone no afecta al original', h.fen().startsWith('rnbqkbnr/pppppppp/8/8/4P3'));
  check('canMate: rey solo no puede mate', !new Chess('8/8/8/4k3/8/8/3K4/8 w - - 0 1').canMate(Chess.WHITE));
  check('canMate: torre sí puede', new Chess('8/8/8/4k3/8/8/3K4/R7 w - - 0 1').canMate(Chess.WHITE));
}

console.log(`\n${total - failures}/${total} pruebas correctas`);
process.exit(failures ? 1 : 0);
