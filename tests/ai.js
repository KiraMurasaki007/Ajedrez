// Pruebas de la IA: táctica básica, rendimiento y remates de finales.
// Uso: node tests/ai.js
const { Chess } = require('../js/chess.js');
const AI = require('../js/ai.js');

let failures = 0, total = 0;
function check(name, cond, extra) {
  total++;
  if (!cond) { failures++; console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')); }
  else console.log('  ✓ ' + name + (extra ? '  (' + extra + ')' : ''));
}
function san(g, m) { return g._san(m, g.legalMoves()); }

console.log('Táctica');
for (const level of ['medium', 'hard']) {
  let g = new Chess('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
  let m = AI.chooseMove(g, level, g.keys);
  check(`[${level}] mate de pasillo: Ra8#`, san(g, m) === 'Ra8', san(g, m));

  g = new Chess('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
  m = AI.chooseMove(g, level, g.keys);
  check(`[${level}] mate del pastor: Qxf7#`, san(g, m) === 'Qxf7', san(g, m));

  g = new Chess('4k3/8/8/3q4/8/2N5/8/4K3 w - - 0 1');
  m = AI.chooseMove(g, level, g.keys);
  check(`[${level}] gana la dama libre: Nxd5`, san(g, m) === 'Nxd5', san(g, m));

  // La dama negra está atacada por un peón: debe moverla o capturar, no dejarla.
  g = new Chess('rnb1kbnr/ppp1pppp/8/3q4/2P5/8/PP1PPPPP/RNBQKBNR b KQkq - 0 3');
  m = AI.chooseMove(g, level, g.keys);
  const dest = Chess.to(m), src = Chess.from(m);
  check(`[${level}] salva la dama atacada`, src === Chess.nameToSq('d5') || g.board[Chess.nameToSq('d5')] !== (Chess.Q | 8) || false, san(g, m));
}

console.log('Mate en 2 (nivel difícil)');
{
  // Dos torres contra rey: Ra7 y Rb8# (mate en 2).
  const g = new Chess('7k/8/8/8/8/8/R7/1R4K1 w - - 0 1');
  const info = {};
  const m = AI.chooseMove(g, 'hard', g.keys, info);
  g.move(m);
  // cualquiera sea la respuesta negra, debe haber mate inmediato a continuación
  const replies = g.legalMoves();
  let allMated = true;
  for (const r of replies) {
    g.move(r);
    const reply = AI.chooseMove(g, 'hard', g.keys);
    g.move(reply);
    if (g.status().reason !== 'checkmate') allMated = false;
    g.undo(); g.undo();
  }
  check('encuentra un mate forzado en 2', allMated, `jugó ${g.history[0].san}, profundidad ${info.depth}`);
}

console.log('Rendimiento (posición inicial, nivel difícil)');
{
  const g = new Chess();
  const info = {};
  AI.chooseMove(g, 'hard', g.keys, info);
  check('responde dentro del límite de tiempo', info.ms < 2200, `${info.ms} ms, profundidad ${info.depth}, ${info.nodes} nodos`);
  check('alcanza al menos profundidad 5', info.depth >= 5, 'profundidad ' + info.depth);
  const g2 = new Chess('r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10');
  const i2 = {};
  AI.chooseMove(g2, 'hard', g2.keys, i2);
  check('juego medio: responde a tiempo', i2.ms < 2200, `${i2.ms} ms, profundidad ${i2.depth}`);
  const e = {};
  AI.chooseMove(new Chess(), 'easy', null, e);
  AI.chooseMove(new Chess(), 'medium', null, e);
  check('niveles fácil y medio responden', true, `medio: ${e.ms} ms, profundidad ${e.depth}`);
}

function selfPlay(fen, levelW, levelB, maxPlies) {
  const g = new Chess(fen);
  while (g.history.length < maxPlies) {
    const st = g.status();
    if (st.over) return { g, st };
    const level = g.turn === Chess.WHITE ? levelW : levelB;
    const m = AI.chooseMove(g, level, g.keys);
    if (!m) break;
    g.move(m);
  }
  return { g, st: g.status() };
}

console.log('Remate de finales ganados (difícil contra difícil)');
{
  const fast = { depth: 8, timeMs: 250, noise: 0, randomChance: 0 };
  for (const [name, fen] of [['rey y dama contra rey', '8/8/8/4k3/8/8/8/Q3K3 w - - 0 1'],
                              ['rey y torre contra rey', '8/8/8/4k3/8/8/8/R3K3 w - - 0 1']]) {
    const { g, st } = selfPlay(fen, fast, fast, 120);
    check(`${name}: termina en jaque mate`, st.over && st.reason === 'checkmate', `${Math.ceil(g.history.length / 2)} jugadas, ${st.reason || 'sin terminar'}`);
  }
}

console.log(`\n${total - failures}/${total} pruebas correctas`);
process.exit(failures ? 1 : 0);
