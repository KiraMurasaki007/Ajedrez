# Ajedrez web

Juego de ajedrez completo en HTML, CSS y JavaScript, sin librerías externas.

## Cómo abrirlo

- **Con modo en línea (recomendado):** instala Node.js 18 o más nuevo y, en la carpeta del proyecto, ejecuta `npm start`. Abre http://localhost:3000. No hay que instalar paquetes: el servidor no usa dependencias.
- **Solo contra la computadora o 2 jugadores:** abre `dist/ajedrez.html` con doble clic (un solo archivo). Desde un archivo local el modo en línea no está disponible y el juego lo avisa.
- **Publicarlo solo sin modo en línea:** sube `dist/ajedrez.html` a un hosting estático (Netlify, Vercel, GitHub Pages).

## Qué incluye

- Tablero 8x8 con movimientos oficiales de todas las piezas.
- Jaque, jaque mate y tablas: ahogado, material insuficiente, regla de 50 movimientos y triple repetición.
- Enroque, promoción de peones (con selector) y captura al paso.
- Computadora con 3 niveles: fácil, medio y difícil.
- Modo de dos jugadores en el mismo dispositivo.
- Reloj con incremento (3+2, 5, 10, 15+10 y 30 minutos) y derrota por tiempo.
- Historial de jugadas en notación española (C, A, T, D, R). Se puede revisar cualquier posición con clic o con las flechas del teclado.
- Reinicio, nueva partida, deshacer, girar el tablero y rendirse.
- Selección de colores del tablero: 6 temas y colores personalizados (se recuerdan).
- Piezas capturadas y ventaja de material, resaltado de la última jugada, jugadas legales y rey en jaque.
- Mover con clic o arrastrando, con animaciones. Funciona con mouse y con pantalla táctil.
- **Modo en línea:** una persona crea una sala, comparte el enlace o el código de 6 letras y la otra se une. Nombre de jugador, relojes sincronizados por el servidor, ofrecer/aceptar/rechazar tablas, rendirse, revancha con colores intercambiados y reconexión automática (90 s de margen si alguien pierde la conexión o recarga la página).
- Diseño adaptable a celular, tableta y computadora. Sonidos opcionales.

## Estructura

```
index.html            página principal
css/styles.css        estilos
js/chess.js           motor de reglas (sin interfaz)
js/ai.js              inteligencia artificial
js/worker.js          hilo de trabajo para que la interfaz no se congele
js/app.js             interfaz: tablero, reloj, historial, diálogos, modo en línea
js/net.js             conexión WebSocket del navegador (reconexión automática)
js/config.js          dirección del servidor, solo si va en otro sitio
server/server.js      servidor HTTP + WebSocket (sin dependencias)
server/rooms.js       salas, turnos, relojes, tablas, revancha (lógica del servidor)
server/ws.js          protocolo WebSocket escrito a mano
tests/                pruebas automáticas
tools/build.js        genera dist/ajedrez.html
dist/ajedrez.html     versión de un solo archivo
```

## Pruebas

Requieren Node.js, solo para desarrollo:

```
node tests/rules.js    37 pruebas de reglas
node tests/perft.js    cuenta de jugadas contra valores oficiales de referencia
node tests/ai.js       táctica, mates y rendimiento de la IA
node tests/rooms.js    68 pruebas de la lógica de salas (con reloj simulado)
node tests/server.js   38 pruebas de red reales contra el servidor
npm test               corre las pruebas de reglas, perft, IA, salas y servidor
node tests/match.js    torneo corto entre los niveles
node tools/build.js    regenera dist/ajedrez.html tras cambiar el código
```

## Niveles de la computadora

| Nivel | Cómo juega |
|---|---|
| Fácil | Mira una jugada adelante, con errores intencionales. |
| Medio | Calcula 3 jugadas adelante, casi no regala piezas. |
| Difícil | Búsqueda profunda con límite de 1.5 segundos por jugada. |

En un torneo de prueba, el nivel medio ganó 8 de 8 partidas al fácil, y el difícil sacó 7.5 de 8 contra el medio.

## Publicar el modo en línea

El servidor sirve también la página, así que basta un solo servicio que ejecute `npm start`:

1. Sube la carpeta a un repositorio de GitHub.
2. En Render, Railway, Fly.io o similar crea un servicio web de Node con comando de inicio `npm start`. El puerto lo toma de la variable `PORT`.
3. Abre la URL pública: el juego se conecta solo (usa `wss://` si la página es https).

Notas:
- Los planes gratuitos suelen "dormir" el servicio tras un rato sin uso; la primera conexión puede tardar unos segundos. Las salas viven en memoria: si el servicio se reinicia, las partidas en curso se pierden.
- Si la página está en un hosting estático y el servidor en otro, edita `js/config.js` con `window.AJEDREZ_WS_URL = 'wss://tu-servidor/ws';` y define en el servidor `ALLOWED_ORIGINS=https://tu-pagina.com` (varios separados por coma). Después ejecuta `node tools/build.js`.
- `GET /healthz` responde `ok` para monitoreo.
- Protecciones incluidas: límite de mensajes por segundo, tamaño máximo de mensaje, validación de todas las jugadas en el servidor (el navegador no puede hacer trampa), códigos de sala sin caracteres confusos y cabeceras de seguridad (CSP).
