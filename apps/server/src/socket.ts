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

import { getLogError, logger } from './logger';
import { createPlaybackUpdateTokenConsumer } from './rate-limiter';
import { createInMemoryRoomStore, type RoomStore, type RoomStoreRemovalReason } from './room';

type ConnectionSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;

export type SessionRecord = {
  socketId: string;
  roomCode: string;
  memberId: string;
  allowPlaybackUpdate: () => boolean;
};

export type RealtimeState = {
  roomStore: RoomStore;
  sessionsBySocket: Map<string, SessionRecord>;
  activeSocketByMember: Map<string, string>;
  removeRoom: (roomCode: string) => void;
};

const INVALID_PAYLOAD_ERROR = 'Invalid request payload.';
const SOCKET_SESSION_REQUIRED_ERROR = 'Socket session not found.';
const PLAYBACK_UPDATE_RATE_LIMIT_ERROR = 'Playback update rate limit exceeded.';
export const DEFAULT_MAX_ROOMS = 1_000;
const log = logger.child({ scope: 'socket' });

export type RealtimeStateOptions = {
  maxRooms?: number;
  roomIdleTtlMs?: number;
  onRoomRemoved?: (room: RoomState, reason: RoomStoreRemovalReason) => void;
};

export function createRealtimeState(options: RealtimeStateOptions = {}): RealtimeState {
  const sessionsBySocket = new Map<string, SessionRecord>();
  const activeSocketByMember = new Map<string, string>();

  const roomStore = createInMemoryRoomStore({
    maxRooms: options.maxRooms ?? DEFAULT_MAX_ROOMS,
    roomIdleTtlMs: options.roomIdleTtlMs ?? 6 * 60 * 60 * 1_000,
    onRoomRemoved: (room, reason) => {
      log.trace(
        {
          roomCode: room.roomCode,
          reason,
          memberCount: room.members.size,
        },
        'room_store:removed',
      );
      cleanupRemovedRoom(sessionsBySocket, activeSocketByMember, room.roomCode);
      options.onRoomRemoved?.(room, reason);
    },
  });

  return {
    roomStore,
    sessionsBySocket,
    activeSocketByMember,
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
    log.info({ socketId: socket.id }, 'socket:connected');
    socket.on(
      'room:create',
      withValidatedPayload<CreateRoomRequest, RoomResponse>(
        'room:create',
        createRoomRequestSchema,
        (payload, acknowledge) => {
          handleRoomCreate(io, state, socket, payload, acknowledge);
        },
      ),
    );

    socket.on(
      'room:join',
      withValidatedPayload<JoinRoomRequest, RoomResponse>(
        'room:join',
        joinRoomRequestSchema,
        (payload, acknowledge) => {
          handleRoomJoin(io, state, socket, payload, acknowledge);
        },
      ),
    );

    socket.on(
      'room:leave',
      withValidatedPayload<LeaveRoomRequest, { roomCode: string }>(
        'room:leave',
        leaveRoomRequestSchema,
        (payload, acknowledge) => {
          handleRoomLeave(io, state, socket, payload, acknowledge);
        },
      ),
    );

    socket.on(
      'playback:update',
      withValidatedPayload<PlaybackUpdateRequest, ReturnType<typeof toPartySnapshot>>(
        'playback:update',
        playbackUpdateRequestSchema,
        (payload, acknowledge) => {
          handlePlaybackUpdate(state, socket, payload, acknowledge);
        },
      ),
    );

    socket.on('disconnect', () => {
      const session = state.sessionsBySocket.get(socket.id);
      if (!session) {
        log.info({ socketId: socket.id }, 'socket:disconnected_without_session');
        return;
      }

      log.info(
        {
          socketId: socket.id,
          roomCode: session.roomCode,
          memberId: session.memberId,
        },
        'socket:disconnected',
      );
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
  event: string,
  schema: ZodType<TPayload>,
  handler: (payload: TPayload, acknowledge: Acknowledge<TResponse>) => void,
) {
  return (payload: unknown, acknowledge: Acknowledge<TResponse>): void => {
    const result = schema.safeParse(payload);
    if (!result.success) {
      log.warn({ event }, 'socket:invalid_payload');
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
    log.error({ socketId: socket.id, error: getLogError(error) }, 'room:create_failed');
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
  log.info(
    {
      socketId: socket.id,
      roomCode: room.roomCode,
      memberId: payload.memberId,
      memberCount: room.members.size,
      roomCount: state.roomStore.size(),
    },
    'room:create_ok',
  );
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
    log.warn({ socketId: socket.id, roomCode: payload.roomCode }, 'room:join_missing_room');
    acknowledge({ ok: false, error: 'Room not found.' });
    return;
  }

  if (payload.serviceId && room.serviceId !== payload.serviceId) {
    log.warn(
      {
        socketId: socket.id,
        roomCode: payload.roomCode,
        requestedServiceId: payload.serviceId,
        roomServiceId: room.serviceId,
      },
      'room:join_service_mismatch',
    );
    acknowledge({ ok: false, error: 'This room is using a different service.' });
    return;
  }

  upsertRoomMember(room, payload.memberId, payload.memberName);
  refreshRoomActivity(state, room);

  moveSocketSession(io, state, socket, payload.roomCode, payload.memberId);

  const snapshot = toPartySnapshot(room);
  acknowledge({ ok: true, data: { memberId: payload.memberId, snapshot } });
  socket.to(payload.roomCode).emit('room:state', snapshot);
  log.info(
    {
      socketId: socket.id,
      roomCode: payload.roomCode,
      memberId: payload.memberId,
      memberCount: room.members.size,
      roomCount: state.roomStore.size(),
    },
    'room:join_ok',
  );
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
    log.warn({ socketId: socket.id }, 'room:leave_missing_session');
    acknowledge({ ok: false, error: SOCKET_SESSION_REQUIRED_ERROR });
    return;
  }

  removeSocketSession(state, socket.id);
  leaveRoom(io, state, session.roomCode, session.memberId);
  acknowledge({
    ok: true,
    data: { roomCode: session.roomCode },
  });
  log.info(
    {
      socketId: socket.id,
      roomCode: session.roomCode,
      memberId: session.memberId,
      roomCount: state.roomStore.size(),
    },
    'room:leave_ok',
  );
}

function handlePlaybackUpdate(
  state: RealtimeState,
  socket: ConnectionSocket,
  payload: PlaybackUpdateRequest,
  acknowledge: Acknowledge<ReturnType<typeof toPartySnapshot>>,
): void {
  const session = getSocketSession(state, socket.id);
  if (!session) {
    log.warn({ socketId: socket.id }, 'playback:update_missing_session');
    acknowledge({ ok: false, error: SOCKET_SESSION_REQUIRED_ERROR });
    return;
  }

  const room = state.roomStore.get(session.roomCode);

  if (!room) {
    log.warn(
      { socketId: socket.id, roomCode: session.roomCode, memberId: session.memberId },
      'playback:update_missing_room',
    );
    acknowledge({ ok: false, error: 'Room not found.' });
    return;
  }

  if (!roomHasMember(room, session.memberId)) {
    log.warn(
      { socketId: socket.id, roomCode: session.roomCode, memberId: session.memberId },
      'playback:update_non_member',
    );
    acknowledge({ ok: false, error: 'Member is not part of this room.' });
    return;
  }

  if (payload.update.serviceId !== room.serviceId) {
    log.warn(
      {
        socketId: socket.id,
        roomCode: session.roomCode,
        memberId: session.memberId,
        updateServiceId: payload.update.serviceId,
        roomServiceId: room.serviceId,
      },
      'playback:update_service_mismatch',
    );
    acknowledge({ ok: false, error: 'Service mismatch.' });
    return;
  }

  if (!session.allowPlaybackUpdate()) {
    log.warn(
      { socketId: socket.id, roomCode: session.roomCode, memberId: session.memberId },
      'playback:update_rate_limited',
    );
    acknowledge({ ok: false, error: PLAYBACK_UPDATE_RATE_LIMIT_ERROR });
    return;
  }

  try {
    const previousPlayback = room.playback;
    const playback = applyPlaybackUpdate(room, payload.update, session.memberId);

    const snapshot = toPartySnapshot(room);
    acknowledge({ ok: true, data: snapshot });

    if (playback === previousPlayback) {
      log.debug(
        {
          socketId: socket.id,
          roomCode: room.roomCode,
          memberId: session.memberId,
          mediaId: payload.update.mediaId,
          clientSequence: payload.update.clientSequence,
          roomSequence: room.sequence,
        },
        'playback:update_noop',
      );
      return;
    }

    refreshRoomActivity(state, room);
    socket.to(room.roomCode).emit('playback:state', snapshot);
    log.debug(
      {
        socketId: socket.id,
        roomCode: room.roomCode,
        memberId: session.memberId,
        mediaId: playback.mediaId,
        playing: playback.playing,
        positionSec: playback.positionSec,
        playbackSequence: playback.sequence,
        clientSequence: payload.update.clientSequence,
      },
      'playback:update_ok',
    );
  } catch (error) {
    log.error(
      {
        socketId: socket.id,
        roomCode: session.roomCode,
        memberId: session.memberId,
        error: getLogError(error),
      },
      'playback:update_failed',
    );
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
    log.info(
      {
        socketId: socket.id,
        previousRoomCode: priorSession.roomCode,
        previousMemberId: priorSession.memberId,
        nextRoomCode: roomCode,
        nextMemberId: memberId,
      },
      'session:moved',
    );
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
    log.info(
      {
        roomCode,
        memberId,
        previousSocketId: priorSocketId,
        nextSocketId: socketId,
      },
      'session:duplicate_socket_replaced',
    );
    io.sockets.sockets.get(priorSocketId)?.disconnect(true);
    state.sessionsBySocket.delete(priorSocketId);
  }

  state.activeSocketByMember.set(key, socketId);
  state.sessionsBySocket.set(socketId, {
    socketId,
    roomCode,
    memberId,
    allowPlaybackUpdate: priorSession?.allowPlaybackUpdate ?? createPlaybackUpdateTokenConsumer(),
  });
  socket.join(roomCode);
  log.trace({ socketId, roomCode, memberId }, 'session:joined_socket_room');
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
    log.trace({ roomCode, memberId }, 'room:leave_missing_room');
    return;
  }

  removeRoomMember(room, memberId);

  if (room.members.size === 0) {
    log.info({ roomCode, memberId }, 'room:remove_empty');
    state.removeRoom(roomCode);
    return;
  }

  refreshRoomActivity(state, room);
  io.to(roomCode).emit('room:state', toPartySnapshot(room));
  log.info(
    {
      roomCode,
      memberId,
      memberCount: room.members.size,
    },
    'room:member_left',
  );
}

function memberKey(roomCode: string, memberId: string): string {
  return `${roomCode}:${memberId}`;
}

function cleanupRemovedRoom(
  sessionsBySocket: Map<string, SessionRecord>,
  activeSocketByMember: Map<string, string>,
  roomCodeValue: string,
): void {
  const roomCode = normalizeRoomCode(roomCodeValue);

  for (const [socketId, session] of sessionsBySocket.entries()) {
    if (session.roomCode === roomCode) {
      sessionsBySocket.delete(socketId);
    }
  }

  for (const key of activeSocketByMember.keys()) {
    if (key.startsWith(`${roomCode}:`)) {
      activeSocketByMember.delete(key);
    }
  }
}

function refreshRoomActivity(state: RealtimeState, room: RoomState): void {
  state.roomStore.set(room);
}
