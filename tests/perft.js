// Prueba de movimientos: cuenta todas las jugadas posibles ("perft") en posiciones
// de referencia conocidas y las compara con los valores oficiales publicados.
// Uso: node tests/perft.js
const { Chess } = require('../js/chess.js');

const POSITIONS = [
  { name: 'Posición inicial', fen: Chess.START_FEN, counts: [20, 400, 8902, 197281, 4865609] },
  { name: 'Kiwipete (enroques, capturas, jaques)', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', counts: [48, 2039, 97862, 4085603] },
  { name: 'Finales con captura al paso', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', counts: [14, 191, 2812, 43238, 674624] },
  { name: 'Promociones y enroques', fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', counts: [6, 264, 9467, 422333] },
  { name: 'Promoción con jaque', fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', counts: [44, 1486, 62379, 2103487] },
  { name: 'Posición de juego medio', fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', counts: [46, 2079, 89890, 3894594] },
];

let failed = 0;
for (const pos of POSITIONS) {
  const g = new Chess(pos.fen);
  const t0 = Date.now();
  const results = [];
  for (let d = 1; d <= pos.counts.length; d++) {
    const got = g.perft(d);
    const ok = got === pos.counts[d - 1];
    if (!ok) failed++;
    results.push(`d${d}=${got}${ok ? '' : ' (esperado ' + pos.counts[d - 1] + ')'}`);
  }
  const same = g.fen() === new Chess(pos.fen).fen();
  if (!same) { failed++; results.push('¡el tablero cambió tras la búsqueda!'); }
  console.log(`${failed ? '' : ''}${pos.name}: ${results.join('  ')}  [${Date.now() - t0} ms]`);
}
console.log(failed ? `\nFALLÓ: ${failed} diferencias` : '\nTodas las cuentas coinciden con los valores de referencia.');
process.exit(failed ? 1 : 0);
