import type { ZodType } from 'zod';
import { Server, type Socket } from 'socket.io';
import { match, P } from 'ts-pattern';
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
const ACTIVE_ROOM_EXISTS_ERROR = 'Leave your current room before joining or creating another room.';
export const DEFAULT_MAX_ROOMS = 1_000;
const log = logger.child({ scope: 'socket' });

type Ack<T> = (response: { ok: true; data: T } | { ok: false; error: string }) => void;
type AckHandlerContext<TPayload> = {
  io: RealtimeServer;
  state: RealtimeState;
  socket: ConnectionSocket;
  payload: TPayload;
};

class SocketDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SocketDomainError';
  }
}

class InvalidPayloadError extends SocketDomainError {
  constructor() {
    super(INVALID_PAYLOAD_ERROR);
  }
}

class SocketSessionRequiredError extends SocketDomainError {
  constructor() {
    super(SOCKET_SESSION_REQUIRED_ERROR);
  }
}

class RoomNotFoundError extends SocketDomainError {
  constructor() {
    super('Room not found.');
  }
}

class RoomServiceMismatchError extends SocketDomainError {
  constructor() {
    super('This room is using a different service.');
  }
}

class RoomMemberRequiredError extends SocketDomainError {
  constructor() {
    super('Member is not part of this room.');
  }
}

class PlaybackServiceMismatchError extends SocketDomainError {
  constructor() {
    super('Service mismatch.');
  }
}

class PlaybackUpdateRateLimitedError extends SocketDomainError {
  constructor() {
    super(PLAYBACK_UPDATE_RATE_LIMIT_ERROR);
  }
}

class ActiveRoomExistsError extends SocketDomainError {
  constructor() {
    super(ACTIVE_ROOM_EXISTS_ERROR);
  }
}

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
      withAckHandler<CreateRoomRequest, RoomResponse>(
        'room:create',
        createRoomRequestSchema,
        { io, state, socket },
        handleRoomCreate,
      ),
    );

    socket.on(
      'room:join',
      withAckHandler<JoinRoomRequest, RoomResponse>(
        'room:join',
        joinRoomRequestSchema,
        { io, state, socket },
        handleRoomJoin,
      ),
    );

    socket.on(
      'room:leave',
      withAckHandler<LeaveRoomRequest, { roomCode: string }>(
        'room:leave',
        leaveRoomRequestSchema,
        { io, state, socket },
        handleRoomLeave,
      ),
    );

    socket.on(
      'playback:update',
      withAckHandler<PlaybackUpdateRequest, ReturnType<typeof toPartySnapshot>>(
        'playback:update',
        playbackUpdateRequestSchema,
        { io, state, socket },
        handlePlaybackUpdate,
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

function withAckHandler<TPayload, TResponse>(
  event: string,
  schema: ZodType<TPayload>,
  context: Omit<AckHandlerContext<TPayload>, 'payload'>,
  handler: (context: AckHandlerContext<TPayload>) => TResponse,
) {
  return (payload: unknown, acknowledge: Ack<TResponse>): void => {
    try {
      const result = schema.safeParse(payload);
      if (!result.success) {
        throw new InvalidPayloadError();
      }

      const data = handler({ ...context, payload: result.data });
      acknowledge({ ok: true, data });
      logAckSuccess(event, context.socket, data);
    } catch (error) {
      const failure = toAckFailure(error);
      logAckFailure(event, context.socket, error, failure);
      acknowledge({ ok: false, error: failure.message });
    }
  };
}

function handleRoomCreate({
  io,
  state,
  socket,
  payload,
}: AckHandlerContext<CreateRoomRequest>): RoomResponse {
  const roomCode = state.roomStore.generateUniqueRoomCode();
  assertMemberCanBindRoom(state, socket.id, roomCode, payload.memberId);

  const room = createRoomState(roomCode, payload);
  state.roomStore.set(room);

  upsertRoomMember(room, payload.memberId, payload.memberName);
  refreshRoomActivity(state, room);

  bindSocketSession(io, state, socket, room.roomCode, payload.memberId);

  const snapshot = toPartySnapshot(room);
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
  return { memberId: payload.memberId, snapshot };
}

function handleRoomJoin({
  io,
  state,
  socket,
  payload,
}: AckHandlerContext<JoinRoomRequest>): RoomResponse {
  const room = requireRoom(state, payload.roomCode);
  assertRoomServiceMatch(room, payload.serviceId);
  assertMemberCanBindRoom(state, socket.id, payload.roomCode, payload.memberId);

  upsertRoomMember(room, payload.memberId, payload.memberName);
  refreshRoomActivity(state, room);

  bindSocketSession(io, state, socket, payload.roomCode, payload.memberId);

  const snapshot = toPartySnapshot(room);
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
  return { memberId: payload.memberId, snapshot };
}

function handleRoomLeave({ io, state, socket }: AckHandlerContext<LeaveRoomRequest>): {
  roomCode: string;
} {
  const session = requireSocketSession(state, socket.id);

  removeSocketSession(state, socket.id);
  leaveRoom(io, state, session.roomCode, session.memberId);
  log.info(
    {
      socketId: socket.id,
      roomCode: session.roomCode,
      memberId: session.memberId,
      roomCount: state.roomStore.size(),
    },
    'room:leave_ok',
  );
  return { roomCode: session.roomCode };
}

function handlePlaybackUpdate({
  state,
  socket,
  payload,
}: AckHandlerContext<PlaybackUpdateRequest>): ReturnType<typeof toPartySnapshot> {
  const session = requireSocketSession(state, socket.id);
  const room = requireRoom(state, session.roomCode);
  assertRoomMember(room, session.memberId);
  assertPlaybackServiceMatch(room, payload);
  assertPlaybackUpdateAllowed(session);

  const previousPlayback = room.playback;
  const playback = applyPlaybackUpdate(room, payload.update, session.memberId);
  const snapshot = toPartySnapshot(room);

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
    return snapshot;
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
  return snapshot;
}

function requireSocketSession(state: RealtimeState, socketId: string): SessionRecord {
  const session = state.sessionsBySocket.get(socketId);
  if (!session) {
    throw new SocketSessionRequiredError();
  }
  return session;
}

function requireRoom(state: RealtimeState, roomCode: string): RoomState {
  const room = state.roomStore.get(roomCode);
  if (!room) {
    throw new RoomNotFoundError();
  }
  return room;
}

function assertRoomServiceMatch(room: RoomState, serviceId: JoinRoomRequest['serviceId']): void {
  if (serviceId && room.serviceId !== serviceId) {
    throw new RoomServiceMismatchError();
  }
}

function assertRoomMember(room: RoomState, memberId: string): void {
  if (!roomHasMember(room, memberId)) {
    throw new RoomMemberRequiredError();
  }
}

function assertPlaybackServiceMatch(room: RoomState, payload: PlaybackUpdateRequest): void {
  if (payload.update.serviceId !== room.serviceId) {
    throw new PlaybackServiceMismatchError();
  }
}

function assertPlaybackUpdateAllowed(session: SessionRecord): void {
  if (!session.allowPlaybackUpdate()) {
    throw new PlaybackUpdateRateLimitedError();
  }
}

function assertMemberCanBindRoom(
  state: RealtimeState,
  socketId: string,
  roomCodeValue: string,
  memberId: string,
): void {
  const roomCode = normalizeRoomCode(roomCodeValue);
  const socketSession = state.sessionsBySocket.get(socketId);

  if (
    socketSession &&
    (socketSession.roomCode !== roomCode || socketSession.memberId !== memberId)
  ) {
    throw new ActiveRoomExistsError();
  }

  // This is O(n) over active socket sessions; create/join are low-frequency paths.
  for (const session of state.sessionsBySocket.values()) {
    if (session.memberId === memberId && session.roomCode !== roomCode) {
      throw new ActiveRoomExistsError();
    }
  }
}

function toAckFailure(error: unknown): { message: string; isExpected: boolean } {
  return match(error)
    .with(P.instanceOf(SocketDomainError), (domainError) => ({
      message: domainError.message,
      isExpected: true,
    }))
    .with(P.instanceOf(Error), (caughtError) => ({
      message: caughtError.message,
      isExpected: false,
    }))
    .otherwise(() => ({
      message: 'Request failed.',
      isExpected: false,
    }));
}

function logAckSuccess<TResponse>(
  event: string,
  socket: ConnectionSocket,
  response: TResponse,
): void {
  log.trace(
    {
      event,
      socketId: socket.id,
      hasResponse: response != null,
    },
    'socket:ack_ok',
  );
}

function logAckFailure(
  event: string,
  socket: ConnectionSocket,
  error: unknown,
  failure: { isExpected: boolean },
): void {
  const fields = {
    event,
    socketId: socket.id,
    error: getLogError(error),
  };
  if (failure.isExpected) {
    log.warn(fields, 'socket:ack_rejected');
    return;
  }

  log.error(fields, 'socket:ack_failed');
}

function bindSocketSession(
  io: RealtimeServer,
  state: RealtimeState,
  socket: ConnectionSocket,
  roomCodeValue: string,
  memberId: string,
): void {
  const roomCode = normalizeRoomCode(roomCodeValue);
  const socketId = socket.id;
  const key = memberKey(roomCode, memberId);
  const priorSocketId = state.activeSocketByMember.get(key);
  const allowPlaybackUpdate =
    state.sessionsBySocket.get(socketId)?.allowPlaybackUpdate ??
    createPlaybackUpdateTokenConsumer();

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
    allowPlaybackUpdate,
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
