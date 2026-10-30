// Realtime fan-out, kept free of Cloudflare imports so the tests can drive it with fake sockets.
// Every identified socket (players, watchers, the table screen) gets its own view; when the action ended
// the game, each of them also gets the one `gameover` event, so everyone pops the victory card at once.
import { viewForPlayer, viewForScreen, gameOverEvent } from '../public/js/room.js';

// A socket that joined with an older token for a seat the host has since opened is stale: that phone must not keep
// seeing the seat's card or acting for it. Sockets opened before tokens were stored have no token and are left alone.
export const seatStale = (room, att) => {
  const p = room.players.find((x) => x.id === att?.playerId);
  return !p || (att.token !== undefined && p.token !== att.token);
};

// stamp: { rev, hist } from the event log. Every view carries rev; the host's view also carries hist (Undo/Redo).
export function fanout(room, sockets, connected, wasOver = false, stamp = null) {
  const ending = !wasOver && room.phase === 'over';
  for (const { ws, att } of sockets) {
    if (!att?.who) continue;
    const screen = att.who === 'screen';
    if (!screen && seatStale(room, att)) { // removed by the host, or the seat was opened for someone else: back to the join form
      try { ws.send(JSON.stringify({ type: 'fatal', error: room.players.some((p) => p.id === att.playerId) ? 'The host opened your seat for someone else.' : 'The host removed you from the table.', clear: true })); ws.serializeAttachment?.({ who: null }); } catch { /* socket gone */ }
      continue;
    }
    const view = screen ? viewForScreen(room, connected) : viewForPlayer(room, att.playerId, connected);
    if (stamp) { view.rev = stamp.rev; if (view.me?.host) view.hist = stamp.hist; }
    try {
      ws.send(JSON.stringify({ type: 'view', view }));
      if (ending) ws.send(JSON.stringify(gameOverEvent(room, screen ? null : att.playerId)));
    } catch { /* socket gone */ }
  }
}
