// Realtime fan-out, kept free of Cloudflare imports so the tests can drive it with fake sockets.
// Every identified socket (players, watchers, the table screen) gets its own view; when the action ended
// the game, each of them also gets the one `gameover` event, so everyone pops the victory card at once.
import { viewForPlayer, viewForScreen, gameOverEvent } from '../public/js/room.js';

export function fanout(room, sockets, connected, wasOver = false) {
  const ending = !wasOver && room.phase === 'over';
  for (const { ws, att } of sockets) {
    if (!att?.who) continue;
    const screen = att.who === 'screen';
    const view = screen ? viewForScreen(room, connected) : viewForPlayer(room, att.playerId, connected);
    try {
      ws.send(JSON.stringify({ type: 'view', view }));
      if (ending) ws.send(JSON.stringify(gameOverEvent(room, screen ? null : att.playerId)));
    } catch { /* socket gone */ }
  }
}
