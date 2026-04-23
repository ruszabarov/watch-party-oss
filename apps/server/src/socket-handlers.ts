import type { ZodType } from 'zod';
import { Server, type Socket } from 'socket.io';
import {
  applyPlaybackUpdate,
  createRoomCode,
  createRoomRequestSchema,
  createRoomState,
  joinRoomRequestSchema,
  leaveRoomRequestSchema,
  normalizeRoomCode,
  playbackUpdateRequestSchema,
  removeRoomMember,
  roomHasMember,
  type Acknowledge,
  type ClientToServerEvents,
  type CreateRoomRequest,
  type JoinRoomRequest,
  type LeaveRoomRequest,
  type PlaybackUpdateRequest,
  type RoomResponse,
  type RoomState,
  type ServerToClientEvents,
  toPartySnapshot,
  upsertRoomMember,
} from '@watch-party/shared';

type ConnectionSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;

export type SessionRecord = {
  socketId: string;
  roomCode: string;
  memberId: string;
};

export type RealtimeState = {
  rooms: Map<string, RoomState>;
  sessionsBySocket: Map<string, SessionRecord>;
  activeSocketByMember: Map<string, string>;
};

const INVALID_PAYLOAD_ERROR = 'Invalid request payload.';

export function createRealtimeState(): RealtimeState {
  return {
    rooms: new Map<string, RoomState>(),
    sessionsBySocket: new Map<string, SessionRecord>(),
    activeSocketByMember: new Map<string, string>(),
  };
}

export function registerSocketHandlers(io: RealtimeServer, state: RealtimeState): void {
  io.on('connection', createConnectionHandler(io, state));
}

export function createConnectionHandler(io: RealtimeServer, state: RealtimeState) {
  return (socket: ConnectionSocket): void => {
    socket.on(
      'room:create',
      withValidatedPayload(createRoomRequestSchema, (payload, acknowledge) => {
        handleRoomCreate(io, state, socket, payload, acknowledge);
      }),
    );

    socket.on(
      'room:join',
      withValidatedPayload(joinRoomRequestSchema, (payload, acknowledge) => {
        handleRoomJoin(io, state, socket, payload, acknowledge);
      }),
    );

    socket.on(
      'room:leave',
      withValidatedPayload(leaveRoomRequestSchema, (payload, acknowledge) => {
        handleRoomLeave(io, state, socket, payload, acknowledge);
      }),
    );

    socket.on(
      'playback:update',
      withValidatedPayload(playbackUpdateRequestSchema, (payload, acknowledge) => {
        handlePlaybackUpdate(io, state, socket, payload, acknowledge);
      }),
    );

    socket.on('disconnect', () => {
      const session = state.sessionsBySocket.get(socket.id);
      if (!session) {
        return;
      }

      const activeSocketId = state.activeSocketByMember.get(
        memberKey(session.roomCode, session.memberId),
      );
      if (activeSocketId !== socket.id) {
        state.sessionsBySocket.delete(socket.id);
        return;
      }

      removeSocketSession(state, socket.id);
      leaveRoom(io, state, session.roomCode, session.memberId);
    });
  };
}

export function withValidatedPayload<TPayload, TResponse>(
  schema: ZodType<TPayload>,
  handler: (payload: TPayload, acknowledge: Acknowledge<TResponse>) => void,
) {
  return (payload: unknown, acknowledge: Acknowledge<TResponse>): void => {
    const result = schema.safeParse(payload);
    if (!result.success) {
      acknowledge({ ok: false, error: INVALID_PAYLOAD_ERROR });
      return;
    }

    handler(result.data, acknowledge);
  };
}

function handleRoomCreate(
  io: RealtimeServer,
  state: RealtimeState,
  socket: ConnectionSocket,
  payload: CreateRoomRequest,
  acknowledge: Acknowledge<RoomResponse>,
): void {
  let room: RoomState;

  try {
    const roomCode = getUniqueRoomCode(state.rooms);
    room = createRoomState(roomCode, payload);
  } catch (error) {
    acknowledge({
      ok: false,
      error: error instanceof Error ? error.message : 'Room creation failed.',
    });
    return;
  }

  upsertRoomMember(room, payload.memberId, payload.memberName);
  state.rooms.set(room.roomCode, room);

  bindMemberToSocket(state, socket.id, room.roomCode, payload.memberId);
  socket.join(room.roomCode);

  const snapshot = toPartySnapshot(room);
  acknowledge({ ok: true, data: { memberId: payload.memberId, snapshot } });
  io.to(room.roomCode).emit('room:state', snapshot);
}

function handleRoomJoin(
  io: RealtimeServer,
  state: RealtimeState,
  socket: ConnectionSocket,
  payload: JoinRoomRequest,
  acknowledge: Acknowledge<RoomResponse>,
): void {
  const room = state.rooms.get(payload.roomCode);

  if (!room) {
    acknowledge({ ok: false, error: 'Room not found.' });
    return;
  }

  if (payload.serviceId && room.serviceId !== payload.serviceId) {
    acknowledge({ ok: false, error: 'This room is using a different service.' });
    return;
  }

  upsertRoomMember(room, payload.memberId, payload.memberName);

  bindMemberToSocket(state, socket.id, payload.roomCode, payload.memberId);
  socket.join(payload.roomCode);

  const snapshot = toPartySnapshot(room);
  acknowledge({ ok: true, data: { memberId: payload.memberId, snapshot } });
  io.to(payload.roomCode).emit('room:state', snapshot);
}

function handleRoomLeave(
  io: RealtimeServer,
  state: RealtimeState,
  socket: ConnectionSocket,
  payload: LeaveRoomRequest,
  acknowledge: Acknowledge<{ roomCode: string }>,
): void {
  removeSocketSession(state, socket.id);
  leaveRoom(io, state, payload.roomCode, payload.memberId);
  acknowledge({
    ok: true,
    data: { roomCode: payload.roomCode },
  });
}

function handlePlaybackUpdate(
  io: RealtimeServer,
  state: RealtimeState,
  socket: ConnectionSocket,
  payload: PlaybackUpdateRequest,
  acknowledge: Acknowledge<ReturnType<typeof toPartySnapshot>>,
): void {
  const room = state.rooms.get(payload.roomCode);

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

  try {
    applyPlaybackUpdate(room, payload.update, payload.memberId);
  } catch (error) {
    acknowledge({
      ok: false,
      error: error instanceof Error ? error.message : 'Playback update failed.',
    });
    return;
  }

  const snapshot = toPartySnapshot(room);
  acknowledge({ ok: true, data: snapshot });
  socket.to(room.roomCode).emit('playback:state', snapshot);
}

function getUniqueRoomCode(rooms: Map<string, RoomState>): string {
  let roomCode = createRoomCode();

  while (rooms.has(roomCode)) {
    roomCode = createRoomCode();
  }

  return roomCode;
}

function bindMemberToSocket(
  state: RealtimeState,
  socketId: string,
  roomCode: string,
  memberId: string,
): void {
  const key = memberKey(roomCode, memberId);
  const priorSocketId = state.activeSocketByMember.get(key);

  if (priorSocketId && priorSocketId !== socketId) {
    state.sessionsBySocket.delete(priorSocketId);
  }

  state.activeSocketByMember.set(key, socketId);
  state.sessionsBySocket.set(socketId, { socketId, roomCode, memberId });
}

function removeSocketSession(state: RealtimeState, socketId: string): void {
  const session = state.sessionsBySocket.get(socketId);
  if (!session) {
    return;
  }

  state.activeSocketByMember.delete(memberKey(session.roomCode, session.memberId));
  state.sessionsBySocket.delete(socketId);
}

function leaveRoom(
  io: RealtimeServer,
  state: RealtimeState,
  roomCodeValue: string,
  memberId: string,
): void {
  const roomCode = normalizeRoomCode(roomCodeValue);
  const room = state.rooms.get(roomCode);

  if (!room) {
    return;
  }

  removeRoomMember(room, memberId);

  if (room.members.size === 0) {
    state.rooms.delete(roomCode);
    return;
  }

  io.to(roomCode).emit('room:state', toPartySnapshot(room));
}

function memberKey(roomCode: string, memberId: string): string {
  return `${roomCode}:${memberId}`;
}
