import http from 'node:http';

import { Server } from 'socket.io';

import {
  applyPlaybackUpdate,
  createRoomCode,
  createRoomState,
  roomHasMember,
  type ClientToServerEvents,
  type RoomState,
  type ServerToClientEvents,
  toPartySnapshot,
  upsertRoomMember,
  removeRoomMember,
} from '@watch-party/shared';

type SessionRecord = {
  socketId: string;
  roomCode: string;
  memberId: string;
};

const port = Number.parseInt(process.env['PORT'] ?? '8787', 10);
const rooms = new Map<string, RoomState>();
const sessionsBySocket = new Map<string, SessionRecord>();
const activeSocketByMember = new Map<string, string>();

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

io.on('connection', (socket) => {
  socket.on('room:create', (payload, acknowledge) => {
    const roomCode = getUniqueRoomCode();
    const room = createRoomState(roomCode, payload);

    upsertRoomMember(room, payload.memberId, payload.memberName);
    rooms.set(roomCode, room);

    bindMemberToSocket(socket.id, roomCode, payload.memberId);
    socket.join(roomCode);

    const snapshot = toPartySnapshot(room);
    acknowledge({ ok: true, data: { memberId: payload.memberId, snapshot } });
    io.to(roomCode).emit('room:state', snapshot);
  });

  socket.on('room:join', (payload, acknowledge) => {
    const roomCode = payload.roomCode.trim().toUpperCase();
    const room = rooms.get(roomCode);

    if (!room) {
      acknowledge({ ok: false, error: 'Room not found.' });
      return;
    }

    if (room.serviceId !== payload.serviceId) {
      acknowledge({ ok: false, error: 'This room is using a different service.' });
      return;
    }

    upsertRoomMember(room, payload.memberId, payload.memberName);

    bindMemberToSocket(socket.id, roomCode, payload.memberId);
    socket.join(roomCode);

    const snapshot = toPartySnapshot(room);
    acknowledge({ ok: true, data: { memberId: payload.memberId, snapshot } });
    io.to(roomCode).emit('presence:state', snapshot);
  });

  socket.on('room:leave', (payload, acknowledge) => {
    removeSocketSession(socket.id);
    leaveRoom(payload.roomCode, payload.memberId);
    acknowledge({
      ok: true,
      data: { roomCode: payload.roomCode.trim().toUpperCase() },
    });
  });

  socket.on('playback:update', (payload, acknowledge) => {
    const room = rooms.get(payload.roomCode.trim().toUpperCase());

    if (!room) {
      acknowledge({ ok: false, error: 'Room not found.' });
      return;
    }

    if (!roomHasMember(room, payload.memberId)) {
      acknowledge({ ok: false, error: 'Member is not part of this room.' });
      return;
    }

    if (payload.update.serviceId !== room.serviceId) {
      acknowledge({ ok: false, error: 'Service mismatch.' });
      return;
    }

    applyPlaybackUpdate(room, payload.update, payload.memberId);
    const snapshot = toPartySnapshot(room);

    acknowledge({ ok: true, data: snapshot });
    io.to(room.roomCode).emit('playback:state', snapshot);
  });

  socket.on('presence:update', () => {
    // Presence data is not persisted in MVP, but the event remains part of the protocol.
  });

  socket.on('ping', (_, acknowledge) => {
    acknowledge({ ok: true, data: { pong: true } });
  });

  socket.on('disconnect', () => {
    const session = sessionsBySocket.get(socket.id);
    if (!session) {
      return;
    }

    const activeSocketId = activeSocketByMember.get(memberKey(session.roomCode, session.memberId));
    if (activeSocketId !== socket.id) {
      sessionsBySocket.delete(socket.id);
      return;
    }

    removeSocketSession(socket.id);
    leaveRoom(session.roomCode, session.memberId);
  });
});

server.listen(port, () => {
  console.log(`watch-party realtime server listening on :${port}`);
});

function getUniqueRoomCode(): string {
  let roomCode = createRoomCode();

  while (rooms.has(roomCode)) {
    roomCode = createRoomCode();
  }

  return roomCode;
}

function bindMemberToSocket(socketId: string, roomCode: string, memberId: string): void {
  const key = memberKey(roomCode, memberId);
  const priorSocketId = activeSocketByMember.get(key);

  if (priorSocketId && priorSocketId !== socketId) {
    sessionsBySocket.delete(priorSocketId);
  }

  activeSocketByMember.set(key, socketId);
  sessionsBySocket.set(socketId, { socketId, roomCode, memberId });
}

function removeSocketSession(socketId: string): void {
  const session = sessionsBySocket.get(socketId);
  if (!session) {
    return;
  }

  activeSocketByMember.delete(memberKey(session.roomCode, session.memberId));
  sessionsBySocket.delete(socketId);
}

function leaveRoom(roomCodeValue: string, memberId: string): void {
  const roomCode = roomCodeValue.trim().toUpperCase();
  const room = rooms.get(roomCode);

  if (!room) {
    return;
  }

  removeRoomMember(room, memberId);

  if (room.members.size === 0) {
    rooms.delete(roomCode);
    return;
  }

  io.to(roomCode).emit('presence:state', toPartySnapshot(room));
}

function memberKey(roomCode: string, memberId: string): string {
  return `${roomCode}:${memberId}`;
}
