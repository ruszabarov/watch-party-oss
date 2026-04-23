import http from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@watch-party/shared';

import { createRealtimeState, registerSocketHandlers } from './socket-handlers';

const port = Number.parseInt(process.env['PORT'] ?? '8787', 10);
const state = createRealtimeState();

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ok: false }));
});

const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: '*',
  },
  transports: ['websocket'],
});

registerSocketHandlers(io, state);

server.listen(port, () => {
  console.log(`watch-party realtime server listening on :${port}`);
});
