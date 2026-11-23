// Torneo corto entre niveles de la IA. Uso: node tests/match.js
const { Chess } = require('../js/chess.js');
const AI = require('../js/ai.js');
const cfg = {
  easy: AI.LEVELS.easy,
  medium: AI.LEVELS.medium,
  hard: Object.assign({}, AI.LEVELS.hard, { timeMs: 300 }),   // más rápido para la prueba
};
function game(w, b) {
  const g = new Chess();
  while (g.history.length < 200) {
    const st = g.status();
    if (st.over) return st.winner === null ? 0.5 : (st.winner === Chess.WHITE ? 1 : 0);
    const m = AI.chooseMove(g, g.turn === Chess.WHITE ? cfg[w] : cfg[b], g.keys);
    if (!m) break;
    g.move(m);
  }
  return 0.5;
}
function match(strong, weak, n) {
  let pts = 0, line = [];
  for (let i = 0; i < n; i++) {
    const r = i % 2 === 0 ? game(strong, weak) : 1 - game(weak, strong);
    pts += r; line.push(r === 1 ? 'G' : r === 0 ? 'P' : 'T');
  }
  console.log(`${strong} vs ${weak}: ${pts}/${n}  [${line.join(' ')}]`);
}
match('medium', 'easy', 8);
match('hard', 'medium', 8);
console.log('fin');
