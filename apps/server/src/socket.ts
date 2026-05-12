import { Server, type Socket } from 'socket.io';
import {
  createRoomRequestSchema,
  joinRoomRequestSchema,
  playbackUpdateRequestSchema,
  type ClientToServerEvents,
  type CreateRoomRequest,
  type JoinRoomRequest,
  type OperationResult,
  type PartySnapshot,
  type PlaybackUpdate,
  type RoomResponse,
  type ServerToClientEvents,
} from '@open-watch-party/shared';

import {
  ACTIVE_ROOM_EXISTS_ERROR,
  PLAYBACK_UPDATE_RATE_LIMIT_ERROR,
  SOCKET_SESSION_REQUIRED_ERROR,
} from './error';
import { logger } from './logger';
import { RoomService, type RoomLeaveResult } from './room.service';
import { SessionRegistry } from './session';
import {
  type Ack,
  acknowledge as acknowledgeResult,
  failure,
  invalidPayload,
  success,
} from './utils';

type ConnectionSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;
type PayloadSchema<TPayload> = {
  safeParse: (payload: unknown) =>
    | {
        success: true;
        data: TPayload;
      }
    | {
        success: false;
      };
};

export type JoinedRoomResult = RoomResponse & {
  readonly roomCode: string;
  readonly replacedSocket?: {
    readonly socketId: string;
    readonly memberId: string;
  };
};

const log = logger.child({ scope: 'socket' });

export class RealtimeSocketService {
  private readonly sessions = new SessionRegistry();
  private readonly rooms: RoomService;

  constructor(private readonly io: RealtimeServer) {
    this.rooms = new RoomService({
      onRoomRemoved: (room) => {
        this.sessions.removeRoom(room.roomCode);
        this.io.socketsLeave(room.roomCode);
      },
    });
  }

  register(): void {
    this.io.on('connection', this.handleConnection);
  }

  readonly handleConnection = (socket: ConnectionSocket): void => {
    log.info({ socketId: socket.id }, 'socket:connected');

    socket.on('room:create', (payload, acknowledge) => {
      this.handleAcknowledgedRequest(payload, acknowledge, createRoomRequestSchema, (request) =>
        this.createRoom(socket, request),
      );
    });

    socket.on('room:join', (payload, acknowledge) => {
      this.handleAcknowledgedRequest(payload, acknowledge, joinRoomRequestSchema, (request) =>
        this.joinRoom(socket, request),
      );
    });

    socket.on('room:leave', (acknowledge) => {
      acknowledgeResult(acknowledge, () => this.leaveCurrentRoom(socket));
    });

    socket.on('playback:update', (payload, acknowledge) => {
      this.handleAcknowledgedRequest(payload, acknowledge, playbackUpdateRequestSchema, (request) =>
        this.updatePlayback(socket, request),
      );
    });

    socket.on('disconnect', () => {
      const session = this.sessions.get(socket.id);
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

      if (!this.sessions.isActiveSocket(session)) {
        this.sessions.remove(socket.id);
        return;
      }

      this.sessions.remove(socket.id);
      const result = this.rooms.leaveRoom(session.roomCode, session.memberId);
      this.broadcastRoomState(result);
    });
  };

  private handleAcknowledgedRequest<TPayload, TResponse>(
    payload: unknown,
    acknowledge: Ack<TResponse>,
    schema: PayloadSchema<TPayload>,
    operation: (payload: TPayload) => OperationResult<TResponse>,
  ): void {
    const result = schema.safeParse(payload);
    if (!result.success) {
      acknowledgeResult(acknowledge, invalidPayload);
      return;
    }

    acknowledgeResult(acknowledge, () => operation(result.data));
  }

  private createRoom(
    socket: ConnectionSocket,
    payload: CreateRoomRequest,
  ): OperationResult<RoomResponse> {
    const roomResult = this.rooms.createRoom(payload);
    if (!roomResult.ok) {
      return roomResult;
    }

    const roomCode = roomResult.data.snapshot.roomCode;
    if (!this.sessions.canBindMember(socket.id, roomCode, payload.memberId)) {
      this.rooms.leaveRoom(roomCode, payload.memberId);
      return failure(ACTIVE_ROOM_EXISTS_ERROR);
    }

    const binding = this.sessions.bind(socket.id, roomCode, payload.memberId);
    const joined = mergeJoinedRoom(roomResult.data, binding, payload.memberId);
    this.joinSocketToRoom(socket, joined);

    return success({
      memberId: joined.memberId,
      snapshot: joined.snapshot,
    });
  }

  private joinRoom(
    socket: ConnectionSocket,
    payload: JoinRoomRequest,
  ): OperationResult<RoomResponse> {
    if (!this.sessions.canBindMember(socket.id, payload.roomCode, payload.memberId)) {
      return failure(ACTIVE_ROOM_EXISTS_ERROR);
    }

    const roomResult = this.rooms.joinRoom(payload);
    if (!roomResult.ok) {
      return roomResult;
    }

    const binding = this.sessions.bind(socket.id, payload.roomCode, payload.memberId);
    const joined = mergeJoinedRoom(roomResult.data, binding, payload.memberId);
    this.joinSocketToRoom(socket, joined);

    return success({
      memberId: joined.memberId,
      snapshot: joined.snapshot,
    });
  }

  private leaveCurrentRoom(socket: ConnectionSocket): OperationResult<{ roomCode: string }> {
    const session = this.sessions.remove(socket.id);
    if (!session) {
      return failure(SOCKET_SESSION_REQUIRED_ERROR);
    }

    const result = this.rooms.leaveRoom(session.roomCode, session.memberId);
    log.info(
      {
        socketId: socket.id,
        roomCode: session.roomCode,
        memberId: session.memberId,
      },
      'room:leave_ok',
    );

    this.broadcastRoomState(result);
    return success({ roomCode: result.roomCode });
  }

  private updatePlayback(
    socket: ConnectionSocket,
    payload: PlaybackUpdate,
  ): OperationResult<PartySnapshot> {
    const session = this.sessions.get(socket.id);
    if (!session) {
      return failure(SOCKET_SESSION_REQUIRED_ERROR);
    }

    if (!session.allowPlaybackUpdate()) {
      return failure(PLAYBACK_UPDATE_RATE_LIMIT_ERROR);
    }

    const result = this.rooms.updatePlayback(session.roomCode, session.memberId, payload);
    if (!result.ok) {
      return result;
    }

    socket.to(result.data.roomCode).emit('playback:state', result.data.snapshot);

    return success(result.data.snapshot);
  }

  private joinSocketToRoom(socket: ConnectionSocket, result: JoinedRoomResult): void {
    if (result.replacedSocket) {
      this.disconnectReplacedSocket(socket.id, result.roomCode, result.replacedSocket);
    }

    socket.join(result.roomCode);
    socket.to(result.roomCode).emit('room:state', result.snapshot);
  }

  private broadcastRoomState(result: RoomLeaveResult): void {
    if (result.remainingSnapshot) {
      this.io.to(result.roomCode).emit('room:state', result.remainingSnapshot);
    }
  }

  private disconnectReplacedSocket(
    nextSocketId: string,
    roomCode: string,
    replacedSocket: NonNullable<JoinedRoomResult['replacedSocket']>,
  ): void {
    log.info(
      {
        roomCode,
        memberId: replacedSocket.memberId,
        previousSocketId: replacedSocket.socketId,
        nextSocketId,
      },
      'session:duplicate_socket_replaced',
    );
    this.io.sockets.sockets.get(replacedSocket.socketId)?.disconnect(true);
  }
}

function mergeJoinedRoom(
  response: RoomResponse,
  binding: { readonly roomCode: string; readonly replacedSocketId?: string },
  memberId: string,
): JoinedRoomResult {
  if (!binding.replacedSocketId) {
    return {
      memberId: response.memberId,
      roomCode: binding.roomCode,
      snapshot: response.snapshot,
    };
  }

  return {
    memberId: response.memberId,
    roomCode: binding.roomCode,
    snapshot: response.snapshot,
    replacedSocket: {
      socketId: binding.replacedSocketId,
      memberId,
    },
  };
}
