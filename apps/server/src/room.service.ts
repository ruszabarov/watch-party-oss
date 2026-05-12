import {
  applyPlaybackUpdate,
  createRoomState,
  normalizeRoomCode,
  removeRoomMember,
  type CreateRoomRequest,
  type JoinRoomRequest,
  type OperationResult,
  type PartySnapshot,
  type PlaybackUpdate,
  type RoomResponse,
  type RoomState,
  toPartySnapshot,
  upsertRoomMember,
} from '@open-watch-party/shared';

import { logger } from './logger';
import { createInMemoryRoomStore, type RoomStore, type RoomStoreRemovalReason } from './room.store';
import { failure, success } from './utils';

export type RoomLeaveResult = {
  readonly roomCode: string;
  readonly remainingSnapshot: PartySnapshot | null;
};

export type PlaybackUpdateResult = {
  readonly roomCode: string;
  readonly snapshot: PartySnapshot;
};

export type RoomServiceOptions = {
  onRoomRemoved?: (room: RoomState, reason: RoomStoreRemovalReason) => void;
};

const DEFAULT_MAX_ROOMS = 1_000;
const DEFAULT_ROOM_IDLE_TTL_MS = 6 * 60 * 60 * 1_000;
const log = logger.child({ scope: 'room-service' });

export class RoomService {
  private readonly roomStore: RoomStore;

  constructor(options: RoomServiceOptions = {}) {
    this.roomStore = createInMemoryRoomStore({
      maxRooms: DEFAULT_MAX_ROOMS,
      roomIdleTtlMs: DEFAULT_ROOM_IDLE_TTL_MS,
      onRoomRemoved: (room, reason) => {
        log.info(
          {
            roomCode: room.roomCode,
            reason,
            memberCount: room.members.size,
          },
          'room:removed',
        );
        options.onRoomRemoved?.(room, reason);
      },
    });
  }

  createRoom(payload: CreateRoomRequest): OperationResult<RoomResponse> {
    const roomCode = this.roomStore.generateUniqueRoomCode();
    const room = createRoomState(roomCode, payload);
    upsertRoomMember(room, payload.memberId, payload.memberName);
    this.roomStore.set(room);

    const snapshot = toPartySnapshot(room);

    log.info(
      {
        roomCode: room.roomCode,
        memberId: payload.memberId,
        memberCount: room.members.size,
        roomCount: this.roomStore.size(),
      },
      'room:create_ok',
    );

    return success({
      memberId: payload.memberId,
      snapshot,
    });
  }

  joinRoom(payload: JoinRoomRequest): OperationResult<RoomResponse> {
    const room = this.roomStore.get(normalizeRoomCode(payload.roomCode));
    if (!room) {
      return failure('Room not found.');
    }

    upsertRoomMember(room, payload.memberId, payload.memberName);
    this.roomStore.set(room);

    const snapshot = toPartySnapshot(room);

    log.info(
      {
        roomCode: payload.roomCode,
        memberId: payload.memberId,
        memberCount: room.members.size,
        roomCount: this.roomStore.size(),
      },
      'room:join_ok',
    );

    return success({
      memberId: payload.memberId,
      snapshot,
    });
  }

  leaveRoom(roomCodeValue: string, memberId: string): RoomLeaveResult {
    const roomCode = normalizeRoomCode(roomCodeValue);
    const room = this.roomStore.get(roomCode);

    if (!room) {
      return { roomCode, remainingSnapshot: null };
    }

    removeRoomMember(room, memberId);

    if (room.members.size === 0) {
      log.info({ roomCode, memberId }, 'room:remove_empty');
      this.roomStore.delete(roomCode);
      return { roomCode, remainingSnapshot: null };
    }

    this.roomStore.set(room);
    const snapshot = toPartySnapshot(room);
    log.info(
      {
        roomCode,
        memberId,
        memberCount: room.members.size,
      },
      'room:member_left',
    );

    return { roomCode, remainingSnapshot: snapshot };
  }

  updatePlayback(
    roomCodeValue: string,
    memberId: string,
    payload: PlaybackUpdate,
  ): OperationResult<PlaybackUpdateResult> {
    const room = this.roomStore.get(normalizeRoomCode(roomCodeValue));
    if (!room) {
      return failure('Room not found.');
    }

    if (!room.members.has(memberId)) {
      return failure('Member is not part of this room.');
    }

    const playback = applyPlaybackUpdate(room, payload, memberId);
    const snapshot = toPartySnapshot(room);

    this.roomStore.set(room);
    log.debug(
      {
        roomCode: room.roomCode,
        memberId,
        mediaId: playback.mediaId,
        playing: playback.playing,
        positionSec: playback.positionSec,
        playbackSequence: playback.sequence,
      },
      'playback:update_ok',
    );

    return success({ roomCode: room.roomCode, snapshot });
  }
}
