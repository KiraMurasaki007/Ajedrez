// Genera dist/ajedrez.html: toda la aplicación (HTML, CSS, JS y el hilo de la IA) en un solo archivo.
// Uso: node tools/build.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');
const css = read('css/styles.css');
const chess = read('js/chess.js'), ai = read('js/ai.js'), app = read('js/app.js');
const net = read('js/net.js'), config = read('js/config.js');
const workerMain = read('js/worker.js').replace(/importScripts\([^)]*\);?/, '');
const esc = s => s.replace(/<\/script/gi, '<\\/script');

html = html.replace('<link rel="stylesheet" href="css/styles.css">', '<style>\n' + css + '\n</style>');
html = html.replace(
  /<script src="js\/config\.js"><\/script>\s*<script src="js\/chess\.js"><\/script>\s*<script src="js\/ai\.js"><\/script>\s*<script src="js\/net\.js"><\/script>\s*<script src="js\/app\.js"><\/script>/,
  () => '<script id="worker-src" type="text/plain">\n' + esc(chess) + '\n' + esc(ai) + '\n' + esc(workerMain) + '\n</script>\n' +
        '<script>\n' + esc(config) + '\n' + esc(chess) + '\n' + esc(ai) + '\n' + esc(net) + '\n' + esc(app) + '\n</script>'
);
if (html.indexOf('src="js/') >= 0) { console.error('El empaquetado dejó scripts sin incluir.'); process.exit(1); }
fs.writeFileSync(path.join(root, 'dist', 'ajedrez.html'), html);
console.log('dist/ajedrez.html', (Buffer.byteLength(html) / 1024).toFixed(0) + ' KB');
