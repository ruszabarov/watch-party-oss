import http from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@open-watch-party/shared';

import { logger } from './logger';
import { DEFAULT_MAX_ROOMS, createRealtimeState, registerSocketHandlers } from './socket';

const port = Number.parseInt(process.env['PORT'] ?? '8787', 10);
const roomIdleTtlMs = Number.parseInt(
  process.env['ROOM_IDLE_TTL_MS'] ?? String(6 * 60 * 60 * 1_000),
  10,
);
const maxRooms = Number.parseInt(process.env['MAX_ROOMS'] ?? String(DEFAULT_MAX_ROOMS), 10);

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    logger.debug({ method: request.method, url: request.url }, 'http:health');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  logger.debug({ method: request.method, url: request.url }, 'http:not_found');
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ok: false }));
});

const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: '*',
  },
  transports: ['websocket'],
});

const state = createRealtimeState({
  maxRooms,
  roomIdleTtlMs,
  onRoomRemoved: (room, reason) => {
    logger.info(
      {
        roomCode: room.roomCode,
        reason,
        memberCount: room.members.size,
      },
      'room:removed',
    );
    io.socketsLeave(room.roomCode);
  },
});

registerSocketHandlers(io, state);

server.listen(port, () => {
  logger.info(
    {
      port,
      maxRooms,
      roomIdleTtlMs,
    },
    'server:listening',
  );
});
