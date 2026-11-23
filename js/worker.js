/* Hilo de trabajo: la IA piensa aquí para no congelar la interfaz. */
importScripts('chess.js', 'ai.js');

self.onmessage = function (e) {
  var req = e.data;
  var move = 0;
  try {
    var game = new Chess(req.fen);
    move = ChessAI.chooseMove(game, req.level, req.keys);
  } catch (err) {
    move = 0;
  }
  self.postMessage({ id: req.id, move: move });
};
