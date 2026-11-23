/*!
 * net.js — Conexión WebSocket con el servidor del juego (modo en línea).
 *
 * - Se conecta a ws(s)://<mismo host>/ws, o a window.AJEDREZ_WS_URL si la página está
 *   publicada en un sitio y el servidor en otro.
 * - Si se cae la conexión, reintenta sola (1 s, 2 s, 4 s... hasta 5 s) mientras se necesite.
 *
 * API:  Net.available()  Net.open()  Net.send(obj)  Net.close()
 *       Net.on('open' | 'close' | 'message', fn)
 */
(function (root) {
  'use strict';

  var ws = null, wanted = false, tries = 0, timer = null, handlers = {};

  function emit(ev, arg) { if (handlers[ev]) handlers[ev](arg); }

  function url() {
    if (root.AJEDREZ_WS_URL) return root.AJEDREZ_WS_URL;
    var loc = root.location;
    if (!loc || loc.protocol === 'file:' || !loc.host) return null;
    return (loc.protocol === 'https:' ? 'wss://' : 'ws://') + loc.host + '/ws';
  }

  function connect() {
    timer = null;
    var u = url();
    if (!u || typeof WebSocket === 'undefined') return;
    var sock;
    try { sock = new WebSocket(u); } catch (e) { retry(); return; }
    ws = sock;
    sock.onopen = function () { if (ws !== sock) return; tries = 0; emit('open'); };
    sock.onmessage = function (e) {
      if (ws !== sock) return;
      var msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      emit('message', msg);
    };
    sock.onclose = function () {
      if (ws !== sock) return;
      ws = null;
      emit('close');
      if (wanted) retry();
    };
    sock.onerror = function () { /* el cierre se maneja en onclose */ };
  }

  function retry() {
    if (!wanted || timer) return;
    var wait = Math.min(5000, 1000 * Math.pow(2, Math.min(tries, 3)));
    tries++;
    timer = setTimeout(connect, wait);
  }

  var Net = {
    available: function () { return !!url() && typeof WebSocket !== 'undefined'; },
    isOpen: function () { return !!ws && ws.readyState === 1; },
    open: function () {
      wanted = true;
      if (ws && (ws.readyState === 0 || ws.readyState === 1)) { if (ws.readyState === 1) emit('open'); return; }
      clearTimeout(timer); timer = null;
      connect();
    },
    send: function (obj) {
      if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
      return false;
    },
    close: function () {
      wanted = false;
      clearTimeout(timer); timer = null;
      var s = ws; ws = null;
      if (s) { try { s.close(1000); } catch (e) { /* ya cerrado */ } }
    },
    on: function (ev, fn) { handlers[ev] = fn; }
  };

  root.Net = Net;
})(window);
