import type { ZodType } from 'zod';
import { Server, type Socket } from 'socket.io';
import {
  applyPlaybackUpdate,
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
} from '@open-watch-party/shared';

import {
  createTokenBucketRateLimiter,
  type TokenBucketRateLimiter,
} from './token-bucket-rate-limiter';
import { createInMemoryRoomStore, type RoomStore, type RoomStoreRemovalReason } from './room-store';

type ConnectionSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;

export type SessionRecord = {
  socketId: string;
  roomCode: string;
  memberId: string;
};

export type RealtimeState = {
  roomStore: RoomStore;
  sessionsBySocket: Map<string, SessionRecord>;
  activeSocketByMember: Map<string, string>;
  playbackUpdateRateLimiter: TokenBucketRateLimiter;
  removeRoom: (roomCode: string) => void;
};

const INVALID_PAYLOAD_ERROR = 'Invalid request payload.';
const SOCKET_SESSION_REQUIRED_ERROR = 'Socket session not found.';
const PLAYBACK_UPDATE_RATE_LIMIT_ERROR = 'Playback update rate limit exceeded.';
const PLAYBACK_UPDATE_TOKENS_PER_SECOND = 10;
const PLAYBACK_UPDATE_BURST_CAPACITY = 20;
export const DEFAULT_MAX_ROOMS = 1_000;

export type RealtimeStateOptions = {
  maxRooms?: number;
  roomIdleTtlMs?: number;
  onRoomRemoved?: (room: RoomState, reason: RoomStoreRemovalReason) => void;
};

export function createRealtimeState(options: RealtimeStateOptions = {}): RealtimeState {
  const sessionsBySocket = new Map<string, SessionRecord>();
  const activeSocketByMember = new Map<string, string>();
  const playbackUpdateRateLimiter = createTokenBucketRateLimiter({
    capacity: PLAYBACK_UPDATE_BURST_CAPACITY,
    refillRatePerSecond: PLAYBACK_UPDATE_TOKENS_PER_SECOND,
  });
  const roomIndexes = {
    sessionsBySocket,
    activeSocketByMember,
    playbackUpdateRateLimiter,
  };

  const roomStore = createInMemoryRoomStore({
    maxRooms: options.maxRooms ?? DEFAULT_MAX_ROOMS,
    roomIdleTtlMs: options.roomIdleTtlMs ?? 6 * 60 * 60 * 1_000,
    onRoomRemoved: (room, reason) => {
      cleanupRemovedRoom(roomIndexes, room.roomCode);
      options.onRoomRemoved?.(room, reason);
    },
  });

  return {
    roomStore,
    sessionsBySocket,
    activeSocketByMember,
    playbackUpdateRateLimiter,
    removeRoom: (roomCodeValue: string): void => {
      const roomCode = normalizeRoomCode(roomCodeValue);
      roomStore.delete(roomCode);
    },
  };
}

export function registerSocketHandlers(io: RealtimeServer, state: RealtimeState): void {
  io.on('connection', createConnectionHandler(io, state));
}

export function createConnectionHandler(io: RealtimeServer, state: RealtimeState) {
  return (socket: ConnectionSocket): void => {
    socket.on(
      'room:create',
      withValidatedPayload<CreateRoomRequest, RoomResponse>(
        createRoomRequestSchema,
        (payload, acknowledge) => {
          handleRoomCreate(io, state, socket, payload, acknowledge);
        },
      ),
    );

    socket.on(
      'room:join',
      withValidatedPayload<JoinRoomRequest, RoomResponse>(
        joinRoomRequestSchema,
        (payload, acknowledge) => {
          handleRoomJoin(io, state, socket, payload, acknowledge);
        },
      ),
    );

    socket.on(
      'room:leave',
      withValidatedPayload<LeaveRoomRequest, { roomCode: string }>(
        leaveRoomRequestSchema,
        (payload, acknowledge) => {
          handleRoomLeave(io, state, socket, payload, acknowledge);
        },
      ),
    );

    socket.on(
      'playback:update',
      withValidatedPayload<PlaybackUpdateRequest, ReturnType<typeof toPartySnapshot>>(
        playbackUpdateRequestSchema,
        (payload, acknowledge) => {
          handlePlaybackUpdate(state, socket, payload, acknowledge);
        },
      ),
    );

    socket.on('disconnect', () => {
      const session = state.sessionsBySocket.get(socket.id);
      state.playbackUpdateRateLimiter.reset(socket.id);
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
    const roomCode = state.roomStore.generateUniqueRoomCode();
    room = createRoomState(roomCode, payload);
    state.roomStore.set(room);
  } catch (error) {
    acknowledge({
      ok: false,
      error: error instanceof Error ? error.message : 'Room creation failed.',
    });
    return;
  }

  upsertRoomMember(room, payload.memberId, payload.memberName);
  refreshRoomActivity(state, room);

  moveSocketSession(io, state, socket, room.roomCode, payload.memberId);

  const snapshot = toPartySnapshot(room);
  acknowledge({ ok: true, data: { memberId: payload.memberId, snapshot } });
  socket.to(room.roomCode).emit('room:state', snapshot);
}

function handleRoomJoin(
  io: RealtimeServer,
  state: RealtimeState,
  socket: ConnectionSocket,
  payload: JoinRoomRequest,
  acknowledge: Acknowledge<RoomResponse>,
): void {
  const room = state.roomStore.get(payload.roomCode);

  if (!room) {
    acknowledge({ ok: false, error: 'Room not found.' });
    return;
  }

  if (payload.serviceId && room.serviceId !== payload.serviceId) {
    acknowledge({ ok: false, error: 'This room is using a different service.' });
    return;
  }

  upsertRoomMember(room, payload.memberId, payload.memberName);
  refreshRoomActivity(state, room);

  moveSocketSession(io, state, socket, payload.roomCode, payload.memberId);

  const snapshot = toPartySnapshot(room);
  acknowledge({ ok: true, data: { memberId: payload.memberId, snapshot } });
  socket.to(payload.roomCode).emit('room:state', snapshot);
}

function handleRoomLeave(
  io: RealtimeServer,
  state: RealtimeState,
  socket: ConnectionSocket,
  _payload: LeaveRoomRequest,
  acknowledge: Acknowledge<{ roomCode: string }>,
): void {
  const session = getSocketSession(state, socket.id);
  if (!session) {
    acknowledge({ ok: false, error: SOCKET_SESSION_REQUIRED_ERROR });
    return;
  }

  removeSocketSession(state, socket.id);
  leaveRoom(io, state, session.roomCode, session.memberId);
  acknowledge({
    ok: true,
    data: { roomCode: session.roomCode },
  });
}

function handlePlaybackUpdate(
  state: RealtimeState,
  socket: ConnectionSocket,
  payload: PlaybackUpdateRequest,
  acknowledge: Acknowledge<ReturnType<typeof toPartySnapshot>>,
): void {
  const session = getSocketSession(state, socket.id);
  if (!session) {
    acknowledge({ ok: false, error: SOCKET_SESSION_REQUIRED_ERROR });
    return;
  }

  const room = state.roomStore.get(session.roomCode);

  if (!room) {
    acknowledge({ ok: false, error: 'Room not found.' });
    return;
  }

  if (!roomHasMember(room, session.memberId)) {
    acknowledge({ ok: false, error: 'Member is not part of this room.' });
    return;
  }

  if (payload.update.serviceId !== room.serviceId) {
    acknowledge({ ok: false, error: 'Service mismatch.' });
    return;
  }

  if (!state.playbackUpdateRateLimiter.consume(socket.id)) {
    acknowledge({ ok: false, error: PLAYBACK_UPDATE_RATE_LIMIT_ERROR });
    return;
  }

  try {
    const previousPlayback = room.playback;
    const playback = applyPlaybackUpdate(room, payload.update, session.memberId);

    const snapshot = toPartySnapshot(room);
    acknowledge({ ok: true, data: snapshot });

    if (playback === previousPlayback) {
      return;
    }

    refreshRoomActivity(state, room);
    socket.to(room.roomCode).emit('playback:state', snapshot);
  } catch (error) {
    acknowledge({
      ok: false,
      error: error instanceof Error ? error.message : 'Playback update failed.',
    });
    return;
  }
}

function getSocketSession(state: RealtimeState, socketId: string): SessionRecord | undefined {
  return state.sessionsBySocket.get(socketId);
}

function moveSocketSession(
  io: RealtimeServer,
  state: RealtimeState,
  socket: ConnectionSocket,
  roomCodeValue: string,
  memberId: string,
): void {
  const roomCode = normalizeRoomCode(roomCodeValue);
  const priorSession = state.sessionsBySocket.get(socket.id);

  if (priorSession && (priorSession.roomCode !== roomCode || priorSession.memberId !== memberId)) {
    removeSocketSession(state, socket.id);

    if (priorSession.roomCode !== roomCode) {
      socket.leave(priorSession.roomCode);
    }

    leaveRoom(io, state, priorSession.roomCode, priorSession.memberId);
  }

  const socketId = socket.id;
  const key = memberKey(roomCode, memberId);
  const priorSocketId = state.activeSocketByMember.get(key);

  if (priorSocketId && priorSocketId !== socketId) {
    io.sockets.sockets.get(priorSocketId)?.disconnect(true);
    state.playbackUpdateRateLimiter.reset(priorSocketId);
    state.sessionsBySocket.delete(priorSocketId);
  }

  state.activeSocketByMember.set(key, socketId);
  state.sessionsBySocket.set(socketId, { socketId, roomCode, memberId });
  socket.join(roomCode);
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
  const room = state.roomStore.get(roomCode);

  if (!room) {
    return;
  }

  removeRoomMember(room, memberId);

  if (room.members.size === 0) {
    state.removeRoom(roomCode);
    return;
  }

  refreshRoomActivity(state, room);
  io.to(roomCode).emit('room:state', toPartySnapshot(room));
}

function memberKey(roomCode: string, memberId: string): string {
  return `${roomCode}:${memberId}`;
}

function cleanupRemovedRoom(
  state: Pick<
    RealtimeState,
    'activeSocketByMember' | 'playbackUpdateRateLimiter' | 'sessionsBySocket'
  >,
  roomCodeValue: string,
): void {
  const roomCode = normalizeRoomCode(roomCodeValue);

  for (const [socketId, session] of state.sessionsBySocket.entries()) {
    if (session.roomCode !== roomCode) {
      continue;
    }

    state.playbackUpdateRateLimiter.reset(socketId);
    state.sessionsBySocket.delete(socketId);
  }

  for (const key of state.activeSocketByMember.keys()) {
    if (key.startsWith(`${roomCode}:`)) {
      state.activeSocketByMember.delete(key);
    }
  }
}

function refreshRoomActivity(state: RealtimeState, room: RoomState): void {
  state.roomStore.set(room);
}
